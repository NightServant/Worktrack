'use client'

import * as React from 'react'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { landingNavHeightPx, navOverHero } from '@/lib/landingNav'
import { shouldPin, heroPinHeightPx, carouselPinHeightPx } from '@/lib/pinnedScroll'
import { LandingNavbar } from './LandingNavbar'
import { PinnedBlock } from './PinnedBlock'
import { usePinnedSection } from './usePinnedSection'
import { useViewportSize } from './useViewportSize'
import { useCarouselProgress, type DrivableSwiper } from './useCarouselProgress'
import { SectionRail } from './SectionRail'
import { StickyMobileCta } from './StickyMobileCta'
import { SectionIndex } from './SectionIndex'
import { useSectionProgress } from './useSectionProgress'
import { RAIL_SECTIONS } from './content'
import { Hero } from './Hero'
import { SocialProof } from './SocialProof'
import { ProblemStatement } from './ProblemStatement'
import { SolutionValue } from './SolutionValue'
import { ScreenCarousel } from './ScreenCarousel'
import { LandingFaq } from './LandingFaq'
import { ClosingCta } from './ClosingCta'
import { SiteFooter } from './SiteFooter'
import type { LandingScreen } from './screens'

/**
 * The public landing page: six sections in the order Gabe settled on
 * 2026-09-02 -- hero, social proof, problem, solution, FAQ, closing CTA.
 *
 * The argument the order makes is the one a stranger actually needs: here is
 * the problem you have, here is what it costs you, here is the thing that
 * fixes it, here is proof you can check, here is how to try it without
 * committing.
 *
 * BUILT IN NORMAL FLOW. Task 3 (6.1a) layers pinning on top by wrapping Hero
 * and ScreenCarousel in a PinnedBlock each, four sections apart. This task
 * ships the unpinned page first deliberately: the reduced-motion and mobile
 * path is the one that rots because nobody with a desktop and motion enabled
 * ever sees it, so it exists and is tested before the pinned path is layered
 * over it. `pinned`, `carouselProgress` and `heroUnpinned` are the seam Task 3
 * drives; their defaults here are the in-flow behaviour.
 *
 * THIS COMPONENT OWNS THE NAVBAR STATE, and it is the only thing that does.
 * LandingNavbar takes a boolean and reads nothing -- one component deciding it
 * is over the hero while another decides it is not is M5's sidebar-and-bottom-
 * nav defect, which cost a fix round and was ruled on: the parent computes
 * once and both consume.
 */
export interface LandingProps {
  screens: LandingScreen[]
  heroPosterSrc: string
  /** Empty ships the poster; a path ships a <video>. */
  heroVideoSrc?: string
  /**
   * Forces the hero's background video into its paused state.
   *
   * `pinned` and `carouselProgress` used to sit beside this, as the seam Task
   * 3 would drive from outside. Task 3 landed and computes both INSIDE this
   * component instead -- shouldPin once, then a usePinnedSection per block --
   * because the two blocks have to agree and a parent passing them in could
   * not guarantee that. They were removed rather than left as props nothing
   * reads: an ignored prop is worse than an absent one, because it looks like
   * a control.
   *
   * This one survives because it is an override rather than a mechanism: the
   * pin drives the video through `heroPin.released`, and a caller can still
   * force the paused state on top of it.
   */
  heroUnpinned?: boolean
}

