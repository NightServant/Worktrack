'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { scrollToSection } from '@/lib/scrollToSection'

/**
 * The vertical progress rail down the side of the landing page.
 *
 * It does three jobs at once, which is why it earns the space: it says how far
 * through the page you are, it says which section you are in, and it lets you
 * jump. A long scrolling page without one asks the reader to hold their own
 * position in their head.
 *
 * THE THIRD JOB ONLY STARTED WORKING ON 2026-09-03. The dots were already
 * anchors, and five of the six pointed at ids no element carried -- sections
 * identified themselves with `data-landing-section` and nothing else, so the
 * browser had nothing to jump to and did nothing. The FAQ dot worked by
 * accident, being the one section that happened to set an id.
 *
 * Two halves to the fix. Section now derives a real `id` from its name, so the
 * plain href works with JavaScript off. And the click is intercepted here to
 * scroll SMOOTHLY and to resolve the target through `data-landing-section` --
 * the same attribute that decides which dot is lit, so the dot you click and
 * the dot that lights up cannot disagree about what a section is.
 *
 * PURELY PRESENTATIONAL, AND THAT IS DELIBERATE. It takes `progress` and
 * `activeId` and computes neither. Right now `Landing` derives them from page
 * scroll via useSectionProgress; when 6.1a lands, the pinned sequence has its
 * own notion of progress -- the hero and the carousel each hold the viewport
 * while their internal progress runs 0..1, so page scrollY stops being a
 * truthful measure of "how far through the content" the reader is. Task 3 can
 * feed this component that value instead and nothing here changes. Owning the
 * measurement here would have made that a rewrite.
 *
 * It is also the same "the parent computes once, children consume" rule the
 * navbar's overHero follows, and for the same reason: two components deriving
 * their own idea of the active section is how they end up disagreeing.
 *
 * Hidden below 2xl (1440). The rail lives in the MARGIN beside the page's
 * 1200px container, and the margin is what decides where it can exist: at
 * 1280 there is 40px a side, which is narrower than the rail's own plate and
 * far narrower than its hover label, so it sat on top of the content it was
 * supposed to be beside. At 1440 the margin is 120px, which is the first width
 * where it is genuinely furniture rather than an overlay.
 *
 * It was `lg` (1024), where the margin is NEGATIVE -- the container is already
 * wider than the viewport minus its gutters -- so every small laptop got a
 * fixed rail floating over the right-hand edge of the text. Moved to 2xl on
 * Gabe's instruction (2026-09-05): large laptops and desktops only.
 *
 * Below that the page is not left without a sense of position: the scrollbar
 * is the progress indicator and the navbar is the jump.
 *
 * BOTH THRESHOLDS MOVED ON 2026-09-15, because the container did. The page's
 * sections went from `max-w-[1200px]` to `max-w-wide` (1440) and this rail
 * lives in the margin that container leaves -- so the widths below are not a
 * taste that happens to have changed, they are the same two sums recomputed
 * against a different number. Leaving them at 1440/1560 would have put a fixed
 * rail over the last word of every paragraph on a 1440 monitor, which is
 * exactly the defect the 2xl move fixed for laptops.
 *
 * THE SUMS, so the next person who changes the container can redo them rather
 * than guess. The rail is `right-6`, so with a box `W_rail` wide its left edge
 * is at `100vw - 24 - W_rail`. The container's right edge is at
 * `(100vw + 1440) / 2`. Clearing it needs
 *
 *     100vw - 24 - W_rail > (100vw + 1440) / 2
 *     100vw > 1440 + 2 * (24 + W_rail)
 *
 * DOTS ONLY: the box is 35px, so the rail is clear from 1558px. The breakpoint
 * is `min-[1640px]`, which leaves ~41px of daylight rather than none -- a rail
 * that arrives exactly touching the text reads as a collision even when the
 * arithmetic says otherwise.
 *
 * WITH LABELS: the <ol> is a flex column, so every row is as wide as the widest
 * label -- 74px for "how it works" -- which makes the box a CONSTANT 121px:
 * 12 (pl-3) + 7 (dot) + 12 (gap-3) + 74 + 16 (pr-4). That is clear from 1730px,
 * and the breakpoint is `min-[1800px]` for the same ~35px of clearance the old
 * 1560 bought against 1490. A slightly longer label added later does not
 * immediately overlap.
 *
 * Recompute both as `1440 + 2 * (24 + W_rail + clearance)` if either the labels
 * or the container change.
 *
 * CLIPPED, NOT `hidden`. Zero width plus `overflow-hidden` is the same
 * mechanism `sr-only` uses: the label contributes nothing to the box and paints
 * nothing, and stays in the accessibility tree. `display: none` would take the
 * section names away from a screen reader on exactly the widths where the dots
 * are all a sighted reader has.
 *
 * `overHero` inverts it for the dark hero, exactly as the navbar does. Without
 * it the rail is a near-black line on near-black footage for the whole first
 * screen.
 *
 * The over-hero treatment uses Tailwind's `white/NN` opacity modifiers rather
 * than arbitrary `bg-[rgba(...)]` values. The arbitrary form was
 * in the DOM but did not always have a rule behind it, so the dots kept their
 * themed colour while the markup claimed otherwise -- a class that lies is
 * worse than one that is merely wrong, because the DOM looks correct while
 * you debug it. The modifier form is generated by the same mechanism as every
 * other utility on the page.
 *
 * The themed dots are `text-muted`, not `border-default`. Border tokens are
 * sized for hairlines against a surface -- #d4d4d8 on white is right for a 1px
 * rule and invisible as a 7px dot, which is how the rail shipped: present in
 * the DOM, measurable, and impossible to see on any light section. A dot is
 * foreground, so it takes a foreground token.
 */
