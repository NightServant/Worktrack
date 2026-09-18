import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/apiAuth'
import { rejectReason, normalizeTargetUrl } from '@/lib/jobUrl'
import { logSecurityEvent } from '@/lib/securityLog'

/**
 * The public door to profile extraction, for every source the panel reads.
 *
 * IT WAS LINKEDIN'S ALONE until 2026-09-18. It now takes a LIST of addresses --
 * a LinkedIn profile, a GitHub account, a job board, a personal site -- and the
 * extractor reads each by whichever route fits it and merges the results. The
 * gate below is unchanged in kind and now walks the list: one bad address
 * refuses the request, because a partial SSRF check is not one.
 *
 * IT IS `/api/autofill` FOR A PERSON INSTEAD OF A POSTING, and it is
 * deliberately the same shape: the extractor service has no top-level rewrite,
 * so it is unroutable from the internet, and this route reaches it over a
 * binding that injects `EXTRACTOR_URL`. A service that fetches an arbitrary URL
 * on request IS an open proxy running on our egress IP with our Firecrawl
 * budget; the only thing that stops it being one is that nobody else can call
 * it.
 *
 * So everything that decides WHETHER a fetch happens lives here:
 *
 *   1. Who is asking      -- `authenticate`, before the body is even read.
 *   2. How often          -- a per-caller throttle, tighter than auto-fill's
 *                            because every one of these costs a Firecrawl
 *                            credit and nobody imports their own profile
 *                            eight times a minute.
 *   3. Where they may point it -- the SSRF gate in lib/jobUrl.
 *
 * The extractor re-checks the URL a redirect lands on, because only the thing
 * performing the fetch can see that.
 *
 * `runtime = 'nodejs'`: this waits on a hosted browser rendering a third-party
 * page, which is a poor fit for an edge budget.
 */
export const runtime = 'nodejs'

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 3

/**
 * How many addresses one import may carry.
 *
 * Four is the panel's own list -- LinkedIn, GitHub, JobStreet, Glassdoor --
 * and six leaves room for a personal site and one more without turning a
 * single throttle tick into an unbounded number of paid fetches.
 */
const MAX_PROFILE_URLS = 6

/**
 * The biggest captured page this route will forward.
 *
 * A logged-in LinkedIn profile is heavy even with its scripts stripped, and it
 * is the one page here that costs nothing to accept: no fetch leaves the
 * service, no third party is involved, and the only thing this number protects
 * is memory. The extractor caps it again at the same size.
 */
const MAX_HTML_CHARS = 6_000_000

/**
 * An affordance, not a boundary -- per-instance memory, and Fluid Compute
 * reuses instances rather than guaranteeing one. What it genuinely stops is a
 * stuck retry loop and a rage-clicked button, which is the whole job.
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
      route: '/api/profile',
      userId: auth.user.id,
      status: 429,
    })
    return NextResponse.json(
      { error: 'Too many requests', retryAfterSeconds: limit.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    )
  }

  let body: { url?: unknown; urls?: unknown; html?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  /**
   * THE ADDRESSES, AND THERE MAY NOW BE SEVERAL (Gabe, 2026-09-18: the profile
   * panel reads LinkedIn, GitHub, JobStreet and Glassdoor and merges them).
   *
   * `url` STAYS because a request body is a wire contract; anything still
   * sending one keeps working. Both forms land in the same list, which is what
   * the gate below walks.
   *
   * THE CAP IS HERE AS WELL AS IN THE EXTRACTOR, and that is not belt and
   * braces for its own sake: this route is the one that knows WHO is asking,
   * and the throttle above counts REQUESTS. Without a cap on addresses, one
   * request is one throttle tick and a hundred hosted fetches.
   */
  const requested = [
    ...(Array.isArray(body?.urls) ? body.urls : []),
    ...(body?.url === undefined ? [] : [body.url]),
  ]
  if (requested.length === 0) {
    return NextResponse.json({ error: 'No profile address was sent' }, { status: 400 })
  }
  if (requested.length > MAX_PROFILE_URLS) {
    return NextResponse.json(
      { error: `Send at most ${MAX_PROFILE_URLS} profile addresses` },
      { status: 400 }
    )
  }

  for (const candidate of requested) {
    const reason = rejectReason(candidate)
    if (reason) {
      // THE SSRF GATE REFUSING SOMETHING. A URL this route will not fetch is
      // the single most interesting rejection in the app: it is either a
      // mistake or somebody probing what the server will reach on their
      // behalf, and the two are told apart by how many there are. `reason` is
      // our own closed set of strings, never the caller's URL -- logging an
      // attacker-supplied URL is how a log drain becomes a place to inject.
      logSecurityEvent({
        kind: 'request.rejected',
        route: '/api/profile',
        userId: auth.user.id,
        reason,
        status: 400,
      })
      return NextResponse.json({ error: reason }, { status: 400 })
    }
  }

  /**
   * THE PAGE THE CALLER IS ALREADY LOOKING AT, from the profile bookmarklet.
   *
   * It belongs to the first address, and the extractor treats it that way. The
   * SSRF gate above still ran on every URL even though nothing will be fetched
   * for this one: the address is still stored and still shown, and a gate that
   * applies only sometimes is a gate whose behaviour nobody can state.
   */
  const html = typeof body?.html === 'string' ? body.html : ''
  if (html.length > MAX_HTML_CHARS) {
    return NextResponse.json(
      { error: 'That page is too large to import.' },
      { status: 413 }
    )
  }

  const extractor = process.env.EXTRACTOR_URL
  if (!extractor) {
    logSecurityEvent({
      kind: 'config.missing',
      route: '/api/profile',
      reason: 'extractor-binding',
      status: 503,
    })
    return NextResponse.json(
      { error: 'Profile import is not configured for this deployment.' },
      { status: 503 }
    )
  }

  try {
    const response = await fetch(new URL('profile', extractor), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: requested.map((candidate) => normalizeTargetUrl(String(candidate))),
        // Omitted rather than sent empty: the extractor's field is `str |
        // None`, and an empty string is a page it would try to parse.
        ...(html ? { html } : {}),
      }),
    })
    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch {
    logSecurityEvent({
      kind: 'request.failed',
      route: '/api/profile',
      userId: auth.user.id,
      reason: 'extractor-unreachable',
      status: 502,
    })
    // Unreachable, not unreadable. See /api/autofill for why the distinction
    // is worth the two branches.
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === 'development'
            ? 'The extractor is not running. Start it with `npm run dev:scraper`.'
            : 'The profile reader is unavailable right now. Try again shortly.',
      },
      { status: 502 }
    )
  }
}
