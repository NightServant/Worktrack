'use client'

import * as React from 'react'
import Link from 'next/link'
import { CheckIcon, DocumentsIcon, MenuIcon, MonitorIcon } from '@/components/icons'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { RailLayoutProvider } from './railLayout'
import { DocumentViewProvider, type DocumentView } from './documentView'
import type { DocumentWorkspaceProps } from './DocumentWorkspace'

/**
 * The editor below `lg`, modelled on Word for Android (Gabe, 2026-09-06):
 * a centred document name, a slim command row, a full-bleed canvas, and the
 * working surfaces docked to the bottom where a thumb reaches them.
 *
 * A SEPARATE COMPONENT SINCE 2026-09-11, when DocumentWorkspace was 533 lines.
 * The seam is the one the file already had: it was two complete chromes with
 * `if (compact) return` between them, ~250 lines each, sharing only the props
 * and the decision. Nothing here is referenced by the desktop tree and nothing
 * there is referenced by this one.
 *
 * THE CHOICE STAYS IN JS RATHER THAN `lg:` CLASSES, which is why these are two
 * components and not one with responsive utilities. Both chromes need
 * `actions`, `tools` and the rails, and those are interactive controls;
 * rendering both trees would put two of every button in the accessibility tree
 * and two of every match in a test's `getByRole`. One tree. See
 * `DocumentWorkspace` for the switch and `useBelowDesktop` for why it defaults
 * to desktop.
 *
 * WHAT CHANGED ON 2026-09-13 (Gabe: "relocate tools and toolbar in tablet
 * mobile view -- my suggestion is proper tab navigation"):
 *
 * 1. THE TAILORING BOTTOM SHEET IS GONE. There was an `AnalyticsIcon` in the
 *    command row that opened a sheet holding the two rails as two pill tabs.
 *    It worked, and it was still wrong: a sheet is a modal interruption, and
 *    the posting and the match score are surfaces you work IN -- you read a
 *    requirement, then edit the document, then read the next one. Every one of
 *    those turns cost a dismiss and a re-open, and while the sheet was up the
 *    document was behind a scrim and untouchable.
 *
 * 2. THE PINNED FORMATTING BAR IS GONE TOO, into the same dock. It was the
 *    only surface with a permanent claim on the screen -- 52px of ribbon under
 *    every document whether or not anybody was formatting.
 *
 * 3. BOTH ARE NOW TABS OF ONE DOCKED PANEL, closed by default. The document is
 *    what somebody opened this screen for, so nothing covers it until it is
 *    asked for, and tapping the open tab again gives the whole screen back.
 *
 * The overflow sheet STAYS, with the `MenuIcon` that opens it. Save, export,
 * reset and delete are commands -- you fire one and it is over -- and a modal
 * list you dismiss is exactly right for that. Only the surfaces moved.
 */

/**
 * The value the controlled `Tabs` carries when nothing is open.
 *
 * NO `TabsContent` MATCHES IT, which is the entire trick: base-ui marks every
 * non-current panel `inert`, so with the value parked on a sentinel all of
 * them are inert and the dock is just its strip. The alternative -- unmounting
 * the `Tabs` or conditionally rendering the panel -- would drop the ribbon's
 * and the rails' internal state every time the panel was closed.
 */
const NO_PANEL = 'none'

/**
 * THE ACTIVE MARKER IS OURS, NOT THE `line` VARIANT'S, and that is a fix
 * rather than a preference. The variant draws its own marker at
 * `bottom:-5px` in the FOREGROUND colour: five pixels outside the trigger's
 * box, where a dock that carries its own border clips it, and in a neutral
 * that is invisible against the list's own hairline. This is the same
 * treatment `ApplicationRecordView` arrived at -- the variant's `::after`
 * switched off, ours drawn at `bottom-0` in `accent-default`.
 *
 * `h-11` and `flex-1`: 44px is the thumb target floor, and equal thirds across
 * the foot of the screen is what a dock is. (`ApplicationRecordView` uses
 * `flex-none` for the opposite reason -- there the tabs are a heading row
 * inside a wide panel, not a nav bar.)
 */
const TAB = cn(
  'relative h-11 flex-1 rounded-none border-0 px-2 text-body-m',
  'transition-colors duration-(--duration-fast)',
  'text-text-muted hover:text-text-primary',
  'data-active:bg-transparent data-active:text-text-primary data-active:shadow-none',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default',
  // The variant's own marker off, and ours on the foot of the trigger.
  'after:hidden',
  'data-active:after:absolute data-active:after:inset-x-0 data-active:after:bottom-0',
  'data-active:after:block data-active:after:h-[2px] data-active:after:bg-accent-default'
)

