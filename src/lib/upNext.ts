import { getStaleApplications } from '@/services/followUp'
import { parseDayKey, sentApplicationsByDay } from '@/lib/calendar'
import type { CalendarEvent, EventKind } from '@/services/events'
import type { Job } from '@/types'

/**
 * What the planner should put in front of somebody, merged from two sources.
 *
 * THE SECTION WAS EMPTY ON A REAL ACCOUNT, which is the whole reason this
 * exists (Gabe, 2026-09-11: "my account still does not have any data for this
 * section"). `up next` read `events` alone, and an account with fifty-two
 * applications and no interviews booked yet has no events at all -- so the
 * busiest user of the app got a heading over nothing while a demo fixture with
 * five invented events looked fine. A panel that only fills up once you are
 * already succeeding is a panel that is absent exactly when it would help.
 *
 * SO IT MERGES WHAT IS BOOKED WITH WHAT HAS GONE QUIET. Applications sitting
 * in flight past the follow-up threshold are the thing that needs doing when
 * nothing is scheduled, and they are computed from `date_applied` and
 * `updated_at` -- columns every account has from its first row. The staleness
 * rule is `services/followUp`'s, unchanged and unduplicated: the Overview's
 * nudge and this rail agree by construction rather than by coincidence.
 *
 * ORDER IS TIME, THEN NEGLECT, THEN MEMORY. Anything with a clock on it comes
 * first, soonest to latest -- a booked interview outranks a chase whatever the
 * numbers say. Chases follow, longest-quiet first, because that is the one
 * most likely to be dead. What has ALREADY HAPPENED comes last, most recent
 * first.
 *
 * WHY THE PAST IS IN A RAIL CALLED `up next` (Gabe, 2026-09-18: "up next
 * section must show the past activities occurred such as sent applications
 * within a specific day and past interviews"). The heading stays his, and the
 * order is what keeps it true: everything actionable is still at the front of
 * the rail, and the recent past is the tail you reach by scrolling. What it
 * buys is a rail that says what you DID as well as what you owe -- on a week
 * with nothing booked and nothing yet stale, the section was empty for
 * somebody who had sent fifteen applications in it.
 *
 * THE TWO HALVES ARE CAPPED SEPARATELY, and that is the whole reason for two
 * numbers: fifty applications produce dozens of chases, and a single cap would
 * let them push every trace of the past off the end -- a feature that vanishes
 * exactly for the busiest account is the defect this rail already had once.
 */

/** In flight and untouched for this long is when chasing becomes reasonable. */
export const QUIET_AFTER_DAYS = 14

/**
 * How far back the rail remembers.
 *
 * The same fortnight `QUIET_AFTER_DAYS` uses, deliberately: it is the window
 * this app already treats as "recent" everywhere else, and two different
 * definitions of recency on one screen is a screen nobody can reason about.
 */
export const RECENT_WINDOW_DAYS = 14

/** How many cards of things to DO lead the rail. */
const MAX_AHEAD = 8

/** How many cards of things already DONE follow them. */
const MAX_PAST = 6

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * One vocabulary for event kinds, shared with the month grid's day tooltip.
 *
 * EXPORTED RATHER THAN COPIED (2026-09-18): the tooltip labels the same five
 * kinds, and a second map is how `take_home` becomes `take-home` in one place
 * and `Take home` in the other.
 */
export const EVENT_LABELS: Record<EventKind, string> = {
  interview: 'interview',
  deadline: 'deadline',
  take_home: 'take-home',
  follow_up: 'follow-up',
  other: 'event',
}

export interface UpNextItem {
  id: string
  /**
   * `event` is booked, `chase` is an application nobody has answered, and
   * `past` already happened -- an interview that was held, or the
   * applications that went out on one day.
   */
  kind: 'event' | 'chase' | 'past'
  /** `interview`, `deadline`, … `no reply`, or `sent`. */
  label: string
  title: string
  company: string | null
  /** The instant it happens or happened. Null on a chase and on a sent day. */
  at: string | null
  /**
   * A bare local day, for something with a date and no clock.
   *
   * `date_applied` is a DATE column: an application was sent on the 14th, not
   * at 14:03 on the 14th, and printing a time for it would be inventing one.
   */
  day?: string | null
  /** Days since the last sign of life. Only on a chase. */
  quietDays?: number
  /** How many applications a `sent` card stands for. */
  count?: number
  /** The application it belongs to, for the link out. */
  jobId: string | null
}

