'use client'

import * as React from 'react'
import { useJobFeed, useJobFeedIndustries, useJobFeedLocations } from '@/hooks/useJobFeed'
import { usePublicHolidays } from '@/hooks/usePublicHolidays'
import { resolveHolidayCountry } from '@/services/holidays'
import { JOB_FEED_GEO_KEY, JOB_FEED_INDUSTRY_KEY, geoSlugForCountry } from '@/services/jobFeed'
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
  >
}

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

export function useCalendarExtras(): CalendarExtras {
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

  // THE FEED OPENS WHERE THE READER IS, when the feed knows that country.
  // Jobicy lists 55 locations, so most countries fall through to `anywhere` --
  // which is the right answer for them, and a great deal better than the
  // de-facto US-only rail an unfiltered call returns.
  const offered = React.useMemo(() => locations.data ?? [], [locations.data])
  React.useEffect(() => {
    if (geoSettled.current || offered.length === 0 || !country) return
    const slug = geoSlugForCountry(country, offered)
    if (slug) setGeo(slug)
    geoSettled.current = true
  }, [country, offered])

  return {
    calendar: {
      holidays: holidays.data ?? [],
      onVisibleYearsChange: setYears,
    },
    feed: {
      jobs: feed.data ?? [],
      loading: feed.isLoading,
      error: !!feed.error,
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