/**
 * HOW TALL THE PANEL MAY RISE. Roughly half the screen: enough for a dozen
 * rail rows while leaving the document visible above it -- which is the whole
 * difference between this and the sheet it replaced. `svh` rather than `vh` so
 * the panel does not sit under mobile Safari's toolbar when it is expanded.
 *
 * A CAP, NOT A HEIGHT, SINCE 2026-09-13. It was `h-[45svh]`, and a fixed
 * height on a dock that holds three surfaces of three different sizes is a
 * promise only the tallest of them can keep. Measured at 390x844 with
 * `format` open: a 379px panel over a 94px toolbar -- 261px of nothing, under
 * controls, above a document that wanted the room. Now the panel is as tall as
 * what is in it, and no taller than this.
 *
 * IT IS STILL A CAP THE FORMAT PANEL HITS ON A PHONE, and the arithmetic says
 * it always will: `@media (pointer: coarse)` puts a 44px floor under every
 * button (index.css, and it is not negotiable -- it is the thumb), so the four
 * stacked bands come to 468px of controls and captions. At 390x844 that is
 * 492px of content against a 380px cap: full, and scrolling 113px, where
 * before it was 118px of content in the same box with three bands missing. At
 * 768x1024 it fits exactly -- 442px of content, 442px of panel, nothing
 * scrolls. Raising the cap for the phone was considered and dropped: the point
 * of the dock is that the document stays visible above it.
 *
 * `flex-none` IS LOAD-BEARING and stays. The vendored `TabsContent` ships
 * `flex-1`, which is `flex-basis: 0%` -- on the main axis of this column that
 * beats any height the content computes, so the panel would take whatever the
 * flex line had going spare rather than what it needs.
 */
const PANEL =
  'max-h-[45svh] flex-none overflow-y-auto border-t border-border-subtle px-3 py-3'

