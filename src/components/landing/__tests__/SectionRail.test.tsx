import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SectionRail } from '../SectionRail'

const SECTIONS = [
  { id: 'hero', label: 'top' },
  { id: 'social-proof', label: 'proof' },
  { id: 'faq', label: 'faq' },
]

const rail = () => document.querySelector('[data-section-rail]') as HTMLElement

describe('SectionRail', () => {
  it('offers a jump link per section, in order', () => {
    render(<SectionRail sections={SECTIONS} activeId="hero" progress={0} />)
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '#hero',
      '#social-proof',
      '#faq',
    ])
  })

  it('marks only the active section, and marks it for assistive tech too', () => {
    // aria-current, not just a colour: the rail is navigation, and "which one
    // am I on" has to survive not being able to see the accent.
    render(<SectionRail sections={SECTIONS} activeId="social-proof" progress={0.5} />)
    const active = document.querySelectorAll('[data-active="true"]')
    expect(active).toHaveLength(1)
    expect(active[0].getAttribute('data-rail-item')).toBe('social-proof')
    expect(active[0]).toHaveAttribute('aria-current', 'true')
  })

  it('fills the track in proportion to progress', () => {
    const { rerender } = render(
      <SectionRail sections={SECTIONS} activeId="hero" progress={0} />
    )
    const fill = () => rail().querySelector('[data-rail-fill]') as HTMLElement
    expect(fill().style.height).toBe('0%')

    rerender(<SectionRail sections={SECTIONS} activeId="faq" progress={0.42} />)
    expect(fill().style.height).toBe('42%')

    rerender(<SectionRail sections={SECTIONS} activeId="faq" progress={1} />)
    expect(fill().style.height).toBe('100%')
  })

  it('renders with no active section rather than throwing', () => {
    // activeId is null before the first measurement. A rail that crashes there
    // takes the whole page with it.
    render(<SectionRail sections={SECTIONS} activeId={null} progress={0} />)
    expect(document.querySelectorAll('[data-active="true"]')).toHaveLength(0)
    // Positive companion: the rail is still there, just with nothing marked.
    expect(screen.getAllByRole('link')).toHaveLength(3)
  })

  it('renders nothing when there are no sections', () => {
    const { container } = render(<SectionRail sections={[]} activeId={null} progress={0} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('inverts over the hero, which is dark in both themes', () => {
    // Without this the rail is a near-black line on near-black footage for the
    // whole first screen -- the same problem the navbar's two treatments solve.
    render(<SectionRail sections={SECTIONS} activeId="hero" progress={0} overHero />)
    expect(rail()).toHaveAttribute('data-over-hero', 'true')
    expect((rail().querySelector('[data-rail-fill]') as HTMLElement).className).toContain(
      'bg-white'
    )
  })

  it('carries no plate anywhere, over the hero least of all', () => {
    // REVERSED ON 2026-09-17 (Gabe: "Remove the background color and
    // backdrop-blur of the scroll right rail in hero section only"), and this
    // test is kept rather than deleted because it used to assert the opposite
    // and the reason it did is still true: the rail sits at the right edge,
    // where the hero's left-to-right scrim has decayed to 0.3 alpha and the
    // footage is brightest, so light marks there can drift as the clip plays.
    //
    // What answers that now is the weight of the marks and the `ink-950` tint
    // on the footage -- not a panel across the picture. If it ever flickers,
    // the fix belongs in the dots, and this assertion says so.
    render(<SectionRail sections={SECTIONS} activeId="hero" progress={0} overHero />)
    expect(rail().className).not.toContain('backdrop-blur')
    expect(rail().className).not.toContain('bg-ink-950')
  })

  it('carries none past the hero either, where the page provides its own ground', () => {
    render(<SectionRail sections={SECTIONS} activeId="faq" progress={0.8} />)
    expect(rail().className).not.toContain('backdrop-blur')
  })

  it('takes the themed treatment past the hero', () => {
    render(<SectionRail sections={SECTIONS} activeId="faq" progress={0.8} />)
    expect(rail()).toHaveAttribute('data-over-hero', 'false')
    expect((rail().querySelector('[data-rail-fill]') as HTMLElement).className).toContain(
      'bg-accent-default'
    )
  })

  it('draws its inactive dots in a foreground colour, not a border colour', () => {
    // Shipped invisible once: border tokens are sized for 1px hairlines
    // against a surface, and #d4d4d8 as a 7px dot on a white section cannot be
    // seen. A dot is foreground and takes a foreground token.
    render(<SectionRail sections={SECTIONS} activeId="hero" progress={0} />)
    const inactive = document.querySelector('[data-rail-item="faq"] span') as HTMLElement
    expect(inactive.className).toContain('bg-text-muted')
    expect(inactive.className).not.toContain('bg-border-default')
  })

  // 1640, not lg and no longer 2xl. The rail lives in the margin the page's
  // container leaves, so its threshold is arithmetic on that container's
  // width: `1440 + 2 * (24 + 35)` clears at 1558, and 1640 buys ~41px of
  // daylight so it does not arrive touching the text. It was `2xl` (1440)
  // while the container was 1200; the container went to 1440 on 2026-09-15 and
  // this moved with it. Both halves of the pair move together; see
  // SectionRail's docblock for the working.
  it('is hidden until the container leaves a margin to live in', () => {
    render(<SectionRail sections={SECTIONS} activeId="hero" progress={0} />)
    expect(rail().className).toContain('hidden')
    expect(rail().className).toContain('min-[1640px]:block')
  })

  /**
   * The rail is visible from 1640 and its LABELS from 1800, and the gap between
   * those two numbers is not slack -- it is the band where a labelled rail
   * provably does not fit.
   *
   * The box is a constant 121px (the flex column is as wide as its widest
   * label), `right-6` puts its left edge at `100vw - 145`, and the container's
   * right edge is at `(100vw + 1440) / 2`. They only clear from 1730px. So
   * between 1640 and 1730 a revealed label would sit on the paragraph beside
   * it, which is exactly what was reported at the old numbers.
   *
   * jsdom has no layout, so this cannot measure the 121px. What it CAN hold
   * still is the thing that would actually regress: the label being clipped
   * below the threshold, and the two classes that implement it agreeing on one
   * number. A future editor who reveals the label at the rail's own threshold
   * to "match the rail" fails here rather than in a browser at 1660px.
   */
  it('clips its labels until there is margin to reveal them into', () => {
    render(<SectionRail sections={SECTIONS} activeId="hero" progress={0} />)
    const label = rail().querySelector('[data-rail-item] > span:last-child') as HTMLElement

    // Zero width and clipped, so the label adds nothing to the rail's box.
    expect(label.className).toContain('max-w-0')
    expect(label.className).toContain('overflow-hidden')
    // Clipped, NOT removed: `display: none` would take the section names away
    // from a screen reader on precisely the widths where the dots are all a
    // sighted reader gets.
    // Split on whitespace rather than a substring check: `overflow-hidden`
    // contains "hidden", so `not.toContain('hidden')` fails against the very
    // class that implements the clipping.
    expect(label.className.split(' ')).not.toContain('hidden')
    expect(label.className).toContain('min-[1800px]:max-w-none')

    // The gap is gated on the same number -- 12px after a zero-width label is
    // 12px of nothing inside a 35px rail.
    const link = rail().querySelector('[data-rail-item]') as HTMLElement
    expect(link.className).toContain('gap-0')
    expect(link.className).toContain('min-[1800px]:gap-3')

    // The label threshold must be WIDER than the rail's own, never equal to
    // it: at 1640 the rail fits and the label does not.
    expect(rail().className).toContain('min-[1640px]:block')
    expect(rail().className).not.toContain('min-[1800px]:block')
  })
})

describe('SectionRail clicking', () => {
  const scrollTo = vi.fn()

  beforeEach(() => {
    scrollTo.mockClear()
    vi.stubGlobal('scrollTo', scrollTo)
    // The sections the rail scrolls to. Without them in the document the
    // handler correctly declines and falls through to the native anchor,
    // which is what the last test here asserts.
    document.body.insertAdjacentHTML(
      'beforeend',
      SECTIONS.map((s) => `<section data-landing-section="${s.id}"></section>`).join('')
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.querySelectorAll('[data-landing-section]').forEach((n) => n.remove())
  })

  it('scrolls to the section a dot names, instead of doing nothing', () => {
    // The reported bug: the dots were anchors pointing at ids nothing carried,
    // so clicking one silently did nothing.
    render(<SectionRail sections={SECTIONS} activeId="hero" progress={0} />)
    const event = fireEvent.click(screen.getByRole('link', { name: /proof/ }))
    expect(scrollTo).toHaveBeenCalledOnce()
    expect(scrollTo.mock.calls[0][0].behavior).toBe('smooth')
    expect(event).toBe(false) // preventDefault was called
  })

  it('leaves modified clicks to the browser', () => {
    // cmd/ctrl-click opens a new tab and shift-click a window. Swallowing
    // those would make a link that is not a link.
    render(<SectionRail sections={SECTIONS} activeId="hero" progress={0} />)
    fireEvent.click(screen.getByRole('link', { name: /proof/ }), { metaKey: true })
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('falls through to the anchor when the section is missing', () => {
    // Only preventDefault on a hit, so a rail configured with a section that
    // is not on this page degrades to the browser's own handling rather than
    // becoming a dead control.
    document.querySelectorAll('[data-landing-section]').forEach((n) => n.remove())
    render(<SectionRail sections={SECTIONS} activeId="hero" progress={0} />)
    const event = fireEvent.click(screen.getByRole('link', { name: /proof/ }))
    expect(scrollTo).not.toHaveBeenCalled()
    expect(event).toBe(true) // default not prevented
  })

  it('gives the 7px dot a click target worth aiming at', () => {
    // Half of the report was "should be clickable". A 7px dot is a 7px
    // target; the padding grows the row and the negative margin cancels it,
    // so the dot spacing the fill percentage is measured against is unchanged.
    render(<SectionRail sections={SECTIONS} activeId="hero" progress={0} />)
    const cls = screen.getAllByRole('link')[0].className
    expect(cls).toContain('py-2')
    expect(cls).toContain('-my-2')
  })
})
