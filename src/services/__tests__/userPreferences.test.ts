import { describe, it, expect } from 'vitest'
import { isSupportedCurrency, currencyForCountry } from '../userPreferences'

// The account-wide default currency, and the resolver that read it, were
// removed on 2026-10-19: each application's currency is detected from the
// application (lib/currencyDetection). What is left here is the vocabulary.

describe('isSupportedCurrency', () => {
  it('accepts every code the database CHECK allows', () => {
    for (const c of ['PHP', 'USD', 'EUR', 'GBP', 'SGD', 'AUD']) {
      expect(isSupportedCurrency(c)).toBe(true)
    }
  })

  it('refuses everything else, lowercase included', () => {
    for (const c of ['JPY', 'php', '', ' PHP', 'PHPX']) expect(isSupportedCurrency(c)).toBe(false)
  })
})

describe('currencyForCountry', () => {
  it('maps the five single-country currencies and the whole eurozone', () => {
    expect(currencyForCountry('PH')).toBe('PHP')
    expect(currencyForCountry('US')).toBe('USD')
    expect(currencyForCountry('GB')).toBe('GBP')
    expect(currencyForCountry('SG')).toBe('SGD')
    expect(currencyForCountry('AU')).toBe('AUD')
    for (const c of ['DE', 'FR', 'IE', 'HR', 'MT']) expect(currencyForCountry(c)).toBe('EUR')
  })

  it('is case-insensitive', () => {
    expect(currencyForCountry('ph')).toBe('PHP')
  })

  it('returns null rather than a currency nothing can be saved in', () => {
    // The column has a CHECK constraint and these six are it.
    expect(currencyForCountry('JP')).toBeNull()
    expect(currencyForCountry(null)).toBeNull()
    expect(currencyForCountry('')).toBeNull()
  })
})
