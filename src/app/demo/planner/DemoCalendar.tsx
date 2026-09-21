'use client'

import * as React from 'react'
import { Calendar } from '@/components/calendar/Calendar'
import { JobFeed } from '@/components/calendar/JobFeed'
import { useCalendarExtras } from '@/hooks/useCalendarExtras'
import { sentApplicationsByDay } from '@/lib/calendar'
import { buildUpNext } from '@/lib/upNext'
import { DEMO } from '@/lib/demoFixture'
import type { FeedSource } from '@/services/jobFeed'

/**
 * The demo's calendar, with the same two live panels the real one has.
 *
 * A CLIENT COMPONENT FOR THE SAME REASON `/demo/analytics` NEEDED ONE: the
 * page itself is a fixture, but two of the things on it are not. Holidays and
 * the remote-roles feed are public third-party reads with nothing to do with
 * an account, so there is no reason for a demo visitor to see a lesser
 * calendar than a signed-in one -- and a demo that quietly omits the newest
 * features is a demo that argues against them.
 *
 * The EVENTS are still the fixture. Those belong to an account, and the demo
 * deliberately has none.
 *
 * AND SO ARE THE FOUR BOARDS, for a reason worth stating rather than
 * discovering (Gabe, 2026-09-21: "why can I not see information from other job
 * posting websites in the demo pages"). On the real planner LinkedIn,
 * JobStreet and Indeed come from Apify actors behind
 * `/api/jobfeed`, which authenticates its caller and bills an account. The
 * demo has no session to authenticate and no account to bill, so calling it
 * here would answer 401 on every press -- and a public URL anyone can open
 * must not carry a button that spends money.
 *
 * So the rows come from `DEMO.boardJobs` and the toggles filter them in
 * memory. Every board is ON when the page opens, because the point of the
 * panel is that it reads more than one site and a visitor should not have to
 * find that out. Nothing is fetched, nothing is charged, and the screen is the
 * real one rather than a reduced copy of it.
 */
const companyByJobId = Object.fromEntries(DEMO.jobs.map((job) => [job.id, job.company]))

/** Sent-per-day, built once: the fixture does not change between renders. */
const applicationsByDay = sentApplicationsByDay(DEMO.jobs)

export function DemoCalendar() {
  // `boards: false` keeps the PAID path off -- no request to `/api/jobfeed`
  // is ever made from here. The board rows below are the fixture's.
  const extras = useCalendarExtras({ boards: false })

  /*
    ONE SOURCE HERE TOO, so the demo shows the control the real screen has.
    It opens on Jobicy -- the live, free feed -- and picking any other board
    swaps the rail to that board's INVENTED rows. Nothing is fetched and
    nothing is charged.
  */
  const [source, setSource] = React.useState<FeedSource>('jobicy')

  // Rebuilt per render rather than at module scope: `buildUpNext` measures
  // against the clock, and a value frozen at import would age on a long-lived
  // tab.
  const upNext = React.useMemo(() => buildUpNext(DEMO.events, DEMO.jobs), [])

  /**
   * The fixture's board rows, merged into the live Jobicy rail.
   *
   * SORTED TOGETHER RATHER THAN APPENDED, which is what the real screen does
   * and is the only ordering the heading supports: "what went up recently,
   * newest first" is a claim about all of them at once, so a fixture row from
   * this morning belongs above a live Jobicy row from yesterday.
   */
  const jobs = React.useMemo(() => {
    // JOBICY IS THE LIVE ONE and is genuinely fetched here -- it is keyless
    // and public, so a demo visitor gets the real thing where the real thing
    // is free. Every other board is the fixture.
    if (source === 'jobicy') return extras.feed.jobs ?? []
    return DEMO.boardJobs
      .filter((job) => job.source === source)
      .slice()
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  }, [extras.feed.jobs, source])

  return (
    <Calendar
      events={DEMO.events}
      companyByJobId={companyByJobId}
      applicationsByDay={applicationsByDay}
      upNext={upNext}
      feed={
        <JobFeed
          {...extras.feed}
          jobs={jobs}
          source={source}
          onSourceChange={setSource}
          // Instant and free: there is nothing in flight to wait for, and
          // nothing that can fail on a per-board basis.
          boardsLoading={false}
          boardNotes={[]}
          // THE DEFAULT LINE WOULD BE A LIE HERE. It says a board is read on
          // demand and takes a moment; on this page nothing is read and
          // nothing takes any time at all.
          boardsHint={
            source === 'jobicy'
              ? 'jobicy is live even here — it is keyless and public, so the demo shows the real thing.'
              : 'these roles are invented, like everything else here.'
          }
        />
      }
      {...extras.calendar}
    />
  )
}
