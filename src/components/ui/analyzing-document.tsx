'use client'

// rounded-full is kept here and allowlisted in shadcnHouseRules.test.ts: the
// scan bar is a capsule 7% of the glyph's width -- about 3px at the size this
// renders -- where rounded-full resolves to under 2px anyway. The 4px cap
// governs corners on containers, and this is a shape, not a container.
import { motion, type Transition } from 'motion/react'
import type { ComponentProps } from 'react'

import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { cn } from '@/lib/utils'

/**
 * The wizard's "the model is reading this posting" state, for step 3 of
 * AddApplicationDialog. A scan line travels across a document glyph and leaves
 * its text lines behind it.
 *
 * WHERE IT CAME FROM. loading-ui.com's `analyzing-image`, pulled from its
 * shadcn registry (`https://loading-ui.com/r/analyzing-image.json`) and then
 * edited to this design system. The site credits the original animation to
 * dmytro (pqoqubbw, x.com/pqoqubbw/status/1913160002451153251), so the credit
 * chain is two deep and both links are named here.
 *
 * THE LICENCE, checked rather than assumed. loading-ui.com describes itself as
 * "Free and open source, forever" and states no attribution clause: there is
 * no /license or /terms route, its llms.txt indexes no licence page, and the
 * site links no repository whose LICENSE could be read. So this is NOT the
 * Skiper situation -- Skiper's free tier requires credit, which is why
 * src/lib/attribution.ts exists and why a test asserts those two sentences
 * verbatim against the README. Adding an entry there would also be wrong
 * mechanically: that list is typed and tested as the Skiper obligation, and
 * its test pins it to exactly `['skiper51', 'skiper106']`.
 *
 * It is credited in the README's general Attribution list instead, beside the
 * Pexels video and the Unsplash photograph -- two other things this repository
 * credits despite their licences not asking it to. Provenance is cheap and a
 * vendored file with no recorded origin is the expensive thing.
 *
 * THE MECHANISM IS THE VENDOR'S, unchanged, because it is the whole idea: one
 * 2.5s mirrored-repeat transition drives both a `clipPath: inset()` wipe on a
 * masking copy of the glyph and a thin bar sweeping across on translateX. The
 * `times: [0, 0.6, 0.6, 1]` pair holds the revealed state still for a beat
 * before the mirror runs it backwards, which is what stops it reading as a
 * loop. Those numbers are copied exactly.
 *
 * FOUR CHANGES, each one a thing the vendor default gets wrong here:
 *
 * 1. THE GLYPH IS A DOCUMENT, NOT A PICTURE. The vendor scans a photo frame,
 *    which is right for OCR and upload review and wrong for this step: the
 *    thing being read is a job posting, and an image icon would tell the user
 *    the app is looking at a picture. The page and its folded corner are the
 *    path data from src/components/icons/file-text.tsx -- the app's own
 *    document glyph -- so this stays inside the one-icon-vocabulary rule.
 *
 *    Drawn as a bare <svg> rather than by rendering `FileTextIcon` twice.
 *    That component's root is a <div> wrapping a LazyMotion tree, so it cannot
 *    be clipped as a flat layer, it sizes off a numeric prop instead of
 *    `size-full`, and mounting two of them would stand up two strict
 *    LazyMotion providers to draw one icon. src/components/icons/field-glyphs
 *    is the existing precedent for taking the geometry without the machinery.
 *
 * 2. THE REVEALED STATE IS THE GLYPH'S OWN TEXT LINES. The vendor reveals
 *    sixty-odd 1x1 rects of pixel noise under its photo -- "the image has been
 *    analysed" as decoration. A document has something truer to show: the
 *    three text lines file-text already draws. The masking copy is the blank
 *    page; the layer underneath is the page with its lines. So the scan
 *    literally leaves text where it has passed, which is what the step is
 *    doing.
 *
 * 3. THE MASK IS `bg-bg-canvas`, not the vendor's
 *    `--loading-ui-analyzing-image-background` custom property falling back to
 *    `--background`. That indirection exists so a library component can sit on
 *    an unknown surface; this one sits in AppDialog, whose panel is
 *    `bg-bg-canvas` in both themes, and a configuration point with one call
 *    site is a setting nobody will ever set. If this is ever placed on
 *    `bg-bg-surface` the wipe will show a seam, and that is the moment to make
 *    it a prop.
 *
 * 4. REDUCED MOTION DEGRADES TO THE GLYPH, NOT TO NOTHING. An infinite sweep
 *    is exactly the animation someone who asked for less motion asked to be
 *    spared. Under the preference the two animated layers are not rendered at
 *    all -- not merely stilled -- which leaves the finished document standing,
 *    lines and all, so the step still shows what it is doing. Read through
 *    usePrefersReducedMotion rather than motion's own useReducedMotion, so
 *    there is one subscription in the app rather than two that can disagree.
 *
 * The vendor's `aria-label` plus duplicate sr-only span became the sr-only
 * label alone, which is what css-spinner.tsx does: one accessible name, not a
 * name and an identical piece of text content inside it.
 */

