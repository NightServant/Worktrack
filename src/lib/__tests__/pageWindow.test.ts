import { describe, it, expect } from 'vitest'
import { pageWindow } from '../pageWindow'

describe('pageWindow', () => {
  it('shows every page up to seven', () => {
    expect(pageWindow(1, 1)).toEqual([1])
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('keeps both ends and the neighbourhood of the current page beyond that', () => {
    expect(pageWindow(1, 12)).toEqual([1, 2, 3, 4, null, 12])
    expect(pageWindow(6, 12)).toEqual([1, null, 5, 6, 7, null, 12])
    expect(pageWindow(12, 12)).toEqual([1, null, 9, 10, 11, 12])
  })

  it('never shows an ellipsis for a gap of one page', () => {
    expect(pageWindow(4, 12)).toEqual([1, 2, 3, 4, 5, null, 12])
  })
})
