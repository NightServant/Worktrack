import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

/**
 * What the rail ASKS FOR, and what it shows when the answer arrives.
 *
 * THE TWO THINGS THIS FILE IS ACTUALLY GUARDING, both from 2026-09-21:
 *
 *   `every board` IS ONE REQUEST FOR THREE BOARDS, not three requests. The
 *   whole value of the option is that `/jobs` gathers them concurrently, and
 *   the only place that can go wrong on this side is the array handed to
 *   `useScrapedJobs` -- a `[source]` left in place would have made it a
 *   request for one board called "all", which the API would refuse.
 *
 *   JOBICY IS IN THE RAIL WHEN IT WAS PICKED, and not otherwise. It used to be
 *   merged in unconditionally, so picking `Indeed` drew a hundred Jobicy roles
 *   with a few Indeed ones sorted into them.
 *
 * THE THIRD-PARTY READS ARE MOCKED for the reason every other test in this app
 * mocks them: jobicy.com and date.nager.at are somebody else's hosts and a
 * unit test must not depend on their uptime.
 */
const mocks = vi.hoisted(() => {
  const row = (id: string, source: string, publishedAt: string) => ({
    source,
    id,
    title: id,
    company: 'Somewhere',
    url: `https://example.test/${id}`,
    geo: null,
    level: null,
    industry: null,
    publishedAt,
    excerpt: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
  })
  return {
    free: [row('jobicy:1', 'jobicy', '2026-09-20T00:00:00.000Z')],
    paid: [row('indeed:1', 'indeed', '2026-09-21T00:00:00.000Z')],
    useScrapedJobs: vi.fn(),
  }
})

vi.mock('@/hooks/useJobFeed', () => ({
  useJobFeed: () => ({ data: mocks.free, isLoading: false, error: null }),
  useJobFeedIndustries: () => ({ data: [] }),
  useJobFeedLocations: () => ({ data: [] }),
  useScrapedJobs: mocks.useScrapedJobs,
}))
vi.mock('@/hooks/usePublicHolidays', () => ({
  usePublicHolidays: () => ({ data: [] }),
  useHolidayCountries: () => ({ data: [] }),
}))

import { useCalendarExtras } from '@/hooks/useCalendarExtras'
import { SCRAPED_SOURCES } from '@/services/jobFeed'

/** What the boards answered last, so a test can decide what arrived. */
function answer(jobs: unknown[] = []) {
  mocks.useScrapedJobs.mockImplementation((sources: readonly string[]) => ({
    data: sources.length > 0 ? { jobs, notes: [] } : undefined,
    isFetching: false,
    error: null,
  }))
}

/** The sources the last render asked for. */
function asked(): readonly string[] {
  const calls = mocks.useScrapedJobs.mock.calls
  return calls[calls.length - 1][0]
}

describe('useCalendarExtras — which boards are read', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.useScrapedJobs.mockReset()
    answer()
  })

  it('asks for nothing at all while Jobicy is the choice', () => {
    // THE DEFAULT MUST NOT SPEND. Jobicy is the free browser-side feed, so
    // the paid query has to be a query that never runs rather than a query
    // for nothing.
    renderHook(() => useCalendarExtras())
    expect(asked()).toEqual([])
  })

  it('asks for every board in one request when every board is picked', () => {
    const { result } = renderHook(() => useCalendarExtras())
    act(() => result.current.feed.onSourceChange?.('all'))
    expect(asked()).toEqual([...SCRAPED_SOURCES])
  })

  it('asks for exactly the one board that was picked', () => {
    const { result } = renderHook(() => useCalendarExtras())
    act(() => result.current.feed.onSourceChange?.('indeed'))
    expect(asked()).toEqual(['indeed'])
  })

  it('drops the free rows when a single board is picked', () => {
    answer(mocks.paid)
    const { result } = renderHook(() => useCalendarExtras())
    act(() => result.current.feed.onSourceChange?.('indeed'))
    expect(result.current.feed.jobs?.map((job) => job.source)).toEqual(['indeed'])
  })

  it('keeps the free rows when every board is picked, newest first', () => {
    answer(mocks.paid)
    const { result } = renderHook(() => useCalendarExtras())
    act(() => result.current.feed.onSourceChange?.('all'))
    expect(result.current.feed.jobs?.map((job) => job.source)).toEqual(['indeed', 'jobicy'])
  })

  it('never spends on the demo, whatever the browser remembers', () => {
    // `/demo/planner` has no session to authenticate and no account to bill.
    // A browser that picked Indeed on the real planner must not turn the demo
    // into a request that 401s -- and must not lose the free rail either.
    localStorage.setItem('worktrack.job-feed-boards', 'indeed')
    const { result } = renderHook(() => useCalendarExtras({ boards: false }))
    expect(asked()).toEqual([])
    expect(result.current.feed.source).toBe('jobicy')
    expect(result.current.feed.jobs?.map((job) => job.source)).toEqual(['jobicy'])
  })
})
