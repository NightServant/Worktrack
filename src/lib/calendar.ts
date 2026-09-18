/**
 * Pure grid geometry for the calendar screen -- turning a year/month or an
 * arbitrary date into the `Date[]` shapes `MonthGrid` and `WeekStrip` render.
 *
 * This file does not bucket EVENTS into days. `groupEventsByDay` in
 * `src/services/events.ts` already owns that (see its docblock for the
 * TIMESTAMPTZ zone handling), and `Agenda`/`MonthGrid` call it directly --
 * writing a second day-bucketer here would give the calendar two competing
 * ideas of "which day does this event belong to."
 *
 * It DOES bucket applications, which is a different question with a different
 * answer: `date_applied` is a bare DATE rather than an instant, so the zone
 * reasoning above does not apply to it and the rule it needs instead is the
 * one `sentApplicationsByDay` carries at the foot of this file.
 */

/** The Sunday on or before `date`, at local midnight. */
function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  start.setDate(start.getDate() - start.getDay())
  return start
}

/**
 * Six full weeks (42 days) covering `month` (0-indexed, matching
 * `Date#getMonth`), padded with the trailing days of the prior month and the
 * leading days of the next rather than blank cells -- so a five-week month
 * like February never renders a shorter grid than a six-week month like
 * August 2026, which would otherwise make the page jump height as the viewer
 * navigates.
 */
export function buildMonthGrid(year: number, month: number): Date[][] {
  const start = startOfWeek(new Date(year, month, 1))
  const weeks: Date[][] = []
  const cursor = new Date(start)
  for (let w = 0; w < 6; w++) {
    const week: Date[] = []
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

/** The seven days (Sunday through Saturday) of the week containing `date`. */
export function weekOf(date: Date): Date[] {
  const start = startOfWeek(date)
  const days: Date[] = []
  const cursor = new Date(start)
  for (let d = 0; d < 7; d++) {
    days.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

/**
 * The Date-side counterpart to `localDayKey` in `src/services/date.ts`.
 * `groupEventsByDay` buckets events under `localDayKey(event.starts_at)` --
 * a TIMESTAMPTZ instant read in the viewer's local zone -- and a grid cell
 * needs the same "YYYY-MM-DD" string to look its bucket up with
 * `grouped.get(dayKey(cell))`.
 *
 * Deliberately not implemented by importing `localDayKey` and formatting
 * `cell.toISOString()`: `toISOString` converts a local `Date` back to UTC
 * first, which reintroduces the exact local-vs-UTC mismatch this pairing
 * exists to avoid. This function only ever reads the local getters
 * (`getFullYear`/`getMonth`/`getDate`) already on the `Date` objects this
 * file's own grid geometry builds.
 */
export function dayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * The inverse of `dayKey`: reconstructs the local calendar day a bucket key
 * names, for display (e.g. an agenda day heading). Parses the "YYYY-MM-DD"
 * parts by hand and calls the local `Date(y, m, d)` constructor rather than
 * `new Date(key)` -- the latter parses a bare date string as UTC midnight,
 * which is the wrong calendar day in any zone behind UTC and is precisely
 * the bug class `localDayKey`/`dayKey` exist to keep out of this file.
 */
export function parseDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** One application, as a calendar cell and its tooltip show it. */
export interface SentApplication {
  id: string
  company: string
  role: string
}

/**
 * Applications bucketed under the day they were sent.
 *
 * THE ROWS, NOT A COUNT, and that is what the day tooltip is built from (Gabe,
 * 2026-09-18: "add a tooltip for viewing the applications sent within that day
 * -- show the role and company name"). It was `Record<string, number>` and a
 * cell could only ever say `5 sent`, which is the one fact about those five
 * applications that does not help: the reader knows they were busy, what they
 * want back is WHICH. The count is still there -- it is `length`.
 *
 * PARSED BY PARTS, NEVER `new Date(string)`. `date_applied` is a bare DATE,
 * and the Date constructor reads `2026-09-18` as UTC midnight -- which is the
 * previous day for anyone behind UTC and would file a whole month one cell to
 * the left. The same rule `jobStats` and `parseDayKey` follow.
 *
 * Structurally typed rather than taking `Job[]`: the four fields it reads are
 * the contract, and that keeps this file free of a domain import.
 */
export function sentApplicationsByDay(
  jobs: { id: string; company: string; role: string; date_applied: string | null }[]
): Record<string, SentApplication[]> {
  const byDay: Record<string, SentApplication[]> = {}
  for (const job of jobs) {
    if (!job.date_applied) continue
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(job.date_applied)
    if (!parts) continue
    const key = dayKey(new Date(+parts[1], +parts[2] - 1, +parts[3]))
    ;(byDay[key] ??= []).push({ id: job.id, company: job.company, role: job.role })
  }
  return byDay
}
