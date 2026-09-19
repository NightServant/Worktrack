import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/apiAuth'
import { rejectReason, normalizeTargetUrl } from '@/lib/jobUrl'
import { logSecurityEvent } from '@/lib/securityLog'
import { capabilitiesOf, readIntegrationConfig } from '@/services/integrations/config'
import { fillPostingGaps, type AutofillEnvelope } from '@/services/integrations/postingFill'

/**
 * Whether the extractor's reply is the envelope this app expects.
 *
 * CHECKED RATHER THAN CAST, because the thing after this reads `.values` and
 * `.warnings`: a deployment running an older extractor, or one answering with
 * an error body, must fall through to the passthrough rather than throw on the
 * way to an enrichment nobody asked for.
 */
function isEnvelope(value: unknown): value is AutofillEnvelope {
  if (!value || typeof value !== 'object') return false
  const body = value as Partial<AutofillEnvelope>
  return (
    !!body.values &&
    typeof body.values === 'object' &&
    !!body.confidence &&
    typeof body.confidence === 'object' &&
    Array.isArray(body.warnings)
  )
}

/**
 * The public door to job-posting extraction.
 *
 * THE EXTRACTOR ITSELF HAS NO DOOR. It is a Vercel Service with no top-level
 * rewrite, so it is unroutable from the internet; this route reaches it over a
 * binding, which injects `EXTRACTOR_URL` at runtime. That arrangement is the
 * whole security design: a service that fetches an arbitrary URL on request IS
 * an open proxy running on our egress IP with our rate budget, and the only
 * thing that stops it being one is that nobody else can call it.
 *
 * So everything that decides WHETHER a fetch happens lives here:
 *
 *   1. Who is asking      -- `authenticate`, before the body is even read.
 *   2. How often          -- a per-caller throttle.
 *   3. Where they may point it -- the SSRF gate in lib/jobUrl.
 *
 * The extractor re-checks the URL a redirect lands on, because only the thing
 * performing the fetch can see that. Two copies, two different questions.
 *
 * `runtime = 'nodejs'`: this reads an arbitrary third-party page through the
 * service, which can take the better part of the 12s the extractor allows.
 */
export const runtime = 'nodejs'

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 8

/**
 * The most page source this route will carry, in characters.
 *
 * A REAL POSTING IS WELL UNDER THIS. Indeed's `viewjob` document measured
 * about 1.7MB on 2026-09-17, and it is one of the heavier ones; 3MB leaves
 * room for a fatter page without becoming a place to post arbitrary bulk.
 * Refused rather than truncated: half a document parses into fields that are
 * quietly wrong, which is worse than a message saying it was too big.
 */
const MAX_HTML_CHARS = 3_000_000

/**
 * An affordance, not a boundary -- the same words `lib/authRateLimit.ts` uses
 * about itself, and true for the same reason. It is per-instance memory, and
 * Fluid Compute reuses instances rather than guaranteeing one, so a determined
 * caller spread across instances gets more than eight. What it genuinely stops
 * is a stuck retry loop and a rage-clicked button, which is what the Deno
 * function's identical throttle was there for.
 */
const attempts = new Map<string, number[]>()

function throttle(key: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldest = recent[0]
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000)),
    }
  }
  recent.push(now)
  attempts.set(key, recent)
  return { allowed: true, retryAfterSeconds: 0 }
}

