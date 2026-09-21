import { describe, it, expect, vi, afterEach } from 'vitest'
/*
  THE SESSION, STUBBED. `fetchScrapedJobs` asks supabase-js for the access
  token to put in the Authorization header; the module itself is a browser
  singleton and this suite has no browser.
*/
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'token-123' } } }),
    },
  },
}))

import {
  SCRAPED_SOURCES,
  fetchScrapedJobs,
  geoSlugForCountry,
  toFeedJob,
  toScrapedJob,
  trackedFeedRoles,
} from '../jobFeed'

const RAW = {
  id: 152938,
  url: 'https://jobicy.com/jobs/152938-software-engineer-backend',
  jobTitle: 'Software Engineer, Backend',
  companyName: 'Vercel',
  jobIndustry: ['Software Engineering'],
  jobType: ['Full-Time'],
  jobGeo: 'USA',
  jobLevel: 'Any',
  jobExcerpt: 'About Vercel: we free people to ship what&#039;s next&hellip;',
  jobDescription: '<h3>About</h3><script>alert(1)</script>',
  pubDate: '2026-09-09T17:23:14+00:00',
  salaryMin: 196000,
  salaryMax: 294000,
  salaryCurrency: 'USD',
  salaryPeriod: 'yearly',
}

/**
 * The boundary between a third-party feed and this app.
 *
 * Every test here is about what does NOT get through: markup, entities left
 * raw, a non-http scheme in something that becomes an `href`, and a row too
 * incomplete to render honestly.
 */
describe('toFeedJob', () => {
  it('keeps the fields the panel shows', () => {
    const job = toFeedJob(RAW)!
    expect(job.title).toBe('Software Engineer, Backend')
    expect(job.company).toBe('Vercel')
    expect(job.geo).toBe('USA')
    expect(job.level).toBe('Any')
    expect(job.industry).toBe('Software Engineering')
    expect(job.salaryMin).toBe(196000)
    expect(job.salaryCurrency).toBe('USD')
    expect(job.publishedAt).toBe(new Date('2026-09-09T17:23:14+00:00').toISOString())
  })

  it('drops the description entirely', () => {
    // 3-6KB of third-party HTML per row that nothing renders. Keeping it would
    // leave untrusted markup one careless dangerouslySetInnerHTML from the DOM.
    const job = toFeedJob(RAW)! as unknown as Record<string, unknown>
    expect(job.jobDescription).toBeUndefined()
    expect(JSON.stringify(job)).not.toContain('<script>')
  })

  it('decodes entities and strips tags out of the excerpt', () => {
    const job = toFeedJob({ ...RAW, jobExcerpt: '<b>Ship</b> fast &amp; well&hellip;' })!
    expect(job.excerpt).toBe('Ship fast & well…')
  })

  it('refuses a URL that is not http(s)', () => {
    // The URL becomes an `href`. `javascript:` there is a stranger's script
    // running on this app's own origin.
    expect(toFeedJob({ ...RAW, url: 'javascript:alert(1)' })).toBeNull()
    expect(toFeedJob({ ...RAW, url: 'data:text/html,<script>alert(1)</script>' })).toBeNull()
    expect(toFeedJob({ ...RAW, url: 'not a url' })).toBeNull()
  })

  it('drops a row that cannot be shown, tracked or placed in time', () => {
    expect(toFeedJob({ ...RAW, jobTitle: '' })).toBeNull()
    expect(toFeedJob({ ...RAW, pubDate: 'sometime' })).toBeNull()
    expect(toFeedJob({ ...RAW, pubDate: undefined })).toBeNull()
    expect(toFeedJob(null)).toBeNull()
  })

  it('names a company it was not given rather than printing undefined', () => {
    expect(toFeedJob({ ...RAW, companyName: null })!.company).toBe('unnamed company')
  })

  it('treats a zero or negative salary as no salary', () => {
    // The feed sends 0 for "not stated", and "$0 – $0" is a worse answer than
    // saying nothing.
    const job = toFeedJob({ ...RAW, salaryMin: 0, salaryMax: 0 })!
    expect(job.salaryMin).toBeNull()
    expect(job.salaryMax).toBeNull()
  })
})

describe('geoSlugForCountry', () => {
  const LOCATIONS = [
    { slug: 'anywhere', name: 'Anywhere' },
    { slug: 'apac', name: 'APAC' },
    { slug: 'philippines', name: 'Philippines' },
    { slug: 'singapore', name: 'Singapore' },
    { slug: 'usa', name: 'USA' },
  ]

  it('matches a country code to the feed slug through Intl, with no second lookup table', () => {
    // The browser already knows PH is "Philippines" and the feed already
    // publishes a location by that name. Matching the two strings is the whole
    // mapping, and it stays correct as the feed adds countries.
    expect(geoSlugForCountry('PH', LOCATIONS)).toBe('philippines')
    expect(geoSlugForCountry('SG', LOCATIONS)).toBe('singapore')
  })

  it('returns null for a country the feed does not list', () => {
    // Jobicy carries 55 locations; most countries are not among them, and
    // "anywhere" is a better answer than a wrong country.
    expect(geoSlugForCountry('IN', LOCATIONS)).toBeNull()
    expect(geoSlugForCountry('GB', LOCATIONS)).toBeNull()
  })

  it('handles nothing to match against', () => {
    expect(geoSlugForCountry(null, LOCATIONS)).toBeNull()
    expect(geoSlugForCountry('PH', [])).toBeNull()
    // A code Intl cannot name comes back as the code itself; that is not a
    // country name and must not be matched against one.
    expect(geoSlugForCountry('ZZ', LOCATIONS)).toBeNull()
  })
})

