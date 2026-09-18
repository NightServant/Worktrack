'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import type { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import type { DialogRootChangeEventReason } from '@base-ui/react/dialog'
import { icons, type IconName } from '@/components/icons'
import { cn } from '@/lib/utils'

/**
 * The system's own chrome over shadcn's `Dialog`, for every screen surface
 * that needs a modal -- the application record, the application form and the
 * new-CV mode chooser.
 *
 * There is no dialog frame anywhere in the Figma file: searching every screen
 * frame's layer names for `dialog|modal|overlay|drawer|sheet` returns
 * nothing. The one thing the design says about dialogs is the Motion
 * Specification row `smooth caret` (`43:571`), whose "where" cell reads "auth,
 * add job dialog" -- confirming one was intended, but not drawing it. So the
 * chrome here is derived from the rest of the system rather than transcribed
 * from a frame: `bg-bg-canvas`, a hairline `border-border-subtle`, `rounded-md`
 * (the 4px cap), no drop shadow, and a hairline rule under the title in place
 * of shadcn's default rounded, shadowed popup chrome.
 *
 * THE HEADER GREW TWO SLOTS for the application record, which puts company,
 * role, status and the record's actions in one bar:
 *
 * - `eyebrow` sits ABOVE the title. It is where the record's company and
 *   status marker go. Above rather than beside, because the title is the
 *   thing being named and a status rule sharing its line competes with it.
 * - `actions` sits opposite the title. It is padded clear of shadcn's own
 *   close button, which `DialogContent` pins at `top-2 right-2` -- these
 *   would otherwise sit underneath it.
 *
 * `title` widened from `string` to `ReactNode` at the same time. It still
 * renders inside `DialogTitle`, so whatever goes in is still the dialog's
 * accessible name; passing a node that contains no text would take that name
 * away, which is the one thing a caller must not do here.
 *
 * `icon` IS OUTSIDE `DialogTitle`, as a sibling (2026-09-05, Gabe's ask for
 * icons on dialog headings). NOT because it would otherwise change the
 * accessible name -- it would not, and an earlier draft of this note claimed
 * so wrongly: these glyphs render an `<svg>` with no text, so a screen reader
 * gets the same name either way. Verified by moving it inside and watching
 * `getByRole('dialog', { name })` still pass.
 *
 * The reasons it is outside are smaller and real. `DialogTitle` carries the
 * type scale, and a glyph inheriting `heading-m`'s line-height sits wrong
 * against its own box. And the title node's content stays exactly the node the
 * caller passed, which is what keeps `title` a string a test or a future
 * feature can read back.
 *
 * 18px, not 16: a dialog heading is heading-m and the glyph is read at arm's
 * length from the rest of the screen, with nothing else competing for the
 * line. `mt-0.5` sits it on the cap height rather than the box.
 */
