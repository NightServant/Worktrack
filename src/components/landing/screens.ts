/**
 * The product screens the landing carousel shows.
 *
 * CAPTURED FROM /demo/*, NOT FROM A REAL ACCOUNT. Every figure in these images
 * comes from src/lib/demoFixture.ts, so they are invented by construction --
 * which is the only safe way to do this, because publishing a screenshot
 * publishes whatever is in it, and the only accounts with real data are real
 * people's. Route them through the demo and there is nothing to redact.
 *
 * They include the demo banner, deliberately. These ARE the demo screens, and
 * a landing page arguing "no marketing claims, just things you can check"
 * should not crop the one label saying where its screenshots came from.
 *
 * There is no CV-editor shot: /demo has no CV route, because the editor is a
 * write surface and the demo has no write path. Captioning a calendar as the
 * CV editor to fill the slot would be the kind of small lie this page's whole
 * social-proof section exists to avoid.
 *
 * ---------------------------------------------------------------------------
 * FOUR CAPTURES PER SCREEN PER THEME, AND THAT IS ART DIRECTION RATHER THAN
 * RESOLUTION SWITCHING (2026-09-15). This replaced a pair of widths -- a
 * 1440px capture and the same capture at 768 -- which is the right tool for
 * "same picture, fewer pixels" and the wrong one here.
 *
 * Worktrack's layout does not merely get narrower. Below `lg` the sidebar is
 * replaced by a bottom tab bar; the stat cards go four across, then two, then
 * one; the chart grid collapses at `xl`. A phone was therefore downloading a
 * desktop screenshot -- sidebar and all -- and rendering it about 340px wide,
 * which shows a visitor an interface they will never see at a size where they
 * cannot read it either.
 *
 * THE TIERS ARE THE APP'S OWN BREAKPOINTS, not invented ones, so each capture
 * is the layout that visitor's own device would produce:
 *
 *   mobile   < 640   bottom tab bar, stat cards one per row
 *   tablet   < 1024  bottom tab bar, stat cards two across
 *   laptop   < 1280  sidebar, stat cards two across, charts one column
 *   desktop  >=1280  sidebar, stat cards four across, charts two columns
 *
 * `sm` is where the stat grid splits, `lg` is where the chrome swaps, `xl` is
 * where the chart grids do -- see the breakpoint note in docs. A fifth set was
 * captured at 1367px and is deliberately unused: it renders the SAME layout as
 * the 1920px one, so it would have been a second resolution of one picture,
 * which is what the srcset this replaces already did badly.
 *
 * MEDIA QUERIES ARE CORRECT FOR THE VIEWPORT AND WRONG FOR THE THEME, which
 * is why only half of this moved into `<picture>`. `prefers-color-scheme`
 * follows the OPERATING SYSTEM, and this app has a theme toggle that must beat
 * it; the carousel therefore still ships both themes and lets the `dark:`
 * class variant choose. Viewport width has no such split -- there is only one
 * answer and the browser already knows it -- so `<source media>` is exactly
 * right there. See the render in components/v1/skiper51.
 *
 * JPEG at quality 80, not PNG. These are UI over a gradient backdrop, which is
 * the case PNG is worst at. The desktop tier is capped at 1600px: the slot
 * renders at roughly 1200, so 1600 is sharp at 1x and still reasonable on a
 * 2x display, while the 1920 originals pushed one visitor's download to 2.1MB
 * on a page whose whole argument is restraint. At 1600/q80 a desktop visitor
 * fetches about 1.4MB for all five slides in both themes, and the table text
 * is still crisp at 1:1 -- checked by cropping one at 2x, not assumed.
 *
 * Re-check with `du -sh public/screens` and the per-tier totals after any
 * recapture. Currently 3.7MB for the whole tree: 488K mobile, 800K tablet,
 * 1.1MB laptop, 1.4MB desktop, both themes in each.
 *
 * PLANNER WAS RECAPTURED ON 2026-09-21, all eight files, because the screen
 * changed underneath the old ones: the rail gained a board picker and it sits
 * ahead of the region dropdown, so the shipped screenshots showed a filter row
 * the app no longer has. The tier dimensions are matched EXACTLY to the other
 * four screens (374x846, 766x846, 1022x846, 1600x779) -- the slides are
 * `object-contain` in a fixed box, so an odd aspect would letterbox one slide
 * differently from its neighbours as the carousel moved.
 *
 * ONE CAPTURE NEEDED A CROP AND IT IS WORTH SAYING WHICH. The dark phone shot
 * arrived 396px wide because it kept an overlay scrollbar; the light one was
 * 375 with none, and no other mobile capture in this tree has one. Cropped
 * from the left to the page's own right edge, so the framing matches its
 * siblings rather than the browser it was taken in. The DESKTOP tier's
 * scrollbar is left alone -- every screen in this set has it, so removing it
 * from one would be the inconsistency.
 */