export interface RailSection {
  id: string
  label: string
}

export interface SectionRailProps {
  sections: RailSection[]
  /** The section the reader is in. Null renders the rail with no active dot. */
  activeId: string | null
  /** 0..1 down the page. Drives the fill height. */
  progress: number
  /** True while the rail sits over the dark hero. */
  overHero?: boolean
}

export function SectionRail({
  sections,
  activeId,
  progress,
  overHero = false,
}: SectionRailProps) {
  const prefersReducedMotion = usePrefersReducedMotion()

  // Hooks before the early return. `sections` is a constant in practice, but
  // an empty one must not change the hook order -- that is the rules-of-hooks
  // violation this milestone already shipped once, in AppShell.
  if (sections.length === 0) return null

  return (
    <nav
      data-section-rail
      data-over-hero={overHero ? 'true' : 'false'}
      aria-label="Page sections"
      className={cn(
        'fixed right-6 top-1/2 z-40 hidden -translate-y-1/2 rounded-md py-4 pl-3 pr-4 min-[1640px]:block',
        'transition-colors duration-150 motion-reduce:transition-none',
        // NO PLATE OVER THE HERO SINCE 2026-09-17 (Gabe: "Remove the background
        // color and backdrop-blur of the scroll right rail in hero section
        // only"), which is the same call he made for the navbar an hour
        // earlier: over footage, a translucent plate is a visible panel across
        // the picture, and that costs more than it buys.
        //
        // WHAT IT BOUGHT IS WORTH KEEPING WRITTEN DOWN, because it was a real
        // observation rather than decoration. This rail is pinned to the RIGHT
        // edge, which is exactly where the hero's left-to-right scrim has
        // decayed to 0.3 alpha and the footage is at its brightest -- the
        // clouds in Gabe's own screenshot. Light marks at low opacity there do
        // not merely read poorly, they drift in and out as the clip plays,
        // which looks like a flicker rather than like a design.
        //
        // Two things make that survivable now and neither is luck: the footage
        // is tinted to `ink-950` rather than left neutral, and the marks over
        // the hero already run at a heavier weight than their off-hero
        // counterparts (`bg-white/40` track, and see the dots below). If it
        // does flicker against a bright cut, the answer is heavier marks --
        // not the panel coming back.
      )}
    >
      <ol className="relative flex flex-col gap-6">
        {/*
          The track sits behind the dots rather than between them, so the fill
          is one continuous line instead of segments that have to be kept in
          step with the dot spacing.
        */}
        <span
          aria-hidden
          className={cn(
            'absolute left-[3px] top-1 -z-10 w-px',
            'bottom-1',
            overHero ? 'bg-white/40' : 'bg-border-default'
          )}
        />
        <span
          aria-hidden
          data-rail-fill
          // Height as a percentage of the track, so the fill is correct at any
          // number of sections without the component knowing the pixel height.
          style={{ height: `${Math.round(progress * 100)}%` }}
          className={cn(
            'absolute left-[3px] top-1 -z-10 w-px transition-[height] duration-150 ease-out',
            'motion-reduce:transition-none',
            overHero ? 'bg-white' : 'bg-accent-default'
          )}
        />

        {sections.map((section) => {
          const active = section.id === activeId
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                data-rail-item={section.id}
                data-active={active ? 'true' : undefined}
                aria-current={active ? 'true' : undefined}
                onClick={(event) => {
                  // Modified clicks belong to the browser: cmd/ctrl-click
                  // opens a new tab, shift-click a window. Swallowing those
                  // would make a link that is not a link.
                  if (
                    event.defaultPrevented ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return
                  }
                  // preventDefault ONLY if the section was found. Otherwise the
                  // native anchor still gets its chance, which is the whole
                  // reason the href is still here.
                  if (scrollToSection(section.id, { reducedMotion: prefersReducedMotion })) {
                    event.preventDefault()
                  }
                }}
                // `py-2 -my-2` grows a 7px dot into a 23px-tall click target
                // without moving anything: the padding is cancelled by the
                // negative margin, so the dot spacing the fill percentage is
                // measured against is unchanged. A dot you have to aim at is
                // not really clickable, which is half of what was reported.
                // `gap-0` until the labels exist -- a 12px gap after a
                // zero-width label is 12px of nothing inside a 35px rail.
                className="group -my-2 flex items-center gap-0 py-2 outline-none min-[1800px]:gap-3"
              >
                <span
                  aria-hidden
                  className={cn(
                    'block h-[7px] w-[7px] shrink-0 rounded-full transition-colors',
                    'motion-reduce:transition-none',
                    active
                      ? overHero
                        ? 'bg-white'
                        : 'bg-accent-default'
                      : overHero
                        ? 'bg-white/45 group-hover:bg-white/80'
                        : 'bg-text-muted group-hover:bg-text-primary'
                  )}
                />
                {/*
                  The label is revealed on hover and focus rather than always
                  shown. Six permanent labels in the margin is a second
                  navigation competing with the one in the header; the dots are
                  the indicator, and the words are there when you go looking.
                  Opacity rather than conditional rendering, so the label is in
                  the accessibility tree and reachable by screen readers at all
                  times -- and the same reasoning is why the narrow-viewport
                  treatment below clips it to zero width rather than hiding it.
                */}
                <span
                  className={cn(
                    'whitespace-nowrap text-body-s opacity-0 transition-opacity',
                    'group-hover:opacity-100 group-focus-visible:opacity-100',
                    'motion-reduce:transition-none',
                    active && 'opacity-100',
                    // Clipped to nothing below 1800, where there is no margin
                    // to reveal into -- see the docblock for the arithmetic.
                    // This is what keeps the rail 35px wide and off the text.
                    'max-w-0 overflow-hidden min-[1800px]:max-w-none min-[1800px]:overflow-visible',
                    overHero ? 'text-white' : 'text-text-secondary'
                  )}
                >
                  {section.label}
                </span>
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
