import {
  currencyForCountry,
  isSupportedCurrency,
  type SupportedCurrency,
} from '@/services/userPreferences'

/**
 * Which currency ONE APPLICATION is in, from what the application itself says.
 *
 * Gabe, 2026-10-19: "Default Currency settings in the Settings Page must be
 * removed. The system must be able to detect the currency of the particular
 * job application itself." An account-wide default labelled every figure in
 * one currency whatever the job paid in; a posting states its own, in its
 * salary or in where the job is.
 *
 * ONLY THE SIX THE COLUMN STORES (see `SUPPORTED_CURRENCIES`). Anything else is
 * null, and the caller falls back -- a currency no row can be saved in is not
 * an answer.
 */

/**
 * Codes count only BESIDE AN AMOUNT. "PHP" is also the language half the
 * postings this app reads ask for: "Laravel, PHP and MySQL" in a US posting is
 * not a salary in pesos. "PHP 40,000", "60,000 php" and "PHP40k" are.
 */
const CODES = 'PHP|USD|EUR|GBP|SGD|AUD'
const CODE_BEFORE_AMOUNT = new RegExp(`\\b(${CODES})\\s?(?=[\\d₱$€£])`, 'gi')
const CODE_AFTER_AMOUNT = new RegExp(`\\d[\\d,.]*\\s?[km]?\\s?(${CODES})\\b`, 'gi')

/**
 * Symbols and names that say one currency on their own. A BARE "$" IS NOT ONE:
 * four of the six are dollars, so it is left for the location to settle.
 * The prefixed dollars come first and refuse a letter before them, so the S$
 * inside "US$" is not read as Singapore's.
 */
const MARKERS: [RegExp, SupportedCurrency][] = [
  [/(?<![A-Za-z])US\$/g, 'USD'],
  [/(?<![A-Za-z])S\$/g, 'SGD'],
  [/(?<![A-Za-z])AU?\$/g, 'AUD'],
  [/₱/g, 'PHP'],
  [/€/g, 'EUR'],
  [/£/g, 'GBP'],
  [/\b(?:philippine\s+)?pesos?\b/gi, 'PHP'],
  [/\beuros?\b/gi, 'EUR'],
  [/\b(?:pounds?\s+sterling|british\s+pounds?)\b/gi, 'GBP'],
  [/\bsingapore\s+dollars?\b/gi, 'SGD'],
  [/\baustralian\s+dollars?\b/gi, 'AUD'],
  [/\b(?:us|american)\s+dollars?\b/gi, 'USD'],
]

/**
 * The FIRST currency the text states. A salary is stated once, usually near
 * the top; a later mention is as often the client's market ("we serve USD
 * clients") as the pay.
 */
export function currencyFromText(text: string | null | undefined): SupportedCurrency | null {
  if (!text) return null
  let best: { at: number; currency: SupportedCurrency } | null = null
  const consider = (at: number, currency: string) => {
    const code = currency.toUpperCase()
    if (isSupportedCurrency(code) && (best === null || at < best.at)) {
      best = { at, currency: code as SupportedCurrency }
    }
  }
  for (const pattern of [CODE_BEFORE_AMOUNT, CODE_AFTER_AMOUNT]) {
    for (const match of text.matchAll(pattern)) consider(match.index ?? 0, match[1])
  }
  for (const [pattern, currency] of MARKERS) {
    for (const match of text.matchAll(pattern)) consider(match.index ?? 0, currency)
  }
  return (best as { currency: SupportedCurrency } | null)?.currency ?? null
}

