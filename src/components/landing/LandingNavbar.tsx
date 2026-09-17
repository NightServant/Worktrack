'use client'

import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { scrollToSection } from '@/lib/scrollToSection'
import { BrandLockup } from '@/components/ui/brand-mark'
import { CloseIcon, MenuIcon, icons } from '@/components/icons'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { NAV_LINKS } from './content'

/**
 * The landing page's navigation header.
 *
 * IT LIVES IN THE HERO AND CHANGES COLOUR AT SOCIAL PROOF. Gabe settled that
 * on 2026-09-02, and it overturns Figma frame 39:355, which is annotated
 * "hidden over the hero, slides down after the carousel". That was drawn when
 * the carousel was section 2; under the six-section order it is section 4, so
 * obeying the annotation would leave a stranger scrolling through three
 * sections with no navigation at all.
 *
 * Why two treatments rather than one bar: the hero is DARK IN BOTH THEMES -- a
 * background video under a scrim from ink-950/90 to ink-950/30,
 * with an eyebrow in accent-400 rather than accent-700 because accent-700 on
 * near-black fails contrast. Social proof is an ordinary bg-canvas surface. A
 * bar that blends into the first is illegible on the second. The swap is not
 * decoration; it is what lets one bar sit on two grounds.
 *
 * POSITIONED `fixed`, AND RENDERED FROM Landing's ROOT rather than from inside
 * the hero's JSX. This is the one place the implementation cannot follow
 * "included in the hero section" literally, and the reason is mechanical: Hero
 * and ScreenCarousel are wrapped in motion.divs that animate translateY, and a
 * transformed ancestor becomes the containing block for `position: fixed`
 * descendants -- so a bar nested in the hero would silently degrade to
 * `absolute`, scroll away with the hero, and never reach social proof. It is
 * visually part of the hero, which is what the decision is about; it is a DOM
 * sibling, which is what makes it work.
 *
 * ITS CONTENT SITS ON THE FOOTER'S COLUMN (Gabe, 2026-09-15: "top navigation
 * bar must have the same width with the footer"). The BAR still spans the
 * viewport -- it has to, because its background and its bottom border are what
 * separate it from the page under it -- but everything inside it is now in the
 * same `px-gutter` + `max-w-wide` container SiteFooter uses, so the brand
 * lockup at the top of the page starts on the same vertical line as the brand
 * lockup at the bottom of it, and as every section heading in between.
 *
 * THIS OVERTURNS THE RULE SiteFooter's DOCBLOCK WROTE DOWN -- "page CONTENT
 * aligns to the 1200px column, and fixed chrome that frames the viewport spans
 * it". That rule was defensible and is now decided against: the navbar carries
 * a wordmark and three links, which read as content whatever the element is
 * positioned as, and at 1440 the old `md:px-16` put the lockup 51px left of
 * everything it sits above. The frame/content distinction still holds for
 * SectionRail, SectionIndex and StickyMobileCta, none of which carry anything
 * the eye lines up against a heading.
 *
 * The scrim stays a direct child of the <header> rather than moving into the
 * container, because it is the bar's ground and has to reach both edges of the
 * viewport; inset to a 1200px column it would end in a visible vertical seam.
 *
 * `overHero` is a prop and nothing here computes it. Landing owns it via
 * navOverHero() so that one component cannot decide it is over the hero while
 * another decides it is not -- M5's sidebar and bottom nav each deriving their
 * own active route and disagreeing cost a fix round, and the ruling was that
 * the parent computes once and both consume.
 *
 * NO AUTH CONTROLS. Gabe removed `sign in` and `sign up` from the bar on
 * 2026-09-02, after the demo button went the same way. What is left is
 * identity (the lockup), orientation (three links) and one preference (the
 * theme toggle) -- the bar orients, it does not ask.
 *
 * Auth is still reachable: the closing CTA carries `create an account` AND
 * `sign in`, the latter having moved out of the footer on 2026-09-03. Both are
 * further down the page than a persistent bar, which is the trade being made
 * deliberately -- a landing page that asks for a decision in its top-right
 * corner asks before it has argued anything.
 *
 * Below md the links hide but the THEME TOGGLE DOES NOT. Figma 64:1020 draws
 * no toggle in the 375px bar, and that omission was only survivable while the
 * footer carried one; the footer's was removed on 2026-09-02, so following the
 * frame would leave a phone visitor unable to change the theme anywhere on the
 * page. The frame loses to the working product here.
 */