/**
 * Copied exactly from the registry source. `times` is the reason it reads as a
 * scan rather than a pulse -- the third keyframe repeats the second, holding
 * the revealed document still for 40% of the cycle.
 */
const SCAN: Transition = {
  duration: 2.5,
  ease: [0.175, 0.885, 0.32, 1],
  times: [0, 0.6, 0.6, 1],
  repeat: Infinity,
  repeatType: 'mirror',
  repeatDelay: 0.2,
}

/** The sheet and its folded corner: file-text.tsx's first two paths. */
function Page() {
  return (
    <>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
    </>
  )
}

/** Lucide geometry, as everywhere else in src/components/icons. */
const SVG_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/**
 * Sized by the caller through a `size-*` utility -- every layer inside is
 * absolutely positioned, so the element has no intrinsic height of its own.
 * Colour comes from `currentColor`, so a `text-*` token on the caller paints
 * the glyph and the scan bar together.
 */
export function AnalyzingDocument({
  className,
  surfaceClassName = 'bg-bg-canvas',
  label = 'Reading the posting',
  ...props
}: ComponentProps<'div'> & { surfaceClassName?: string; label?: string }) {
  const reduced = usePrefersReducedMotion()

  return (
    <div
      role="status"
      className={cn('relative isolate shrink-0', className)}
      {...props}
    >
      {/* The read document. Under reduced motion this is the whole component. */}
      <svg {...SVG_PROPS} className="absolute inset-0 size-full" aria-hidden="true">
        <Page />
        <path d="M10 9H8" />
        <path d="M16 13H8" />
        <path d="M16 17H8" />
      </svg>

      {!reduced && (
        <>
          {/* The blank page, clipped away left-to-right to uncover the lines. */}
          <motion.div
            initial={{ clipPath: 'inset(0% 0% 0% 0%)' }}
            animate={{
              clipPath: [
                'inset(0% 0% 0% 0%)',
                'inset(0% 105% 0% 0%)',
                'inset(0% 105% 0% 0%)',
                'inset(0% 0% 0% 0%)',
              ],
            }}
            transition={SCAN}
            /*
              THE SURFACE THIS SITS ON, NOT THE THEME'S (Gabe, 2026-09-19:
              "black animation is not fixed").

              This layer is a MASK: a copy of the blank page painted in the
              background colour, wiped away to uncover the lines under it. It
              only disappears if it is the same colour as whatever is behind
              the component -- and `bg-bg-canvas` is only that in the wizard,
              where this was written. On the CV's page sheet the background is
              `bg-white` in BOTH themes, so in dark mode the mask painted a
              near-black rectangle over the glyph, which is the black block in
              the screenshot. The caller names its own surface.
            */
            className={cn('absolute inset-0 z-10', surfaceClassName)}
          >
            <svg {...SVG_PROPS} className="size-full" aria-hidden="true">
              <Page />
            </svg>
          </motion.div>

          <motion.div
            initial={{ transform: 'translateX(1400%)' }}
            animate={{
              transform: [
                'translateX(1400%)',
                'translateX(-80%)',
                'translateX(-80%)',
                'translateX(1400%)',
              ],
            }}
            transition={SCAN}
            className="absolute z-10 h-full w-[7%] rounded-full bg-current"
          />
        </>
      )}

      {/* The wizard reads a posting; the CV editor writes a document. Same
          animation, different sentence -- and a screen reader should be told
          which. */}
      <span className="sr-only">{label}</span>
    </div>
  )
}
