import { EVENT_LABELS } from '@/lib/upNext'
import type { IconName } from '@/components/icons'
import type { CalendarEvent } from '@/services/events'
import type { PublicHoliday } from '@/services/holidays'
import type { SentApplication } from '@/lib/calendar'

/**
 * What a day actually contains, as the cards the grid's tooltip stacks.
 *
 * WHY THIS EXISTS (Gabe, 2026-09-18: "add a tooltip for viewing the
 * applications sent within that day -- show the role and company name ...
 * tooltips must be also applied in general such as viewing interview
 * schedules, reminders etc ... it will be much [better] when there are
 * multiple cards stacked in a row"). A month cell is about 190px wide and
 * ~96px tall, and everything in it is already truncated or counted: an
 * interview shows a title with no time and no company, a public holiday shows
 * whichever half of its name fits, and five applications show as the words
 * `5 sent`. The day is the thing the reader is pointing at; the cell is only
 * as much of it as fits.
 *
 * ONE STACK FOR THE WHOLE DAY, not a tooltip per mark, and that is the
 * decision worth recording. Three separate tooltips on three marks inside a
 * 190px cell is three hover targets a few pixels apart, each holding a third
 * of the answer -- and the question anybody hovering a day cell is asking is
 * "what happened on the 18th", not "what is that one line". It also means a
 * day with an interview AND two applications reads as one day rather than as
 * two unrelated hovers.
 *
 * ORDER IS THE CELL'S ORDER, which is itself an argument the cell already
 * makes: the holiday is a property of the day and leads, what is BOOKED comes
 * next because it is somewhere you have to be, and what was SENT comes last
 * because it is already done. A tooltip that reordered them would make the
 * reader re-find things they had just looked at.
 */
export interface DayCard {
  key: string
  /** `interview`, `holiday`, `applied` -- the kind, in the cell's own words. */
  label: string
  icon: IconName
  title: string
  /** The company, where there is one. */
  detail: string | null
  /** The time, where there is one. */
  meta: string | null
}

/** `10:00 AM`, in the reader's own zone. The day is the tooltip's heading. */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

const EVENT_ICONS: Record<string, IconName> = {
  interview: 'Calendar',
  deadline: 'Clock',
  'take-home': 'Documents',
  'follow-up': 'Mail',
  event: 'Calendar',
}

export function dayCards({
  events = [],
  holidays = [],
  sent = [],
  companyByJobId = {},
}: {
  events?: CalendarEvent[]
  holidays?: PublicHoliday[]
  sent?: SentApplication[]
  companyByJobId?: Record<string, string>
}): DayCard[] {
  return [
    ...holidays.map((holiday) => ({
      key: `holiday-${holiday.date}-${holiday.name}`,
      label: 'holiday',
      icon: 'Flag' as IconName,
      title: holiday.localName,
      // The English name only when it says something the local one does not,
      // which is most of the time here and never for a country whose holidays
      // are already named in English.
      detail: holiday.name !== holiday.localName ? holiday.name : null,
      meta: null,
    })),
    ...events.map((event) => {
      const label = EVENT_LABELS[event.kind] ?? 'event'
      const company = event.job_id ? (companyByJobId[event.job_id] ?? null) : null
      return {
        key: `event-${event.id}`,
        label,
        icon: EVENT_ICONS[label] ?? ('Calendar' as IconName),
        title: event.title,
        // NOT TWICE. Plenty of events are titled after the employer --
        // `Interview — Ridgeway Outsourcing` -- and printing the company
        // underneath that is the same words in two type sizes, which reads as
        // a bug rather than as detail.
        detail:
          company && !event.title.toLowerCase().includes(company.toLowerCase())
            ? company
            : null,
        meta: formatTime(event.starts_at),
      }
    }),
    ...sent.map((application) => ({
      key: `sent-${application.id}`,
      label: 'applied',
      icon: 'Briefcase' as IconName,
      // THE ROLE LEADS AND THE COMPANY FOLLOWS, which is the order the
      // applications table and the record dialog both use. A stack of five
      // companies with the roles underneath would answer "who" when the
      // question a calendar asks is "what did I send".
      title: application.role,
      detail: application.company,
      meta: null,
    })),
  ]
}