/** Country names, every country whose currency the app stores. */
const COUNTRIES: [RegExp, string][] = [
  [/\b(?:philippines|pilipinas)\b/i, 'PH'],
  [/\bsingapore\b/i, 'SG'],
  [/\baustralia\b/i, 'AU'],
  [/\b(?:united kingdom|uk|great britain|england|scotland|wales|northern ireland)\b/i, 'GB'],
  [/\b(?:united states(?: of america)?|usa|u\.s\.a?\.?)(?![a-z])/i, 'US'],
  [/\bgermany\b/i, 'DE'],
  [/\bfrance\b/i, 'FR'],
  [/\b(?:netherlands|holland)\b/i, 'NL'],
  [/\bireland\b/i, 'IE'],
  [/\bspain\b/i, 'ES'],
  [/\bitaly\b/i, 'IT'],
  [/\bportugal\b/i, 'PT'],
  [/\bbelgium\b/i, 'BE'],
  [/\baustria\b/i, 'AT'],
  [/\bfinland\b/i, 'FI'],
  [/\bgreece\b/i, 'GR'],
  [/\bluxembourg\b/i, 'LU'],
  [/\bestonia\b/i, 'EE'],
  [/\blatvia\b/i, 'LV'],
  [/\blithuania\b/i, 'LT'],
  [/\bslovakia\b/i, 'SK'],
  [/\bslovenia\b/i, 'SI'],
  [/\bcroatia\b/i, 'HR'],
  [/\bcyprus\b/i, 'CY'],
  [/\bmalta\b/i, 'MT'],
]

/**
 * Cities and regions a posting names without its country. Checked AFTER the
 * country names and the US "City, ST" form, so "Paris, Texas, United States"
 * and "Birmingham, AL" are read by what they say about themselves.
 */
const PLACES: [RegExp, string][] = [
  [
    /\b(?:metro manila|manila|makati|taguig|bgc|bonifacio global city|pasig|ortigas|quezon city|mandaluyong|pasay|para[ñn]aque|alabang|muntinlupa|cebu|davao|iloilo|baguio|clark|pampanga|tarlac|laguna|cavite|bulacan|bacolod|cagayan de oro)\b/i,
    'PH',
  ],
  [/\b(?:sydney|melbourne|brisbane|perth|adelaide|canberra|nsw|qld)\b/i, 'AU'],
  [/\b(?:london|manchester|birmingham|edinburgh|glasgow|bristol|leeds|liverpool)\b/i, 'GB'],
  [/\b(?:new york|san francisco|seattle|chicago|boston|los angeles|austin|silicon valley)\b/i, 'US'],
  [/\b(?:berlin|munich|hamburg|frankfurt)\b/i, 'DE'],
  [/\b(?:paris|lyon)\b/i, 'FR'],
  [/\b(?:amsterdam|rotterdam)\b/i, 'NL'],
  [/\bdublin\b/i, 'IE'],
  [/\b(?:madrid|barcelona)\b/i, 'ES'],
  [/\b(?:milan|rome)\b/i, 'IT'],
  [/\b(?:lisbon|porto)\b/i, 'PT'],
  [/\bbrussels\b/i, 'BE'],
  [/\bvienna\b/i, 'AT'],
  [/\bhelsinki\b/i, 'FI'],
  [/\bathens\b/i, 'GR'],
  [/\btallinn\b/i, 'EE'],
]

const US_STATES = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' ')
)

function firstMatch(text: string, table: [RegExp, string][]): string | null {
  let best: { at: number; code: string } | null = null
  for (const [pattern, code] of table) {
    const match = pattern.exec(text)
    if (match && (best === null || match.index < best.at)) best = { at: match.index, code }
  }
  return best?.code ?? null
}

/**
 * The country a location names, as an ISO code, or null.
 *
 * A US STATE COUNTS ONLY AS A TRAILING ", XX" ("Austin, TX", optionally with a
 * ZIP), because a bare capital pair is as often a word: "Remote OR onsite" is
 * not Oregon.
 */
export function countryFromLocation(location: string | null | undefined): string | null {
  const text = location?.trim()
  if (!text) return null
  const country = firstMatch(text, COUNTRIES)
  if (country) return country
  const state = /,\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/.exec(text)?.[1]
  if (state && US_STATES.has(state)) return 'US'
  return firstMatch(text, PLACES)
}

/**
 * The application's currency, best evidence first:
 *
 * 1. what the posting reader extracted, when it is one the app stores;
 * 2. what the salary or the description states;
 * 3. the country the location names -- which is also what settles a bare "$".
 *
 * Null when the application says nothing, so the caller decides the fallback.
 */
export function detectCurrency(input: {
  extracted?: string | null
  text?: string | null
  location?: string | null
}): SupportedCurrency | null {
  const extracted = input.extracted?.trim().toUpperCase()
  if (extracted && isSupportedCurrency(extracted)) return extracted as SupportedCurrency
  return currencyFromText(input.text) ?? currencyForCountry(countryFromLocation(input.location))
}