export function buildUpNext(
  events: CalendarEvent[],
  jobs: Job[],
  now: Date = new Date()
): UpNextItem[] {
  const companyById = new Map(jobs.map((job) => [job.id, job.company]))

  // UPCOMING ONLY IN THIS HALF. The read reaches back sixty days now (see
  // `useEvents`), so the filter is what separates the two ends of the rail
  // rather than a guard against a stale cache: what is still ahead leads, and
  // what already happened is gathered below.
  const booked: UpNextItem[] = events
    .filter((event) => new Date(event.starts_at).getTime() >= now.getTime())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((event) => ({
      id: `event-${event.id}`,
      kind: 'event' as const,
      label: EVENT_LABELS[event.kind] ?? 'event',
      title: event.title,
      company: event.job_id ? (companyById.get(event.job_id) ?? null) : null,
      at: event.starts_at,
      jobId: event.job_id,
    }))

  // The same `last_touched_at` precedence the Overview's nudge uses: the
  // freshest timestamp on the row stands in for an activity log this screen
  // does not read.
  const quiet = getStaleApplications(
    jobs.map((job) => ({
      id: job.id,
      company: job.company,
      role: job.role,
      status: job.status,
      last_touched_at: job.updated_at || job.date_applied || job.created_at,
    })),
    QUIET_AFTER_DAYS,
    now
  ).map((stale) => ({
    id: `chase-${stale.id}`,
    kind: 'chase' as const,
    label: 'no reply',
    title: stale.role,
    company: stale.company,
    at: null,
    quietDays: Math.max(
      0,
      Math.round((now.getTime() - new Date(stale.last_touched_at).getTime()) / DAY_MS)
    ),
    jobId: stale.id,
  }))

  /**
   * What already happened, most recent first.
   *
   * TWO SOURCES, ONE ORDER. An interview that was held is an event with a
   * clock on it; the applications sent on a day are a DATE with no clock, so
   * they are bucketed per day rather than listed one by one -- five cards
   * saying `sent` for one Tuesday is a rail nobody can read, and the month
   * grid's own tooltip is where the full list of a day already lives.
   *
   * The bucketing is `sentApplicationsByDay`'s, shared with the calendar, so
   * the rail and the grid can never disagree about which day something was
   * sent on.
   */
  const windowStart = new Date(now.getTime() - RECENT_WINDOW_DAYS * DAY_MS)

  const held: UpNextItem[] = events
    .filter((event) => {
      const at = new Date(event.starts_at).getTime()
      return at < now.getTime() && at >= windowStart.getTime()
    })
    .map((event) => ({
      id: `past-${event.id}`,
      kind: 'past' as const,
      label: EVENT_LABELS[event.kind] ?? 'event',
      title: event.title,
      company: event.job_id ? (companyById.get(event.job_id) ?? null) : null,
      at: event.starts_at,
      jobId: event.job_id,
    }))

  const sent: UpNextItem[] = Object.entries(sentApplicationsByDay(jobs))
    .filter(([key]) => {
      const day = parseDayKey(key)
      // The whole of today counts as past -- an application sent this morning
      // is something that happened -- so the upper bound is the day, not the
      // instant.
      return day.getTime() <= now.getTime() && day.getTime() >= windowStart.getTime()
    })
    .map(([key, rows]) => ({
      id: `sent-${key}`,
      kind: 'past' as const,
      label: 'sent',
      // ONE ROLE, OR A COUNT. A day with one application is that application;
      // a day with five is an amount of work, and the roles are one hover away
      // on the grid below.
      title: rows.length === 1 ? rows[0].role : `${rows.length} applications`,
      company:
        rows.length === 1
          ? rows[0].company
          : [...new Set(rows.map((row) => row.company))].join(', '),
      at: null,
      day: key,
      count: rows.length,
      // Only a single application can be opened; a day is not a record.
      jobId: rows.length === 1 ? rows[0].id : null,
    }))

  const recent = [...held, ...sent]
    // Newest first, and a sent day sorts by its end so it lands after an
    // interview held earlier the same day.
    .sort((a, b) => sortAt(b).localeCompare(sortAt(a)))
    .slice(0, MAX_PAST)

  return [...[...booked, ...quiet].slice(0, MAX_AHEAD), ...recent]
}

/** The instant an item sorts by: its clock, or the end of its day. */
function sortAt(item: UpNextItem): string {
  return item.at ?? `${item.day ?? ''}T23:59:59.999Z`
}