export interface AppDialogProps {
  open: boolean
  /**
   * `reason` IS BASE UI'S OWN, PASSED STRAIGHT THROUGH, and it is here for one
   * caller: the application record, which reads a posting in a second panel of
   * this same dialog and has to tell `Escape from the posting` (go back) from
   * `Escape from the record` (close, after the discard guard). Every other
   * caller takes one argument and is unaffected.
   *
   * Not `event`, not the whole details object: a reason is a string a caller
   * can compare, and handing out `cancel()` would let a caller keep a dialog
   * open behind Base UI's back.
   */
  onOpenChange: (open: boolean, reason?: DialogRootChangeEventReason) => void
  title: React.ReactNode
  /** A muted glyph before the title, outside its accessible name. */
  icon?: IconName
  description?: string
  /** Rendered above the title. Metadata about the thing being shown, not a second heading. */
  eyebrow?: React.ReactNode
  /** Rendered opposite the title, clear of the built-in close button. */
  actions?: React.ReactNode
  /**
   * `m` is 480px (the mode chooser); `l` is 720px (the add wizard's first two
   * steps); `xl` is 1280px -- the whole application record.
   *
   * 1280 IS THE STANDARD LARGE CONTAINER and that is the argument for it
   * (Gabe, 2026-09-13: "reduce the overall width of the application dialog,
   * align to the standard format for large dialogs"). It is Tailwind's
   * `max-w-7xl`, the width every other wide surface in this app tops out at,
   * and the point at which a centred dialog stops reading as a page with a
   * border round it.
   *
   * THE ROUTE HERE WAS 1040 -> 1400 -> 1680 -> 1280, and the overshoot is
   * worth recording because each step was answering a real complaint with the
   * wrong lever. 1040 gave a three-column record 300px columns; 1400 fixed
   * that; 1680 was bought to make a two-up FORM legible and to fill a
   * newspaper-column posting. Both of those are gone -- the form is one column
   * again and the posting is a document -- so the width they were paying for
   * went with them.
   *
   * IT IS A CEILING, NOT A WIDTH. `sm:w-[calc(100%-2rem)]` below still caps it
   * at the viewport, so a 1280px laptop gets 1248 and nothing overflows.
   */
  size?: 'm' | 'l' | 'xl'
  /**
   * Whether the dialog BODY owns the scrolling. Default true.
   *
   * `false` hands it to the child instead, which is what a dialog with fixed
   * chrome inside it needs: the application record keeps its pipeline bar and
   * its Save row still while only the three columns move, and it cannot do
   * that if the body scrolls the lot.
   *
   * FROM `sm` UP ONLY. Below 640 this dialog is a bottom sheet and its content
   * stacks -- the record's pipeline becomes a 299px column, and freezing that
   * as chrome leaves a phone almost nothing to read the record in. There, the
   * body goes back to scrolling the lot.
   */
  bodyScroll?: boolean
  /**
   * The hairline between the header and the body.
   *
   * On by default, because a title sitting straight on a form needs the
   * division. Off for the two dialogs that open with a progress tracker: the
   * run of nodes IS a horizontal band under the title, and a rule immediately
   * above it drew two parallel lines a few millimetres apart.
   */
  headerSeparator?: boolean
  /**
   * Where focus goes when this dialog closes, passed straight to Base UI.
   *
   * IT EXISTS FOR A DIALOG THAT CREATES THE THING YOU THEN WORK IN. Base UI's
   * default is right nearly everywhere -- focus returns to whatever opened the
   * dialog -- and wrong for the posting's `name the section` step, whose whole
   * result is a new field that mounts as this closes. There the default put
   * focus on a control BEHIND the record dialog, which is a keyboard user
   * outside the modal they are still in.
   *
   * A function rather than a ref, because the element it names does not exist
   * until the close commits it. Returning `null` falls back to the default,
   * which is the honest answer when the thing was not created after all.
   */
  finalFocus?: DialogPrimitive.Popup.Props['finalFocus']
  children: React.ReactNode
}

const MAX_WIDTH = {
  m: 'sm:max-w-[480px]',
  l: 'sm:max-w-[720px]',
  xl: 'sm:max-w-[1280px]',
} as const

