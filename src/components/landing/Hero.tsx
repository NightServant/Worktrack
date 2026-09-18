'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button-variants'
import { ExternalIcon } from '@/components/icons'
import { ICON_MOTION_GROUP, iconMotion } from '@/components/icons/motion'
import { HeroMedia } from './HeroMedia'
import { HeroScrollCue } from './HeroScrollCue'
import { HERO } from './content'

/**
 * Section 1. Dark in both themes, because HeroMedia lays a scrim over the
 * background -- which is why the colours here name PRIMITIVES (`ink-950`,
 * `ink-50`, `accent-400`) rather than semantic tokens: a semantic token flips
 * with the theme and this section does not.
 *
 * THEY USED TO BE RAW LITERALS -- `#050507`, `#fafafa`, `rgba(5,5,7,0.92)` --
 * and that is what made the dark-mode refactor (2026-09-09) a hunt through
 * five files. `ink-*` is the same warm ramp the dark theme now runs on, so the
 * hero and dark mode cannot drift apart again.
 *
 * The eyebrow is accent-400 and not accent-default because accent-700 on
 * near-black fails contrast, and the frame already made that choice.
 * Transcribed from Figma 39:369.
 *
 * ONE call to action: "read the source", and it is PRIMARY. Gabe removed the
 * demo and create-account buttons on 2026-09-02 and promoted the survivor.
 *
 * Filled accent rather than the hairline-on-dark treatment it had while it was
 * the third of three: a lone secondary button reads as a button someone forgot
 * to finish. With nothing to be secondary to, the only honest weight is
 * primary -- and the accent fill is the one element that carries colour on an
 * otherwise desaturated hero, so it is also where the eye lands. The hero therefore makes an argument rather than asking for a
 * decision. Both removed routes are still one click away, though NOT in the
 * navbar -- that bar's auth controls were removed the same day these were, so
 * the sentence that used to point there was describing buttons that no longer
 * existed. They are in the closing CTA, which carries the demo, the signup and
 * sign-in together with the sentence that says what the demo is.
 *
 * HEIGHT IS VIEWPORT-RELATIVE, AND THE CONTENT IS CENTRED IN IT. `min-h` with
 * `justify-center` means a taller hero grows the MEDIA, not the gap under the
 * text -- the extra height goes to the image, and the copy stays optically
 * centred at any viewport. Padding-based height does the opposite: it pushes
 * the text up and leaves dead space beneath it, which is exactly what a taller
 * fixed-padding hero looked like.
 *
 * `svh` rather than `vh`: on mobile Safari `100vh` is the height WITHOUT the
 * browser chrome, so a vh-sized hero is taller than the visible viewport and
 * the CTA sits under the address bar on first paint. `svh` is the small
 * viewport height, which is the one actually on screen.
 *
 * `h-full` ALONGSIDE the min-height, because this section renders in two
 * containers. Unpinned its parent has auto height, `h-full` resolves to auto,
 * and min-h-[88svh] governs -- the standalone behaviour. Inside 6.1a's pin the
 * parent is exactly one viewport tall, and 88svh is SHORTER than that: without
 * h-full the hero letterboxed itself, leaving a ~39px band of page background
 * above and below the dark media on every pinned frame.
 *
 * Content sits in the same `max-w-wide` container as every section below it,
 * so the headline starts on the same vertical line as every heading on the
 * page. Before that it used its own `px-16` and lined up with nothing. The
 * container was 1200 until 2026-09-15; see Section for why it is 1440 now.
 */
export interface HeroProps {
  posterSrc: string
  videoSrc?: string
  /** True once the hero has unpinned. Pauses the background video. */
  unpinned?: boolean
}

