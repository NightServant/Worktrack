import * as React from 'react'
import { cn } from '@/lib/utils'
import { groupEventsByDay, type CalendarEvent, type EventKind } from '@/services/events'
import { parseDayKey } from '@/lib/calendar'

const KIND_LABELS: Record<EventKind, string> = {
  interview: 'Interview',
  deadline: 'Deadline',
  take_home: 'Take-home',
  follow_up: 'Follow-up',
  other: 'Event',
}

function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatDayHeading(key: string): string {
  return parseDayKey(key).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * The list of upcoming events, grouped by day, that carries mobile's actual
 * content -- `WeekStrip` above it is orientation only. Desktop does not
 * render this at all; `MonthGrid` shows event titles directly in each cell.
 *
 * Grouping goes through `groupEventsByDay` (`src/services/events.ts`)
 * rather than a second bucketer here, and day headings are built with
 * `parseDayKey` (`src/lib/calendar.ts`) rather than `new Date(key)` --
 * the latter parses a bare "YYYY-MM-DD" string as UTC midnight, which is
 * the wrong local day in any zone behind UTC and is exactly the bug class
 * the local-day-key pairing exists to keep out.
 *
 * Each row's rule is `border-border-strong`, the same neutral 2px vocabulary
 * `FollowUpNudge` already uses -- never a status colour. An event kind
 * (interview, deadline, take-home...) is not an application status, and the
 * five status hues are reserved for that one meaning everywhere else in the
 * app.
 *
 * `companyByJobId` is the client-side join fix round 1 added: roadmap 5.7
 * requires the mobile agenda carry "time, duration, title and company", but
 * `CalendarEvent` (from `eventService.listFrom`) has no company of its
 * own -- only `job_id`. `src/app/(app)/calendar/page.tsx` builds this map
 * from `useJobs()` -- the same `['jobs', user?.id]` cache every other screen
 * in this branch already reads -- and threads it down through `Calendar`,
 * rather than this component or `Calendar` itself adding a second query.
 * Without it, two "Technical interview" events for two different companies
 * on the same day would render as identical rows -- the company line is
 * what tells them apart. `job_id` is nullable (a standalone event with no
 * linked application), and a job can also simply be missing from the map (still
 * loading, or deleted) -- both cases render the row with no company line at
 * all rather than a "null"/"undefined" string or a stray leading separator.
 */
export interface AgendaProps {
  events: CalendarEvent[]
  companyByJobId?: Record<string, string>
  className?: string
}

export function Agenda({ events, companyByJobId = {}, className }: AgendaProps) {
  const grouped = groupEventsByDay(events)
  const days = [...grouped.keys()].sort()

  if (days.length === 0) {
    return <p className={cn('text-body-s text-text-muted', className)}>nothing scheduled.</p>
  }

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {days.map((day) => (
        <div key={day} className="flex flex-col gap-3">
          <h3 className="text-label-caps uppercase text-text-muted">{formatDayHeading(day)}</h3>
          <ul className="flex flex-col gap-3">
            {grouped.get(day)!.map((event) => {
              const company = event.job_id ? companyByJobId[event.job_id] : undefined
              return (
                <li
                  key={event.id}
                  data-event-rule
                  className="flex items-start gap-3 border-l-2 border-border-strong pl-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-body-m text-text-primary">{event.title}</p>
                    {company && (
                      <p className="truncate text-body-s text-text-secondary">{company}</p>
                    )}
                    <p className="tabular text-body-s text-text-muted">
                      {KIND_LABELS[event.kind]} · {formatEventTime(event.starts_at)}
                      {event.duration_minutes ? ` · ${event.duration_minutes}m` : ''}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
