import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/apiAuth'
import { logSecurityEvent } from '@/lib/securityLog'
import { SCRAPED_SOURCES, type FeedSource } from '@/services/jobFeed'

/**
 * The paid half of the fresh-roles rail: four boards, behind four Apify actors.
 *
 * WHY THIS ROUTE EXISTS AT ALL, when Jobicy needs none. Jobicy is keyless and
 * CORS-open, so the browser fetches it directly and no server is involved.
 * These four are the opposite in every respect: they need a token that must
 * never reach a browser, they cost money per result, and they take tens of
 * seconds. Every one of those is a reason for a gate.
 *
 * IT IS `/api/profile` FOR POSTINGS, deliberately the same shape. The
 * extractor service has no top-level rewrite and is unroutable from the
 * internet; this route reaches it over the binding that injects
 * `EXTRACTOR_URL`. A service that spends money on request IS a way to spend
 * somebody else's money, and the only thing that stops it being one is that
 * nobody else can call it. So everything that decides WHETHER a run happens
 * lives here:
 *
 *   1. Who is asking -- `authenticate`, before the body is read.
 *   2. How often     -- a per-caller throttle, tighter than auto-fill's,
 *                       because one request here is up to four actor runs.
 *   3. What they may ask for -- a closed set of sources, and a capped limit.
 *
 * NO URL IS TAKEN FROM THE CALLER, which is what makes this route a smaller
 * problem than `/api/profile` rather than a larger one. The addresses are the
 * actors' own; the caller supplies a search term and a place, so there is no
 * SSRF surface to gate -- only a spend.
 *
 * `runtime = 'nodejs'`: this waits on a crawler working through a result page,
 * which is a poor fit for an edge budget.
 */
export const runtime = 'nodejs'

const RATE_LIMIT_WINDOW_MS = 60_000

/**
 * Two runs a minute per person.
 *
 * TIGHTER THAN `/api/profile`'s THREE, because one request there is one hosted
 * fetch and one request here is up to four crawls. Nobody refreshes a job rail
 * twice a minute for a reason that is not a stuck retry.
 */
const RATE_LIMIT_MAX_REQUESTS = 2

/** The most postings one source may be asked for. Mirrors the extractor's cap. */
const MAX_LIMIT = 25

/**
 * The longest search term forwarded.
 *
 * It is typed into a box and sent to a third party. A kilobyte of it is not a
 * job title, and the actors bill for the crawl either way.
 */
const MAX_QUERY_CHARS = 120

/**
 * An affordance, not a boundary -- per-instance memory, and Fluid Compute
 * reuses instances rather than guaranteeing one. What it genuinely stops is a
 * stuck retry loop and a rage-clicked button, which is the whole job. The real
 * ceiling on spend is the Apify account's own balance.
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

/** A caller-supplied string, trimmed and capped, or undefined. */
function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, max)
  return trimmed || undefined
}

export async function POST(request: Request) {
  // FIRST, and before the body is parsed. A route that reads a body and only
  // then 401s has already paid for the request it is rejecting.
  const auth = await authenticate(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status })
  }

  // Keyed on the signed-in user rather than an IP: this throttle exists to cap
  // one person's spend, and an IP is shared by everyone behind a NAT.
  const limit = throttle(auth.user.id)
  if (!limit.allowed) {
    logSecurityEvent({
      kind: 'rate.limited',
      route: '/api/jobfeed',
      userId: auth.user.id,
      status: 429,
    })
    return NextResponse.json(
      { error: 'Too many requests', retryAfterSeconds: limit.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    )
  }

  let body: { sources?: unknown; query?: unknown; location?: unknown; limit?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  /**
   * A CLOSED SET, CHECKED HERE. The extractor checks it again -- it is the
   * thing that spends the money and cannot assume its caller -- but an unknown
   * name refused at this end never becomes a request at all.
   */
  const requested = Array.isArray(body?.sources) ? body.sources : []
  const sources = requested.filter((value): value is FeedSource =>
    SCRAPED_SOURCES.includes(value as FeedSource)
  )
  if (sources.length === 0) {
    return NextResponse.json({ error: 'No known source was requested' }, { status: 400 })
  }

  const extractor = process.env.EXTRACTOR_URL
  if (!extractor) {
    logSecurityEvent({
      kind: 'config.missing',
      route: '/api/jobfeed',
      reason: 'extractor-binding',
      status: 503,
    })
    return NextResponse.json(
      { error: 'Board search is not configured for this deployment.' },
      { status: 503 }
    )
  }

  const count = Number(body?.limit)
  try {
    const response = await fetch(new URL('jobs', extractor), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sources: [...new Set(sources)],
        query: text(body?.query, MAX_QUERY_CHARS),
        location: text(body?.location, MAX_QUERY_CHARS),
        limit: Number.isFinite(count) ? Math.max(1, Math.min(count, MAX_LIMIT)) : MAX_LIMIT,
      }),
    })
    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch {
    logSecurityEvent({
      kind: 'request.failed',
      route: '/api/jobfeed',
      userId: auth.user.id,
      reason: 'extractor-unreachable',
      status: 502,
    })
    // Unreachable, not unreadable. See /api/autofill for why the two branches.
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === 'development'
            ? 'The extractor is not running. Start it with `npm run dev:scraper`.'
            : 'Board search is unavailable right now. Try again shortly.',
      },
      { status: 502 }
    )
  }
}
