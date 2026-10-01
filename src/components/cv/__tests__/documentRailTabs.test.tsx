import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DocumentRailTabs } from '../DocumentRail'
import { RailLayoutProvider } from '../railLayout'

/**
 * The strip draws two ways and the chrome picks (Gabe, 2026-09-13: horizontal
 * "must be applied to smaller laptop screens", then "restore the vertical tabs
 * in larger screens").
 *
 * WHAT IS WORTH ASSERTING is the part a reader cannot see from the classes:
 * which arrangement each context produces, and that the hint -- the reason a
 * pane is empty -- survives both, since it moves from per-row to a single line
 * when the rows lose the height for one.
 */
function renderTabs(layout?: 'row' | 'column') {
  const tabs = (
    <DocumentRailTabs active="tailor" onSelect={() => {}} applicationSelected={false} />
  )
  return render(layout ? <RailLayoutProvider layout={layout}>{tabs}</RailLayoutProvider> : tabs)
}

describe('the document rail tabs', () => {
  it('is a vertical list with no provider, which is what a rail with room gets', () => {
    renderTabs()
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical')
  })

  it('is a vertical list in its own column', () => {
    renderTabs('column')
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical')
    // Every row carries its own hint, which is what costs the height.
    expect(screen.getByText('agreement, tense, phrasing and style')).toBeInTheDocument()
    expect(screen.getByText('needs an application')).toBeInTheDocument()
  })

  it('is one row when it shares a column with the pane it opens', () => {
    renderTabs('row')
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'horizontal')
    // The hint collapses to one line for the SELECTED tab -- so the inactive
    // tab's hint is gone and the active tab's survives.
    expect(screen.queryByText('agreement, tense, phrasing and style')).toBeNull()
    expect(screen.getByText('needs an application')).toBeInTheDocument()
  })

  it('marks the same tab selected either way', () => {
    const column = renderTabs('column')
    expect(screen.getByRole('tab', { name: /tailor to a job/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    column.unmount()
    renderTabs('row')
    expect(screen.getByRole('tab', { name: /tailor to a job/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })
})

/**
 * Gabe, 2026-10-01: "Fix the responsiveness of ... tab navigation in laptop
 * screens." Below 1700 the strip is a row in a 320px column, and two tabs of
 * icon + label + count needed 278px of a 268px strip: the second ran past the
 * column. jsdom has no layout, so what is pinned is the mechanism -- the
 * strip is a size container, the icons are the part it drops when narrow,
 * and a tab may shrink below its content instead of overflowing.
 */
describe('the row on a laptop', () => {
  it('lets each tab take its share rather than its content width', () => {
    render(
      <RailLayoutProvider layout="row">
        <DocumentRailTabs kind="cover_letter" active="tailor" onSelect={() => {}} badges={{ tailor: 2 }} />
      </RailLayoutProvider>
    )
    expect(screen.getByRole('tablist').className).toContain('@container/tabs')
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('min-w-0')
      const icon = tab.querySelector('span[aria-hidden]')!
      expect(icon.className).toContain('hidden')
      expect(icon.className).toContain('@[20rem]/tabs:inline-flex')
    }
  })

  it('keeps the icons in the vertical list, where there is room for them', () => {
    render(
      <RailLayoutProvider layout="column">
        <DocumentRailTabs kind="cover_letter" active="tailor" onSelect={() => {}} />
      </RailLayoutProvider>
    )
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.querySelector('span[aria-hidden]')!.className).not.toContain('hidden')
    }
  })
})
