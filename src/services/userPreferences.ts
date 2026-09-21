// Mirrors user_preferences_currency_check and jobs_salary_currency_check.
export const SUPPORTED_CURRENCIES = ['PHP','USD','EUR','GBP','SGD','AUD'] as const
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

export interface UserPreferences {
  user_id: string
  default_currency: string
  created_at: string
  updated_at: string
}

export function isSupportedCurrency(code: string): boolean {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(code)
}

/**
 * Which of the six currencies a country uses, or null.
 *
 * ONLY THE SIX THIS APP STORES. The column has a CHECK constraint and these
 * are it, so a reader in Japan gets null rather than JPY -- and null means the
 * caller falls back rather than offering a currency no application can be
 * saved in.
 *
 * THE EUROZONE IS THE ONLY LIST WORTH WRITING OUT. The other five are one
 * country each; EUR is twenty, and leaving them out would mean every European
 * opened on somebody else's currency. Members as of 2026, from the ECB's own
 * list -- it changes about once a decade and a stale entry costs one wrong
 * default, which the picker in Settings corrects.
 */
const EUROZONE = new Set([
  'AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV',
  'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES',
])

export function currencyForCountry(country: string | null): SupportedCurrency | null {
  if (!country) return null
  const code = country.toUpperCase()
  if (EUROZONE.has(code)) return 'EUR'
  const direct: Record<string, SupportedCurrency> = {
    PH: 'PHP',
    US: 'USD',
    GB: 'GBP',
    SG: 'SGD',
    AU: 'AUD',
  }
  return direct[code] ?? null
}

/**
 * The currency a new application should start in.
 *
 * THE STORED PREFERENCE ALWAYS WINS. It is the one value here somebody chose
 * on purpose, and detection must never override a choice.
 *
 * WITHOUT ONE, THE COUNTRY DECIDES (2026-09-21). The row is created lazily on
 * first write, so most users never have one -- and until now every one of them
 * got PHP, which is this app author's currency and nobody else's. `country`
 * comes from `resolveUserCountry`, the same resolver behind the calendar's
 * holidays and the phone input's country, so there is one answer to "where is
 * this person" rather than three.
 *
 * PHP REMAINS THE LAST RESORT rather than USD, and that is deliberate: this
 * app is used from the Philippines and an undetectable country is more likely
 * to be a browser that reports nothing than a browser in Ohio.
 *
 * An unrecognised stored code falls back rather than throwing: the CHECK
 * constraint should make that impossible, but a value read from the database
 * should not be able to break the form that renders it.
 */
export function resolveDefaultCurrency(
  prefs: Pick<UserPreferences, 'default_currency'> | null,
  country: string | null = null
): SupportedCurrency {
  if (prefs !== null && isSupportedCurrency(prefs.default_currency)) {
    return prefs.default_currency as SupportedCurrency
  }
  return currencyForCountry(country) ?? 'PHP'
}
