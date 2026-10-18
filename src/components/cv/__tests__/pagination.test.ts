import { describe, it, expect } from 'vitest'
import { breakIndexes, pageUnits, remainingOnPage } from '../pagination'

/**
 * The break rule, tested without a browser: the plugin measures and this
 * decides. A page is 1000 units here so the arithmetic reads clearly.
 */
const PAGE = 1000

describe('breakIndexes', () => {
  it('does not break a document that fits on one page', () => {
    expect(breakIndexes([300, 300, 300], PAGE)).toEqual([])
  })

  it('breaks before the block that would straddle the edge', () => {
    // 400 + 400 = 800, and the third would reach 1200, so it starts page two.
    expect(breakIndexes([400, 400, 400], PAGE)).toEqual([2])
  })

  it('breaks again on every page, not only the first', () => {
    expect(breakIndexes(Array(9).fill(400), PAGE)).toEqual([2, 4, 6, 8])
  })

  it('fills a page exactly without breaking', () => {
    // Exactly 1000 fits; the break belongs before the NEXT block.
    expect(breakIndexes([500, 500, 10], PAGE)).toEqual([2])
  })

  it('LEAVES A BLOCK TALLER THAN A PAGE ALONE, rather than looping', () => {
    // Moving it to the next page would not help -- it does not fit there
    // either -- and a rule that keeps moving it never terminates.
    expect(breakIndexes([2500], PAGE)).toEqual([])
    expect(breakIndexes([300, 2500, 300], PAGE)).toEqual([])
  })

  it('starts a fresh page after an oversized block', () => {
    // The overflowing block ends wherever it ends; what follows begins a page.
    expect(breakIndexes([2500, 400, 400, 400], PAGE)).toEqual([3])
  })

  it('handles an empty document and a nonsense page height', () => {
    expect(breakIndexes([], PAGE)).toEqual([])
    expect(breakIndexes([100, 200], 0)).toEqual([])
    expect(breakIndexes([100, 200], -5)).toEqual([])
  })
})

describe('remainingOnPage', () => {
  it('is what is left of the page when the break falls', () => {
    // Two 400s used 800 of 1000, so 200 remain. The bands around the seam --
    // this page's bottom margin and the next page's top margin -- are added
    // by the widget, which is what keeps the text off the page edge.
    expect(remainingOnPage([400, 400, 400], 2, PAGE)).toBe(200)
  })

  it('is nothing when the page was filled exactly', () => {
    expect(remainingOnPage([500, 500, 10], 2, PAGE)).toBe(0)
  })

  it('AGREES WITH breakIndexes, which is what makes this converge', () => {
    // The whole design rests on both walking the same accumulation, so a
    // second pass over the same heights gives the same answer whether or not
    // spacers are already in the document.
    const heights = [300, 450, 260, 380, 500, 120]
    for (const index of breakIndexes(heights, PAGE)) {
      const filled = remainingOnPage(heights, index, PAGE)
      expect(filled).toBeGreaterThanOrEqual(0)
      expect(filled).toBeLessThan(PAGE)
    }
  })

  it('never returns a negative height', () => {
    expect(remainingOnPage([2500], 0, PAGE)).toBeGreaterThanOrEqual(0)
  })
})

describe('pageUnits (2026-10-18)', () => {
  // jsdom lays nothing out, so each element is given the numbers a browser
  // would report. A list of three 20px bullets at the top of the editor,
  // after a 30px paragraph, with a 6px gap below the list.
  const box = (el: HTMLElement, offsetTop: number, offsetHeight: number, offsetParent: Element | null) => {
    Object.defineProperty(el, 'offsetTop', { value: offsetTop })
    Object.defineProperty(el, 'offsetHeight', { value: offsetHeight })
    Object.defineProperty(el, 'offsetParent', { value: offsetParent })
  }
  const build = (spacerAfterFirst = 0) => {
    const dom = document.createElement('div')
    document.body.append(dom)
    const p = document.createElement('p')
    const ul = document.createElement('ul')
    ul.style.marginBottom = '6px'
    ul.style.paddingLeft = '24px'
    dom.append(p, ul)
    box(p, 0, 30, dom)
    const items = [0, 1, 2].map(() => document.createElement('li'))
    items.forEach((li, i) => {
      if (i === 1 && spacerAfterFirst) {
        const spacer = document.createElement('div')
        spacer.setAttribute('data-page-spacer', '')
        box(spacer, 50, spacerAfterFirst, dom)
        ul.append(spacer)
      }
      ul.append(li)
      box(li, 30 + i * 20 + (i >= 1 ? spacerAfterFirst : 0), 20, dom)
    })
    box(ul, 30, 60 + spacerAfterFirst, dom)
    return { dom, p, items }
  }

  it('breaks a list into its items, which add up to the list', () => {
    const { dom, p, items } = build()
    const units = pageUnits(dom)
    expect(units.map((u) => u.el)).toEqual([p, ...items])
    expect(units.map((u) => u.height)).toEqual([30, 20, 20, 26])
    expect(units[1].inset).toBe(24)
    dom.remove()
  })

  it('gives the same heights with a page spacer drawn inside the list', () => {
    // Otherwise the spacer's own height feeds back into the next pass and the
    // break never settles.
    const { dom } = build(400)
    expect(pageUnits(dom).map((u) => u.height)).toEqual([30, 20, 20, 26])
    dom.remove()
  })
})