export function CompactDocumentChrome({
  // `kindLabel` and `footnote` are deliberately not destructured: this chrome
  // shows no breadcrumb and no footnote. They stay on the shared props type
  // because the desktop chrome does use them.
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
  paged = false,
  children,
}: DocumentWorkspaceProps) {
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [panel, setPanel] = React.useState<string>(NO_PANEL)
  /**
   * SCROLL VIEW IS THE DEFAULT (Gabe, 2026-09-13). A letter sheet is 816px
   * wide; fitted to a 375px phone that is a zoom of 0.46, which puts 11pt body
   * text at about 5pt on glass. Print layout is a proof -- it answers "what
   * will come out of the printer" -- and nobody asks that question on a phone
   * before they have asked "what does it say".
   */
  const [view, setView] = React.useState<DocumentView>('scroll')
  const displayTitle = title.trim() || 'untitled document'

  /**
   * A TAB PER SURFACE THE CALLER ACTUALLY PASSED, and none for the ones it
   * did not. The LaTeX editor hands over no `tools` and no `rightRail`, so its
   * dock is a single tab rather than three, two of which would open an empty
   * panel.
   *
   * AN HONEST WART: the labels are fixed to the slot, and the LaTeX editor
   * puts its tailoring rail in `leftRail` (deliberately -- see the "ONE RAIL,
   * ON THE LEFT" note in that file), so over there the one tab reads `outline`
   * above a tailoring panel. Not fixed here, because which rail a document
   * uses is the editor's decision and this chrome has no way to ask.
   *
   * THE STACKED TOOLBAR IS NOT SWITCHED ON HERE EITHER, and it cannot be. `tools`
   * arrives as an already-built `ReactNode` -- the same seam `documentView`
   * describes -- so the only way this file could hand `DocumentToolbar` its
   * `layout` is `cloneElement`, which would inject an unknown `layout` prop
   * into whatever the caller passed. The tests pass a bare `<button>` as
   * `tools`; that would be a React DOM warning for every one of them.
   *
   * So the editor decides, from the same `useBelowDesktop()` it already asks
   * for other reasons -- see `WordResumeEditor`, which passes
   * `layout={compact ? 'stacked' : 'ribbon'}`. What this file owns is the box:
   * a capped, content-sized panel (`PANEL` above) is what makes a toolbar that
   * no longer lies about its height visible as one.
   */
  const surfaces: { id: string; label: string; node: React.ReactNode }[] = []
  if (tools) surfaces.push({ id: 'format', label: 'format', node: tools })
  if (leftRail) surfaces.push({ id: 'outline', label: 'outline', node: leftRail })
  if (rightRail)
    surfaces.push({
      id: 'tailor',
      label: 'tailor',
      // THE STRIP TRAVELS WITH THE PANE, not with the outline. `railNav` is
      // what chooses which pane this tab shows, so putting it anywhere else
      // leaves this surface with no way to switch and the `outline` tab
      // holding a control for a panel you cannot see while using it.
      node: (
        <div className="flex flex-col gap-3">
          {/* ALWAYS A ROW HERE. The panel is capped at `PANEL`'s max height and
              already scrolls when the ribbon is in it, so the ~120px a vertical
              strip costs comes straight off the pane it introduces. */}
          <RailLayoutProvider layout="row">{railNav}</RailLayoutProvider>
          {rightRail}
        </div>
      ),
    })

  return (
    // `fixed inset-0`, so the editor really is the whole viewport rather
    // than a tall page inside the shell's gutters. AppShell has already
    // dropped the sidebar, the bottom nav AND the top bar in response to
    // `useDocumentFocus()`, so there is nothing underneath this to escape.
    <div
      data-document-workspace
      data-compact
      className="fixed inset-0 z-30 flex flex-col bg-bg-canvas"
    >
      {/* THE NAME, CENTRED, exactly as Word does it -- the document names
          the screen, and there is no room at this width for a breadcrumb
          path as well. Still the h1, still typed into in place. */}
      <div className="flex h-11 shrink-0 items-center justify-center border-b border-border-subtle px-12">
        <h1 className="min-w-0 max-w-full">
          <input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="untitled document"
            aria-label="Document title"
            title={displayTitle}
            className={cn(
              'w-full min-w-0 truncate border-0 bg-transparent p-0 text-center text-body-m text-accent-default',
              'placeholder:text-text-muted focus:outline-none focus-visible:outline-none'
            )}
          />
        </h1>
      </div>

      {/* THE COMMAND ROW. Done on the left as Word puts its tick there;
          state in the middle, where it is read rather than tapped; the
          overflow on the right.

          IT IS ONE BUTTON SHORTER THAN IT WAS. The `AnalyticsIcon` that
          opened the tailoring sheet stood here, and the reason it existed --
          that tailoring and the CV check must not be buried three taps deep
          under a `...` -- is now served better by a permanent tab in the
          dock, which names the surface rather than hiding it behind a glyph. */}
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border-subtle px-1">
        {/* See `DesktopDocumentChrome`: a disabled button rather than an
            anchor with the pointer turned off, because only one of those is
            actually unreachable. */}
        {polishing ? (
          <button
            type="button"
            disabled
            aria-label="Done"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-text-muted"
          >
            <CheckIcon size={20} aria-hidden />
          </button>
        ) : (
        <Link
          href={documentsHref}
          aria-label="Done"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-text-primary hover:text-accent-default"
        >
          <CheckIcon size={20} aria-hidden />
        </Link>
        )}

        <p className="min-w-0 flex-1 truncate px-1 text-caption text-text-muted">
          {savedLabel}
          {/* SAVING OUTRANKS UNSAVED, because it is the newer fact: the write
              for those changes has started. Showing both would be two labels
              for one state on a bar this narrow. */}
          {saving ? (
            <span className="ml-2 text-text-muted">saving</span>
          ) : (
            dirty && <span className="ml-2 text-status-interviewing-mark">unsaved</span>
          )}
        </p>

        <button
          type="button"
          aria-label="More actions"
          onClick={() => setSheetOpen(true)}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-text-primary hover:text-accent-default"
        >
          <MenuIcon size={20} aria-hidden />
        </button>
      </div>

      {/* THE CANVAS, full bleed and the only thing that scrolls.

          THE FLOATING TOGGLE IS POSITIONED AGAINST THIS BOX, not against the
          viewport, and that is what keeps it off the dock for free: the canvas
          ends where the dock begins, so `bottom-4` is 16px above the strip
          when the panel is closed and 16px above the PANEL when it is open,
          with no measurement of either. `pb-safe` lives on the strip, so the
          home indicator is already accounted for below all of this. */}
      <div className="relative min-h-0 flex-1">
        <div data-document-canvas className="h-full overflow-auto">
          {/* `paged ? view : 'print'`, so the state and the control agree.
              Without `paged` there is no toggle, and reporting `scroll` to a
              canvas nobody can switch back would hand a future consumer a
              value it has no way to change. Print is the "unchanged" answer,
              which is what the desktop chrome gives by providing nothing. */}
          <DocumentViewProvider view={paged ? view : 'print'}>{children}</DocumentViewProvider>
        </div>

        {/* ONLY WHERE THERE IS PAPER TO TOGGLE. The LaTeX editor's canvas is a
            source pane and a compiled PDF in an <iframe> -- neither has a page
            geometry, a zoom or a page break to suppress -- so it passes no
            `paged` and gets no button rather than a control that does nothing.

            THE GLYPH IS THE DESTINATION, NOT THE STATE: it shows the view you
            will land in, which is what makes a one-button toggle readable
            without a label. A page for print, a screen for scroll -- the two
            nearest things in the icon set, and nothing was drawn for this. */}
        {paged && (
          <button
            type="button"
            aria-label={view === 'scroll' ? 'Switch to print view' : 'Switch to scroll view'}
            data-document-view={view}
            onClick={() => setView(view === 'scroll' ? 'print' : 'scroll')}
            className={cn(
              'absolute bottom-4 right-4 z-10 grid h-12 w-12 place-items-center rounded-full',
              // A HAIRLINE CIRCLE, NOT A MATERIAL FAB. This system has three
              // shadows in the whole codebase; it separates with rules. The
              // border is `strong` rather than `subtle` because this floats
              // over the document's own white sheet, where a neutral-200
              // hairline disappears.
              'border border-border-strong bg-bg-canvas text-text-primary',
              'transition-colors duration-(--duration-fast) hover:text-accent-default',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default'
            )}
          >
            {view === 'scroll' ? (
              <DocumentsIcon size={20} aria-hidden />
            ) : (
              <MonitorIcon size={20} aria-hidden />
            )}
          </button>
        )}
      </div>

      {/* THE DOCK. One panel, one tab per surface, closed until asked for.
          `gap-0` because the root ships `gap-2` and an 8px stripe of canvas
          between the panel and its own tab strip reads as a rendering fault. */}
      {surfaces.length > 0 && (
        <Tabs
          value={panel}
          // Opening is base-ui's job: its Tab guards on `!active`, so this
          // fires for every tab EXCEPT the one already open.
          onValueChange={(next) => setPanel(String(next))}
          data-document-dock
          className="shrink-0 gap-0 bg-bg-canvas"
        >
          {/* THE PANEL IS BEFORE THE STRIP IN THE DOM because it is above it
              on screen, and reading order should agree with paint order on a
              surface where both are visible at once. */}
          {surfaces.map((surface) => (
            <TabsContent key={surface.id} value={surface.id} className={PANEL}>
              {surface.node}
            </TabsContent>
          ))}

          {/* `group-data-[orientation=horizontal]/tabs:h-auto` RATHER THAN
              `h-auto`. The list's own `h-8` is written with that group
              modifier, and a plain `h-auto` passed in through className is a
              less specific selector that loses to it -- so the dock silently
              rendered 32px tall with 44px triggers overflowing it. Matching
              the modifier lets tailwind-merge displace the class instead of
              fighting it. */}
          <TabsList
            variant="line"
            className={cn(
              'w-full shrink-0 gap-0 rounded-none border-t border-border-subtle p-0 pb-safe',
              'group-data-[orientation=horizontal]/tabs:h-auto'
            )}
          >
            {surfaces.map((surface) => (
              <TabsTrigger
                key={surface.id}
                value={surface.id}
                className={TAB}
                // CLOSING IS OURS. base-ui never re-commits the value that is
                // already current, so `onValueChange` cannot say "the open tab
                // was tapped again" -- it simply does not fire. Compared
                // against the value from THIS render rather than through a
                // functional update, because on a tab that is not open the
                // library's handler has already queued the new value and a
                // functional updater would read it and close what it just
                // opened.
                onClick={() => {
                  if (panel === surface.id) setPanel(NO_PANEL)
                }}
              >
                {surface.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        {/* `pb-safe` on the CONTENT, not on the last child: the sheet is
            flush to the bottom edge, so on a device with a home indicator
            the final action sat under it -- which is what cut `delete` off.
            A capped height plus its own scroll keeps a long action list
            reachable instead of pushing the top of the sheet off-screen. */}
        <SheetContent side="bottom" className="max-h-[80svh] overflow-y-auto pb-safe">
          <SheetHeader>
            <SheetTitle>{displayTitle}</SheetTitle>
          </SheetHeader>
          {/* EVERY DESKTOP ACTION, none dropped. Save, export, reset,
              versions and delete all arrive as the caller passed them;
              this sheet only decides where they sit. Destructive stays
              separated by a rule, as it is on desktop. */}
          {/* COLUMNS AND ROWS, NOT ONE TALL COLUMN (Gabe, 2026-09-06).
              Six full-width actions stacked came to roughly 400px of
              sheet over a document the reader was in the middle of --
              the menu was bigger than the thing it belonged to. Two per
              row halves that at no cost: none of these labels needs a
              full phone width, and the pairs read as what they are
              (`export .docx` beside `export PDF`).

              Centred inside each cell, per Gabe's earlier note. Sizing
              happens HERE rather than in the caller, so the desktop
              action bar -- the same nodes, in a row, at natural width --
              is untouched. */}
          <div
            className={cn(
              // ONE COLUMN ON A PHONE, TWO FROM `sm` (Gabe,
              // 2026-09-06). The pairing is a tablet win and a phone
              // loss: at 390px two columns leave each action about
              // 175px, which is cramped for `export .docx` and puts two
              // 44px targets side by side under one thumb. The tablet
              // has the width to spend and the sheet is what needed
              // shortening there.
              // ONE COLUMN ON A PHONE, EIGHT TRACKS FROM `sm`.
              //
              // The point of a track count larger than the number of
              // cells is that the sheet can hold two row shapes without
              // a second grid: peers at two tracks each on one row, then
              // save and delete at half a row each (Gabe, 2026-09-06).
              // Three tracks cannot express halves at all, which is why
              // this has never been `grid-cols-3` with a span.
              //
              // EIGHT RATHER THAN SIX SINCE 2026-09-17, when `.tex`
              // joined the compact row and made the caller's first row
              // four cells -- reset and three exports. Six fitted three
              // exactly and had nowhere to put a fourth: it wrapped onto
              // save's row, leaving a track of nothing and pushing
              // delete onto a third row of its own.
              'grid grid-cols-1 gap-2 px-4 pb-4 sm:grid-cols-8',
              'sm:[&>button]:col-span-2',
              '[&_button]:w-full [&_button]:justify-center',
              // EVERY ACTION IS A TILE. The caller ranks these for a
              // desktop bar, where a row of mostly-ghost buttons is
              // correct: they sit on one line, separated by their own
              // spacing, and only Save is meant to carry weight. Stacked
              // in a sheet that ranking reads as chaos -- `reset` and
              // `export .docx` had no boundary at all, so two of the six
              // items looked like captions rather than controls.
              //
              // A hairline and a 44px floor on all of them, and nothing
              // else: BACKGROUND IS DELIBERATELY NOT SET HERE, because
              // this arbitrary-variant selector outranks a utility class
              // and would repaint Save's accent fill and flatten the
              // exact ranking worth keeping.
              '[&_button]:min-h-11 [&_button]:rounded-md [&_button]:border [&_button]:border-border-subtle',
              // SAVE TAKES HALF THE ROW, and delete the other half. The
              // caller ranks save last, so among the grid's direct
              // <button> children it is the final one -- delete is
              // nested in its own div and is not one of them.
              'sm:[&>button:last-of-type]:col-span-4',
              // Anything a caller passes that is not a <button> still
              // has to fill its cell rather than keep its own width.
              '[&_[data-slot=select-trigger]]:w-full [&_[data-slot=select-trigger]]:justify-center'
            )}
          >
            {actions}
            {destructiveActions && (
              <>
                {/* Full-width, and after a rule: a destructive action
                    does not share a row with a save. */}
                {/* NO SEPARATOR FROM `sm`, and that is a real trade.
                    Desktop keeps its vertical rule because a destructive
                    action does not belong beside a save -- but Gabe
                    asked for these two to share a row here, and a rule
                    between two cells of the same row would have to break
                    the row to draw. What still tells them apart is the
                    ranking the caller already gives them: save is the
                    only filled control in the sheet, delete is a ghost
                    with a trash glyph. The phone keeps the rule, because
                    there the two are stacked and it costs nothing. */}
                <Separator className="my-1 sm:hidden" />
                <div className="sm:col-span-4">{destructiveActions}</div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
