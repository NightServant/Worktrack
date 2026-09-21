'use client'

import * as React from 'react'
import {
  useJobFeed,
  useJobFeedIndustries,
  useJobFeedLocations,
  useScrapedJobs,
} from '@/hooks/useJobFeed'
import { usePublicHolidays } from '@/hooks/usePublicHolidays'
import { resolveHolidayCountry } from '@/services/holidays'
import {
  JOB_FEED_GEO_KEY,
  JOB_FEED_INDUSTRY_KEY,
  SCRAPED_SOURCES,
  geoSlugForCountry,
  type FeedSource,
} from '@/services/jobFeed'
import type { JobFeedProps } from '@/components/calendar/JobFeed'
import type { CalendarProps } from '@/components/calendar/Calendar'

/**
 * The two THIRD-PARTY reads the calendar screen carries, and the per-browser
 * choices in front of them.
 *
 * A SHARED HOOK BECAUSE THERE ARE TWO CALENDARS. `/planner` reads the user's
 * own events; `/demo/planner` renders a fixture. Holidays and the job feed
 * are identical on both -- they are public data with nothing to do with the
 * account -- so a second hand-written copy in the demo would be two places to
 * keep a localStorage key, a sentinel value and a fallback in step.
 *
 * IT DELIBERATELY DOES NOT READ EVENTS OR JOBS. Those are the account's, and
 * the route-owns-the-reads split still holds for them: this hook is only the
 * part that is the same whoever is looking.
 *
 * NEITHER READ CAN GATE A SCREEN. Both are supplementary by construction --
 * the caller spreads the result into `Calendar`, which draws a full month with
 * or without them.
 */
export interface CalendarExtras {
  /** Spread straight into `Calendar`. */
  calendar: Pick<CalendarProps, 'holidays' | 'onVisibleYearsChange'>
  /** Spread straight into `JobFeed`. */
  feed: Pick<
    JobFeedProps,
    | 'jobs'
    | 'loading'
    | 'error'
    | 'industries'
    | 'industry'
    | 'onIndustryChange'
    | 'locations'
    | 'geo'
    | 'onGeoChange'
    | 'boards'
    | 'onBoardsChange'
    | 'boardsLoading'
    | 'boardNotes'
  >
}

/**
 * Which paid boards this browser last had switched on.
 *
 * REMEMBERED, LIKE THE OTHER TWO CHOICES, and per-browser for the same reason:
 * there is no column for it. What is different is what forgetting costs --
 * industry and geo forgotten means an unfiltered free feed, and boards
 * forgotten means nothing is spent. So the failure direction is right: a
 * blocked store leaves the paid half off.
 */
const JOB_FEED_BOARDS_KEY = 'worktrack.job-feed-boards'

/** `all` is the panel's sentinel for "no filter", not an API slug. */
const ANY_INDUSTRY = 'all'

/** Reads a remembered choice without letting a blocked store throw. */
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* private mode, or storage disabled */
  }
}

export interface CalendarExtrasOptions {
  /**
   * Whether the paid boards may be offered at all.
   *
   * OFF FOR THE DEMO, AND THAT IS NOT A DETAIL. `/demo/planner` renders the
   * real screen with no session, so `/api/jobfeed` would answer every press
   * with a 401 -- a row of controls that cannot work, on the one surface whose
   * whole promise is that it is the real thing. It is also the surface with no
   * account behind it to bill, which is the better reason: a public URL that
   * anyone can open must not have a button on it that spends money.
   *
   * The free half is unaffected. Jobicy is keyless and public, so the demo
   * gets exactly the rail it got before.
   */
  boards?: boolean
}

