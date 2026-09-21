'use client'

import * as React from 'react'
import Link from 'next/link'
import { Separator } from '@/components/ui/separator'
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons'
import { buttonVariants } from '@/components/ui/button-variants'
import { ICON_MOTION_GROUP, iconMotion } from '@/components/icons/motion'
import { cn } from '@/lib/utils'
import { RailLayoutProvider } from './railLayout'
import type { DocumentWorkspaceProps } from './DocumentWorkspace'

/* The toggles point at these with `aria-controls`, so the ids have to be the
   same two strings in both places -- a dangling reference is worse than none,
   which is the same rule `document-sheet` below is written under. */
const LEFT_RAIL_ID = 'document-left-rail'
const RIGHT_RAIL_ID = 'document-right-rail'

/**
 * WHERE THE TWO RAILS SEPARATE INTO COLUMNS OF THEIR OWN, in pixels of
 * workspace width.
 *
 * 1700, WHICH IS THE WIDE TIER THIS FILE ALREADY HAD as `min-[1700px]:`
 * classes before the arrangement moved into JS. Above it the rails widen to
 * 380 and 500 because there is room to spare; that is the same statement as
 * "both rails are comfortable here", so it should not be made twice with
 * different numbers.
 *
 * IT USED TO DECIDE WHETHER THE RAILS STARTED OPEN AS WELL, AND IT NO LONGER
 * DOES (Gabe, 2026-09-17: open the left and right rails by default). The
 * arithmetic that made it a default has expired. It was set against the
 * THREE-column arrangement, where a 1440 laptop opening both rails kept 720px
 * for the page and made the document the smallest of three panels on a screen
 * whose entire purpose is the document. Below this threshold there is no
 * three-column arrangement any more: `oneColumn` puts both panels in ONE 320px
 * rail, so the same 1440 laptop opens to 320 of rail and 1120 of page. The
 * objection was never "rails are open", it was "the page is the smallest thing
 * on screen", and the two-column layout already answers it.
 *
 * WHAT IT STILL DECIDES is `wide`: three columns above, two below. That has to
 * keep tracking the window, which the open/shut state does not -- see the
 * measurement effect.
 */
const RAILS_SPLIT_AT = 1700

/* THE DRAWER IS NAMED FOR WHAT IT HOLDS, not for the rail the handle is on.
   One control moves both panels, so "document tools" (the left rail's own
   title) would under-report what the click does. */
const COLLAPSE_LABEL = 'Collapse document panels'
const EXPAND_LABEL = 'Expand document panels'

/**
 * The editor at `lg` and above: breadcrumb, name, save state, actions, a
 * docked tool strip, and the page between two rails.
 *
 * THE OTHER HALF of the split described in `CompactDocumentChrome` -- see that
 * file for why this is two components rather than one with `lg:` classes.
 *
 * THE THREE-COLUMN FRAME STARTS AT `lg`, AND IT STARTED AT `xl` UNTIL
 * 2026-09-13 (Gabe: "make left and right rail collapsible and maintain the
 * layout of large screens to the small laptop screens"). Between 1024 and 1280
 * this file had a SECOND layout -- rails stacked above and below the page, the
 * whole window scrolling -- and 1280 is above every 13" laptop there is, so
 * the arrangement most people saw was the fallback. It is gone: one layout at
 * every width this component renders at, and the rails COLLAPSE rather than
 * stack when there is no room for them.
 *
 * That also retires rules that were already unreachable. `DocumentWorkspace`
 * hands this component only widths >= 1024 (`useBelowDesktop` switches at
 * `lg`), so every un-prefixed class here that existed to serve the stacked
 * fallback below `xl` was serving a 1024-1280 band that now looks like the
 * large screens, and nothing narrower ever gets here at all.
 */