export interface LandingNavbarProps {
  /** True while the hero still covers the band the bar occupies. */
  overHero: boolean
  /**
   * Whether the page has moved at all. Drives the blur, and only the blur.
   *
   * SEPARATE FROM `overHero` BECAUSE THEY ANSWER DIFFERENT QUESTIONS, and
   * keying the blur on the wrong one is what made it arrive a screen late.
   * `overHero` decides the bar's COLOURS -- light links on footage, themed
   * links on the page -- and stays true for the length of the hero. This
   * decides whether there is a plate at all.
   */
  scrolled?: boolean
}

export function LandingNavbar({ overHero, scrolled = false }: LandingNavbarProps) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const [menuOpen, setMenuOpen] = React.useState(false)

  // Close on Escape. A panel that covers the page and can only be dismissed by
  // finding its button again is a trap on a phone, where the button is small
  // and the panel is everything.
  React.useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    // The panel covers the page, so the page behind it must not scroll under
    // it -- otherwise dismissing the menu returns you somewhere else.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [menuOpen])

  /** Shared by both the desktop row and the mobile panel. */
  const linkHandler = (href: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    const id = href.replace(/^#/, '')
    if (scrollToSection(id, { reducedMotion: prefersReducedMotion })) {
      event.preventDefault()
      setMenuOpen(false)
    }
  }

  return (
    <header
      data-landing-nav
      data-over-hero={overHero ? 'true' : 'false'}
      className={cn(
        // `px-gutter` at every width, with no `md:px-16` step: the gutter is
        // the footer's, and the container below is what actually holds the
        // content to 1200px once the viewport is wider than that.
        'fixed inset-x-0 top-0 z-[60] flex h-[60px] items-center px-gutter',
        'md:h-20',
        // Colour only, and only these three properties. A bar that resizes or
        // slides on scroll is the pattern this design system's restraint rules
        // out, and it would fight the pinned hero underneath it.
        'transition-[background-color,border-color,color] duration-150',
        'motion-reduce:transition-none',
        /*
          THE BAR IS NOTHING UNTIL YOU SCROLL (Gabe, 2026-09-17, settled across
          four messages and quoted at the end: "when the navbar is scrolled,
          blur appears. No scroll, no blur").
          So the two states are not two weights of the same treatment, they are
          presence and absence. AT REST, over the hero, there is no plate, no
          blur and no border -- the footage runs edge to edge and the links sit
          on it, carried by the gradient scrim below. ONCE SCROLLED, the bar
          becomes a frosted plate over ordinary page content.
          THE PLATE AND THE BLUR ARE SEPARABLE, which is the thing worth
          recording: they were introduced together on 2026-09-15 and read as
          one treatment. The plate supplies contrast by adding colour, the blur
          supplies it by destroying detail. Neither is wanted over the footage,
          because both put a visible band across the picture -- which is what
          every message in this sequence was pointing at.
          OVER THE HERO HAS NO BACKGROUND AND NO BLUR. What carries the links
          is the gradient scrim below (`from-ink-950/55` to transparent), which
          was always doing the real work -- the plate and the blur were both
          additions on top of it, and only the scrim was ever load-bearing.
          THE SCRIM IS NOW THE ONLY THING between the links and moving footage,
          so it cannot be removed as "unused" by the next reader. SectionRail's
          docblock argues that light marks at low opacity over a bright moving
          frame drift in and out of legibility as the clip plays -- worse than
          being consistently wrong, because it reads as a flicker. The hero
          footage is tinted to `ink-950` now, which narrows that gap, and the
          scrim covers the top of the frame where the bar sits. If the links
          ever do flicker against a bright cut, the answer is a stronger scrim,
          not a plate coming back.

          OFF THE HERO KEEPS ITS PLATE, and that is the one place "remove the
          background" is not applied. There the bar sits over ordinary page
          content in the page's own colours, and a transparent bar means dark
          links with dark text sliding through them -- not a softer version of
          the same look, simply unreadable. With the blur back it returns to
          `bg-bg-canvas/80`, the translucency the blur pays for.
          SUPPORTS-GUARDED AGAIN, and that is not decoration: without the guard
          a browser with no `backdrop-filter` gets a bar that is 80% opaque and
          NOT blurred, which is text sliding through legible text. The
          translucency is bought only where the blur that justifies it exists;
          everywhere else the bar stays opaque. Over the hero there is nothing
          to guard, because there is nothing there to fall back from.
          THE Z-INDEX WAS ALREADY WINNING, and is raised anyway because it was
          asked for. Measured in the browser on both 2026-09-15 and 2026-09-17,
          the second time at six scroll positions: this bar took every probe,
          and every other piece of landing chrome -- the rail, the section
          index, the sticky mobile CTA, the mobile menu panel -- is `z-40`.
          `z-[60]` lifts it clear of the `z-50` shared by the ui/ overlay
          primitives (dialog, drawer, dropdown, popover). NOTHING ON THIS PAGE
          MOUNTS ONE, which is the only reason that is safe: a navbar floating
          above a modal scrim is a worse bug than the one being fixed, so if a
          dialog ever lands on the landing page this number comes back down.
        */
        overHero
          ? cn('text-ink-50', scrolled ? 'bg-ink-950/30' : 'bg-transparent')
          : 'border-b border-border-subtle bg-bg-canvas text-text-primary',
        // EVERYTHING BELONGS TO THE SCROLL, NOT TO THE HERO, and that is the
        // whole rule: at the top of the page the bar is absent -- no plate, no
        // blur, no border, the footage running edge to edge under the links --
        // and the moment the page moves it becomes a bar again.
        //
        // `overHero` decides only WHICH bar: `ink-950/30` over the footage,
        // the themed canvas plate over the page. It does not decide whether
        // there is one, which is the mistake that shipped once -- keyed on
        // `overHero`, the blur arrived only after the whole hero had gone, a
        // screen later than asked for.
        scrolled && 'supports-[backdrop-filter]:backdrop-blur-md',
        // Off the hero the blur also buys the `/80` translucency, guarded
        // together: without `backdrop-filter` an 80% bar is NOT blurred, which
        // is text sliding through legible text, so that plate stays opaque.
        // Over the hero the tint needs no guard -- it is doing the work alone,
        // with the gradient scrim beneath it.
        scrolled && !overHero && 'supports-[backdrop-filter]:bg-bg-canvas/80'
      )}
    >
      {overHero && (
        // The contrast fix Figma never needed, because its bar is opaque
        // white. Ours sits on video and the controls are on the right, where
        // the hero's own scrim has decayed to 0.3 alpha.
        <div
          data-nav-scrim
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[120%] bg-gradient-to-b from-ink-950/55 to-transparent"
        />
      )}

      {/*
        THE FOOTER'S COLUMN, copied rather than imported for the same reason
        SiteFooter copies it from Section: one `mx-auto w-full max-w-wide`
        is smaller than a component that exists to hold two class names, and
        the three places that spend it are the three the eye compares.
      */}
      <div
        data-nav-container
        className="mx-auto flex w-full max-w-wide items-center gap-6 md:gap-8"
      >
        <Link href="/" aria-label="Worktrack home" className="shrink-0">
          {/*
            Over the hero the lockup renders its DARK-MODE colours whatever the
            page theme is, because the hero is dark in both. Two halves to that:

            `text-ink-50` carries the wordmark and BrandMark's three static
            cells, which are `currentColor`.

            The accent cell is `fill="var(--color-accent-default)"`, which
            resolves to accent-700 (#c2410c) in the light theme -- too dark
            against near-black, and the same contrast problem that made the hero
            eyebrow accent-400 rather than accent-default in the frame. So the
            token itself is redefined for this subtree rather than the component
            being forked or given a variant prop, which is what BrandMark's own
            docblock asks callers to do.

            `[&>svg]:text-ink-50` is NOT redundant with the container's
            `text-ink-50`, and leaving it out is a bug that only shows in the
            light theme. BrandMark sets `text-text-primary` on its OWN <svg>, so
            the inherited colour never reaches the three currentColor cells --
            the svg re-declares it. In dark mode text-text-primary is near-white
            and the mark looks correct by accident; in light mode it is
            near-black and the cells vanish into the hero. The descendant
            selector out-specifies the svg's own class, which is what actually
            repaints them.
          */}
          <BrandLockup
            className={cn(
              overHero &&
                'text-ink-50 [&>svg]:text-ink-50 [--color-accent-default:var(--color-accent-400)]'
            )}
          />
        </Link>

        <div className="flex-1" />

        <nav
          data-nav-links
          aria-label="Landing sections"
          className="hidden items-center gap-8 md:flex"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              {...(link.external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
              {...(link.external ? {} : { onClick: linkHandler(link.href) })}
              className={cn(
                'text-body-s transition-colors',
                overHero
                  ? 'text-ink-50/85 hover:text-ink-50'
                  : 'text-text-secondary hover:text-text-primary'
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/*
          Shown at EVERY width, including mobile. Figma 64:1020 draws no toggle
          in the 375px bar, and this deliberately departs from it: the footer's
          toggle was removed on 2026-09-02, and the frame's omission was only
          survivable while the footer carried one. Following it now would leave a
          phone visitor with no way to change the theme anywhere on the page.
        */}
        <div data-nav-toggle>
          <ThemeToggle size={32} className={cn(overHero && 'text-ink-50')} />
        </div>

        {/*
          THE MOBILE MENU. Below md the three links were simply hidden, which
          left a phone visitor with no route to the FAQ or the repository from
          the top of the page -- the nav did not degrade, it disappeared.

          A disclosure rather than a Sheet or a Drawer: this is three links and
          the shadcn overlays bring a focus trap, a portal and an animation
          library for a panel that needs none of them. The trade is that the
          focus trap has to be replaced by something, which is why Escape closes
          it, the page beneath it stops scrolling, and the button owns
          aria-expanded and aria-controls.
        */}
        <button
          type="button"
          data-nav-menu-toggle
          aria-expanded={menuOpen}
          aria-controls="landing-mobile-nav"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((v) => !v)}
          className={cn(
            'grid h-10 w-10 place-items-center rounded-md md:hidden',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default',
            overHero ? 'text-ink-50' : 'text-text-primary'
          )}
        >
          {menuOpen ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
        </button>
      </div>

      {menuOpen && (
        <div
          id="landing-mobile-nav"
          data-nav-mobile-panel
          className={cn(
            'fixed inset-x-0 top-[60px] z-40 flex flex-col gap-1 border-b',
            'px-gutter pb-6 pt-2 md:hidden',
            // THE PANEL FOLLOWS THE BAR (Gabe, 2026-09-06). Over the hero the
            // bar is light-on-dark and the panel dropped out of it white,
            // which read as a different application appearing on top of the
            // page rather than as the bar opening.
            //
            // OPAQUE IN BOTH STATES, and that part is unchanged: `ink-950` is
            // the hero's own base colour, the one its scrim runs from. The
            // note that used to sit here argued against a TRANSLUCENT panel
            // over video -- links that stop being readable -- and that
            // argument still holds. This swaps the ground, not the opacity.
            overHero
              ? 'border-white/10 bg-ink-950 text-ink-50'
              : 'border-border-subtle bg-bg-canvas text-text-primary'
          )}
        >
          {NAV_LINKS.map((link) => {
            const Icon = icons[link.icon]
            return (
              <Link
                key={link.label}
                href={link.href}
                {...(link.external
                  ? { target: '_blank', rel: 'noreferrer noopener' }
                  : { onClick: linkHandler(link.href) })}
                onClickCapture={() => link.external && setMenuOpen(false)}
                className={cn(
                  // `min-h-11` so each row is a 44px target. The panel is
                  // reached by a thumb and nothing else.
                  'flex min-h-11 items-center gap-3 rounded-md px-2 py-3 text-body-l',
                  overHero
                    ? 'text-ink-50 hover:bg-white/10'
                    : 'text-text-primary hover:bg-bg-inset'
                )}
              >
                <Icon
                  size={18}
                  aria-hidden
                  data-nav-link-glyph
                  className={cn('shrink-0', overHero ? 'text-white/60' : 'text-text-muted')}
                />
                {link.label}
              </Link>
            )
          })}
        </div>
      )}
    </header>
  )
}
