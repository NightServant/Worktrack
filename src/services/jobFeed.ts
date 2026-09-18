/**
 * Remote job postings, from Jobicy (https://jobicy.com/jobs-rss-feed).
 *
 * WHY THIS ONE, out of the twenty-four on publicapis.dev/category/jobs (Gabe
 * pointed at that page, 2026-09-10). Three were keyless AND sent
 * `access-control-allow-origin: *`, which is what a browser-side fetch needs
 * — Arbeitnow, The Muse and Jobicy. Measured the same day:
 *
 *   Arbeitnow  — keyless, CORS, but the board is German/European. A tracker
 *                used from Manila would open on roles nobody here can take.
 *   The Muse   — keyless, CORS, 411k jobs, but US-office-centric and its
 *                filters are category+location rather than remote-first.
 *   Jobicy     — keyless, CORS, REMOTE-ONLY, carries `pubDate`, salary bands,
 *                a geo eligibility field and a seniority level, and publishes
 *                live taxonomy endpoints for its own filter slugs.
 *
 * Remote-only is what settles it: it is the category of role this app's owner
 * can actually apply for from where he is, and `jobGeo` says which regions a
 * posting will hire in rather than leaving that to be guessed from an office
 * address. Himalayas was rejected on measurement — no CORS header, so it
 * cannot be called from a browser at all.
 *
 * ATTRIBUTION IS A CONDITION OF USE, not a courtesy. Every response carries a
 * `friendlyNotice` asking that Jobicy be "clearly credited with a direct link
 * to the source, and all application buttons redirect to the original job URL
 * provided in this feed". `JobFeed` renders that credit and links every row to
 * `job.url` — nothing here rewrites or hides the source.
 *
 * NOTHING IS STORED. This is a read-through panel: no table, no cache beyond
 * react-query's, and no row of somebody else's data written into this
 * database. Tracking a posting creates an application from its URL through the
 * ordinary add flow, which is the app's own extractor reading the page.
 *
 * `jobDescription` IS DROPPED AT THIS BOUNDARY, and that is a security
 * decision as much as a payload one. It is 3–6KB of third-party HTML per row
 * that nothing renders; keeping it would put untrusted markup one careless
 * `dangerouslySetInnerHTML` away from the DOM. Everything below is plain text
 * or a scheme-checked URL.
 */

export interface FeedJob {
  id: string
  title: string
  company: string
  /** The Jobicy posting. Always http(s); see `safeUrl`. */
  url: string
  /** Regions the employer will hire in, e.g. `APAC`, `Anywhere`. */
  geo: string | null
  /** Seniority as the board states it, e.g. `Any`, `Senior`. */
  level: string | null
  industry: string | null
  /** ISO instant the posting went up. */
  publishedAt: string
  /** One or two sentences, entity-decoded, no markup. */
  excerpt: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
}

export interface FeedFacet {
  slug: string
  name: string
}

const API = 'https://jobicy.com/api/v2/remote-jobs'

/** Where the chosen industry is remembered. Per-browser; there is no column. */
export const JOB_FEED_INDUSTRY_KEY = 'worktrack.job-feed-industry'

/** Where the chosen region is remembered. Same trade as the industry. */
export const JOB_FEED_GEO_KEY = 'worktrack.job-feed-geo'

/**
 * The handful of named entities this feed actually emits.
 *
 * A MAP RATHER THAN THE DOM. The obvious decode is to set `innerHTML` on a
 * detached element and read `textContent` back — which is the one technique
 * that must never be used on third-party text, because it parses it. Jobicy's
 * excerpts use exactly these; anything else survives as its own literal, which
 * is ugly and safe rather than pretty and dangerous.
 */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
  '&apos;': "'",
  '&hellip;': '…',
  '&nbsp;': ' ',
  '&ndash;': '–',
  '&mdash;': '—',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
}

function decode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value
    .replace(/&[a-z]+;|&#0?39;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    // Any stray tag is removed rather than escaped: the excerpt is prose and a
    // half-open `<div` in the middle of it is noise either way.
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}

