import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRecordDraft } from '../record/useRecordDraft'
import { makeJob } from '@/test/fixtures'

/**
 * A NEW application's currency follows what the application says (Gabe,
 * 2026-10-19: no account default). These pin the three rules that make that
 * safe: it follows the location and description as they are filled, it never
 * overrides a currency somebody chose, and it never relabels a SAVED
 * application's figures.
 */
describe("a new application's currency", () => {
  it('follows the location as it is typed', () => {
    const { result } = renderHook(() => useRecordDraft(null, 'PHP'))
    expect(result.current.draft.currency).toBe('PHP')
    act(() => result.current.set('location', 'Singapore'))
    expect(result.current.draft.currency).toBe('SGD')
    act(() => result.current.set('location', 'Berlin, Germany'))
    expect(result.current.draft.currency).toBe('EUR')
  })

  it('reads the salary the description states before the location', () => {
    const { result } = renderHook(() => useRecordDraft(null, 'PHP'))
    act(() => result.current.replace({ location: 'Makati', description: 'Pay: US$3,000 monthly' }))
    expect(result.current.draft.currency).toBe('USD')
  })

  it('keeps the starting currency when the application names none', () => {
    const { result } = renderHook(() => useRecordDraft(null, 'AUD'))
    act(() => result.current.set('location', 'Remote'))
    expect(result.current.draft.currency).toBe('AUD')
  })

  it('never overrides a currency the reader picked', () => {
    const { result } = renderHook(() => useRecordDraft(null, 'PHP'))
    act(() => result.current.set('currency', 'GBP'))
    act(() => result.current.set('location', 'Singapore'))
    expect(result.current.draft.currency).toBe('GBP')
  })

  it('never overrides the currency the posting reader extracted', () => {
    const { result } = renderHook(() => useRecordDraft(null, 'PHP'))
    act(() => result.current.replace({ currency: 'USD', location: 'Singapore' }))
    expect(result.current.draft.currency).toBe('USD')
  })

  it("never relabels a saved application's figures when its location changes", () => {
    const job = makeJob({ id: 'j1', status: 'applied', salary_currency: 'PHP', salary_min: 50000 })
    const { result } = renderHook(() => useRecordDraft(job, 'PHP'))
    act(() => result.current.set('location', 'Singapore'))
    expect(result.current.draft.currency).toBe('PHP')
  })
})
