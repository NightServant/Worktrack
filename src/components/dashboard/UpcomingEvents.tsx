'use client'

import * as React from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircleIcon } from '@/components/icons'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import { dayKey } from '@/lib/calendar'
import type { CalendarEvent } from '@/services/events'

const KIND_LABELS: Record<CalendarEvent['kind'], string> = {
  interview: 'interview',
  deadline: 'deadline',
  take_home: 'take-home',
  follow_up: 'follow-up',
  other: 'event',
}

export interface UpcomingEventsProps {
  events: CalendarEvent[]
  companyByJobId?: Record<string, string>
  loading?: boolean
  error?: boolean
  /**
   * How many events to list. THREE: the panel shares a row height with `by
   * source`, and the two-week strip under the list now shows how the rest of
   * the fortnight is loaded -- a fourth row on top of it made this card the
   * taller of the pair and stretched the whole row.
   */
  limit?: number
}

/**
 * The next few things in the calendar — Figma Overview panel 25:76.
 *
 * This panel is the whole of Gabe's "no empty state display for calendar".
 * The old block did not read the calendar at all: it printed the literal
 * string `N interviews in progress`, derived from job statuses, so there was
 * nothing to be empty about and nothing to show when something *was*
 * scheduled. `useEvents` already existed and `/planner` already used it; the
 * Overview simply never called it.
 *
 * Three states, kept apart on purpose. Loading is a skeleton, not an empty
 * list — an empty list while a read is in flight tells the user they have
 * nothing scheduled, which may be false. A failed read says so rather than
 * claiming an empty calendar, the same distinction Task 5 of M5 had to add to
 * the application detail panels. Genuinely empty says so plainly and points at
 * the calendar.
 *
 * Event rows use no status colour. An event kind is not an application status,
 * and the five hues mean one specific thing everywhere else — the same rule
 * `/planner`'s agenda follows.
 */