/**
 * A URL from the feed, or null.
 *
 * SCHEME-CHECKED, because this string ends up in an `href`. A feed is a
 * stranger: `javascript:` in that position is a script this app would be
 * running on its own origin.
 */
function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function first(value: unknown): string | null {
  if (Array.isArray(value)) return decode(value[0])
  return decode(value)
}

function toNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** One row of the feed, or null when it is missing the two fields that matter. */
export function toFeedJob(raw: unknown): FeedJob | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const title = decode(row.jobTitle)
  const url = safeUrl(row.url)
  const published = typeof row.pubDate === 'string' ? new Date(row.pubDate) : null
  // A posting with no title, no link or no date cannot be shown, tracked or
  // placed in time. Dropped rather than rendered as "undefined".
  if (!title || !url || !published || Number.isNaN(published.getTime())) return null

  return {
    id: String(row.id ?? url),
    title,
    company: decode(row.companyName) ?? 'unnamed company',
    url,
    geo: decode(row.jobGeo),
    level: decode(row.jobLevel),
    industry: first(row.jobIndustry),
    publishedAt: published.toISOString(),
    excerpt: decode(row.jobExcerpt),
    salaryMin: toNumber(row.salaryMin),
    salaryMax: toNumber(row.salaryMax),
    salaryCurrency: decode(row.salaryCurrency),
  }
}

async function getJson(params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const query = new URLSearchParams(params).toString()
  const response = await fetch(`${API}?${query}`, { signal })
  if (!response.ok) throw new Error(`Jobicy answered ${response.status}`)
  return response.json()
}

export interface FeedQuery {
  /** How many to ask for. The API caps at 200; this panel wants a page. */
  count?: number
  /** An industry slug from `fetchFeedIndustries`, or null for everything. */
  industry?: string | null
  /** A geo slug, e.g. `apac`. Null for anywhere. */
  geo?: string | null
}

/** Recent remote postings, newest first. */
export async function fetchRemoteJobs(
  { count = 20, industry = null, geo = null }: FeedQuery = {},
  signal?: AbortSignal
): Promise<FeedJob[]> {
  const params: Record<string, string> = { count: String(count) }
  if (industry) params.industry = industry
  if (geo) params.geo = geo

  const body = (await getJson(params, signal)) as { jobs?: unknown }
  const rows = Array.isArray(body.jobs) ? body.jobs : []
  return rows
    .map(toFeedJob)
    .filter((job): job is FeedJob => job !== null)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

/**
 * The geo slugs the feed currently offers — regions and countries both.
 *
 * IT EXISTS BECAUSE THE FEED WAS ALL AMERICAN (Gabe, 2026-09-11: "I want you
 * to include jobs outside of US"). Unfiltered, Jobicy returns whatever is
 * newest, and what is newest is overwhelmingly US-eligible — so a tracker used
 * from Manila opened on a rail of roles nobody there can take. `jobGeo` is an
 * ELIGIBILITY field, not an office address: `APAC` means they will hire in
 * APAC, which is the question somebody outside the US is actually asking.
 *
 * Fetched rather than hardcoded, for the reason the industries are: the API's
 * own documentation says to read the current slugs, and a stale one returns an
 * empty feed that looks like a broken panel.
 */
export async function fetchFeedLocations(signal?: AbortSignal): Promise<FeedFacet[]> {
  const body = (await getJson({ get: 'locations' }, signal)) as { locations?: unknown }
  const rows = Array.isArray(body.locations) ? body.locations : []
  return rows
    .map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>
      const slug = decode(row.geoSlug)
      const name = decode(row.geoName)
      return slug && name ? { slug, name } : null
    })
    .filter((facet): facet is FeedFacet => facet !== null)
}

/**
 * The feed's slug for a country code, by matching the country's English name.
 *
 * `Intl.DisplayNames` IS THE WHOLE TRICK and it is why there is no second
 * lookup table in this repository. The browser already knows that `PH` is
 * "Philippines"; Jobicy already publishes a location called "Philippines".
 * Matching those two strings is the entire mapping, and it stays correct as
 * the feed adds countries without anybody maintaining a list.
 *
 * Returns null when the feed has no such country -- most of them -- and the
 * caller falls back to a region or to anywhere.
 */
