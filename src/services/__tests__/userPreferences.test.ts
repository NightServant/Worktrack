import { describe, it, expect } from 'vitest'
import { resolveDefaultCurrency, isSupportedCurrency, currencyForCountry } from '../userPreferences'

describe('resolveDefaultCurrency', () => {
  it('returns the stored preference when one exists', () => {
    expect(resolveDefaultCurrency({ default_currency: 'SGD' })).toBe('SGD')
  })

  it('falls back to PHP when the user has no preferences row', () => {
    expect(resolveDefaultCurrency(null)).toBe('PHP')
  })

  it('falls back to PHP when the stored code is not supported', () => {
    expect(resolveDefaultCurrency({ default_currency: 'XYZ' })).toBe('PHP')
  })
})

describe('isSupportedCurrency', () => {
  it('accepts every code the database CHECK allows', () => {
    for (const c of ['PHP','USD','EUR','GBP','SGD','AUD']) {
      expect(isSupportedCurrency(c)).toBe(true)
    }
  })
})

describe('the currency a new account starts in', () => {
  it('follows the reader when they have never chosen one', () => {
    // The preferences row is created lazily on first write, so most people
    // have none -- and every one of them used to get PHP, which is this app
    // author's currency and nobody else's.
    expect(resolveDefaultCurrency(null, 'US')).toBe('USD')
    expect(resolveDefaultCurrency(null, 'GB')).toBe('GBP')
    expect(resolveDefaultCurrency(null, 'SG')).toBe('SGD')
    expect(resolveDefaultCurrency(null, 'DE')).toBe('EUR')
  })

  it('never overrides a currency somebody actually chose', () => {
    // A stored preference is the one value here that was picked on purpose.
    expect(resolveDefaultCurrency({ default_currency: 'PHP' }, 'US')).toBe('PHP')
    expect(resolveDefaultCurrency({ default_currency: 'AUD' }, 'GB')).toBe('AUD')
  })

  it('falls back rather than offering a currency nothing can be saved in', () => {
    // The column has a CHECK constraint and these six are it. A reader in
    // Japan gets the fallback, not JPY.
    expect(currencyForCountry('JP')).toBeNull()
    expect(resolveDefaultCurrency(null, 'JP')).toBe('PHP')
    expect(resolveDefaultCurrency(null, null)).toBe('PHP')
  })
})