export function AppDialog({
  open,
  onOpenChange,
  title,
  icon,
  description,
  eyebrow,
  actions,
  size = 'm',
  bodyScroll = true,
  headerSeparator = true,
  finalFocus,
  children,
}: AppDialogProps) {
  const Icon = icon ? icons[icon] : null
  return (
    <Dialog open={open} onOpenChange={(next, details) => onOpenChange(next, details.reason)}>
      <DialogContent
        finalFocus={finalFocus}
        className={cn(
          'gap-0 border border-border-subtle bg-bg-canvas p-0 ring-0',
          // BOTTOM SHEET below 640. A centred dialog inset 16px each side is
          // the desktop shape shrunk, and on a phone it wastes the two edges
          // the thumb can actually reach while putting the close button at the
          // top of the screen. Anchored to the bottom instead: full width, top
          // corners rounded, no bottom border (it is the screen edge), and
          // `dvh` rather than `vh` so the browser's own collapsing chrome is
          // not counted twice.
          //
          // `flex flex-col` replaces DialogContent's `grid`: the header is
          // fixed and the body scrolls, and that needs a `flex-1 min-h-0`
          // child, which a grid row does not give.
          'inset-x-0 bottom-0 left-0 top-auto flex max-h-[92dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-md rounded-b-none border-b-0',
          // From 640 up it is a centred dialog again, unchanged.
          'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85vh] sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-md sm:border-b',
          // NINETY-TWO FOR `xl` ONLY, and tied to the size rather than to a
          // prop because `xl` has exactly one caller: the application record.
          // Its first column is a form of ten fields, and at 85vh on a 900px
          // laptop the last two sat under the fold -- so the column Gabe edits
          // in scrolled while the two beside it had room to spare. The extra
          // 7vh is about 63px there, which is the two fields. The sheet below
          // 640 is already 92dvh, so this only brings the desktop into line
          // with it.
          size === 'xl' && 'sm:max-h-[92vh]',
          MAX_WIDTH[size]
        )}
      >
        <DialogHeader className="shrink-0 gap-0 p-gutter pb-3">
          {eyebrow && <div className="mb-2 pr-8">{eyebrow}</div>}
          <div className="flex items-start justify-between gap-6">
            <div className="flex min-w-0 items-start gap-2.5">
              {Icon && (
                <Icon size={18} aria-hidden className="mt-0.5 shrink-0 text-text-muted" />
              )}
              <DialogTitle className="text-heading-m text-text-primary">{title}</DialogTitle>
            </div>
            {actions && <div className="shrink-0 pr-8">{actions}</div>}
          </div>
          {description && (
            // `max-w-prose`, because `xl` is 1400px wide and a description is
            // prose: unconstrained it runs a single 190-character line that
            // the eye loses its place in on the way back. `mt-2` so it reads
            // as the title's subtitle rather than as the next thing along.
            <DialogDescription className="mt-2 max-w-prose text-body-s text-text-muted">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        {/* OPT-OUT (Gabe, 2026-09-11: "remove the separator between the
            component title and pipeline workflow"). A dialog that opens with a
            progress tracker already has a horizontal band under its title --
            the run of nodes and connectors -- and a hairline immediately above
            it drew two parallel lines two millimetres apart. Every other
            dialog keeps it: a title sitting straight on a form needs the
            division. */}
        {headerSeparator && <Separator className="shrink-0" />}
        {/* `flex-1 min-h-0` rather than a second viewport calculation. The old
            `max-h-[calc(85vh-6rem)]` had to guess the header's height, and the
            guess was wrong for any dialog whose header wrapped to two lines or
            carried an eyebrow -- and wrong again for the sheet, which is 92dvh.
            Letting the container own the height and this child own the scroll
            is right at every height without arithmetic. `min-h-0` is what
            allows a flex child to shrink below its content and actually
            scroll. */}
        {/* `pt-3` rather than the gutter's 32px, so the rule above sits EVENLY
            between the header and the content: the header closes on `pb-3` and
            this opens on the same 12px.
            
            TWELVE, NOT SIXTEEN, AND NOT THIRTY-TWO (Gabe, 2026-09-10, twice:
            "padding is still there"). A divider is a hairline between two
            blocks, not a band of its own -- the space around it only has to be
            enough to stop the rule touching type, and a text block's own
            descender already contributes a few pixels on the upper side. */}
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto p-gutter pt-3',
            // A CHILD THAT OWNS THE SCROLLING OWNS THE BOTTOM EDGE TOO. The
            // record ends in an action bar that runs to the dialog's edge, and
            // 32px of body padding under it is 32px of nothing between the
            // button and the frame. The bar sets its own.
            !bodyScroll && 'pb-0 sm:flex sm:flex-col sm:overflow-hidden'
          )}
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}
