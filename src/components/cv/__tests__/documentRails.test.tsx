import * as React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DesktopDocumentChrome } from '../DesktopDocumentChrome'

/**
 * The rail drawer (Gabe, 2026-09-13: "left drawer should open both left and
 * right rail; remove the collapsed version of right rail").
 *
 * WHAT IS WORTH ASSERTING HERE is not that a class changed -- it is the three
 * things a person loses if this is done the obvious way: the page paying for a
 * track that holds a rail nobody can see, a half-reviewed rewrite thrown away
 * because a layout toggle unmounted the pane holding it, and a rail that folds
 * away with no handle left to bring it back.
 */

/**
 * jsdom has no layout, so `getBoundingClientRect` reports 0 for everything and
 * the component keeps its open-by-default state. These tests that care about
 * the MEASURED default stub a width onto the prototype; the rest leave it
 * alone and get the default, which is what a wide screen sees.
 */
const realRect = HTMLElement.prototype.getBoundingClientRect
function stubWorkspaceWidth(width: number) {
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { ...realRect.call(this), width } as DOMRect
  }
}
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect
})

/** A rail that remembers something, so "hidden, not unmounted" can be proved. */
function StatefulRail({ label }: { label: string }) {
  const [count, setCount] = React.useState(0)
  return (
    <button type="button" onClick={() => setCount((c) => c + 1)}>
      {label} {count}
    </button>
  )
}

function renderChrome(props: Partial<React.ComponentProps<typeof DesktopDocumentChrome>> = {}) {
  return render(
    <DesktopDocumentChrome
      kindLabel="word"
      documentsHref="/documents"
      title="My CV"
      onTitleChange={() => {}}
      savedLabel="saved 7:43 am"
      actions={<button type="button">save</button>}
      tools={<button type="button">bold</button>}
      railNav={<button type="button">pick a pane</button>}
      leftRail={<StatefulRail label="outline" />}
      rightRail={<StatefulRail label="analysis" />}
      {...props}
    >
      <p>the document</p>
    </DesktopDocumentChrome>
  )
}

/** The grid is the sheet's parent; no test-only attribute needed to find it. */
const railGrid = () => document.getElementById('document-sheet')!.parentElement!
const collapse = () => screen.getByRole('button', { name: 'Collapse document panels' })
const expand = () => screen.getByRole('button', { name: 'Expand document panels' })

