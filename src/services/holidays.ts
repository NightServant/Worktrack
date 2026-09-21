/**
 * Public holidays, from Nager.Date (https://github.com/nager/nager.date).
 *
 * WHY THIS SOURCE (Gabe, 2026-09-10, naming the repository). It is MIT, it
 * needs no key and no account, it answers with `access-control-allow-origin:
 * *` so the browser can call it directly, and Cloudflare in front of it sends
 * `cache-control: public, max-age=604800` — a week, which is right for data
 * that changes once a year. So there is no route of ours to write, no secret
 * to store, and no proxy to pay for: the alternative designs all added a
 * server hop to a public, cacheable, keyless GET.
 *
 * A `date` IS A WALL-CALENDAR DAY, not an instant — `"2026-04-09"` with no
 * zone, exactly like `jobs.date_applied`. It is deliberately never turned into
 * a `Date` here: the calendar grid keys its cells with `dayKey`, which
 * produces the same `YYYY-MM-DD` shape from a local `Date`, so the two meet as
 * strings and no timezone ever gets the chance to move a holiday a day.
 *
 * THE COUNTRY IS A GUESS THE USER CAN CORRECT, and both halves matter. A
 * browser's language tag is the language its UI is in, not where the person
 * is — Chrome reports `en-US` on plenty of machines in Manila — so detection
 * alone would confidently show the wrong country's holidays, which is worse
 * than showing none. The calendar therefore carries a visible country picker
 * and remembers the choice; this function only supplies the opening bid.
 */

export interface PublicHoliday {
  /** `YYYY-MM-DD`, a day on a wall calendar. Never parse this as an instant. */
  date: string
  /** The name in the country's own language, e.g. `Araw ng Kagitingan`. */
  localName: string
  /** The English name, e.g. `Day of Valor`. */
  name: string
  countryCode: string
  /** False when the holiday is observed only in some regions of the country. */
  global: boolean
}

export interface HolidayCountry {
  countryCode: string
  name: string
}

const API = 'https://date.nager.at/api/v3'

/** Where the choice is remembered. Per-browser; there is no column for it. */
export const HOLIDAY_COUNTRY_KEY = 'worktrack.holiday-country'

/**
 * The opening guess at a country.
 *
 * THE IMPLEMENTATION MOVED to `services/userLocation` on 2026-09-21 -- it was
 * general the whole time and nothing in it knows what a holiday is, which the
 * phone input found out by writing a second, worse copy. The name stays here
 * because the calendar's own code and tests read better for it.
 */
export { resolveUserCountry as resolveHolidayCountry } from './userLocation'

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API}${path}`, { signal })
  if (!response.ok) throw new Error(`Nager.Date answered ${response.status}`)
  return (await response.json()) as T
}

/** Every public holiday in one country in one year. */
export function fetchPublicHolidays(
  year: number,
  countryCode: string,
  signal?: AbortSignal
): Promise<PublicHoliday[]> {
  return getJson<PublicHoliday[]>(`/PublicHolidays/${year}/${countryCode}`, signal)
}

/** The countries Nager.Date has data for, alphabetically by name. */
export async function fetchHolidayCountries(signal?: AbortSignal): Promise<HolidayCountry[]> {
  const countries = await getJson<HolidayCountry[]>('/AvailableCountries', signal)
  return [...countries].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Holidays bucketed by their day key, matching `groupEventsByDay`'s shape so
 * the two can be looked up the same way from the same cell.
 *
 * A day CAN hold more than one — the Philippines stacks Eid'l Fitr onto other
 * observances in some years — so the value is a list rather than a single
 * holiday, and a cell that shows only the first is making that choice
 * knowingly rather than losing data it never had.
 */
export function holidaysByDay(holidays: PublicHoliday[]): Map<string, PublicHoliday[]> {
  const grouped = new Map<string, PublicHoliday[]>()
  for (const holiday of holidays) {
    const bucket = grouped.get(holiday.date)
    if (bucket) bucket.push(holiday)
    else grouped.set(holiday.date, [holiday])
  }
  return grouped
}