export function UpcomingEvents({
  events,
  companyByJobId = {},
  loading = false,
  error = false,
  limit = 3,
}: UpcomingEventsProps) {
  if (error) {
    return (
      <p className="flex items-center gap-2 py-4 text-body-s text-status-rejected-mark">
        <AlertCircleIcon size={16} aria-hidden className="[&_svg]:size-4" />
        could not load your calendar.
      </p>
    )
  }

  if (loading) {
    return (
      // Three bars for the three rows. A skeleton that is shorter than what
      // replaces it makes the card jump on every read.
      <div data-events-loading className="flex flex-1 flex-col justify-center gap-3 py-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  // UPCOMING, FROM TODAY. `useEvents` reads a window starting sixty days
  // back (the planner needs the past), so slicing the head of that list put
  // last month's interviews in a panel called "upcoming".
  const upcoming = events
    .filter((event) => new Date(event.starts_at).getTime() >= startOfToday.getTime())
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
  const shown = upcoming.slice(0, limit)

  if (shown.length === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <EmptyState data-events-empty icon="Calendar" className="flex-1 justify-center">
          nothing scheduled yet. interviews and deadlines you add show up here.
        </EmptyState>
      </div>
    )
  }

  return (
    // TOP-ALIGNED LIST, FORTNIGHT AT THE FOOT. The panel's height is set by
    // `by source` beside it, so with one or two events there is always spare
    // height. It used to be split above and below the rows (`justify-center`
    // plus growing rows), which floated a lone event mid-card with a band of
    // nothing on either side. Now the rows sit under the header where the eye
    // lands, and the spare height goes to the two-week strip, which says what
    // a short list cannot: how the next fortnight is loaded, and that the
    // empty days really are empty rather than unloaded.
    <div className="flex flex-1 flex-col gap-4">
      <ul className="flex flex-col">
        {shown.map((event, index) => {
          const when = new Date(event.starts_at)
          const company = event.job_id ? companyByJobId[event.job_id] : undefined
          const next = index === 0
          return (
            <li
              key={event.id}
              data-event-row
              data-next={next || undefined}
              className="flex items-center gap-3 border-b border-border-subtle py-2 last:border-b-0"
            >
              {/* Date tile. The NEXT event's is filled in the accent: the one
                  thing on this card you are most likely to act on. */}
              <div
                className={cn(
                  'flex w-11 shrink-0 flex-col items-center rounded-[4px] py-0.5',
                  next
                    ? 'bg-accent-default/15 text-accent-default ring-1 ring-inset ring-accent-default/40'
                    : 'text-text-primary'
                )}
              >
                <span className="tabular text-body-m leading-tight">{when.getDate()}</span>
                <span
                  className={cn(
                    'text-label-caps uppercase leading-tight',
                    next ? 'text-accent-default' : 'text-text-muted'
                  )}
                >
                  {when.toLocaleString(undefined, { month: 'short' })}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-m text-text-primary">{event.title}</p>
                <p className="truncate text-body-s text-text-muted">
                  {KIND_LABELS[event.kind]}
                  {company ? ` · ${company}` : ''} ·{' '}
                  <span className="tabular">
                    {when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </p>
              </div>
              {/* How far off, in words: "in 5 days" is read at a glance, a
                  date has to be subtracted from today first. */}
              <span
                data-event-countdown
                className={cn(
                  'shrink-0 whitespace-nowrap text-body-s tabular',
                  next ? 'text-accent-default' : 'text-text-muted'
                )}
              >
                {countdown(when, startOfToday)}
              </span>
            </li>
          )
        })}
      </ul>

      <Fortnight events={upcoming} today={startOfToday} />
    </div>
  )
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole calendar days from today to `when`, in words. */
function countdown(when: Date, today: Date): string {
  const day = new Date(when)
  day.setHours(0, 0, 0, 0)
  const days = Math.round((day.getTime() - today.getTime()) / DAY_MS)
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days < 14) return `in ${days} days`
  const weeks = Math.round(days / 7)
  return `in ${weeks} weeks`
}

/**
 * The next fourteen days, one cell each, today first. A day with something
 * booked carries a mark (one dot per event, up to three) and reads in the
 * primary colour; the rest stay muted. Sits at the foot of the panel
 * (`mt-auto`) so it lines up with the bottom of `by source` beside it.
 */
function Fortnight({ events, today }: { events: CalendarEvent[]; today: Date }) {
  const counts = new Map<string, number>()
  for (const event of events) {
    const key = dayKey(new Date(event.starts_at))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const days = Array.from({ length: 14 }, (_, offset) => {
    const date = new Date(today)
    date.setDate(today.getDate() + offset)
    return date
  })
  const booked = days.reduce((sum, date) => sum + (counts.get(dayKey(date)) ?? 0), 0)

  return (
    <figure data-events-fortnight className="mt-auto flex flex-col gap-1.5 border-t border-border-subtle pt-3">
      <figcaption className="flex items-baseline justify-between text-body-s text-text-muted">
        <span className="text-label-caps uppercase">next 14 days</span>
        <span className="tabular">
          {booked} {booked === 1 ? 'event' : 'events'}
        </span>
      </figcaption>
      <ol className="grid grid-cols-14 gap-1">
        {days.map((date, offset) => {
          const count = counts.get(dayKey(date)) ?? 0
          const label = `${date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}: ${
            count === 0 ? 'nothing booked' : `${count} ${count === 1 ? 'event' : 'events'}`
          }`
          return (
            <li
              key={offset}
              aria-label={label}
              title={label}
              data-booked={count > 0 || undefined}
              className={cn(
                'flex flex-col items-center gap-1 rounded-[4px] py-1',
                count > 0 ? 'bg-bg-surface' : '',
                offset === 0 && 'ring-1 ring-inset ring-border-default'
              )}
            >
              <span aria-hidden className="text-[10px] uppercase leading-none text-text-muted">
                {date.toLocaleDateString(undefined, { weekday: 'narrow' })}
              </span>
              <span
                aria-hidden
                className={cn(
                  'tabular text-body-s leading-none',
                  count > 0 ? 'text-text-primary' : 'text-text-muted'
                )}
              >
                {date.getDate()}
              </span>
              <span aria-hidden className="flex h-1 items-center gap-0.5">
                {Array.from({ length: Math.min(count, 3) }, (_, dot) => (
                  <span key={dot} className="size-1 rounded-full bg-accent-default" />
                ))}
              </span>
            </li>
          )
        })}
      </ol>
    </figure>
  )
}
