import { countryFromTimeZone } from './timezoneCountry'

/**
 * Where this person is, as well as a browser can answer it without asking.
 *
 * WHY IT IS NOT IN `holidays.ts` ANY MORE (2026-09-21). It was written for the
 * calendar and named for it, and it was general the whole time -- nothing in
 * it knows what a holiday is. The phone input needed the same answer and got a
 * second, worse implementation instead: `new Intl.Locale(navigator.language)
 * .maximize().region`, which is precisely the mistake the note below warns
 * about. It turned `en` into `US` for somebody in Manila and the phone library
 * caught it -- "Expected phone number +639282844172 to correspond to country
 * US but in reality it corresponds to country PH".
 *
 * So there is one resolver now and everything that wants a country asks it.
 * The two known callers are the calendar's holidays and the phone input's
 * opening country; a third should import this rather than write a third guess.
 *
 * THE CLOCK, THEN THE LANGUAGE, NEVER A MAXIMISED GUESS. A time zone is set
 * from the operating system and is about WHERE the machine is; a language tag
 * is about what its owner reads. `en-PH` carries a region and is worth
 * reading; a bare `en` does not, and inferring the United States from it is a
 * guess dressed up as knowledge.
 *
 * IT IS AN OPENING BID, NOT AN ANSWER, and every caller must leave a way to
 * correct it: the calendar has a country picker, the phone input has a country
 * dropdown. A detected value that cannot be changed is worse than none.
 *
 * NO IP LOOKUP AND NO PERMISSION PROMPT. The alternative design sends
 * somebody's address to a third party to find out what day Christmas is.
 */
export function resolveUserCountry(
  locales: readonly string[],
  timeZone?: string | null
): string | null {
  // THE CLOCK FIRST. A time zone is about where the machine is; a language tag
  // is about what its owner reads. Only one of those answers "where is this
  // person".
  //
  // `undefined` means "not told, go and look"; an explicit `null` means "there
  // is no zone, use the language". `??` cannot tell those apart, which is how
  // a test passing `null` to isolate the language path still picked up the
  // machine's own clock and asserted PH against every expectation.
  if (timeZone !== null) {
    const fromZone = countryFromTimeZone(timeZone)
    if (fromZone) return fromZone
  }

  for (const tag of locales) {
    // WALKED SUBTAG BY SUBTAG rather than matched with one pattern, and both
    // guards below are things a single pattern got wrong on the first try.
    // `zh-Hans-CN` puts a SCRIPT between the language and the region, so
    // "the second subtag" is not the region; and `en-u-ca-buddhist` opens a
    // Unicode EXTENSION whose `ca` is two letters and is not a country.
    const parts = tag.split(/[-_]/)
    for (const part of parts.slice(1)) {
      if (part.length === 1) break // a singleton starts an extension
      if (/^[A-Za-z]{2}$/.test(part)) return part.toUpperCase()
    }
  }
  return null
}

/**
 * The same answer, read from this browser.
 *
 * SEPARATE FROM THE PURE FUNCTION ABOVE so that one stays testable without a
 * DOM -- every test of the resolution rules passes its own locales and zone.
 * This is the half that touches globals, and it is the half that must never
 * run during a server render: `navigator` does not exist there, so a component
 * that called it while rendering would produce one country on the server and
 * another in the browser. Call it from an effect. See `useUserCountry`.
 */
export function detectUserCountry(): string | null {
  if (typeof navigator === 'undefined') return null
  const locales = navigator.languages?.length
    ? [...navigator.languages]
    : navigator.language
      ? [navigator.language]
      : []
  return resolveUserCountry(locales)
}
