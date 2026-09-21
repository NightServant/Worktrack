import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DocumentWorkspace } from '../DocumentWorkspace'

vi.mock('next/navigation', () => ({ usePathname: vi.fn(() => '/cv') }))

function setViewport(belowDesktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: belowDesktop && query.includes('max-width'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

const original = window.matchMedia
afterEach(() => {
  window.matchMedia = original
})

const renderWorkspace = () =>
  render(
    <DocumentWorkspace
      kindLabel="word"
      documentsHref="/documents"
      title="My CV"
      onTitleChange={() => {}}
      savedLabel="saved 7:43 am"
      actions={<button type="button">save</button>}
      destructiveActions={<button type="button">delete</button>}
      tools={<button type="button">bold</button>}
      leftRail={<p>pick a posting</p>}
      rightRail={<p>match analysis</p>}
    >
      <p>the document</p>
    </DocumentWorkspace>
  )

/**
 * The compact editor chrome (Gabe, 2026-09-06), modelled on Word for Android.
 *
 * THE INVARIANT WORTH PROTECTING is not the visual arrangement -- it is that
 * NOTHING WAS DROPPED on the way to a phone. Every desktop capability has to
 * remain reachable, and the two that matter most are the ones Gabe named:
 * AI tailoring and the CV check. A mobile layout that quietly loses features
 * is the standard failure of this pattern, so each is asserted by name.
 */
describe('the editor below lg', () => {
  beforeEach(() => setViewport(true))

  it('takes the whole viewport, with the name centred as Word puts it', () => {
    const { container } = renderWorkspace()
    const shell = container.querySelector('[data-document-workspace]')!
    expect(shell.hasAttribute('data-compact')).toBe(true)
    expect(shell.className).toContain('fixed')
    expect(shell.className).toContain('inset-0')
    // Still the h1, still typed into in place -- the document names the screen.
    expect(screen.getByLabelText('Document title')).toHaveValue('My CV')
  })

  it('keeps a way out, the save state, and the formatting controls', async () => {
    // THE FORMATTING BAR IS NO LONGER PINNED (2026-09-13). It was 52px of
    // ribbon under every document whether or not anybody was formatting, and
    // it is now the `format` tab of the dock. The assertion that matters is
    // unchanged -- the controls are still here, one tap away -- so this test
    // takes the tap rather than being deleted.
    const user = userEvent.setup()
    renderWorkspace()
    expect(screen.getByRole('link', { name: 'Done' })).toHaveAttribute('href', '/documents')
    expect(screen.getByText('saved 7:43 am')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'format' }))
    expect(screen.getByRole('button', { name: 'bold' })).toBeInTheDocument()
  })

  it('reaches AI tailoring and the CV check from the dock', async () => {
    // Gabe's requirement, and the one most easily lost. It used to be a glyph
    // in the command row that opened a bottom sheet; it is now a named tab in
    // the dock, which is a better answer to the same requirement -- burying
    // the app's one piece of real intelligence under a `...` is how a feature
    // stops existing, and a word beats a chart icon at saying it is there.
    //
    // THE SHEET IS GONE, SO THE CONTROL THAT OPENED IT IS TOO. Asserted, so
    // nobody restores a second route to the same surface by accident.
    const user = userEvent.setup()
    renderWorkspace()
    expect(screen.queryByRole('button', { name: /tailoring and cv check/i })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'outline' }))
    expect(screen.getByText('pick a posting')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'tailor' }))
    expect(screen.getByText('match analysis')).toBeInTheDocument()
  })

  it('keeps every other desktop action, in the overflow sheet', async () => {
    const user = userEvent.setup()
    renderWorkspace()
    // Not on the bar to begin with -- that is what makes it an overflow.
    expect(screen.queryByRole('button', { name: 'save' })).toBeNull()
    await user.click(screen.getByRole('button', { name: /more actions/i }))
    expect(screen.getByRole('button', { name: 'save' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'delete' })).toBeInTheDocument()
  })

  it('lays the action sheet out as one column on a phone and two row shapes from sm', async () => {
    // Gabe, 2026-09-06, over three passes. The first cut was one tall column
    // (~400px of sheet over a document the reader was mid-edit in); the second
    // was two columns everywhere, which at 390px left each action ~175px --
    // cramped for `export .docx` and two thumb targets side by side; the third
    // put save alone on its own row with a hole beside it.
    //
    // EIGHT TRACKS, not three, because the sheet holds two row shapes: the
    // caller's peers at two tracks each, then save and delete at four each.
    // Three tracks cannot express halves. It was six until 2026-09-17, when
    // `.tex` made the compact editor's first row four cells rather than three
    // and the fourth wrapped onto save's row.
    const user = userEvent.setup()
    const { container } = renderWorkspace()
    await user.click(screen.getByRole('button', { name: /more actions/i }))
    const grid = container.ownerDocument.querySelector('[data-slot="sheet-content"] .grid')!
    expect(grid.className).toContain('grid-cols-1')
    expect(grid.className).toContain('sm:grid-cols-8')
    expect(grid.className).toContain('sm:[&>button]:col-span-2')
    // Save is the caller's last <button>; delete is nested in its own div and
    // is deliberately not one of them.
    expect(grid.className).toContain('sm:[&>button:last-of-type]:col-span-4')
  })

  it('keeps the destructive rule on a phone and drops it where the row is shared', async () => {
    // A real trade, recorded rather than smoothed over: desktop separates
    // delete from save with a rule because a destructive action does not
    // belong beside a save. Gabe asked for the two to share a row here, and a
    // rule between two cells of one row would have to break the row to draw.
    // Stacked on a phone it costs nothing, so it stays there.
    const user = userEvent.setup()
    const { container } = renderWorkspace()
    await user.click(screen.getByRole('button', { name: /more actions/i }))
    const sep = container.ownerDocument.querySelector('[data-slot="sheet-content"] [data-slot="separator"]')
    expect(sep, 'the phone rule is gone entirely').not.toBeNull()
    expect(sep!.className).toContain('sm:hidden')
  })

  it('gives every action a boundary and a 44px floor', async () => {
    // The caller ranks these for a DESKTOP BAR, where mostly-ghost buttons on
    // one line are correct. Stacked in a sheet, `reset` and `export .docx` had
    // no boundary at all and read as captions rather than controls.
    const user = userEvent.setup()
    const { container } = renderWorkspace()
    await user.click(screen.getByRole('button', { name: /more actions/i }))
    const grid = container.ownerDocument.querySelector('[data-slot="sheet-content"] .grid')!
    expect(grid.className).toContain('[&_button]:min-h-11')
    expect(grid.className).toContain('[&_button]:border')
    // Background is deliberately NOT set: this selector outranks a utility
    // class and would repaint Save's accent fill, flattening the ranking.
    expect(grid.className).not.toMatch(/\[&_button\]:bg-/)
  })

  it('renders one tree, not two', async () => {
    // The reason the breakpoint is JS and not a `lg:` class. Two trees would
    // put two of every control in the accessibility tree; a screen reader
    // would read the whole toolbar twice.
    const user = userEvent.setup()
    renderWorkspace()
    expect(screen.getAllByLabelText('Document title')).toHaveLength(1)
    await user.click(screen.getByRole('tab', { name: 'format' }))
    expect(screen.getAllByRole('button', { name: 'bold' })).toHaveLength(1)
  })
})

describe('the editor at desktop', () => {
  beforeEach(() => setViewport(false))

  it('is unchanged: breadcrumb, both rails, no compact chrome', () => {
    const { container } = renderWorkspace()
    const shell = container.querySelector('[data-document-workspace]')!
    expect(shell.hasAttribute('data-compact')).toBe(false)
    expect(screen.getByText('pick a posting')).toBeInTheDocument()
    expect(screen.getByText('match analysis')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull()
  })
})