export function useCalendarExtras({ boards: allowBoards = true }: CalendarExtrasOptions = {}): CalendarExtras {
  // Which years the grid is showing. `Calendar` reports it, because the month
  // cursor lives there and only it knows a December grid reaches into January.
  const [years, setYears] = React.useState<number[]>(() => [new Date().getFullYear()])

  // WHERE THE MACHINE IS, not what language it reads. Resolved from the clock,
  // with the language region as a fallback; there is no picker in front of it
  // any more (Gabe, 2026-09-11: "local aware is the reason to remove the
  // dropdown for country holidays"), so this value IS the answer rather than a
  // default somebody is expected to go and correct.
  //
  // Null until the effect runs: `Intl` and `navigator` do not exist during the
  // server render, and reading them in the initial state would be a hydration
  // mismatch rather than a clever shortcut.
  const [country, setCountry] = React.useState<string | null>(null)
  const [industry, setIndustry] = React.useState<string | null>(null)
  const [geo, setGeo] = React.useState<string | null>(null)
  // Whether the region has been settled -- by a stored choice, by the default
  // below, or by the reader picking one. Without it the default would keep
  // reapplying and overwrite a choice on every render that locations resolve.
  const geoSettled = React.useRef(false)

  React.useEffect(() => {
    // The clock is read inside `resolveHolidayCountry`; the languages are only
    // its fallback. See services/timezoneCountry for why.
    const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
    setCountry(resolveHolidayCountry(languages))

    const storedIndustry = readStored(JOB_FEED_INDUSTRY_KEY)
    if (storedIndustry) setIndustry(storedIndustry)

    const storedGeo = readStored(JOB_FEED_GEO_KEY)
    if (storedGeo !== null) {
      // '' is a stored "anywhere", which is a real choice and must not be
      // mistaken for "never chose".
      setGeo(storedGeo || null)
      geoSettled.current = true
    }
  }, [])

  const holidays = usePublicHolidays(years, country)
  const feed = useJobFeed(industry, geo)
  const industries = useJobFeedIndustries()
  const locations = useJobFeedLocations()

  /**
   * The paid boards, off until somebody says otherwise.
   *
   * READ ONCE ON MOUNT rather than as lazy state, which is the pattern the two
   * choices above already use: this is a client component that renders on the
   * server first, and reading `localStorage` during render is a hydration
   * mismatch waiting to happen.
   */
  const [boards, setBoards] = React.useState<FeedSource[]>([])
  React.useEffect(() => {
    const stored = readStored(JOB_FEED_BOARDS_KEY)
    if (!stored) return
    // Filtered against the known set: a board removed from the app must not
    // come back out of a browser that remembers it.
    const remembered = stored
      .split(',')
      .filter((value): value is FeedSource => SCRAPED_SOURCES.includes(value as FeedSource))
    if (remembered.length > 0) setBoards(remembered)
  }, [])

  // THE FEED OPENS WHERE THE READER IS, when the feed knows that country.
  // Jobicy lists 55 locations, so most countries fall through to `anywhere` --
  // which is the right answer for them, and a great deal better than the
  // de-facto US-only rail an unfiltered call returns.
  const offered = React.useMemo(() => locations.data ?? [], [locations.data])

  /**
   * THE TWO DROPDOWNS STEER THE BOARDS TOO, translated into words.
   *
   * Jobicy takes slugs; these four take free text, because they are searching
   * a board the way a person would. The region's own NAME is the location and
   * the field's name is the search term -- so `Philippines` + `Design` asks
   * each board for design roles in the Philippines rather than asking for
   * everything and filtering four crawls' worth of results afterwards.
   *
   * It also means the controls a reader already understands keep working when
   * a board is switched on, instead of a second set appearing beside them.
   */
  const boardQuery = React.useMemo(() => {
    const field = (industries.data ?? []).find((facet) => facet.slug === industry)
    const place = offered.find((facet) => facet.slug === geo)
    return { query: field?.name, location: place?.name }
  }, [industries.data, industry, offered, geo])

  const boardFeed = useScrapedJobs(allowBoards ? boards : [], boardQuery)
  React.useEffect(() => {
    if (geoSettled.current || offered.length === 0 || !country) return
    const slug = geoSlugForCountry(country, offered)
    if (slug) setGeo(slug)
    geoSettled.current = true
  }, [country, offered])

  /**
   * ONE RAIL, NOT TWO, and the sort is what makes that honest.
   *
   * The panel's question is "what went up recently"; a board's identity is a
   * fact about a posting rather than a grouping. Merged and sorted by date,
   * a LinkedIn role posted this morning sits above a Jobicy one from
   * yesterday, which is the order the heading promises. Each card names its
   * own board -- see `JobFeed`.
   */
  const jobs = React.useMemo(() => {
    const free = feed.data ?? []
    const paid = boardFeed.data?.jobs ?? []
    if (paid.length === 0) return free
    return [...free, ...paid].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  }, [feed.data, boardFeed.data])

  return {
    calendar: {
      holidays: holidays.data ?? [],
      onVisibleYearsChange: setYears,
    },
    feed: {
      jobs,
      loading: feed.isLoading,
      error: !!feed.error,
      boards: allowBoards ? boards : [],
      boardsLoading: boardFeed.isFetching,
      /**
       * A FAILED REQUEST IS A NOTE TOO, so the row never goes quiet. The
       * extractor reports per-board failures in `notes`; a request that did
       * not land at all has no notes, and the reader still switched something
       * on and deserves to be told why nothing came of it.
       */
      boardNotes:
        boardFeed.data?.notes ??
        (boardFeed.error
          ? boards.map((source) => ({
              source,
              message:
                boardFeed.error instanceof Error
                  ? boardFeed.error.message
                  : 'That board could not be searched right now.',
            }))
          : []),
      onBoardsChange: allowBoards
        ? (next: FeedSource[]) => {
            setBoards(next)
            writeStored(JOB_FEED_BOARDS_KEY, next.join(','))
          }
        : undefined,
      industries: industries.data ?? [],
      industry,
      onIndustryChange: (slug) => {
        const next = slug === ANY_INDUSTRY ? null : slug
        setIndustry(next)
        writeStored(JOB_FEED_INDUSTRY_KEY, next ?? '')
      },
      locations: offered,
      geo,
      onGeoChange: (slug) => {
        const next = slug === ANY_INDUSTRY ? null : slug
        geoSettled.current = true
        setGeo(next)
        writeStored(JOB_FEED_GEO_KEY, next ?? '')
      },
    },
  }
}
