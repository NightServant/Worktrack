'use client'

import * as React from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { ChevronLeftIcon, ChevronRightIcon, CalendarIcon } from '@/components/icons'
import { buildMonthGrid, weekOf, type SentApplication } from '@/lib/calendar'
import { MonthGrid } from './MonthGrid'
import { WeekStrip } from './WeekStrip'
import { Agenda } from './Agenda'
import { UpNext } from './UpNext'
import type { CalendarEvent } from '@/services/events'
import type { PublicHoliday } from '@/services/holidays'
import type { UpNextItem } from '@/lib/upNext'

/**
 * The calendar screen's body, over plain props -- same split as `Dashboard`
 * (Task 3) and `DetailPage` (Task 5), so it renders without Next routing or
 * react-query. `src/app/(app)/planner/page.tsx` owns both reads this screen
 * needs: `useEvents()` (wrapping `eventService.listFrom`) for `events`,
 * and `useJobs()` -- the same shared `['jobs', user?.id]` cache every other
 * screen in this branch already reads -- to build `companyByJobId`, the
 * `job_id -> company` map `Agenda` needs to satisfy roadmap 5.7's "time,
 * duration, title and company" requirement. `CalendarEvent` itself only has
 * `job_id`, no company.
 *
 * `useJobs()` was called directly inside this component in fix round 1; fix
 * round 2 hoisted it back out to the route, matching `dashboard/page.tsx`
 * and `applications/page.tsx` (both call their hooks at the route and pass
 * data down as props). A component that fetches its own data is not what
 * ruling R3 asked a props-taking `Calendar` for -- route-as-thin-wrapper,
 * sections testable without Next routing -- and Tasks 8/9 would have had
 * only this file to copy from. Component tests here no longer mock any
 * hook; the route's own test (`__tests__/page.test.tsx`) is where that
 * mocking now belongs, the same way it already does for `dashboard`.
 *
 * Desktop and mobile are genuinely different layouts, not one squeezed into
 * the other, per the roadmap's "Mobile Calendar deliberately diverges from
 * desktop" note (M5 5.7): `MonthGrid` (`hidden md:grid`) is the six-week
 * grid; the `md:hidden` block below it pairs `WeekStrip` (date orientation,
 * always the CURRENT week) with `Agenda` (the actual upcoming events, in
 * every case -- not scoped to the desktop month cursor). Wrapping both
 * mobile pieces in one `data-week-strip` container keeps them appearing and
 * disappearing together rather than each having to independently agree on
 * the breakpoint.
 *
 * Month navigation only affects `MonthGrid`, so its controls live in
 * `PageHeader`'s action slot -- the same "content controls belong in the
 * body header" convention Documents' `+ new cv` and Analytics' range picker
 * follow -- and are hidden below `md`, since nothing on the mobile layout
 * responds to them.
 */
export interface CalendarProps {
  events: CalendarEvent[]
  companyByJobId?: Record<string, string>
  /** Public holidays for the years this screen is currently showing. */
  holidays?: PublicHoliday[]
  /**
   * The years the grid currently covers, so the caller can fetch exactly
   * those.
   *
   * IT IS REPORTED RATHER THAN ASKED FOR because the month cursor lives here
   * -- this is the only component that knows a December grid reaches into
   * January of the next year. The route owns the fetch, per the same
   * route-owns-the-reads split the rest of this screen follows; this is the
   * one fact it cannot work out on its own.
   */
  onVisibleYearsChange?: (years: number[]) => void
  /**
   * Which applications went out on each day, keyed by `dayKey`.
   *
   * Built at the route by `sentApplicationsByDay`, from the same `useJobs()`
   * cache `companyByJobId` comes from, so the grid and the agenda agree
   * without a second read. It carries the rows rather than a count because the
   * grid's day tooltip names the roles -- see MonthGrid.
   */
  applicationsByDay?: Record<string, SentApplication[]>
  /**
   * What is booked and what has gone quiet, built by `lib/upNext`.
   *
   * PASSED IN, not derived here, for the same reason `applicationsByDay` is:
   * it needs the jobs list as well as the events, and this component takes
   * plain props rather than reading either.
   */
  upNext?: UpNextItem[]
  /**
   * The fresh-postings panel, rendered under the month.
   *
   * A SLOT, NOT SIX PROPS. It needs a feed, a loading flag, an error flag, a
   * taxonomy, the chosen filter and a change handler; threading all six
   * through this component would make `Calendar` a pass-through for a panel it
   * has no opinion about. The route builds it, the same way the settings
   * screen takes its import control as a node.
   */
  feed?: React.ReactNode
}