describe('trackedFeedRoles', () => {
  const role = (id: string, title: string, company: string, url: string) => ({
    id,
    title,
    company,
    url,
    geo: null,
    level: null,
    industry: null,
    publishedAt: new Date().toISOString(),
    source: 'jobicy' as const,
    excerpt: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
  })

  const application = (id: string, url: string | null, company: string, jobRole: string) => ({
    id,
    url,
    company,
    role: jobRole,
  })

  it('matches on the address a `track it` would have stored', () => {
    const feed = [role('1', 'Junior Web Builder', 'Luxury Presence', 'https://jobicy.com/jobs/152598-junior-web-builder')]
    const tracked = trackedFeedRoles(
      [application('a1', 'https://jobicy.com/jobs/152598-junior-web-builder', 'Luxury Presence', 'Junior Web Builder')],
      feed
    )
    expect(tracked).toEqual({ '1': 'a1' })
  })

  it('ignores the parts of an address that carry no meaning', () => {
    // A board appends `?ref=`, a browser keeps a fragment, a paste gains a
    // trailing slash. None of them make it a different posting.
    const feed = [role('1', 'Junior Web Builder', 'Luxury Presence', 'https://jobicy.com/jobs/152598')]
    const tracked = trackedFeedRoles(
      [application('a1', 'http://www.Jobicy.com/jobs/152598/?ref=saved#top', 'Luxury Presence', 'Junior Web Builder')],
      feed
    )
    expect(tracked).toEqual({ '1': 'a1' })
  })

  it('still matches a posting tracked from the employer’s own page', () => {
    const feed = [role('1', 'Junior Web Builder', 'Luxury Presence', 'https://jobicy.com/jobs/152598')]
    const tracked = trackedFeedRoles(
      [application('a1', 'https://luxurypresence.com/careers/123', 'luxury  presence', 'JUNIOR WEB BUILDER')],
      feed
    )
    expect(tracked).toEqual({ '1': 'a1' })
  })

  it('leaves an untracked role out rather than guessing', () => {
    const feed = [role('1', 'Backend Engineer', 'Vercel', 'https://jobicy.com/jobs/1')]
    expect(trackedFeedRoles([application('a1', null, 'Netlify', 'Backend Engineer')], feed)).toEqual({})
  })
})

describe('rows from the paid boards', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    source: 'linkedin',
    id: 'linkedin:1',
    title: 'Staff Engineer',
    company: 'Chainguard',
    url: 'https://www.linkedin.com/jobs/view/1',
    geo: 'APAC',
    level: 'Senior',
    industry: null,
    publishedAt: '2026-09-20T09:00:00.000Z',
    excerpt: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    ...over,
  })

  it('keeps the board a row came from', () => {
    expect(toScrapedJob(row())?.source).toBe('linkedin')
  })

  it('refuses a source the app does not know', () => {
    // The extractor is a separate service over HTTP, so this is a boundary: an
    // unknown source would reach `SOURCE_LABELS[job.source]` as undefined, and
    // `jobicy` arriving down the paid path would mislabel a free row.
    expect(toScrapedJob(row({ source: 'myspace' }))).toBeNull()
    expect(toScrapedJob(row({ source: 'jobicy' }))).toBeNull()
  })

  it('refuses a javascript: address even though the extractor cleaned it once', () => {
    expect(toScrapedJob(row({ url: 'javascript:alert(1)' }))).toBeNull()
  })

  it('drops a row with no usable date, which the rail groups by', () => {
    expect(toScrapedJob(row({ publishedAt: 'not a date' }))).toBeNull()
  })

  it('names the paid boards, and jobicy is not one of them', () => {
    // Jobicy is free, keyless and always on; nothing in the paid path may ask
    // for it, or a free source would be billed through an actor.
    //
    // GLASSDOOR LEFT ON 2026-09-21, its Apify actor being in maintenance. A
    // board that answers every search with an error is a control that spends a
    // press and a throttle tick to tell you nothing.
    expect([...SCRAPED_SOURCES]).toEqual(['linkedin', 'jobstreet', 'indeed'])
    expect(SCRAPED_SOURCES).not.toContain('jobicy')
    expect(SCRAPED_SOURCES).not.toContain('glassdoor')
  })

  it('matches a board posting against an application by company and title', () => {
    // The tracked indicator has to work for a LinkedIn row the same way it
    // does for a Jobicy one: the reader tracked the job, not the board.
    const feed = [toScrapedJob(row())!]
    const tracked = trackedFeedRoles(
      [{ id: 'a1', url: null, company: 'Chainguard', role: 'Staff Engineer' }],
      feed
    )
    expect(tracked).toEqual({ 'linkedin:1': 'a1' })
  })
})

describe('asking the paid boards', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('proves who is asking, or every board answers "Sign in to use this."', async () => {
    /*
      THE BUG THIS EXISTS FOR, shipped and found the same day (2026-09-21).
      `/api/jobfeed` authenticates with `lib/apiAuth`, which reads an
      Authorization header and NOT the session cookie -- so a same-origin fetch
      that carried only cookies was anonymous as far as the route was
      concerned, and every board came back 401 to somebody who was signed in.

      The header is the assertion. Reverting the fix makes this red.
    */
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ jobs: [], notes: [] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchScrapedJobs(['linkedin'], { query: 'frontend' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/jobfeed')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-123')
  })

  it('spends nothing when no board was asked for', async () => {
    // `enabled` on the hook is the first guard; this is the second. An empty
    // selection must never become a request, because a request is up to four
    // crawls that bill per posting.
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchScrapedJobs([])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({ jobs: [], notes: [] })
  })
})
