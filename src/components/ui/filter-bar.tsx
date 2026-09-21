'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'
import type { IconName } from '@/components/icons'

/**
 * The row of narrowing controls that sits above a list: one search box, then
 * the dropdowns (Gabe, 2026-09-15: "fresh remote jobs, templates and files
 * section (search bar and dropdown) -- implement a new row/section containing
 * that components. Make sure that these components are responsive across all
 * screens").
 *
 * WHAT IT REPLACES. Three sections had already grown the same pair -- the
 * template gallery, the documents list, and the remote-roles rail (dropdowns
 * only) -- and each had built it by hand. They agreed on the idea and
 * disagreed on every number: `w-52` against `w-56` against `w-48`, `gap-3`
 * against `gap-2`, `max-sm:w-full` on the wrapper in two of them and on the
 * inner div in the third. None of that was decided; each was whatever looked
 * right the day that section was written.
 *
 * IT IS A ROW OF ITS OWN, NOT A CLUSTER ON THE HEADING'S ROW (Gabe,
 * 2026-09-15: "implement a new row containing that components"). That is a
 * second pass over the same three sections: the first one unified the controls
 * and left them where they had always been, tucked against the right-hand end
 * of the line the heading starts. Three things were wrong with that, and only
 * the third is obvious from a screenshot.
 *
 *   THE HEADING ROW WAS DOING TWO JOBS. "fresh remote roles" plus a sentence
 *   of description plus three controls is a title, an explanation and a
 *   toolbar on one line. The eye has to sort them before it can use either.
 *
 *   THE CONTROLS WERE SIZED BY WHAT WAS LEFT OVER. On the calendar the
 *   description is a full sentence, so the three controls were squeezed into
 *   whatever it did not take -- and they wrapped onto a second line inside
 *   their own corner at widths where the row had plenty of space going spare.
 *
 *   IT COULD NOT BE MADE RESPONSIVE. A cluster pinned to the right of a
 *   heading has no width of its own to give or take; every adjustment is a
 *   negotiation with a sentence. On its own row the search is simply the
 *   flexible element and absorbs the change.
 *
 * SEARCH FIRST, THEN THE DROPDOWNS, and it is a rule rather than a habit. They
 * are not the same kind of control: a search finds something you already have
 * in mind, a dropdown changes what the list is ABOUT. The finder goes first
 * because it is the one somebody arrives wanting, and it is wider because a
 * title is longer than a category. The three sections already ordered
 * themselves this way; fixing it here is what stops the fourth from not.
 *
 * THE TWO POLES ARE THE ROW'S OWN EDGES. The search takes the leading edge and
 * the dropdowns the trailing one, which is the toolbar convention and also
 * buys a real alignment: on /documents the trailing dropdown lands on the same
 * vertical line as the table's last column and its delete control, and on the
 * calendar the same line as the rail's `next` arrow. A cluster in the middle
 * would line up with nothing.
 *
 * RESPONSIVE IN THREE STEPS, and the middle one is the one the hand-built
 * copies could not have had.
 *
 *   Below `sm` every control is FULL WIDTH and the row becomes a column. A
 *   192px dropdown next to a 224px search box does not fit a 375px screen, so
 *   the old `flex-wrap` put them on two lines anyway -- at their fixed widths,
 *   which left a ragged right edge with 60px of dead space beside each one.
 *   Stacking says the same thing and looks deliberate.
 *
 *   From `sm` the SEARCH IS THE FLEXIBLE ONE, between `min-w-40` and
 *   `max-w-sm`. The floor is what stops three controls on a tablet squeezing
 *   it into a lens and no room to type; the ceiling is what stops it becoming
 *   a 900px box with a placeholder marooned at one end of it on a 1440
 *   monitor. Everything between those two numbers is absorbed by the one
 *   control that can use the room, which is what "responsive" means here.
 *
 *   `flex-wrap` SURVIVES AS THE FLOOR UNDER THE FLOOR. Four controls in a
 *   narrow panel can still exceed the row even with the search at its minimum,
 *   and wrapping is the correct failure -- an overflowing row would put a
 *   dropdown off the edge of the card.
 *
 * THE VERTICAL RHYTHM AROUND IT, because a row of its own needs saying where
 * a cluster on a heading line did not (Gabe, 2026-09-15: "implement better
 * spacing"). Measured the moment the row landed: the gallery ran 12px heading
 * to controls and 12px controls to rail; the documents list ran 20 and 20.
 * Both are FLAT -- three things at one interval is a list, not a hierarchy,
 * which is the argument the landing hero's own docblock makes about its
 * eyebrow. And the two disagreed with each other while sitting on one screen,
 * which is the drift this component exists to end, moved from the horizontal
 * axis to the vertical one.
 *
 * Three steps, and every section that has a filter row uses them:
 *
 *   12px  THE HEADING TO THIS ROW. They are one group -- the section's name
 *         and the controls that narrow it -- so they sit closer to each other
 *         than either sits to anything else. `flex flex-col gap-3` around the
 *         two.
 *   24px  THAT GROUP TO THE CONTENT. The header is separated from the body it
 *         describes; this is the step that makes the grouping legible at all.
 *   40px  SECTION TO SECTION, on /documents, where the gallery and the list
 *         are stacked. It was 32, which is close enough to the 24 inside a
 *         section that "your documents" did not read as a new one starting.
 *
 * THE TWO CLASS NAMES ARE COPIED AT EACH CALL SITE rather than wrapped in a
 * component that takes a `heading` slot. That is this repository's own
 * convention for a two-class pairing -- SiteFooter copies `px-gutter` +
 * `max-w-wide` from Section for the same reason and says so -- and the
 * alternative here is worse than usual: the three headings are an `<h2>`, an
 * `<h2>` beside a `<p>`, and a `CardHeader` carrying a title and a
 * description, so the slot would be a component whose entire body is
 * `{heading}{controls}` in a flex column. The rule lives here, in the file
 * both halves of it are about.
 *
 * IT IS NOT A `<form>`. Nothing here submits -- every control narrows a list
 * that is already on screen, as you type -- and wrapping it in a form would
 * invent a submit button that has nothing to do, plus an Enter key that
 * reloads the page.
 *
 * NO LABELS ABOVE THE CONTROLS, and that is not an accessibility gap: every
 * control takes a required `label` which becomes its `aria-label`, and the
 * placeholder repeats it for sighted readers. A visible `<label>` over a
 * narrowing control on a heading row would be a third line of type above a
 * list that already has a heading and a description.
 *
 * THE LABELS MUST NOT REPEAT A NOUN ACROSS TWO SECTIONS ON ONE SCREEN. At
 * desktop width the template gallery and the documents list are both on
 * `/documents`, so there are two search boxes and two dropdowns in one
 * viewport. What tells them apart is wording -- "search templates" against
 * "search documents", "CV templates" against "CVs" -- and that each pair sits
 * on the row of the thing it narrows. This component makes the second half
 * structural; the first half is still the caller's to get right.
 */