export async function POST(request: Request) {
  // FIRST, and before the body is parsed. A route that reads a body and only
  // then 401s has already paid for the request it is rejecting.
  //
  // `routesAreGuarded.test.ts` asserts that ordering by comparing SOURCE
  // OFFSETS, so it reads comments too -- naming the parse call in prose above
  // this line is enough to fail it. That is the test being blunt rather than
  // wrong, and the fix is to say it differently, not to loosen the guard.
  const auth = await authenticate(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status })
  }

  // Keyed on the signed-in user, not an IP: the throttle exists to stop one
  // person's stuck loop, and an IP is shared by everyone behind a NAT.
  const limit = throttle(auth.user.id)
  if (!limit.allowed) {
    // THE `unusual traffic` SIGNAL. The throttle was firing into silence,
    // which makes a rate limit a control nobody can audit: there is no way to
    // tell a working one from one that never triggers. One of these is a
    // rage-click; a hundred from one id is a loop or a script.
    logSecurityEvent({
      kind: 'rate.limited',
      route: '/api/autofill',
      userId: auth.user.id,
      status: 429,
    })
    return NextResponse.json(
      { error: 'Too many requests', retryAfterSeconds: limit.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    )
  }

  let body: { url?: unknown; html?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const reason = rejectReason(body?.url)
  if (reason) {
    // THE SSRF GATE REFUSING SOMETHING. A URL this route will not fetch is the
    // single most interesting rejection in the app: it is either a mistake or
    // somebody probing what the server will reach on their behalf, and the two
    // are told apart by how many there are. `reason` is our own closed set of
    // strings, never the caller's URL -- logging an attacker-supplied URL is
    // how a log drain becomes a place to inject.
    logSecurityEvent({
      kind: 'request.rejected',
      route: '/api/autofill',
      userId: auth.user.id,
      reason,
      status: 400,
    })
    return NextResponse.json({ error: reason }, { status: 400 })
  }


  /**
   * PAGE SOURCE THE CALLER ALREADY HAS, which is the bookmarklet's whole point.
   *
   * The extractor has accepted `html` since M7 and this route has never sent
   * it, so the capability sat half-built: `ExtractRequest.html` skips the fetch
   * entirely and parses what it is given. That is the one route to a posting
   * behind an anti-bot wall that involves no proxy, no vendor and no key --
   * a browser already looking at the page is not a scraper, and Indeed cannot
   * tell it apart from a reader because it IS one.
   *
   * THE SSRF GATE ABOVE STILL RUNS, deliberately, even though nothing is
   * fetched on this path. The URL is still recorded on the application and
   * still shown to the user, and a gate that applies only sometimes is a gate
   * whose behaviour nobody can state. It costs one regex against a string the
   * caller sent anyway.
   */
  const html = typeof body?.html === 'string' ? body.html : ''
  if (html.length > MAX_HTML_CHARS) {
    return NextResponse.json(
      { error: 'That page is too large to import. Paste the description instead.' },
      { status: 413 }
    )
  }

  // Read before the fetch so the capability check below costs nothing.
  const config = readIntegrationConfig()
  const extractor = process.env.EXTRACTOR_URL
  if (!extractor) {
    logSecurityEvent({
      kind: 'config.missing',
      route: '/api/autofill',
      reason: 'extractor-binding',
      status: 503,
    })
    // 503, not 500: the deployment is missing its binding, which is a
    // configuration fact rather than a failure of this request. Retrying with
    // a different URL will not help and the message says so.
    return NextResponse.json(
      { error: 'Auto-fill is not configured for this deployment.' },
      { status: 503 }
    )
  }

  try {
    const response = await fetch(new URL('extract', extractor), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `html` omitted rather than sent empty: the extractor's field is
      // `str | None`, and an empty string is a page it would try to parse.
      body: JSON.stringify({
        url: normalizeTargetUrl(String(body.url)),
        ...(html ? { html } : {}),
      }),
    })
    const payload = await response.json()

    /*
     * THE GAPS THE PARSER LEFT, READ OUT OF THE POSTING'S OWN TEXT (Gabe,
     * 2026-09-19: "one for job description filling").
     *
     * ONLY ON A SUCCESSFUL EXTRACT, and only when a model is configured. The
     * parser stays authoritative: `fillPostingGaps` is offered the empty
     * fields and merges back only what it filled, so this can add a salary
     * and can never change one. Every failure returns the parser's envelope
     * untouched -- auto-fill worked before this existed and works identically
     * when the free tier is rate-limited.
     */
    if (response.ok && capabilitiesOf(config).fillPosting && isEnvelope(payload)) {
      return NextResponse.json(await fillPostingGaps(payload, { config }), {
        status: response.status,
      })
    }
    return NextResponse.json(payload, { status: response.status })
  } catch {
    logSecurityEvent({
      kind: 'request.failed',
      route: '/api/autofill',
      userId: auth.user.id,
      reason: 'extractor-unreachable',
      status: 502,
    })
    // THE EXTRACTOR IS UNREACHABLE, which is not the same thing as a posting
    // that cannot be read -- and saying the latter sends the reader off to
    // blame a URL that is fine. It cost an afternoon on 2026-09-10: locally
    // `npm run dev` starts Next and nothing else, so `EXTRACTOR_URL` points at
    // a port with nothing listening on it and every auto-fill came back
    // "Could not read that job posting".
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === 'development'
            ? 'The extractor is not running. Start it with `npm run dev:scraper`.'
            : 'The posting reader is unavailable right now. Try again shortly.',
      },
      { status: 502 }
    )
  }
}
