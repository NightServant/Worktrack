import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useNaturalLineHeight } from '../useNaturalLineHeight'

/**
 * A WEB FONT MEASURED BEFORE IT ARRIVES IS MEASURED AS ITS FALLBACK (Gabe,
 * 2026-10-18). The editor's Garamond is an @font-face, and the probe ran on
 * mount: it read Georgia's 1.14 and kept it, so every line stayed taller than
 * the fitted face's 1.125 and the pages broke early.
 */
describe('useNaturalLineHeight', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(document, 'fonts')
  })

  it('measures again once the font has loaded', async () => {
    let loaded = false
    let resolve!: () => void
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: () => new Promise<void>((r) => (resolve = () => { loaded = true; r() })) },
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ height: loaded ? 112.5 : 114 }) as DOMRect
    )

    const { result } = renderHook(() => useNaturalLineHeight('"Garamond", Georgia, serif'))
    await waitFor(() => expect(result.current).toBeCloseTo(1.14))
    resolve()
    await waitFor(() => expect(result.current).toBeCloseTo(1.125))
  })
})
