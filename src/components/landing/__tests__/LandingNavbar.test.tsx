import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LandingNavbar } from '../LandingNavbar'
import { NAV_LINKS } from '../content'

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }),
}))

function renderNav(overHero: boolean, scrolled = false) {
  const { container } = render(<LandingNavbar overHero={overHero} scrolled={scrolled} />)
  const bar = container.querySelector('[data-landing-nav]')
  expect(bar).not.toBeNull()
  return bar as HTMLElement
}

describe('LandingNavbar over the hero', () => {
  // The hero is dark in BOTH themes -- a background video under a scrim from
  // rgba(5,5,7,0.92) to rgba(5,5,7,0.3). A themed bar on it is illegible.
  it('blends into the hero: no background, no bottom border', () => {
    const bar = renderNav(true)
    expect(bar).toHaveAttribute('data-over-hero', 'true')
    expect(bar.className).not.toContain('bg-bg-canvas')
    expect(bar.className).not.toContain('border-b')
  })

  it('carries its own scrim, because the hero is bright on the right', () => {
    // Figma's navbar is opaque white, so its links never sat on video. Ours
    // do, and the controls are on the RIGHT of the bar, where the hero scrim
    // has decayed to 0.3 alpha. Without this the blend is legible only over
    // the dark left third -- which is where the headline is and the nav is not.
    const bar = renderNav(true)
    expect(bar.querySelector('[data-nav-scrim]')).not.toBeNull()
  })
})

describe('the brand lockup over the hero', () => {
  // Gabe, 2026-09-02: the Worktrack icon must render its dark-mode version in
  // the hero. The hero is dark in BOTH themes, so the light theme's
  // accent-700 (#c2410c) accent cell sits on near-black -- the same contrast
  // problem that made the frame's hero eyebrow accent-400.
  it('renders the mark in its dark-mode colours whatever the page theme is', () => {
    const bar = renderNav(true)
    const lockup = bar.querySelector('svg')?.parentElement
    expect(lockup).not.toBeNull()
    // The wordmark. `ink-50` now, not the raw `#fafafa` literal it replaced
    // (2026-09-09) -- see Hero.tsx's docblock on the warm ink-* primitive scale.
    expect(lockup!.className).toContain('text-ink-50')
    // And the three currentColor cells, which need their OWN override:
    // BrandMark declares text-text-primary on its <svg>, so the container's
    // colour never reaches them. Without this the mark is invisible against
    // the hero in the light theme and correct-by-accident in the dark one --
    // which is exactly how it shipped broken the first time.
    expect(lockup!.className).toContain('[&>svg]:text-ink-50')
    // The accent cell, which is fill="var(--color-accent-default)". The token
    // is redefined for the subtree rather than the component being forked.
    expect(lockup!.className).toContain('[--color-accent-default:var(--color-accent-400)]')
  })

  it('leaves the lockup on the theme tokens past the hero', () => {
    // Positive companion: proves the override is scoped to the blended
    // treatment and is not simply always on, which would break light mode.
    const bar = renderNav(false)
    const lockup = bar.querySelector('svg')?.parentElement
    expect(lockup!.className).not.toContain('text-ink-50')
    expect(lockup!.className).not.toContain('--color-accent-default')
  })
})

describe('LandingNavbar past the hero', () => {
  it('takes the themed treatment: canvas background and a hairline rule', () => {
    const bar = renderNav(false)
    expect(bar).toHaveAttribute('data-over-hero', 'false')
    expect(bar.className).toContain('bg-bg-canvas')
    expect(bar.className).toContain('border-b')
  })

  it('drops the scrim, which has nothing left to protect', () => {
    const bar = renderNav(false)
    expect(bar.querySelector('[data-nav-scrim]')).toBeNull()
  })
})

describe('LandingNavbar across both treatments', () => {
  // The prop was renamed from `revealed` and its polarity INVERTED. A port
  // that drops the `!` produces a bar that is opaque over the hero and
  // transparent over the page -- wrong in both places, and it looks
  // deliberate. So both states are asserted, never just the interesting one.
  it('renders the same controls either way', () => {
    for (const overHero of [true, false]) {
      const { unmount } = render(<LandingNavbar overHero={overHero} />)
      for (const link of NAV_LINKS) {
        expect(screen.getByRole('link', { name: link.label })).toBeInTheDocument()
      }
      unmount()
    }
  })

  it('carries no auth control at all', () => {
    // Removed 2026-09-02, after the demo button went the same way. The bar
    // orients -- identity, three links, one preference -- and does not ask for
    // a decision from its top-right corner before the page has argued
    // anything. Auth lives in the closing CTA and the footer.
    for (const overHero of [true, false]) {
      const { unmount } = render(<LandingNavbar overHero={overHero} />)
      expect(screen.queryByRole('link', { name: 'sign up' })).toBeNull()
      expect(screen.queryByRole('link', { name: 'sign in' })).toBeNull()
      expect(document.querySelector('[data-nav-signup]')).toBeNull()
      // Positive companion: the bar really did render, so the absences above
      // are about auth and not about an empty component.
      expect(screen.getByRole('link', { name: 'faq' })).toBeInTheDocument()
      unmount()
    }
  })

  it('sends the external link out safely and without a glyph', () => {
    // `open source` is the one nav item that leaves the site. No external-link
    // icon: the bar already carries a lockup, three links, two buttons and a
    // theme toggle, and decorating one of them is the asymmetry this design
    // system rules out.
    const bar = renderNav(false)
    const external = screen.getByRole('link', { name: 'open source' })
    expect(external).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
    expect(external.querySelector('svg')).toBeNull()
    expect(bar).toBeInTheDocument()
  })
})

