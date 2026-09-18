import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeroMedia } from '../HeroMedia'

const reduced = vi.hoisted(() => ({ value: false }))
vi.mock('@/hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => reduced.value,
}))

const size = vi.hoisted(() => ({ widthPx: 1440, heightPx: 900 }))
vi.mock('../useViewportSize', () => ({ useViewportSize: () => size }))

beforeEach(() => {
  reduced.value = false
  size.widthPx = 1440
})

describe('HeroMedia on a desktop viewport', () => {
  it('plays the video when one is supplied', () => {
    render(<HeroMedia posterSrc="/hero-poster.jpg" videoSrc="/hero.mp4" />)
    expect(screen.getByTestId('hero-video')).toBeInTheDocument()
    expect(screen.queryByTestId('hero-poster')).toBeNull()
  })

  it('falls back to the poster when there is no video', () => {
    // The state the page shipped in before a clip existed. Still supported:
    // dropping the src is how you turn the video off.
    render(<HeroMedia posterSrc="/hero-poster.jpg" />)
    expect(screen.getByTestId('hero-poster')).toBeInTheDocument()
    expect(screen.queryByTestId('hero-video')).toBeNull()
  })
})

describe('HeroMedia below the md breakpoint', () => {
  it('does not render the video element at all', () => {
    // Not a layout choice, a WEIGHT one: the clip is 6.8 MB and the poster is
    // 65 KB. A <video> with a poster attribute still fetches its source, so
    // the element has to be absent rather than merely hidden.
    size.widthPx = 375
    render(<HeroMedia posterSrc="/hero-poster.jpg" videoSrc="/hero.mp4" />)
    expect(screen.queryByTestId('hero-video')).toBeNull()
    expect(screen.getByTestId('hero-poster')).toBeInTheDocument()
  })

  it('shows the poster before the viewport has been measured', () => {
    // widthPx is 0 on the first render. Defaulting to the video there would
    // start the 6.8 MB fetch on a phone before we know it is a phone.
    size.widthPx = 0
    render(<HeroMedia posterSrc="/hero-poster.jpg" videoSrc="/hero.mp4" />)
    expect(screen.getByTestId('hero-poster')).toBeInTheDocument()
  })
})

describe('HeroMedia under prefers-reduced-motion', () => {
  it('shows the poster instead of an autoplaying loop', () => {
    // An autoplaying background loop is precisely what the setting asks not to
    // happen, and it reads the shared hook rather than opening a second
    // matchMedia subscription.
    reduced.value = true
    render(<HeroMedia posterSrc="/hero-poster.jpg" videoSrc="/hero.mp4" />)
    expect(screen.queryByTestId('hero-video')).toBeNull()
    expect(screen.getByTestId('hero-poster')).toBeInTheDocument()
  })
})

describe('HeroMedia pausing', () => {
  it('pauses once the hero unpins and plays again when it returns', async () => {
    // jsdom implements neither play nor pause; stubbing them is what lets the
    // assertion be about our effect rather than about jsdom.
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve())
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})

    const { rerender } = render(
      <HeroMedia posterSrc="/hero-poster.jpg" videoSrc="/hero.mp4" paused={false} />
    )
    expect(play).toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()

    rerender(<HeroMedia posterSrc="/hero-poster.jpg" videoSrc="/hero.mp4" paused />)
    expect(pause).toHaveBeenCalledTimes(1)

    // And it comes back, rather than staying dead for the rest of the session.
    const before = play.mock.calls.length
    rerender(<HeroMedia posterSrc="/hero-poster.jpg" videoSrc="/hero.mp4" paused={false} />)
    expect(play.mock.calls.length).toBeGreaterThan(before)

    play.mockRestore()
    pause.mockRestore()
  })

  it('wears the UI\'s own dark rather than a neutral grey', () => {
    // Gabe, 2026-09-17: "Hero background video must have the same color of the
    // top navigation bar." `grayscale` takes the hue out and puts nothing back,
    // so the hero rendered colourless while LandingNavbar over it is
    // `bg-ink-950/30` -- two different darks, one of them neutral.
    //
    // BOTH HALVES ARE ASSERTED because they answer different failures.
    // Deleting the tint returns the neutral grey; deleting `grayscale` removes
    // the floor a browser without blend-mode support falls back to, and that
    // one fails INVISIBLY here -- jsdom composites nothing, so only the classes
    // can testify.
    const { container } = render(<HeroMedia posterSrc="/hero-poster.jpg" videoSrc="/hero.mp4" />)

    expect(screen.getByTestId('hero-video').className).toContain('grayscale')

    const tint = container.querySelector('.mix-blend-color')
    expect(tint, 'the footage is tinted to the UI dark').not.toBeNull()
    expect(tint!.className).toContain('bg-ink-950')
    // Isolated, so the blend cannot reach the token-coloured scrim below it.
    expect(tint!.parentElement!.className).toContain('isolate')
  })
})

/**
 * THE HERO IS DARK IN BOTH THEMES, so nothing inside it may be painted in a
 * token that flips with the theme.
 *
 * The rule is written in both docblocks and it has now been broken twice: the
 * bottom fade band was `to-bg-canvas`, which is `ink-950` in the dark theme
 * and WHITE in the light one -- a 96px haze across the foot of a near-black
 * hero -- and the call to action filled with `--color-accent-default`, which
 * is orange in the dark theme and brick in the light one, two lines under an
 * eyebrow that names `accent-400` outright.
 *
 * GATED ON SOURCE TEXT, like landingTypography: these are Tailwind classes and
 * jsdom loads no stylesheet, so a rendered `to-bg-canvas` and a rendered
 * `to-ink-950` compute to the same nothing. The class string is the artefact.
 */
describe('the hero paints in primitives, never in theme tokens', () => {
  const FLIPPING = /\b(?:bg|from|via|to|text|border)-(?:bg-canvas|bg-inset|text-primary|text-secondary|text-muted|border-subtle|border-default|accent-default)\b/

  it.each(['Hero.tsx', 'HeroMedia.tsx'])('%s', (file) => {
    const source = readFileSync(`src/components/landing/${file}`, 'utf8')
    // The section's own override is the exception that proves it: it REDEFINES
    // the token for this subtree rather than painting with it.
    const painted = source.replace(/\[--color-accent-default:[^\]]+\]/g, '')
    expect(painted).not.toMatch(FLIPPING)
  })

  it('pins the accent for the section, so the one button on it cannot flip', () => {
    // The button is a shared primitive and keeps meaning "the accent"; this is
    // the one section where which colour that is cannot follow the theme.
    expect(readFileSync('src/components/landing/Hero.tsx', 'utf8')).toContain(
      '[--color-accent-default:var(--color-accent-400)]'
    )
  })
})

