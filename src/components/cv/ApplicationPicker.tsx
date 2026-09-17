'use client'

import * as React from 'react'
import { icons } from '@/components/icons'
import { cn } from '@/lib/utils'
import type { Job } from '@/types'

/**
 * Choosing which application to work against, when there are forty-five.
 *
 * THE DROPDOWN IT REPLACES ASKED THE WRONG QUESTION, and the length was only
 * the visible half of that. A `<select>` of every application is unusable past
 * a dozen -- no search, no ordering, and the one you want is wherever the
 * insertion order put it. But the deeper problem is that a single-select
 * control implies the document has ONE target, and a CV sent to forty-five
 * jobs has forty-five. See the note at the bottom of this file for where that
 * leads.
 *
 * TWO THINGS FIX THE SELECTION ITSELF:
 *
 *   SEARCH, because forty-five rows is a list you read and a list you read is
 *   a list you scroll past. Typing "stripe" is one action; finding Stripe in
 *   an alphabetical select is several.
 *
 *   A PREDICTABLE ORDER, by company, because insertion order is not one.
 *
 * IT USED TO SORT BY "ALREADY SENT" FIRST, reading `application_documents`
 * through a `linkedJobIds` prop, on the reasoning that the applications this
 * CV had actually gone to were the realistic targets. That reasoning died with
 * the wishlist filter below: a CV is linked to applications you have SENT, and
 * this list now holds only ones you have NOT. The two sets cannot intersect,
 * so the sort could never fire and the `already sent` marker could never
 * render. No caller had passed the prop in any case. Removed rather than left
 * as a feature that reads as if it works.
 *
 * BUILT HERE RATHER THAN ON `ui/combobox`. That component is vendored, unused
 * anywhere in the app, and wraps Base UI's combobox with its own filtering and
 * grouping model; adopting it for the first time inside a rail meant learning
 * an API to get a listbox, and its item styling carries `rounded-md` against a
 * design system that caps radius at 4px. This is a text input and a filtered
 * list with the combobox ARIA pattern written out, which is the part that
 * actually has to be right.
 *
 * IT LISTS THE WISHLIST, AND IT DOES NOT DO THAT FILTERING ITSELF. Tailoring
 * is work you do before applying, so `useCvTailoring` hands `jobs` in already
 * narrowed to `status === 'wishlist'` -- one filter, in the place that also
 * resolves which job is selected. A picker that filtered on its own would be a
 * second opinion about which applications exist, and the hook would go on
 * happily holding a selection this list cannot show.
 *
 * A TAILORED CV HAS NO CHOICE TO OFFER, AND SO IT IS OFFERED NONE (Gabe,
 * 2026-09-17). Tailoring writes a NEW file keyed to the application it was run
 * for, and `/cv` pins the link that makes the next run a rewrite of that file
 * rather than a tenth copy of it. The target was therefore settled before the
 * document existed, and a search box in front of it is a control that cannot
 * do what it looks like it does: picking a different posting does not
 * re-target the file, it only scores a CV written for one employer against
 * another employer's words. So on a tailored CV this draws the company and the
 * role it was written for, in the same two lines an option row uses, and there
 * is nothing to type into.
 *
 * NOT A DISABLED COMBOBOX. A greyed-out search field says "this is switched
 * off, find out why" about a decision that is not reversible and is not a
 * setting; the honest shape is a statement of fact, which is also the one a
 * screen reader can read without landing on a dead control first.
 *
 * THE KEYBOARD CONTRACT IS THE REASON THIS IS NOT A DIV WITH AN ONCLICK:
 * `role="combobox"` with `aria-expanded` and `aria-activedescendant`, the list
 * as `role="listbox"`, arrows to move, Enter to take, Escape to close. A
 * picker that only works with a mouse is one a keyboard user cannot reach at
 * all, and this one sits in front of every other feature in the rail.
 */

export interface ApplicationPickerProps {
  jobs: Job[]
  value: string
  onChange: (jobId: string) => void
  label?: string
  className?: string
  /**
   * The application this DOCUMENT was tailored for, if it is a tailored CV.
   *
   * Set, this replaces the whole control with the company and role -- see the
   * note above. It arrives already resolved rather than as an id, because
   * `useCvTailoring` is the thing that knows whether the id still names an
   * application (the picker's list is the wishlist, and a tailored CV's
   * posting has usually moved past that by the time anyone reopens the file).
   */
  tailoredFor?: Job | null
}

