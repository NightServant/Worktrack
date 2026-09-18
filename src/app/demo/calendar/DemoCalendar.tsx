'use client'

import * as React from 'react'
import { Calendar } from '@/components/calendar/Calendar'
import { JobFeed } from '@/components/calendar/JobFeed'
import { useCalendarExtras } from '@/hooks/useCalendarExtras'
import { sentApplicationsByDay } from '@/lib/calendar'
import { buildUpNext } from '@/lib/upNext'
import { DEMO } from '@/lib/demoFixture'

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
 */
const companyByJobId = Object.fromEntries(DEMO.jobs.map((job) => [job.id, job.company]))

/** Sent-per-day, built once: the fixture does not change between renders. */
const applicationsByDay = sentApplicationsByDay(DEMO.jobs)

export function DemoCalendar() {
  const extras = useCalendarExtras()
  // Rebuilt per render rather than at module scope: `buildUpNext` measures
  // against the clock, and a value frozen at import would age on a long-lived
  // tab.
  const upNext = React.useMemo(() => buildUpNext(DEMO.events, DEMO.jobs), [])
  return (
    <Calendar
      events={DEMO.events}
      companyByJobId={companyByJobId}
      applicationsByDay={applicationsByDay}
      upNext={upNext}
      feed={<JobFeed {...extras.feed} />}
      {...extras.calendar}
    />
  )
}
