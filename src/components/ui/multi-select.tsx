'use client'

import * as React from 'react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { icons, type IconName } from '@/components/icons'
import { iconMotion } from '@/components/icons/motion'
import { ChevronDownIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

/**
 * Several choices from a list, in a control that reads as one of the filters.
 *
 * WHY IT EXISTS (Gabe, 2026-09-21: "it would be better for fresh remote roles
 * to add dropdown for job sources instead of pills"). The boards were a row of
 * toggle buttons, which is a fine control and the wrong one HERE: it sat under
 * a filter row that already had a search box and two dropdowns, so the panel
 * had two vocabularies for "narrow this list" stacked on top of each other.
 * As a dropdown it joins that row and the panel has one.
 *
 * IT IS NOT `Select`, BECAUSE `Select` PICKS ONE. The whole point of the
 * boards is choosing several, and a native multiple-select is a scrolling
 * list box nobody has used deliberately since 2003. This is
 * `DropdownMenuCheckboxItem` -- the same primitive, the same keyboard
 * behaviour -- behind a trigger that is `Select`'s, character for character,
 * so the three controls in that row are one thing rather than three.
 *
 * THE TRIGGER SAYS WHAT IS CHOSEN, not how many. "LinkedIn, Indeed" is the
 * answer to "which boards"; "2 selected" makes somebody open the menu to find
 * out what they already picked. It falls back to a count only past the point
 * where the names stop fitting, which is what `summary` decides.
 */
export interface MultiSelectOption {
  value: string
  label: string
  /** Shown under the label. A row's own note, not a tooltip. */
  hint?: string
  disabled?: boolean
}

export interface MultiSelectProps {
  items: MultiSelectOption[]
  /** The chosen values. Order is the caller's, not the menu's. */
  value: readonly string[]
  onValueChange: (next: string[]) => void
  id?: string
  /** Shown when nothing is chosen. */
  placeholder?: string
  /** A glyph inside the leading edge, as `Select` and `Input` place theirs. */
  icon?: IconName
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

/**
 * How many names fit before the trigger starts counting instead.
 *
 * THREE IS WHERE IT STOPS READING AS A LIST. "LinkedIn, JobStreet, Indeed" is
 * a sentence somebody scans; a fourth turns it into something they parse, and
 * the trigger is a fixed width with a chevron in it either way.
 */
const MAX_NAMED = 3

export function summary(
  items: MultiSelectOption[],
  value: readonly string[],
  placeholder: string
): string {
  const chosen = items.filter((item) => value.includes(item.value))
  if (chosen.length === 0) return placeholder
  if (chosen.length <= MAX_NAMED) return chosen.map((item) => item.label).join(', ')
  return `${chosen.length} of ${items.length}`
}

export function MultiSelect({
  items,
  value,
  onValueChange,
  id,
  placeholder = 'none',
  icon,
  disabled,
  className,
  'aria-label': ariaLabel,
}: MultiSelectProps) {
  const Icon = icon ? icons[icon] : null
  const label = summary(items, value, placeholder)
  const empty = value.length === 0

  const toggle = (option: string, on: boolean) => {
    // ORDER IS THE ITEM LIST'S, not the order they were pressed in. The
    // caller's list is an authority ordering -- which board leads -- and a
    // selection that came out in click order would change what "first" means
    // depending on how somebody happened to tick the boxes.
    const next = on ? [...value, option] : value.filter((entry) => entry !== option)
    onValueChange(items.map((item) => item.value).filter((entry) => next.includes(entry)))
  }

  return (
    <div className="w-full">
      <DropdownMenu>
        <DropdownMenuTrigger
          id={id}
          aria-label={ariaLabel}
          disabled={disabled}
          data-multi-select
          className={cn(
            iconMotion('none'),
            // `Select`'s trigger, character for character. The two sit beside
            // each other in the same row, so a difference of a pixel here
            // reads as one of them being broken.
            'group/icon flex h-10 w-full items-center justify-between gap-2 rounded-md border',
            'relative bg-bg-canvas pr-3 text-left text-body-m text-text-primary',
            Icon ? 'pl-10' : 'pl-3',
            'transition-colors duration-(--duration-fast)',
            'focus-visible:border-accent-default focus-visible:outline-none',
            'focus-visible:ring-2 focus-visible:ring-accent-default/30',
            'disabled:cursor-not-allowed disabled:bg-bg-inset disabled:text-text-muted',
            'border-border-default',
            className
          )}
        >
          {Icon && (
            <span
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            >
              <Icon size={16} />
            </span>
          )}
          <span className={cn('truncate', empty && 'text-text-muted')}>{label}</span>
          <span aria-hidden className="flex shrink-0 items-center text-text-muted">
            {/* THE SAME FLIP `Select` USES, which is a class rather than an
                `iconMotion` name -- the trigger is the group it keys off. */}
            <ChevronDownIcon
              size={16}
              className="transition-transform duration-(--duration-fast) group-data-[popup-open]/icon:rotate-180 motion-reduce:transition-none"
            />
          </span>
        </DropdownMenuTrigger>

        {/* `align="start"` AND THE TRIGGER'S OWN WIDTH, so the menu opens under
            the control rather than beside it -- the same way `Select`'s list
            does, because they are the same row. */}
        <DropdownMenuContent align="start" className="w-(--anchor-width) min-w-56">
          {items.map((item) => (
            <DropdownMenuCheckboxItem
              key={item.value}
              checked={value.includes(item.value)}
              disabled={item.disabled}
              data-multi-select-option={item.value}
              // CLOSING ON EVERY TICK WOULD MAKE CHOOSING THREE BOARDS THREE
              // ROUND TRIPS. A checkbox menu is a list somebody works through.
              closeOnClick={false}
              onCheckedChange={(next: boolean) => toggle(item.value, next)}
            >
              <span className="flex flex-col gap-0.5">
                <span>{item.label}</span>
                {item.hint && <span className="text-caption text-text-muted">{item.hint}</span>}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