/** One dropdown in the row. */
export interface FilterBarSelect {
  /** Used for the element id and as the React key. */
  id: string
  /** The accessible name. Never rendered as visible text. */
  label: string
  value: string
  onValueChange: (value: string) => void
  items: SelectOption[]
  /** A decorative leading glyph. Two dropdowns on one screen must not share one. */
  icon?: IconName
  /**
   * Held shut while the choice is being acted on.
   *
   * ONLY FOR A DROPDOWN THAT COSTS SOMETHING. Every other control here narrows
   * a list that is already on screen and can be changed as fast as anybody
   * likes; the rail's board picker starts a crawl that bills per posting, so
   * changing it mid-read is a second charge for a question already asked.
   */
  disabled?: boolean
  /**
   * Width from `sm` up. Below it every control is full width.
   *
   * A token rather than a class, because the point of this component is that
   * three sections stop inventing their own widths. `m` is the default and
   * fits a category name; `l` is for a list of country or region names, which
   * is the one case that genuinely needs the room.
   */
  width?: 'm' | 'l'
}

export interface FilterBarProps {
  /**
   * The search box. Omitted entirely when a section has nothing to search --
   * rendered as a disabled or empty box it would be a control that lies.
   */
  search?: {
    id: string
    /** The accessible name, e.g. "Search documents by name". */
    label: string
    /** The in-field prompt, e.g. "search documents". */
    placeholder: string
    value: string
    onChange: (value: string) => void
  }
  /** The dropdowns, in the order they should read. */
  selects?: FilterBarSelect[]
  className?: string
}

/**
 * The widths, in one place.
 *
 * ON A WRAPPER, NOT ON THE CONTROL. `Select`'s root is `w-full` and only its
 * trigger takes `className`, so a width handed to the component lands on the
 * wrong element and does nothing -- the trap the calendar's country picker hit
 * and every call site since has had to remember. Here it is remembered once.
 */
const WIDTHS = {
  m: 'sm:w-48',
  l: 'sm:w-56',
} as const
// `shrink-0` is NOT on these. A dropdown carrying "every field" or a country
// name has a real minimum and these widths are it, but the search is the
// element that gives way first -- it has a floor of its own and the row wraps
// before either is squeezed to nothing. Pinning the dropdowns as well would
// make wrapping the FIRST response to a narrow row rather than the last.

export function FilterBar({ search, selects = [], className }: FilterBarProps) {
  // A row with nothing in it is a 40px gap above a list. Callers already guard
  // on "are there any documents", but a section that passes neither half
  // should get nothing rather than an empty flex container.
  if (!search && selects.length === 0) return null

  return (
    <div
      data-filter-bar
      className={cn(
        // `w-full`, not `sm:w-auto`. It is the row now, so it takes the row's
        // width -- that is the whole change, and everything below follows from
        // having width to distribute rather than width to fit into.
        'flex w-full flex-col gap-2',
        'sm:flex-row sm:flex-wrap sm:items-center sm:gap-3',
        className
      )}
    >
      {search && (
        // THE ONLY FLEXIBLE ELEMENT IN THE ROW, bounded at both ends -- see the
        // docblock for what each bound is stopping. `min-w-0` alongside the
        // floor because a flex item's automatic minimum is its CONTENT width,
        // and an input's is its placeholder: without it the box refuses to go
        // below "search documents" and pushes a dropdown off the row instead.
        <div className="w-full sm:min-w-40 sm:max-w-sm sm:flex-1">
          <Input
            id={search.id}
            type="search"
            icon="Search"
            aria-label={search.label}
            placeholder={search.placeholder}
            value={search.value}
            onChange={(event) => search.onChange(event.target.value)}
          />
        </div>
      )}

      {selects.length > 0 && (
        /*
          THE DROPDOWNS TRAVEL TOGETHER, in their own group, and that is not
          cosmetic. `ml-auto` on the group sends the whole set to the trailing
          edge as one object; `ml-auto` on each dropdown would put the first
          one there and leave the rest trailing off the end.

          It also keeps them together when the row wraps: two filters that
          belong to the same list must not end up on two different lines with
          the search between them.
        */
        <div
          data-filter-bar-selects
          className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
        >
          {selects.map((select) => (
            <div key={select.id} className={cn('w-full', WIDTHS[select.width ?? 'm'])}>
              <Select
                id={select.id}
                icon={select.icon}
                aria-label={select.label}
                disabled={select.disabled}
                value={select.value}
                onValueChange={select.onValueChange}
                items={select.items}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