/** A viewport tier, narrowest first. `desktop` is the fallback and has no query. */
export const SCREEN_TIERS = [
  { dir: 'mobile', media: '(max-width: 639px)' },
  { dir: 'tablet', media: '(max-width: 1023px)' },
  { dir: 'laptop', media: '(max-width: 1279px)' },
] as const

export type ScreenTheme = 'light' | 'dark'

export interface LandingScreen {
  /** The file name under `/screens/<theme>/<tier>/`, and the demo route it came from. */
  slug: string
  alt: string
  caption: string
}

/**
 * The `<source>` list for one screen in one theme, narrowest query first.
 *
 * ORDER IS LOAD-BEARING. `<picture>` takes the FIRST source whose media
 * matches, so a `max-width` list has to run narrow to wide -- reversed, every
 * viewport under 1280 would match the laptop query and no phone would ever see
 * the phone capture.
 */
export function screenSources(theme: ScreenTheme, slug: string) {
  return SCREEN_TIERS.map((tier) => ({
    media: tier.media,
    srcSet: `/screens/${theme}/${tier.dir}/${slug}.jpg`,
  }))
}

/** The `<img>` fallback: the desktop capture, used when no media query matches. */
export function screenSrc(theme: ScreenTheme, slug: string): string {
  return `/screens/${theme}/desktop/${slug}.jpg`
}

export const SCREENS: LandingScreen[] = [
  /*
    THE ORDER IS THE APP'S OWN NAV ORDER (Gabe, 2026-09-15: "order of pictures
    must be overview, applications, planner, documents and analytics"), which
    is also the order the captures were taken in.

    It used to run overview, applications, analytics, documents, planner --
    leading with the charts, on the reasoning that analytics is the most
    persuasive screen. That put the carousel in a different order from the
    sidebar every one of these screenshots contains, so a reader comparing the
    two saw the product disagree with itself. Following the nav costs nothing
    and means the carousel is a walk through the app rather than a pitch deck.
  */
  {
    slug: 'overview',
    alt: 'The overview screen, showing application counts by stage and recent activity.',
    caption: 'the overview',
  },
  {
    slug: 'applications',
    alt: 'The applications screen, showing every role being tracked with its status.',
    caption: 'the pipeline',
  },
  {
    // `planner`, NOT `calendar`, which is what these files and this caption
    // used to say. The app's own nav has read "planner" for some time, so the
    // landing page was captioning a screen with a name it does not use -- the
    // sort of small drift that makes a product look like someone else's.
    slug: 'planner',
    alt: 'The planner screen, showing upcoming interviews and applications that have gone quiet.',
    caption: 'the planner',
  },
  {
    slug: 'documents',
    alt: 'The documents screen, showing saved CVs and cover letters with their versions.',
    caption: 'the documents',
  },
  {
    slug: 'analytics',
    alt: 'The analytics screen, showing conversion rates and time-in-stage charts.',
    caption: 'the analytics',
  },
]