/**
 * ONE RAIL, WHICH IS ALSO A DRAWER.
 *
 * IT IS ONE DRAWER HOLDING TWO RAILS, NOT TWO SIDEBARS (Gabe, 2026-09-13:
 * "left drawer should open both left and right rail; remove the collapsed
 * version of right rail"). The two rails used to fold independently, which
 * gave the frame four states and two edges to hunt controls along. They are
 * one state now: the left edge is the only handle, and it puts both panels
 * away or brings both back.
 *
 * SO ONLY THE ANCHOR RAIL KEEPS AN EDGE WHEN SHUT. The other simply leaves --
 * no 44px strip, no second control - and the grid gives its track back to the
 * page. `onToggle` is what marks the anchor: the rail that has it draws the
 * handle and the chevron, the rail without it is carried by that decision.
 *
 * THE HANDLE IS A LARGE ARROWHEAD, CENTRED ON THE EDGE, and it is a drawer
 * pull rather than an icon button. A rail's own glyph named WHAT would open,
 * which is the right answer when each rail opens separately and you are
 * choosing between them; with one drawer there is nothing to choose, so the
 * edge should say only "pull". 28px against the 18px glyph it replaces, and
 * vertically centred where a hand would take it.
 *
 * THE CONTENT IS `hidden`, NEVER UNMOUNTED, and the difference is a person's
 * work. These subtrees hold per-section edit state and whatever request is in
 * flight -- a rewrite being reviewed, a tailoring run half returned. Throwing
 * that away on a LAYOUT toggle would re-ask the model for it, which is a bill
 * as well as a surprise. `display:none` also takes the subtree out of the
 * accessibility tree, so a screen reader never finds two copies of one control
 * while the drawer is shut.
 */
function Rail({
  id,
  side,
  open,
  column,
  onToggle,
  label,
  children,
}: {
  id: string
  side: 'left' | 'right'
  open: boolean
  /** Explicit grid column, so placement never depends on sibling count. */
  column: string
  /** Given only to the rail that owns the drawer; the other has no control. */
  onToggle?: () => void
  /** Names the panel, not the verb: "document tools", "tailoring". */
  label: string
  children: React.ReactNode
}) {
  const Chevron = side === 'left' ? ChevronLeftIcon : ChevronRightIcon

  return (
    <aside
      id={id}
      className={cn(
        'min-w-0 border-border-default bg-bg-surface',
        side === 'left'
          ? 'border-b lg:border-b-0 lg:border-r'
          : 'border-t lg:border-t-0 lg:border-l',
        column,
        open
          ? 'p-5 lg:overflow-y-auto'
          : // The handle has no padding of its own -- its button fills the
            // strip, so the whole 44px column is the target rather than a
            // glyph with dead margin around it. A rail that is not the drawer's
            // anchor has no strip at all and leaves the grid entirely.
            onToggle
            ? 'overflow-hidden p-0'
            : 'hidden'
      )}
    >
      {!open && onToggle && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          aria-controls={id}
          aria-label={EXPAND_LABEL}
          title={EXPAND_LABEL}
          className={cn(
            'grid h-full w-full place-items-center',
            'text-text-muted transition-colors hover:bg-bg-inset hover:text-accent-default',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/30'
          )}
        >
          <ChevronRightIcon size={28} aria-hidden />
        </button>
      )}

      <div className={cn('flex flex-col gap-4', !open && 'hidden')}>
        {/* THE FOLD CONTROL IS CONDITIONAL WHERE THE CONTENT IS MERELY HIDDEN,
            and the asymmetry is deliberate. The content has state to protect,
            so it stays mounted behind `display:none`. This button has none --
            and if it stayed, a shut drawer would carry TWO controls with the
            same accessible name (the handle and this one), which is a duplicate
            in the tree for anyone not looking at the pixels. Caught by a test
            that found both. */}
        {open && (
        // TITLE LEADING, CONTROL TRAILING (Gabe, 2026-09-13: "add title to left
        // and right rail"). The title is a column label, not a heading: the
        // rails' own panels already carry `heading-s` titles inside them, and a
        // second, larger one above would out-rank the thing it introduces.
        //
        // ONLY THE ANCHOR GETS A CHEVRON, so the right rail's row is a title
        // and nothing else. It closes with the drawer, and a second control
        // saying "collapse tailoring" while collapsing the outline too would be
        // lying about its own scope.
        <div className="flex items-center justify-between gap-2 border-b border-border-subtle pb-3">
          <h2 className="min-w-0 truncate text-label-caps uppercase text-text-secondary">
            {label}
          </h2>
          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded
              aria-controls={id}
              aria-label={COLLAPSE_LABEL}
              title={COLLAPSE_LABEL}
              className={cn(
                'grid size-7 place-items-center rounded-md text-text-muted',
                'transition-colors hover:bg-bg-inset hover:text-text-primary',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/30'
              )}
            >
              <Chevron size={16} aria-hidden />
            </button>
          )}
        </div>
        )}
        {children}
      </div>
    </aside>
  )
}