export function Hero({ posterSrc, videoSrc, unpinned = false }: HeroProps) {
  return (
    <section
      id="hero"
      data-landing-section="hero"
      /*
        `pb-48` -- 192px -- and it is RESERVED FOR THE SCROLL CUE rather than
        being air. The cue is absolutely positioned and reaches 160px up from
        the bottom edge (`bottom-28` plus its own 48px); the content is centred
        between this padding and `pt-32`, so it can never come closer to the
        bottom than the padding does. See HeroScrollCue.

        IT MUST EXCEED THE CUE'S REACH, NOT MATCH IT, and that is the fix of
        2026-09-17 rather than the original rule. This was `pb-40 md:pb-48`,
        and 160px is EXACTLY the cue's reach -- which guarantees the two never
        overlap and guarantees nothing else. Whenever the hero is content-
        driven rather than viewport-driven the gap between the CTA and the cue
        is then precisely zero, and the cue reads as hanging off the button
        instead of sitting at the foot of the section.

        That is not a rare case, it is every phone: the hero is `min-h-[88svh]`
        over 427px of content, so below about 740px of visible viewport the
        88svh floor stops binding and the height comes from the content --
        715px, with the CTA's bottom edge landing on the padding line the cue
        starts at. Measured at 375x812 the gap is 54px and at 375x640 it is 0.

        192 - 160 = 32px of clearance, at every width, by construction. Anyone
        lowering this has to lower the cue with it.

        It also reads better: with `justify-center` a larger bottom padding
        lifts the headline and the CTA slightly, which leaves the lower third
        of the hero to the footage and the cue rather than crowding all three.
      */
      /*
        THE ACCENT IS PINNED TO `accent-400` FOR THIS SECTION (Gabe,
        2026-09-18: "in light mode there is a color mismatch problem").

        The eyebrow already named `accent-400` directly, with the reason
        written down: accent-700 on near-black fails contrast. The CTA under it
        did not -- `buttonVariants` fills with `--color-accent-default`, which
        is accent-400 in the dark theme and accent-700 in the light one. So the
        single button on a section that is DARK IN BOTH THEMES turned brick red
        when the page theme flipped, two lines under an eyebrow that stayed
        orange.

        Redefining the token for this subtree rather than passing the colour to
        the button: the button is a shared primitive and must keep meaning "the
        accent", while this section is the one place where which colour that is
        cannot follow the theme. It is the same move LandingNavbar makes for the
        brand mark's accent cell over the hero, for the same reason.
      */
      className="relative isolate flex h-full min-h-[88svh] flex-col justify-center overflow-hidden px-gutter pb-48 pt-32 [--color-accent-default:var(--color-accent-400)] md:pt-40 lg:min-h-[92svh]"
    >
      <HeroMedia posterSrc={posterSrc} videoSrc={videoSrc} paused={unpinned} />

      {/*
        THE STACK IS GROUPED, NOT EVENLY SPACED. It was one `gap-7` column --
        eyebrow, headline, body and button all 28px apart -- and four things at
        one interval is a list, not a hierarchy: the eyebrow floated 28px clear
        of the headline it labels, so the first thing on the page read as a
        stray line rather than as the headline's kicker.
        Grouping states the relationships instead. The eyebrow is bound to the
        headline at `gap-3`, which is the SAME 12px SectionHeading couples its
        own eyebrow and title with, so the hero and the five section openings
        below it are finally built the same way. The outer `gap-6` then
        separates the three real parts -- who this is for, what it does, what to
        do about it -- and the button's `pt-2` lifts the ask clear of the
        sentence that earns it.
      */}
      <div className="mx-auto flex w-full max-w-wide flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="text-label-caps uppercase text-accent-400">{HERO.eyebrow}</p>
          <h1 className="max-w-4xl text-display-xl text-ink-50">{HERO.headline}</h1>
        </div>

        <p className="max-w-[720px] text-body-l text-ink-50/85">{HERO.body}</p>

        <div className="pt-2">
          {/*
            THE ONE BUTTON ON THIS PAGE THAT LEAVES THE SITE, and until
            2026-09-05 it was also the only CTA with no glyph at all. The
            outbound arrow is not decoration here: every other control on the
            landing page keeps you on it, and this one opens GitHub in a new
            tab -- which `target="_blank"` does silently unless something on
            the button says so.
          */}
          <Link
            href={HERO.sourceCta.href}
            target="_blank"
            rel="noreferrer noopener"
            data-variant="primary"
            className={cn(
              buttonVariants({ variant: 'primary', size: 'm' }),
              ICON_MOTION_GROUP,
              // Full width below 640 (Gabe, 2026-09-05), matching the closing
              // CTA. The wrapping <div> is a block, so the button only needs
              // permission to fill it -- there is no flex row here holding it
              // to its content width.
              'w-full sm:w-auto'
            )}
          >
            <ExternalIcon size={16} aria-hidden className={iconMotion('forward')} />
            {HERO.sourceCta.label}
          </Link>
        </div>
      </div>

      {/*
        THE SCROLL CUE, and it is a SIBLING of the content column rather than
        the last child of it. The column is `max-w-wide mx-auto`, so a cue
        inside it would centre on the COLUMN and land left of the section's own
        middle at any viewport wider than 1200 + gutters. It is also absolutely
        positioned against the section, which the column is not.

        It reuses `unpinned` rather than taking a scroll position of its own:
        the hero already receives one boolean meaning "the reader has moved on",
        and the background video's pause reads the same one. Two components
        deriving the same fact independently is the defect this page has a
        standing rule against -- see LandingNavbar's `overHero`.
      */}
      <HeroScrollCue hidden={unpinned} />
    </section>
  )
}
