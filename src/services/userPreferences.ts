// Mirrors user_preferences_currency_check and jobs_salary_currency_check.
export const SUPPORTED_CURRENCIES = ['PHP','USD','EUR','GBP','SGD','AUD'] as const
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

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
 * detection, which the application's own currency field corrects.
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