describe('LandingNavbar has no duplicate demo call to action', () => {
  it('does not repeat the hero primary CTA in the bar', () => {
    // Removed 2026-09-02 at Gabe's instruction. The hero's "try the live demo"
    // sits directly under the bar, so a nav "open the demo" is the same call
    // to action twice in one viewport. Figma 39:355 draws it only because that
    // bar was never meant to be visible over the hero at all.
    for (const overHero of [true, false]) {
      const { unmount } = render(<LandingNavbar overHero={overHero} />)
      expect(screen.queryByRole('link', { name: 'open the demo' })).toBeNull()
      // Positive companion: the bar IS still rendering links, so this is not
      // passing on a bar that renders nothing.
      expect(screen.getByRole('link', { name: 'how it works' })).toBeInTheDocument()
      unmount()
    }
  })
})

describe('LandingNavbar at mobile widths', () => {
  it('hides the links below md, keeping the lockup and the actions', () => {
    // Read from Figma 64:1020: at 375 the bar is 60px and holds the lockup,
    // sign in and sign up. No links, no "open the demo", and no theme toggle.
    renderNav(false)
    for (const link of NAV_LINKS) {
      const el = screen.getByRole('link', { name: link.label })
      expect(el.closest('[data-nav-links]')?.className).toContain('hidden')
      expect(el.closest('[data-nav-links]')?.className).toContain('md:flex')
    }
  })

  it('keeps the theme toggle at every width, including mobile', () => {
    // Figma 64:1020 draws no toggle in the 375px bar. That omission was only
    // survivable while the footer carried one, and the footer's was removed on
    // 2026-09-02 -- so obeying the frame would leave a phone visitor unable to
    // change the theme anywhere on the page. The two decisions only work as a
    // pair, which is why this asserts the absence of the hiding classes rather
    // than merely that a toggle exists somewhere.
    const bar = renderNav(false)
    const toggle = bar.querySelector('[data-theme-toggle]')
    expect(toggle).not.toBeNull()
    const wrapper = toggle!.closest('[data-nav-toggle]') as HTMLElement
    expect(wrapper.className).not.toContain('hidden')
    expect(wrapper.className).not.toContain('md:block')
  })

  describe('the blur belongs to the scroll, not to the hero', () => {
    // Gabe, 2026-09-17, after it was keyed on the wrong one: "when the navbar
    // is scrolled, blur appears. No scroll, no blur", then "when the navbar is
    // scrolled through hero section, blur applies".
    //
    // THE BUG THIS LOCKS OUT is subtle and was shipped once: `overHero` stays
    // true for the WHOLE hero, so a blur keyed on it arrived only after ~800px
    // of scrolling -- most of a screen late, and never during the part of the
    // journey the request is actually about.

    it('has nothing at all at rest', () => {
      const bar = renderNav(true, false)
      expect(bar.className).toContain('bg-transparent')
      expect(bar.className).not.toContain('backdrop-blur')
    })

    it('becomes a bar again as soon as the page moves, still inside the hero', () => {
      const bar = renderNav(true, true)
      expect(bar.className).toContain('backdrop-blur')
      // The tint comes back WITH the scroll (Gabe: "restore the background
      // when the scroll is applied"). What it must not be is the themed plate
      // -- over footage the bar is `ink-950`, not the page's canvas.
      expect(bar.className).toContain('bg-ink-950/30')
      expect(bar.className).not.toContain('bg-transparent')
      expect(bar.className).not.toContain('bg-bg-canvas/80')
    })

    it('adds the plate only once the hero is behind it', () => {
      const bar = renderNav(false, true)
      expect(bar.className).toContain('backdrop-blur')
      expect(bar.className).toContain('bg-bg-canvas/80')
    })

    it('leaves the off-hero plate opaque where there is no blur to justify it', () => {
      // Without `backdrop-filter` an 80% bar is not blurred, which is text
      // sliding through legible text. Both translucency and blur are bought
      // together behind the same `supports-` guard, or neither is.
      const bar = renderNav(false, true)
      const translucent = bar.className.includes('supports-[backdrop-filter]:bg-bg-canvas/80')
      const blurred = bar.className.includes('supports-[backdrop-filter]:backdrop-blur')
      expect(translucent && blurred, 'translucency and blur are guarded together').toBe(true)
    })
  })
})