export function geoSlugForCountry(
  countryCode: string | null,
  locations: FeedFacet[]
): string | null {
  if (!countryCode || locations.length === 0) return null
  let name: string | undefined
  try {
    name = new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode)
  } catch {
    return null
  }
  if (!name || name === countryCode) return null
  const wanted = name.toLowerCase()
  return locations.find((facet) => facet.name.toLowerCase() === wanted)?.slug ?? null
}

/**
 * The industry slugs the feed currently offers.
 *
 * FETCHED, NOT HARDCODED, because the API's own documentation says to: "Use
 * current slugs… since available options may change over time." A stale
 * hardcoded slug returns an empty feed that looks like a broken panel.
 */
export async function fetchFeedIndustries(signal?: AbortSignal): Promise<FeedFacet[]> {
  const body = (await getJson({ get: 'industries' }, signal)) as { industries?: unknown }
  const rows = Array.isArray(body.industries) ? body.industries : []
  return rows
    .map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>
      const slug = decode(row.industrySlug)
      const name = decode(row.industryName)
      return slug && name ? { slug, name } : null
    })
    .filter((facet): facet is FeedFacet => facet !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The address, stripped of everything that varies without meaning.
 *
 * A tracked application holds the URL the reader handed to the add wizard, and
 * the rail hands it `job.url` -- so they are the same string in the ordinary
 * case. They stop being the same string for reasons that are not about the
 * posting: a `?ref=` a board appended, a `#fragment` the browser kept, a
 * trailing slash, `www.`, or `http` where the feed later said `https`.
 * Comparing raw strings would call the same posting untracked over a question
 * mark.
 */
function addressKey(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.host.replace(/^www\./, '').toLowerCase()}${path.toLowerCase()}`
  } catch {
    return null
  }
}

/** `luxury presence|junior web builder`. Case and spacing carry no meaning here. */
function roleKey(company: string | null, role: string | null): string | null {
  const clean = (value: string | null) => value?.replace(/\s+/g, ' ').trim().toLowerCase() || null
  const left = clean(company)
  const right = clean(role)
  return left && right ? `${left}|${right}` : null
}

/**
 * Which roles in the rail are already applications, as `feed id -> record id`.
 *
 * WHY THE RAIL NEEDS TO KNOW (Gabe, 2026-09-18: "Junior Web Builder is already
 * tracked by my system ... the status link must be changed to tracked"). The
 * panel offered `track it` on every role whatever the reader had already done,
 * so the one thing it could say about a posting -- whether it is already in the
 * pipeline -- it did not say, and pressing it opened the add wizard on a
 * posting that has a record two screens away.
 *
 * TWO KEYS, IN THAT ORDER, and the second is not a nicety. The address is the
 * exact match and is what `track it` itself produces: `?add=<url>` fills the
 * wizard's URL field, so a role tracked FROM this rail stores this rail's link.
 * Company-and-title catches the same posting reached another way -- from the
 * employer's own careers page, or from the board's app -- which is the ordinary
 * case for anybody who does not live in this panel.
 *
 * NOTHING IS FETCHED AND NOTHING IS WRITTEN. Both sides are already in memory:
 * the applications the screen loaded and the rail it is drawing.
 */
export function trackedFeedRoles(
  applications: { id: string; url: string | null; company: string; role: string }[],
  feed: FeedJob[]
): Record<string, string> {
  const byAddress = new Map<string, string>()
  const byRole = new Map<string, string>()
  for (const application of applications) {
    const address = addressKey(application.url)
    // FIRST WINS, both times. Two applications for one posting is a duplicate
    // the reader can see on their own board; picking the later one would move
    // the link under them without explaining why.
    if (address && !byAddress.has(address)) byAddress.set(address, application.id)
    const role = roleKey(application.company, application.role)
    if (role && !byRole.has(role)) byRole.set(role, application.id)
  }

  const tracked: Record<string, string> = {}
  for (const job of feed) {
    const match =
      byAddress.get(addressKey(job.url) ?? '') ?? byRole.get(roleKey(job.company, job.title) ?? '')
    if (match) tracked[job.id] = match
  }
  return tracked
}