export function Calendar({
  events,
  companyByJobId = {},
  holidays = [],
  onVisibleYearsChange,
  applicationsByDay = {},
  upNext = [],
  feed,
}: CalendarProps) {
  const today = React.useMemo(() => new Date(), [])
  const [cursor, setCursor] = React.useState(today)

  const grid = React.useMemo(
    () => buildMonthGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor]
  )
  const week = React.useMemo(() => weekOf(today), [today])
  const monthLabel = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  // Every year the padded grid touches, plus the current week's -- the mobile
  // layout shows that week regardless of where the desktop cursor is.
  const visibleYears = React.useMemo(() => {
    const years = new Set<number>([today.getFullYear()])
    for (const date of grid.flat()) years.add(date.getFullYear())
    return [...years].sort()
  }, [grid, today])

  const yearsKey = visibleYears.join(',')
  React.useEffect(() => {
    onVisibleYearsChange?.(yearsKey.split(',').map(Number))
    // Keyed on the joined list rather than the array: a fresh array every
    // render would re-report on every render, and `onVisibleYearsChange` is a
    // fresh closure from the route on each of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearsKey])

  const goToPreviousMonth = () =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))
  const goToNextMonth = () => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))
  const goToToday = () => setCursor(today)

  return (
    <div className="flex flex-col gap-6">
      {/* NO CONTROLS IN THE PAGE HEADER (Gabe, 2026-09-10, calling the old
          arrangement a regression). The month nav and the holiday picker sat
          in `PageHeader`'s action slot, which is where a PAGE-level action
          belongs -- `/applications`' add button, `/documents`' new CV. These
          are not page actions: they steer one component further down, and
          beside the title they read as the app's own navigation. They now sit
          directly above the grid they move, which is the section they act on.

          The header keeps the rule, so the page still opens the same way every
          other screen does. */}
      <PageHeader
        title="planner"
        description="what is booked, what is open, and what has just been posted."
        rule
      />

      {/* WHAT NEEDS DOING OPENS THE PAGE (Gabe, 2026-09-11). Both bands above
          the month were things to look at; this is the only one that is a list
          of things to DO, so it goes first -- which does push `fresh remote
          roles` down one band, deliberately. Your own commitments outrank a
          job board. */}
      <UpNext items={upNext} />

      {/* THEN THE FEED, still above the month (Gabe, 2026-09-10). What is
          newly posted is perishable in a way a month grid is not -- a role
          three days old is most of the way through its shortlist, while an
          interview next Tuesday is still next Tuesday. */}
      {feed}

      <section className="flex flex-col gap-3" data-calendar-block>
        {/* NO COUNTRY PICKER (Gabe, 2026-09-11: "local aware is the reason to
            remove the dropdown for country holidays"). The clock now answers
            the question the dropdown was asking -- see
            `services/timezoneCountry` -- and a control that only ever restates
            what the machine already knows is a control nobody should have to
            find.

            THE TRADE, STATED: a VPN, or a laptop carried abroad, now shows the
            holidays of wherever the clock says it is, with nothing on screen to
            override it. That is the correct default for the overwhelmingly
            common case and a wrong answer for a rare one; the override can come
            back as a settings row if it ever actually bites. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Hidden below `md` for the same reason it always was: nothing on
              the mobile layout responds to the month cursor. */}
          <div className="hidden items-center gap-3 md:flex">
            <p className="tabular text-body-m text-text-secondary">{monthLabel}</p>
            {/* Icons sit on the side the control moves you toward, so the
                pair reads as one axis; `today` takes the calendar glyph
                because it is a jump to a date rather than a step along one. */}
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="s" onClick={goToPreviousMonth}>
                <ChevronLeftIcon size={16} aria-hidden className="[&_svg]:size-4" />
                previous
              </Button>
              <Button variant="ghost" size="s" onClick={goToToday}>
                <CalendarIcon size={16} aria-hidden className="[&_svg]:size-4" />
                today
              </Button>
              <Button variant="ghost" size="s" onClick={goToNextMonth}>
                next
                <ChevronRightIcon size={16} aria-hidden className="[&_svg]:size-4" />
              </Button>
            </div>
          </div>

        </div>

        <MonthGrid
          grid={grid}
          month={cursor.getMonth()}
          events={events}
          holidays={holidays}
          applicationsByDay={applicationsByDay}
          companyByJobId={companyByJobId}
          today={today}
        />

        <div data-week-strip className="mt-3 flex flex-col gap-6 md:hidden">
          <WeekStrip days={week} holidays={holidays} today={today} />
          <Agenda events={events} companyByJobId={companyByJobId} />
        </div>

      </section>
    </div>
  )
}