export function DesktopDocumentChrome({
  kindLabel,
  documentsHref,
  polishing = false,
  title,
  onTitleChange,
  savedLabel,
  dirty = false,
  saving = false,
  actions,
  destructiveActions,
  tools,
  leftRail,
  rightRail,
  railNav,
  children,
  footnote,
}: DocumentWorkspaceProps) {
  const displayTitle = title.trim() || 'untitled document'

  /**
   * ONE BOOLEAN FOR BOTH RAILS, AND IT STARTS OPEN AT EVERY WIDTH.
   *
   * IT WAS TWO UNTIL 2026-09-13, one per rail. Gabe: "left drawer should open
   * both left and right rail." Two booleans is four states, and the two mixed
   * ones were never chosen deliberately -- they were what you landed in on the
   * way to one of the other two.
   *
   * `true` WAS ALREADY WRITTEN HERE AND WAS NOT THE REAL DEFAULT UNTIL
   * 2026-09-17, which is the trap this comment exists to close. The
   * measurement effect below used to overwrite it once, on mount, with
   * `width >= RAILS_SPLIT_AT` -- so on every laptop narrower than 1700, which
   * is nearly all of them, the rails arrived shut and this initialiser only
   * ever described a screen almost nobody has. Gabe asked for them open by
   * default; what had to change was the effect, not this line. See
   * `RAILS_SPLIT_AT` for why the arithmetic that justified the old default
   * does not survive the two-column arrangement.
   *
   * DESKTOP-FIRST for the same reason `useBelowDesktop` is: the server cannot
   * measure anything, so the first client render must agree with the markup it
   * hydrates. Nothing corrects this after mount now, so there is no wrong
   * first paint left to be the cheaper of.
   */
  const [railsOpen, setRailsOpen] = React.useState(true)
  /**
   * WHETHER THERE IS ROOM FOR THE RAILS BESIDE THE PAGE, tracked for the life
   * of the component -- the one thing the measurement still decides.
   *
   * It has to keep up, because it decides HOW the rails open (two columns or
   * three) rather than WHETHER they start open -- and a window dragged across
   * 1700 with the drawer out would otherwise keep whichever answer happened to
   * be true at mount.
   */
  const [wide, setWide] = React.useState(true)
  const rootRef = React.useRef<HTMLDivElement>(null)

  /**
   * THE ARRANGEMENT IS MEASURED, NOT ASKED OF A MEDIA QUERY.
   *
   * A media query answers about the VIEWPORT; what decides whether two rails
   * and a page fit is the width of this workspace, which is the viewport minus
   * whatever chrome is beside it. They agree today because `useDocumentFocus`
   * hides the sidebar -- and that is exactly the kind of agreement that stops
   * being true the first time something is docked next to the editor.
   *
   * MEASURED DIRECTLY, THEN OBSERVED ONLY IF THAT FAILED. A ResizeObserver is
   * delivered as part of the rendering lifecycle, so an environment that is
   * not painting never calls it: a hidden browser pane gave a laid-out element
   * zero callbacks in 1.5s (2026-09-13), and a background tab or a headless
   * capture does the same. `getBoundingClientRect` asks layout directly and
   * cannot be starved, so it goes first and the observer is the fallback for
   * the case where there was no layout to read yet.
   *
   * IT NO LONGER TOUCHES `railsOpen` (Gabe, 2026-09-17: open the left and
   * right rails by default). It set it once, on mount, from the same
   * threshold -- which is what made "starts open" false on every laptop under
   * 1700px. That one-shot default is gone, along with the `defaulted` ref that
   * existed only to fire it once; the drawer now starts open and moves only
   * when somebody moves it. What survives is `wide`, which is about layout
   * rather than intent and has to stay current for as long as the window can
   * change.
   */
  React.useEffect(() => {
    const el = rootRef.current
    if (!el) return

    const measure = () => {
      const width = el.getBoundingClientRect().width
      // ZERO IS "UNMEASURED", NOT "NARROW". jsdom lays nothing out and reports
      // 0 for every element, and a `display:none` subtree does the same in a
      // real browser. There is no such thing as a 0px workspace; taking that
      // reading would drop a wide screen into the two-column arrangement
      // wherever it is rendered without a layout. Keeping the default is the
      // honest answer to a measurement that did not happen.
      if (width === 0) return
      setWide(width >= RAILS_SPLIT_AT)
    }

    measure()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // THE LEFT RAIL IS THE DRAWER'S ANCHOR, so a workspace with no left rail has
  // no handle -- and a rail you cannot reopen is worse than one that never
  // folds. The right rail is therefore only collapsible in the company of a
  // left one, which is every editor there is: Word passes both, LaTeX passes
  // left alone.
  const drawerOpen = railsOpen || !leftRail
  const showLeftRail = !!leftRail && drawerOpen
  const showRightRail = !!rightRail && drawerOpen

  /**
   * BELOW `RAILS_SPLIT_AT` THE TWO RAILS BECOME ONE COLUMN.
   *
   * THE ARITHMETIC IS WHY. The rails want 880px between them at their proper
   * widths, so on a 1100px window opening both leaves the document 220 -- and
   * now that the zoom actually tracks its well, the page honestly shrinks to
   * fit it. Gabe, 2026-09-13, on seeing that: "another problem", and then the
   * answer: "how about no left and right rails? implement two column layout in
   * smaller laptop screens."
   *
   * SO A SMALL LAPTOP GETS TWO COLUMNS, NOT THREE. One 320px rail carrying
   * both panels, stacked, with the document beside it. That is not a
   * compromise arrangement -- the left rail is a TAB LIST and the right rail
   * is the pane those tabs select, so putting them in one column restores the
   * adjacency they always had in the compact dock, where the same two things
   * are one panel with tabs across the top.
   *
   * Above 1700 there is room for three columns and they separate again, which
   * is the arrangement that wants the width: the posting you are tailoring TO
   * on the left, how well you match it on the right, the document between them.
   */
  const oneColumn = drawerOpen && !wide && !!leftRail && !!rightRail

  const railColumns =
    leftRail && rightRail
      ? !drawerOpen
        ? 'lg:grid-cols-[44px_minmax(0,1fr)]'
        : wide
          ? 'lg:grid-cols-[380px_minmax(0,1fr)_500px]'
          : 'lg:grid-cols-[320px_minmax(0,1fr)]'
      : leftRail
        ? !drawerOpen
          ? 'lg:grid-cols-[44px_minmax(0,1fr)]'
          : wide
            ? 'lg:grid-cols-[380px_minmax(0,1fr)]'
            : 'lg:grid-cols-[320px_minmax(0,1fr)]'
        : rightRail
          ? 'lg:grid-cols-[minmax(0,1fr)_400px]'
          : 'lg:grid-cols-[minmax(0,1fr)]'

  return (
    <div
      ref={rootRef}
      // FULL BLEED AND FULL HEIGHT, NOT A CARD IN A PAGE. It was centred at
      // max-w-1600 inside the app's gutters, so a word processor sat in a
      // reading column -- the one layout Word never has.
      //
      // `h-[100dvh]` with `overflow-hidden` is what makes the DOCUMENT the
      // only thing that scrolls (Gabe, 2026-09-11). Before this the whole page
      // scrolled, so the ribbon and both rails slid away the moment you read
      // past the first screen -- a formatting bar you have to scroll back up
      // to reach is a formatting bar you stop using. `dvh` rather than `vh`
      // because mobile browsers change the viewport as their chrome hides, and
      // `vh` would leave the foot of the document under the address bar.
      //
      // THE LOCKED FRAME IS NOW EVERY WIDTH THIS CHROME RENDERS AT, which it
      // was not until 2026-09-13. It used to lock from `xl` only, because
      // below that the rails stacked into three auto rows inside a fixed
      // height -- which CSS Grid SQUEEZES rather than overflows. Measured at
      // 900x600 back then: the left rail rendered 154px tall instead of its
      // natural 500, so the layout was three crushed strips each with its own
      // scrollbar over a document about 160px tall. The rails collapse instead
      // of stacking now, so there is never a third row to crush and the frame
      // can lock from `lg` -- the `lg:` prefix stays only because this file is
      // still nominally a `lg`-and-up component.
      className="flex w-full flex-col lg:h-[100dvh] lg:overflow-hidden"
      data-document-workspace
    >
      {/*
        WORD'S TITLE BAR, which is what this replaces (Gabe, 2026-09-11:
        "follow the UI of Microsoft Word desktop, file name at the top of the
        toolbar, migrate CTAs to the toolbar itself").

        Before this there were TWO header rows above the ribbon: a back link
        with a kind label, then a large h1 filename with every action ranged
        right. Three stacked bands of chrome before the first formatting
        control, where Word has one. The filename now sits centred in the bar
        as Word puts "Document1", the way out is an icon at the left where
        Word's home button is, and the actions are the quick-access row beside
        it.

        THE FILENAME IS SMALLER THAN IT WAS AND THAT IS DELIBERATE. It was a
        `heading-l` h1, which is a page title; in a word processor the
        document name is a label on the window, not a headline over the
        content. It keeps h1 semantics for screen readers regardless.
      */}
      <div className={cn(
          // `sticky` IS INERT HERE NOW and is kept because it costs nothing to
          // keep and something to rediscover. It mattered while this file had
          // a 1024-1280 arrangement where the whole page scrolled: without it
          // the title bar and the ribbon scrolled away with the document,
          // which is what Gabe saw -- half a ribbon at the top of the window
          // and the actions stranded beside it. The frame is locked at every
          // width this component renders at now, so nothing scrolls past it.
          'sticky top-0 z-30 flex shrink-0 items-center gap-2',
          'border-b border-border-default bg-bg-surface px-4 py-2'
        )}>
        {/* THE WAY OUT KEEPS ITS WORDS (Gabe, 2026-09-11: "do not forget to
            include the redirect button"). The first pass at this bar reduced
            it to a bare chevron because that is what Word's home icon is --
            but Word's icon leads to a file browser everybody already knows,
            and a lone `<` in a web app is a guess. The label shows from `sm`
            and the icon carries it below that, where the bar has no room;
            `aria-label` names it either way, so it is never just an arrow to
            a screen reader. */}
        {/* A BUTTON, NOT A STYLED LINK, WHILE THE MODEL WRITES. `disabled` is
            what a screen reader announces and what the keyboard skips;
            `pointer-events-none` on an anchor only stops the mouse, and the
            link is still tabbable and still followable by Enter. See
            `DocumentWorkspace`'s `polishing` for why leaving is blocked at
            all. */}
        {polishing ? (
          <button
            type="button"
            disabled
            aria-label="back to documents"
            title="Writing your document — this takes a moment"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 's' }),
              'shrink-0 gap-1 px-2'
            )}
          >
            <ChevronLeftIcon size={16} aria-hidden />
            <span className="hidden sm:inline">back to documents</span>
          </button>
        ) : (
        <Link
          href={documentsHref}
          aria-label="back to documents"
          title="back to documents"
          className={cn(
            ICON_MOTION_GROUP,
            buttonVariants({ variant: 'ghost', size: 's' }),
            'shrink-0 gap-1 px-2'
          )}
        >
          <ChevronLeftIcon size={16} aria-hidden className={iconMotion('back')} />
          <span className="hidden sm:inline">back to documents</span>
        </Link>
        )}

        {/* CENTRED, as Word centres "Document1". `min-w-0` on both this and
            the input is what lets a long name ellipsis instead of pushing the
            actions off the bar. */}
        {/* THE KIND LABEL SITS OUTSIDE THE h1, not inside it. An input inside
            a heading contributes its VALUE to the heading's accessible name,
            so a sibling span in there makes the heading announce "LaTeX CV
            WORD" -- which is what broke the route test when this bar was first
            written. The heading names the document and nothing else. */}
        <div className="mx-auto flex min-w-0 items-baseline justify-center gap-2 px-4">
        <h1 className="min-w-0">
          <input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="untitled document"
            aria-label="Document title"
            // `text-ellipsis` on an input is honoured while it is NOT focused,
            // which is exactly what is wanted: a long name reads truncated at
            // rest and gives back the whole string the moment you click in.
            title={displayTitle}
            className={cn(
              'min-w-0 max-w-[22rem] truncate border-0 bg-transparent p-0 text-center',
              'text-body-m font-medium text-text-primary placeholder:text-text-muted',
              'focus:outline-none focus-visible:outline-none',
              // The only chrome it grows: the same 2px accent rule the active
              // nav item and the status marker already use.
              'border-b-2 border-transparent focus:border-accent-default'
            )}
          />
        </h1>
        <span className="shrink-0 text-label-caps uppercase text-text-muted">{kindLabel}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <span className="hidden text-body-s text-text-muted lg:inline">
            {savedLabel}
            {/* "unsaved changes", not "unsaved": the shorter form reads as a
                state the document is in rather than work that is pending, and
                two tests assert the longer one because it is what a person
                needs to see.

                SAVING OUTRANKS IT, being the newer fact -- the write for those
                changes has already started. With the Save button gone this
                line is the editor's only answer to "did that go through", and
                it is now asked by somebody who pressed nothing. */}
            {saving ? (
              <span className="ml-2 text-text-muted">saving</span>
            ) : (
              dirty && <span className="ml-2 text-status-interviewing-mark">unsaved changes</span>
            )}
          </span>
        </div>
      </div>

      <div className="flex flex-col lg:min-h-0 lg:flex-1">
        {/*
          THE RIBBON SITS ON ITS OWN GROUND (Gabe, 2026-09-11: "there is no
          real dividers between components"). A hairline alone was not enough
          separation: the toolbar, the rails and the page were all the same
          off-white, so the chrome read as one undifferentiated field with
          rules drawn through it.

          TONE ALONE WAS NOT ENOUGH, AND THAT IS WORTH MEASURING RATHER THAN
          arguing about. In light mode the three grounds are 255 / 250 / 244 in
          luminance -- five and six units apart, which is very nearly
          invisible and is exactly why the chrome read as one field. In dark
          mode the same tiers are 19 / 28 / 40, nine and twelve apart, where
          the tint genuinely does the work.

          So both: `surface` for the ribbon and rails against `inset` around
          the page, plus `border-border-default` at 212 -- 38 units against
          surface, about seven times the tonal step -- to carry the boundary
          where the tint cannot. The tint is not decorative; it is what makes
          dark mode read without a heavier border.
        */}
        {/* THE CTAs LIVE IN THE RIBBON NOW (Gabe, 2026-09-11: "move the CTAs
            within the toolbar"). They were in the title bar, which left the
            right end of the ribbon empty once the styles gallery stopped
            being capped -- a band of nothing where Word puts its Editing
            group. Putting them here fills that space with the controls a
            person reaches for most, and leaves the title bar doing what
            Word's does: naming the file.

            `ml-auto` rather than a spacer: the ribbon's own bands size
            themselves, and whatever is left over goes to the gap before these.
            */}
        {/* THE ROW RENDERS WHENEVER THERE ARE ACTIONS, not only when there are
            tools. Gating the whole band on `tools` cost the LaTeX editor every
            one of its controls -- it passes no formatting ribbon -- which two
            tests caught immediately. The ribbon half is what is optional. */}
        {(tools || actions || destructiveActions) && (
          <div className={cn(
              // Sits under the title bar when both are stuck. `top-[var()]`
              // would need the bar's measured height; `top-12` is its height
              // at this padding and is close enough that nothing shows through.
              'sticky top-12 z-20 flex shrink-0 items-stretch gap-3',
              'border-y border-border-default bg-bg-surface px-4 py-2.5'
            )}>
            <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">{tools}</div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5 border-l border-border-subtle pl-3">
                            {actions}
              {destructiveActions && (
                <>
                  {/* A real gap, not a bigger margin: the separator says these
                      are a different category of action rather than the end of
                      a row. */}
                  <Separator orientation="vertical" className="mx-1 h-6" />
                  {destructiveActions}
                </>
              )}
            </div>
          </div>
        )}
        {/*
          THREE COLUMNS FROM `lg`, AND A DRAWER. The rails want ~300px each
          beside an 816px page, which is more than a 1366 laptop has to give
          all three at once -- so the answer is which layout is in force rather
          than whether the panels are open. Below `RAILS_SPLIT_AT` of workspace
          both panels share one 320px rail beside the page; above it they take
          a column each. Either way they start open, and the handle on the left
          edge is how the page gets the screen to itself.

          The page itself is a PRINT PROOF, not app chrome: it keeps its own
          white sheet and letter geometry and deliberately does not follow the
          app's theme, because what is on it has to match what comes out of a
          printer.
        */}
        {/* `min-h-0` IS THE LOAD-BEARING HALF of "only the document scrolls".
            A flex child's automatic minimum size is its content height, so
            without this the grid refuses to shrink, the frame grows past the
            viewport and the page scrolls after all -- which is the bug this
            whole layout exists to fix. Each region then scrolls itself. */}
        <div
          className={cn(
            'grid gap-0 lg:min-h-0 lg:flex-1',
            /*
              THE RAILS NO LONGER TRADE AGAINST THE PAGE.

              They did, and the numbers here had been nudged three times by
              2026-09-11 without the tension going anywhere: a letter page is a
              fixed 816px, its well adds 64, so every pixel a rail gained was a
              pixel the page lost. Widening the left rail to 320 would have put
              the page into a sideways scroll at 1366, 1440 and 1536 -- the
              three commonest laptop widths there are.

              `useFitToWidth` removed the constraint rather than balancing it.
              The page now scales to whatever column it is given, as Word's
              zoom does, so a rail can be as wide as it is useful and the page
              still shows whole. These widths are chosen for the CONTENT now:
              the left rail holds an outline, a statistics table with a label
              and a figure on one line, and the tab list; the right holds an
              ATS ring, two keyword lists, rewrites and the thesaurus.

              Which is also why collapsing is a TOGGLE and not a narrower rail:
              there is no width at which this content is merely smaller. It is
              either there at the width it needs or it is out of the way.
            */
            railColumns
          )}
        >
          {leftRail && (
            <Rail
              id={LEFT_RAIL_ID}
              side="left"
              open={showLeftRail}
              column="lg:col-start-1"
              onToggle={() => setRailsOpen((value) => !value)}
              label={oneColumn ? 'document tools & tailoring' : 'document tools'}
            >
              {/* STRIP, THEN WHAT IT SELECTS, THEN THE REST. In one column the
                  pane has to follow the tabs immediately or the click reads as
                  having done nothing; the outline and the statistics are
                  reference material and can sit under both.

                  THE SECOND PANEL IS MOUNTED HERE, not merely moved: crossing
                  1700 re-parents it, which React answers with a remount -- and
                  that is survivable only because the tailoring state lives up
                  in the editor and is handed down as props. If a pane ever
                  grows state of its own, this is the line that spends it. */}
              {/* THE STRIP FOLLOWS THE ARRANGEMENT: a vertical list while it
                  has a column to itself, one 45px row while it is sharing one
                  with the pane it opens. See railLayout.tsx. */}
              <RailLayoutProvider layout={oneColumn ? 'row' : 'column'}>
                {railNav}
              </RailLayoutProvider>
              {oneColumn && rightRail}
              {leftRail}
            </Rail>
          )}
          {/* `id` IS LOAD-BEARING: the formatting ribbon points at this region
              with `aria-controls`, which is what tells a screen reader that a
              toolbar in the chrome above formats the document down here. A
              dangling reference would be worse than none. */}
          <div
            id="document-sheet"
            className={cn(
              // GENEROUS ROOM UNDER THE LAST PAGE (Gabe: "no space at the
              // bottom"). The well's own padding put 32px under the sheet,
              // which reads as the document being cut off rather than ended --
              // Word leaves most of a screen below the final page. `pb-24`
              // is that breathing room.
              'min-w-0 overflow-x-auto bg-bg-inset p-4 pb-24 md:p-8 md:pb-24',
              'lg:overflow-auto',
              /* PLACED EXPLICITLY, NOT LEFT TO AUTO-PLACEMENT, and that is not
                 tidiness. An overlaid rail is `position: absolute` and so out
                 of flow, which leaves the grid ONE in-flow child -- and auto
                 placement duly put the document in the drawer's 44px track.
                 Measured: the page wrapper reported a clientWidth of 0 with
                 the drawer open, which `useFitToWidth` correctly refused to
                 believe, so the page kept its old zoom and hung 784px past its
                 own well. The column a thing belongs in does not depend on how
                 many of its siblings happen to be floating. */
              leftRail ? 'lg:col-start-2' : 'lg:col-start-1'
            )}
          >
            {children}
          </div>
          {rightRail && !oneColumn && (
            <Rail
              id={RIGHT_RAIL_ID}
              side="right"
              open={showRightRail}
              column={leftRail ? 'lg:col-start-3' : 'lg:col-start-2'}
              label="tailoring"
            >
              {rightRail}
            </Rail>
          )}
        </div>
      </div>

      {footnote && (
        <div className="shrink-0 border-t border-border-default bg-bg-surface px-3 py-1 text-body-s text-text-muted">
          {footnote}
        </div>
      )}
    </div>
  )
}
