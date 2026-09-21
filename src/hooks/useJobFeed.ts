import { useQuery } from '@tanstack/react-query'
import {
  fetchFeedIndustries,
  fetchFeedLocations,
  fetchRemoteJobs,
  fetchScrapedJobs,
  type FeedFacet,
  type FeedJob,
  type FeedSource,
  type ScrapedFeed,
} from '@/services/jobFeed'

/**
 * Recent remote postings for the calendar's feed panel.
 *
 * NOT KEYED ON THE USER and not gated on a session, for the same reason
 * `usePublicHolidays` is not: this is public third-party data, identical for
 * everyone, and it has nothing to do with auth.
 *
 * `staleTime` is fifteen minutes rather than `Infinity`. A holiday list is
 * fixed once published; a job board is not, and the whole value of the panel
 * is that the postings are recent. Fifteen minutes is short enough that a
 * morning and an afternoon visit differ, and long enough that clicking
 * between screens costs nothing.
 */
export function useJobFeed(industry: string | null, geo: string | null, enabled = true) {
  return useQuery<FeedJob[]>({
    queryKey: ['job-feed', industry, geo],
    queryFn: ({ signal }) => fetchRemoteJobs({ count: 24, industry, geo }, signal),
    enabled,
    staleTime: 15 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

/** The feed's own industry taxonomy, behind the panel's filter. */
export function useJobFeedIndustries(enabled = true) {
  return useQuery<FeedFacet[]>({
    queryKey: ['job-feed-industries'],
    queryFn: ({ signal }) => fetchFeedIndustries(signal),
    enabled,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

/** The feed's own geo taxonomy, behind the panel's region filter. */
export function useJobFeedLocations(enabled = true) {
  return useQuery<FeedFacet[]>({
    queryKey: ['job-feed-locations'],
    queryFn: ({ signal }) => fetchFeedLocations(signal),
    enabled,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

/**
 * The paid boards, and only when one has been switched on.
 *
 * `enabled` IS THE SPEND SWITCH, which is why it is derived from the list
 * rather than passed in. An empty selection must not produce a request: this
 * query runs up to four crawls that bill per posting, so "nobody asked for a
 * board" has to mean "no request", not "a request for nothing".
 *
 * A LONGER `staleTime` THAN JOBICY'S FIFTEEN MINUTES, and the reason is money
 * rather than freshness. Jobicy is a free GET, so re-fetching it costs a
 * request nobody pays for; re-running these costs a crawl each. An hour is
 * still well inside the window in which a board's front page changes, and it
 * means a reader moving between screens all morning pays once.
 *
 * RETRY IS OFF. Every other query in this app retries once, because a failed
 * GET costs nothing to repeat. A failed actor run has usually already been
 * charged for, and a retry is a second charge for the same answer -- so a
 * board that fails, fails, and the panel says which one.
 */
export function useScrapedJobs(
  sources: readonly FeedSource[],
  options: { query?: string; location?: string } = {}
) {
  const { query, location } = options
  return useQuery<ScrapedFeed>({
    queryKey: ['job-feed-boards', [...sources].sort().join(','), query ?? '', location ?? ''],
    queryFn: ({ signal }) => fetchScrapedJobs(sources, { query, location }, signal),
    enabled: sources.length > 0,
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: false,
  })
}
