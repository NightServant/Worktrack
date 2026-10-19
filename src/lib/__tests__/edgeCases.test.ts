import { describe, it, expect, vi, afterEach } from 'vitest'
import { jobValidation } from '@/services/jobValidation'
import { matchesTerms, searchTerms } from '../search'
import { pageWindow } from '../pageWindow'
import { isTailoredFor, tailoredCompanyOf } from '@/services/applicationDocuments'
import { dayKey, parseDayKey } from '../calendar'
import { rangeStartMonth } from '../analyticsRange'

/**
 * EDGE CASES (Gabe, 2026-10-19: "Implement more test case scenarios to catch
 * more bugs within the system itself"). Inputs at the boundaries the ordinary
 * suites do not reach: time zones, month and year ends, accents, ranges with
 * nothing in them, and look-alike hosts.
 */

afterEach(() => {
  vi.useRealTimers()
})

describe('the date an application was sent', () => {
  it("accepts today's LOCAL date before UTC has reached it", () => {
    // 07:30 on 19 October in Manila is still 18 October in UTC. Comparing
    // against UTC's today refused an application sent this morning as
    // "in the future" for the first eight hours of every Philippine day.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 19, 7, 30)) // local time, whatever zone
    expect(jobValidation.validateDateApplied(dayKey(new Date()))).toBeNull()
  })

  it('still refuses tomorrow', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 19, 23, 59))
    expect(jobValidation.validateDateApplied('2026-10-20')).not.toBeNull()
  })

  it('refuses a day that does not exist, rather than rolling it over', () => {
    expect(jobValidation.validateDateApplied('2026-02-30')).not.toBeNull()
    expect(jobValidation.validateDateApplied('2026-13-01')).not.toBeNull()
    expect(jobValidation.validateDateApplied('2026-00-10')).not.toBeNull()
    // A real leap day is fine.
    expect(jobValidation.validateDateApplied('2024-02-29')).toBeNull()
    expect(jobValidation.validateDateApplied('2025-02-29')).not.toBeNull()
  })
})

describe('a contact LinkedIn address', () => {
  it('accepts LinkedIn and its subdomains', () => {
    expect(jobValidation.validateLinkedInUrl('https://www.linkedin.com/in/someone')).toBeNull()
    expect(jobValidation.validateLinkedInUrl('https://ph.linkedin.com/in/someone')).toBeNull()
    expect(jobValidation.validateLinkedInUrl('https://linkedin.com/company/acme')).toBeNull()
  })

  it('refuses a host that only MENTIONS linkedin.com', () => {
    for (const url of [
      'https://evil.example/?next=linkedin.com',
      'https://notlinkedin.com/in/x',
      'https://linkedin.com.evil.example/in/x',
      'https://evil.example/linkedin.com/in/x',
    ]) {
      expect(jobValidation.validateLinkedInUrl(url), url).not.toBeNull()
    }
  })
})

describe('search', () => {
  it('finds a word whatever its accents', () => {
    // A reader typing "telefonica" or "cafe" means the company spelt with
    // the accent, and the other way round.
    expect(matchesTerms(searchTerms('telefonica'), 'Telefónica')).toBe(true)
    expect(matchesTerms(searchTerms('Café'), 'cafe society')).toBe(true)
  })

  it('treats symbols as text, not as a pattern', () => {
    expect(matchesTerms(searchTerms('c++'), 'C++ developer')).toBe(true)
    expect(matchesTerms(searchTerms('(senior)'), 'Engineer (Senior)')).toBe(true)
    expect(matchesTerms(searchTerms('.*'), 'anything')).toBe(false)
  })

  it('matches everything for an empty or blank query', () => {
    expect(matchesTerms(searchTerms('   '), 'anything')).toBe(true)
    expect(matchesTerms(searchTerms(''), null, undefined)).toBe(true)
  })
})

describe('the pager window', () => {
  it('has nothing to show for no pages', () => {
    expect(pageWindow(1, 0)).toEqual([])
  })

  it('clamps a current page outside the range instead of inventing pages', () => {
    for (const [current, count] of [
      [0, 12],
      [-3, 12],
      [99, 12],
    ] as const) {
      const pages = pageWindow(current, count).filter((p): p is number => p !== null)
      expect(pages.every((p) => p >= 1 && p <= count), `${current}/${count}`).toBe(true)
      expect(pages).toContain(1)
      expect(pages).toContain(count)
    }
  })
})

describe('which application a document was tailored for', () => {
  it('reads the company after the last separator', () => {
    expect(tailoredCompanyOf('CV — Acme — Asia')).toBe('Asia')
    expect(tailoredCompanyOf('CV  —   Acme ')).toBe('Acme')
    expect(tailoredCompanyOf('CV —')).toBeNull()
    expect(tailoredCompanyOf('CV – Acme')).toBeNull() // an en dash is not the separator
  })

  it("still matches after the company's capitals change", () => {
    // A company retyped "acme corp" -> "Acme Corp" kept its tailored CV but
    // unlocked it, because the comparison was case-sensitive.
    expect(isTailoredFor('CV — Acme Corp', 'acme corp')).toBe(true)
    expect(isTailoredFor('CV — Acme Corp', 'Acme')).toBe(false)
  })
})

describe('day keys and month ranges at the edges of the calendar', () => {
  it('round-trips a leap day and a year end', () => {
    for (const key of ['2028-02-29', '2026-12-31', '2027-01-01']) {
      expect(dayKey(parseDayKey(key))).toBe(key)
    }
  })

  it('counts a range back across a year end, from the last day of a month', () => {
    // From 31 March, three months back is January -- not a rollover into a
    // month that "31 January minus a month" would make.
    expect(rangeStartMonth('3m' as never, new Date(2026, 2, 31))).toBe('2026-01')
    expect(rangeStartMonth('3m' as never, new Date(2026, 0, 15))).toBe('2025-11')
  })
})