describe('the desktop rails', () => {
  it('starts both rails open where nothing could be measured', () => {
    // Desktop-first, like useBelowDesktop: an unmeasured workspace keeps the
    // wide arrangement rather than inventing a narrow one.
    renderChrome()
    expect(collapse()).toHaveAttribute('aria-expanded', 'true')
    expect(railGrid().className).toContain('lg:grid-cols-[380px_minmax(0,1fr)_500px]')
  })

  it('starts both rails open on a laptop too, not only on a wide screen', () => {
    // Gabe, 2026-09-17: open the left and right rails by default. `railsOpen`
    // has read `true` since the drawer was written, and it was NOT the real
    // default: the measurement effect overwrote it once, on mount, with
    // `width >= 1700` -- so every laptop narrower than that opened shut and
    // the initialiser described a screen almost nobody has.
    //
    // 1024 IS THE POINT OF THIS TEST rather than a round number. It is the
    // narrowest width this chrome renders at at all (`useBelowDesktop` hands
    // anything below `lg` to the compact chrome), so if the old measured
    // default survived anywhere it survives here.
    stubWorkspaceWidth(1024)
    const narrow = renderChrome()
    expect(collapse()).toHaveAttribute('aria-expanded', 'true')
    // Open, in the TWO-column arrangement -- which is why the arithmetic that
    // justified shutting them no longer applies: both panels share one 320px
    // rail, so a 1440 laptop keeps 1120 for the page rather than 720.
    expect(railGrid().className).toContain('lg:grid-cols-[320px_minmax(0,1fr)]')
    narrow.unmount()

    stubWorkspaceWidth(1700)
    renderChrome()
    expect(collapse()).toHaveAttribute('aria-expanded', 'true')
    expect(railGrid().className).toContain('lg:grid-cols-[380px_minmax(0,1fr)_500px]')
  })

  it('folds both rails from the one handle, and gives the right rail no edge', async () => {
    // ONE DRAWER, NOT TWO SIDEBARS (Gabe, 2026-09-13: "left drawer should open
    // both left and right rail. Remove the collapsed version of right rail").
    // Two booleans made four states, and the two mixed ones were never chosen
    // deliberately -- they were what you landed in on the way to the other two.
    const user = userEvent.setup()
    renderChrome()
    await user.click(collapse())

    // 44px for the drawer's own edge and nothing for the right rail: two
    // strips cost 88px and offered a choice that no longer exists.
    expect(railGrid().className).toContain('lg:grid-cols-[44px_minmax(0,1fr)]')
    expect(screen.queryByRole('button', { name: /tailoring/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /document tools/ })).toBeNull()

    await user.click(expand())
    expect(railGrid().className).toContain('lg:grid-cols-[380px_minmax(0,1fr)_500px]')
  })

  it('shows a large arrowhead on the shut drawer, not a panel glyph', async () => {
    // Gabe, 2026-09-13: "collapsed rail must show a large arrowhead (this
    // provides an immersive experience to simulate a left drawer behavior)".
    // A rail's own glyph named WHAT would open, which is the right answer only
    // while each rail opened separately. With one drawer there is nothing to
    // choose, so the edge says "pull" -- at 28px against the 18px it replaced.
    const user = userEvent.setup()
    renderChrome()
    await user.click(collapse())
    expect(expand().querySelector('svg')).toHaveAttribute('width', '28')
  })

  it('hides a closed rail instead of unmounting it, keeping its state', async () => {
    // The reason the rule exists: the tailoring pane holds per-section edit
    // state and an in-flight request. A layout toggle must not spend them.
    const user = userEvent.setup()
    renderChrome()
    await user.click(screen.getByRole('button', { name: /analysis 0/ }))
    await user.click(collapse())

    const rail = document.getElementById('document-right-rail')!
    // `hidden` is `display:none`, which is what takes the subtree out of the
    // accessibility tree as well as off the screen -- asserted as the class
    // rather than by querying roles, because jsdom loads no stylesheet and so
    // computes no display for a Tailwind utility. The state below is the half
    // this test exists for anyway.
    expect(rail.className).toContain('hidden')
    // Still mounted, still counting.
    expect(rail.textContent).toContain('analysis 1')

    await user.click(expand())
    expect(screen.getByRole('button', { name: 'analysis 1' })).toBeInTheDocument()
  })

  it('gives the left-rail-only editor one toggle and a two-column frame', () => {
    // The LaTeX editor passes no right rail: source beside preview lives
    // inside the content column instead.
    renderChrome({ rightRail: undefined })
    expect(collapse()).toBeInTheDocument()
    // Two columns, not three-with-a-strip: there is no right rail to fold.
    expect(railGrid().className).toContain('lg:grid-cols-[380px_minmax(0,1fr)]')
  })

  it('never folds a right rail that has no left rail to open it', () => {
    // The handle lives on the left edge, so a workspace with no left rail has
    // none -- and a rail you cannot reopen is worse than one that never folds.
    // No editor ships this shape; the guard is here so none can.
    stubWorkspaceWidth(1024)
    renderChrome({ leftRail: undefined })
    expect(screen.queryByRole('button', { name: /document panels/ })).toBeNull()
    expect(railGrid().className).toContain('lg:grid-cols-[minmax(0,1fr)_400px]')
    expect(screen.getByRole('button', { name: 'analysis 0' })).toBeInTheDocument()
  })

  it('points the drawer at the rail it is attached to', () => {
    renderChrome()
    expect(collapse()).toHaveAttribute('aria-controls', 'document-left-rail')
    expect(document.getElementById('document-left-rail')).not.toBeNull()
    expect(document.getElementById('document-right-rail')).not.toBeNull()
  })

  it('lets a resize correct an unmeasured first paint, without reopening a shut drawer', async () => {
    // A hidden pane or a background tab lays nothing out, so the direct
    // measurement reads 0 and an observer has to carry the answer later. Zero
    // must not itself be read as "narrow".
    //
    // WHAT THE OBSERVER MAY DECIDE IS THE ARRANGEMENT, NEVER THE INTENT. It
    // used to set the open/shut default too, behind a `defaulted` ref that
    // fired it once; that default is gone (2026-09-17) and the ref with it, so
    // the invariant is now the stronger one: a drawer somebody shut stays shut
    // through any number of resizes.
    const user = userEvent.setup()
    let deliver: (() => void) | undefined
    const observe = vi.fn()
    const disconnect = vi.fn()
    class Observer {
      constructor(cb: () => void) {
        deliver = cb
      }
      observe = observe
      unobserve = vi.fn()
      disconnect = disconnect
    }
    const real = globalThis.ResizeObserver
    globalThis.ResizeObserver = Observer as unknown as typeof ResizeObserver
    try {
      renderChrome()
      // 0 was not taken as narrow: the wide, three-column arrangement stands.
      expect(collapse()).toBeInTheDocument()
      expect(railGrid().className).toContain('lg:grid-cols-[380px_minmax(0,1fr)_500px]')
      expect(observe).toHaveBeenCalled()

      // The late measurement moves the LAYOUT and leaves the rails open.
      stubWorkspaceWidth(1100)
      React.act(() => deliver!())
      expect(collapse()).toBeInTheDocument()
      expect(railGrid().className).toContain('lg:grid-cols-[320px_minmax(0,1fr)]')
    } finally {
      globalThis.ResizeObserver = real
    }

    // And a shut drawer is never reopened under somebody: `wide` goes on
    // tracking the window, the open/shut state does not.
    await user.click(collapse())
    stubWorkspaceWidth(1700)
    React.act(() => deliver!())
    expect(expand()).toBeInTheDocument()
  })

  it('gives a smaller laptop two columns, with both panels in one rail', () => {
    // Gabe, 2026-09-13, after watching 880px of rails squeeze the document to
    // 220 and the page honestly shrink to fit: "how about no left and right
    // rails? implement two column layout in smaller laptop screens."
    //
    // The left rail is a TAB LIST and the right rail is the pane those tabs
    // select, so one column is the arrangement they already have in the
    // compact dock -- not a compromise.
    stubWorkspaceWidth(1024)
    renderChrome()

    expect(railGrid().className).toContain('lg:grid-cols-[320px_minmax(0,1fr)]')
    // One rail, carrying both.
    expect(document.getElementById('document-right-rail')).toBeNull()
    const rail = document.getElementById('document-left-rail')!
    expect(rail.textContent).toContain('outline')
    expect(rail.textContent).toContain('analysis')
    expect(screen.getByRole('heading', { name: 'document tools & tailoring' })).toBeInTheDocument()
  })

  it('keeps the strip next to the pane it selects, in both arrangements', () => {
    // Gabe, 2026-09-13: "and render the clicked navigation". In one column the
    // strip used to sit above an outline and a statistics table with the pane
    // below both, so clicking a tab changed something two screens down -- which
    // reads as the click having done nothing.
    const order = (root: HTMLElement) =>
      [...root.querySelectorAll('button')].map(
        (b) => b.getAttribute('aria-label') ?? b.textContent!.trim()
      )

    stubWorkspaceWidth(1024)
    const narrow = renderChrome()
    // strip, then what it selects, then the reference material.
    expect(order(document.getElementById('document-left-rail')!)).toEqual([
      'Collapse document panels',
      'pick a pane',
      'analysis 0',
      'outline 0',
    ])
    narrow.unmount()

    stubWorkspaceWidth(1700)
    renderChrome()
    // Split again, the strip still leads its own column.
    expect(order(document.getElementById('document-left-rail')!)).toEqual([
      'Collapse document panels',
      'pick a pane',
      'outline 0',
    ])
    expect(order(document.getElementById('document-right-rail')!)).toEqual(['analysis 0'])
  })

  it('separates them again where there is room for three columns', () => {
    // Above 1700 the split is the arrangement that wants the width: what you
    // are tailoring TO on the left, how well you match it on the right.
    stubWorkspaceWidth(1700)
    renderChrome()
    expect(railGrid().className).toContain('lg:grid-cols-[380px_minmax(0,1fr)_500px]')
    expect(document.getElementById('document-right-rail')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'document tools' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'tailoring' })).toBeInTheDocument()
  })

  it('names each rail, so a panel is not an unlabelled column of controls', async () => {
    // Gabe, 2026-09-13: "add title to left and right rail". A column label
    // rather than a heading -- the panels inside carry `heading-s` titles of
    // their own, and a larger one above would out-rank what it introduces.
    const user = userEvent.setup()
    renderChrome()
    expect(screen.getByRole('heading', { name: 'document tools' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'tailoring' })).toBeInTheDocument()

    // The titles go with the panels: shut, the drawer's handle stands in.
    await user.click(collapse())
    expect(screen.queryByRole('heading', { name: 'tailoring' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'document tools' })).toBeNull()
    expect(expand()).toBeInTheDocument()
  })
})