/** Match on role, company or location, because people search by any of them. */
function matches(job: Job, query: string): boolean {
  if (!query) return true
  const haystack = `${job.role} ${job.company} ${job.location ?? ''}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

export function ApplicationPicker({
  jobs,
  value,
  onChange,
  label = 'application',
  className,
  tailoredFor = null,
}: ApplicationPickerProps) {
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [highlight, setHighlight] = React.useState(0)
  const listId = React.useId()
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  const selected = jobs.find((job) => job.id === value) ?? null

  const options = React.useMemo<Job[]>(
    () =>
      jobs
        .filter((job) => matches(job, query))
        // By company, so the long tail is at least predictable.
        .sort((a, b) => a.company.localeCompare(b.company)),
    [jobs, query]
  )

  React.useEffect(() => {
    setHighlight(0)
  }, [query])

  // Close on an outside click, or the list stays over the document.
  React.useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function choose(option: Job) {
    onChange(option.id)
    setQuery('')
    setOpen(false)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlight((h) => Math.min(h + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (event.key === 'Enter' && open && options[highlight]) {
      event.preventDefault()
      choose(options[highlight])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const CheckIcon = icons.Check
  const SearchIcon = icons.Search

  // BELOW THE HOOKS, NEVER ABOVE THEM. Returning before `useState` would give
  // a tailored document a different hook order from an untailored one, which
  // React treats as a different component and refuses to render. The hooks
  // above cost nothing when this branch is taken: the list is never opened, so
  // the outside-click listener is never attached.
  if (tailoredFor) {
    return (
      <div
        className={cn('flex flex-col gap-1.5', className)}
        data-tailored-for={tailoredFor.id}
      >
        <p className="text-label-caps uppercase text-text-secondary">tailored for</p>
        {/* Role over company, the same two lines an option row draws, so the
            target reads as the row that would have been chosen. No box around
            it: this section groups with hairline rules and states facts in
            plain text, and a filled panel here would look like a control. */}
        <span className="truncate text-body-m text-text-primary">{tailoredFor.role}</span>
        <span className="truncate text-body-s text-text-muted">{tailoredFor.company}</span>
      </div>
    )
  }

  return (
    <div ref={rootRef} className={cn('relative flex flex-col gap-1.5', className)}>
      <label
        htmlFor={`${listId}-input`}
        className="text-label-caps uppercase text-text-secondary"
      >
        {label}
      </label>

      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        >
          <SearchIcon size={14} />
        </span>
        {/* THE EMPTY STATE HAS TO BE TRUE ABOUT THE FILTER, not about the
            account. `jobs` is the wishlist now (see `useCvTailoring`), so
            "no applications yet" was a lie on a tracker full of applied ones
            -- it sent the reader looking for a bug in the picker when the
            answer is that nothing is waiting to be applied to. */}
        <input
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && options[highlight] ? `${listId}-option-${options[highlight].id}` : undefined
          }
          value={open ? query : selected ? `${selected.role} — ${selected.company}` : ''}
          placeholder={
            jobs.length
              ? `search ${jobs.length} wishlisted ${jobs.length === 1 ? 'role' : 'roles'}`
              : 'nothing on the wishlist to tailor to'
          }
          disabled={jobs.length === 0}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-10 w-full rounded-[4px] border border-border-default bg-bg-canvas pl-9 pr-3 text-body-m text-text-primary placeholder:text-text-muted transition-colors focus-visible:border-accent-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/30 disabled:cursor-not-allowed disabled:bg-bg-inset disabled:text-text-muted"
        />
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto border border-border-default bg-bg-canvas"
        >
          {value && (
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setQuery('')
                  setOpen(false)
                }}
                className="w-full px-3 py-2 text-left text-body-s text-text-muted hover:bg-bg-surface"
              >
                clear selection
              </button>
            </li>
          )}

          {options.length === 0 && (
            <li className="px-3 py-3 text-body-s text-text-muted">
              nothing matches “{query}”.
            </li>
          )}

          {options.map((option, index) => {
            const isSelected = option.id === value
            return (
              <li key={option.id}>
                <button
                  type="button"
                  id={`${listId}-option-${option.id}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(option)}
                  className={cn(
                    'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors',
                    index === highlight ? 'bg-bg-surface' : 'bg-transparent'
                  )}
                >
                  <span className="mt-0.5 w-4 shrink-0 text-accent-default">
                    {isSelected && <CheckIcon size={14} aria-hidden />}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body-m text-text-primary">{option.role}</span>
                    <span className="truncate text-body-s text-text-muted">{option.company}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