export function Landing({
  screens,
  heroPosterSrc,
  heroVideoSrc,
  heroUnpinned = false,
}: LandingProps) {
  const reduced = usePrefersReducedMotion()
  const heroRef = React.useRef<HTMLDivElement>(null)
  const [overHero, setOverHero] = React.useState(false)
  // The rail needs its OWN answer, because it does not sit where the navbar
  // sits. navOverHero asks "is the hero still behind the band this element
  // occupies", and the two elements occupy different bands: the navbar is the
  // top 60-80px, the rail is centred on the viewport. Sharing one flag made
  // the rail keep its light-on-dark treatment through the whole hero-to-social
  // -proof transition -- white dots on a white section, invisible for hundreds
  // of pixels of scroll.
  const [railOverHero, setRailOverHero] = React.useState(false)
  /**
   * Whether the page has moved AT ALL, which is a different question from
   * `overHero` and needs its own answer.
   *
   * `overHero` asks "is the hero still behind the navbar's band", and stays
   * true for the whole 800-odd pixels of it. The navbar's blur is keyed on
   * something much earlier: at rest it is nothing, and the moment the page
   * moves it becomes a plate over whatever is sliding under it (Gabe,
   * 2026-09-17: "when the navbar is scrolled, blur appears. No scroll, no
   * blur"). Keyed on `overHero` the blur appeared only once the hero had gone,
   * which is most of a screen too late.
   *
   * Starts false so the first paint is the bare bar; `read()` runs on mount,
   * so arriving deep-linked or restored mid-page corrects it in the same frame.
   */
  const [scrolled, setScrolled] = React.useState(false)

  // Measured, not computed from a pin height: the hero is pinned on desktop
  // and in normal flow on mobile and under reduced motion, so a computed
  // bottom edge would have to know which and would be wrong in two of three
  // cases. Starts false, so the first paint is the themed treatment rather
  // than light-on-light text on a themed page.
  React.useEffect(() => {
    const read = () => {
      const el = heroRef.current
      if (!el) return
      const heroBottom = el.getBoundingClientRect().bottom + window.scrollY
      setOverHero(
        navOverHero(window.scrollY, heroBottom, landingNavHeightPx(window.innerWidth))
      )
      // Half the viewport, because that is where the rail is anchored
      // (top-1/2). Same tested function, a different band.
      setRailOverHero(navOverHero(window.scrollY, heroBottom, window.innerHeight / 2))
      // Not a threshold. "Scrolled" means the page is not at its origin, and a
      // tolerance here would be a band where the bar is bare over moving
      // content -- the exact state the blur exists to prevent.
      setScrolled(window.scrollY > 0)
    }
    read()
    window.addEventListener('scroll', read, { passive: true })
    window.addEventListener('resize', read)
    return () => {
      window.removeEventListener('scroll', read)
      window.removeEventListener('resize', read)
    }
  }, [])

  // Computed once here and handed down, the same rule overHero follows. Two
  // components deriving their own idea of the active section is how they end
  // up disagreeing about it.
  const rail = useSectionProgress(RAIL_SECTIONS.map((s) => s.id))

  // 6.1a. shouldPin is called ONCE and the boolean is handed to both blocks.
  // Two callers each deriving it could straddle a resize and pin the hero
  // while the carousel sat in flow -- M5's sidebar-and-bottom-nav defect,
  // which cost a fix round and was ruled on: the parent computes, both consume.
  const size = useViewportSize()
  const isPinned = shouldPin(reduced, size.widthPx)
  const heroPin = usePinnedSection(heroPinHeightPx(size.heightPx), isPinned)
  const carouselPin = usePinnedSection(
    carouselPinHeightPx(screens.length, size.heightPx),
    isPinned
  )

  // The Swiper instance arrives through onSwiper, and the drive call lives
  // here rather than inside ScreenCarousel: the progress it needs is held
  // here, and putting the call in the child would mean two components each
  // holding a reference to the same instance.
  const [swiper, setSwiper] = React.useState<DrivableSwiper | null>(null)
  useCarouselProgress(swiper, carouselPin.progress, carouselPin.pinned)

  return (
    <>
      <LandingNavbar overHero={overHero} scrolled={scrolled} />
      {/*
        6.1a: when the pinned sequence lands, `progress` should come from it
        rather than from page scroll -- a thousand pixels of scroll inside a
        pinned hero advances the reader through the CONTENT not at all, so
        scrollY stops being a truthful measure. SectionRail takes props and
        computes nothing, so that is a one-line change here.
      */}
      <SectionRail
        sections={[...RAIL_SECTIONS]}
        activeId={rail.activeId}
        progress={rail.progress}
        overHero={railOverHero}
      />
      {/*
        The left margin's counterweight. Same state as the rail, different job:
        the rail is navigation, this states the position the rail only implies.
      */}
      <SectionIndex
        sections={[...RAIL_SECTIONS]}
        activeId={rail.activeId}
        overHero={railOverHero}
      />

      <main>
        {/*
          The hero is section 1 and the carousel is inside section 4, with two
          ordinary sections between them. That is the whole reason this is a
          hook called twice and a wrapper placed twice rather than one
          component owning "the pinned sequence".

          `heroUnpinned` is the prop seam kept from Task 2, so a caller can
          still force the paused state; `heroPin.released` is what actually
          drives it once the pin is live.
        */}
        <div ref={heroRef}>
          <PinnedBlock section={heroPin} name="hero">
            <Hero
              posterSrc={heroPosterSrc}
              videoSrc={heroVideoSrc}
              unpinned={heroUnpinned || heroPin.released}
            />
          </PinnedBlock>
        </div>

        <SocialProof />
        <ProblemStatement />

        <SolutionValue>
          {/*
            scrollDriven is carouselPin.pinned, passed straight down.
            ScreenCarousel must not call usePrefersReducedMotion or read a
            width itself: three conditions turn driving off -- reduced motion,
            a viewport below 768px, and not being inside the pin yet -- and
            they collapse to one question, asked once, here.
          */}
          <PinnedBlock section={carouselPin} name="carousel">
            <ScreenCarousel
              screens={screens}
              scrollDriven={carouselPin.pinned}
              onSwiper={(s) => setSwiper(s as unknown as DrivableSwiper)}
            />
          </PinnedBlock>
        </SolutionValue>

        <LandingFaq />
        <ClosingCta />
      </main>

      <SiteFooter />

      {/* Mobile only, and only between the hero and the closing CTA. */}
      <StickyMobileCta />
    </>
  )
}
