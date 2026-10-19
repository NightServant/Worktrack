import { describe, it, expect } from 'vitest'
import { countryFromLocation, currencyFromText, detectCurrency } from '../currencyDetection'

/**
 * Gabe, 2026-10-19: "Default Currency settings in the Settings Page must be
 * removed. The system must be able to detect the currency of the particular
 * job application itself." The application says what it pays in -- its salary
 * text or where the job is -- so that is what decides, per application.
 */
describe('currencyFromText', () => {
  it('reads an ISO code wherever it appears', () => {
    expect(currencyFromText('Salary: PHP 40,000 - 60,000 monthly')).toBe('PHP')
    expect(currencyFromText('80k–100k usd per year')).toBe('USD')
    expect(currencyFromText('Pay range 5,000 SGD')).toBe('SGD')
  })

  it('reads the unambiguous symbols', () => {
    expect(currencyFromText('₱50,000 a month')).toBe('PHP')
    expect(currencyFromText('€55.000 brutto')).toBe('EUR')
    expect(currencyFromText('£45,000 + bonus')).toBe('GBP')
    expect(currencyFromText('S$6,000 per month')).toBe('SGD')
    expect(currencyFromText('A$120k package')).toBe('AUD')
    expect(currencyFromText('AU$120k package')).toBe('AUD')
    expect(currencyFromText('US$4,000 monthly')).toBe('USD')
  })

  it('reads the currency named in words', () => {
    expect(currencyFromText('competitive pay in Philippine pesos')).toBe('PHP')
    expect(currencyFromText('paid in euros')).toBe('EUR')
    expect(currencyFromText('salary in Singapore dollars')).toBe('SGD')
  })

  it('leaves a bare dollar sign to the location, since four countries use one', () => {
    expect(currencyFromText('$120,000 base')).toBeNull()
  })

  it('does not take the PHP language for pesos', () => {
    // A US posting that asks for "Laravel, PHP and MySQL" is not paid in
    // pesos. A code counts only beside an amount.
    expect(currencyFromText('Stack: Laravel, PHP and MySQL. $150k base.')).toBeNull()
    expect(currencyFromText('PHP 40,000 to 60,000')).toBe('PHP')
    expect(currencyFromText('up to 60,000 php monthly')).toBe('PHP')
    expect(currencyFromText('PHP40k')).toBe('PHP')
  })

  it('does not read a code out of the middle of a word', () => {
    // "CUSDA", "EUROPA" and "Philippines" are not currencies.
    expect(currencyFromText('Work with CUSDA partners across EUROPA')).toBeNull()
    expect(currencyFromText('Based in the Philippines')).toBeNull()
  })

  it('takes the first currency the text states, not the most frequent', () => {
    // The salary is usually stated once, near the top; a later mention is
    // often a client's market ("we serve USD clients").
    expect(currencyFromText('₱80,000 monthly. We work with USD and EUR clients.')).toBe('PHP')
  })

  it('handles nothing at all', () => {
    expect(currencyFromText('')).toBeNull()
    expect(currencyFromText(null)).toBeNull()
    expect(currencyFromText(undefined)).toBeNull()
  })
})

describe('countryFromLocation', () => {
  it('knows the countries and their usual cities', () => {
    expect(countryFromLocation('Makati, Metro Manila')).toBe('PH')
    expect(countryFromLocation('BGC, Taguig City')).toBe('PH')
    expect(countryFromLocation('Bamban, Tarlac, Philippines')).toBe('PH')
    expect(countryFromLocation('Singapore')).toBe('SG')
    expect(countryFromLocation('Sydney NSW')).toBe('AU')
    expect(countryFromLocation('London, England')).toBe('GB')
    expect(countryFromLocation('Berlin, Germany')).toBe('DE')
    expect(countryFromLocation('Dublin')).toBe('IE')
  })

  it('reads a US "City, ST" location and the country spelled out', () => {
    expect(countryFromLocation('Austin, TX')).toBe('US')
    expect(countryFromLocation('San Francisco, CA, USA')).toBe('US')
    expect(countryFromLocation('United States')).toBe('US')
  })

  it('says nothing for a location that names no country', () => {
    expect(countryFromLocation('Remote')).toBeNull()
    expect(countryFromLocation('Anywhere')).toBeNull()
    expect(countryFromLocation('')).toBeNull()
    expect(countryFromLocation(null)).toBeNull()
  })

  it('does not take a two-letter word for a state', () => {
    // "Remote, OR onsite" is not Oregon; only a trailing ", XX" is a state.
    expect(countryFromLocation('Remote OR onsite')).toBeNull()
  })

  it('prefers the country stated over a city that shares its name', () => {
    // There is a Manila in Arkansas, but "Manila, Philippines" says which.
    expect(countryFromLocation('Paris, Texas, United States')).toBe('US')
  })
})

describe('detectCurrency', () => {
  it('trusts a currency the posting reader extracted', () => {
    expect(detectCurrency({ extracted: 'GBP', text: '₱50,000', location: 'Manila' })).toBe('GBP')
  })

  it('ignores an extracted code the app cannot store', () => {
    expect(detectCurrency({ extracted: 'JPY', location: 'Singapore' })).toBe('SGD')
  })

  it('takes the text before the location: a salary says what it pays in', () => {
    // A Manila-based role paid in dollars is paid in dollars.
    expect(detectCurrency({ text: 'US$3,000 monthly', location: 'Makati' })).toBe('USD')
  })

  it("falls back to the location's country, which decides a bare dollar sign", () => {
    expect(detectCurrency({ text: '$7,000 per month', location: 'Singapore' })).toBe('SGD')
    expect(detectCurrency({ text: '$120k', location: 'Austin, TX' })).toBe('USD')
  })

  it('returns null when the application says nothing, for the caller to fall back', () => {
    expect(detectCurrency({ text: 'Great culture!', location: 'Remote' })).toBeNull()
    expect(detectCurrency({})).toBeNull()
  })
})
