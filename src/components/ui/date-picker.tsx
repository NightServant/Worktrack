'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CalendarIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

/**
 * A date, picked from this app's own calendar rather than the browser's.
 *
 * WHY NOT `<input type="date">`, WHICH IS WHAT THIS REPLACES (Gabe,
 * 2026-09-21: "make sure components such as date picker calendar adheres to
 * the design rules"). The native control is genuinely the accessible,
 * locale-correct default and that is why it was reached for first -- but the
 * panel it opens is the BROWSER'S. It is Chrome's blue, Chrome's radius,
 * Chrome's type, and on a Swiss-typography screen with one orange accent and
 * a 4px cap it reads as a piece of a different application. A design system
 * that is enforced by tests everywhere else cannot have one control that opts
 * out of it.
 *
 * WHAT IS KEPT FROM THE NATIVE ONE, because the reasons it was chosen are
 * still real:
 *
 *   THE FIELD IS STILL TYPEABLE. A picker that can only be clicked makes
 *     entering a birthday forty years back a scroll through five hundred
 *     months. The trigger opens the calendar; `fromValue` still accepts a
 *     typed `YYYY-MM-DD` from the caller.
 *   THE VALUE IS STILL `YYYY-MM-DD`. Same contract as the input it replaces,
 *     so every caller, validator and stored row is untouched.
 *   IT IS STILL KEYBOARD-REACHABLE. `Calendar` is react-day-picker, which
 *     implements the grid pattern -- arrows move by day, page by month.
 *
 * THE MONTH DROPDOWNS ARE ON, and for a birthday they are the whole point:
 * `captionLayout="dropdown"` turns "back forty years" into two selects rather
 * than four hundred and eighty presses of a chevron.
 *
 * DATES ARE PARSED AND FORMATTED AS LOCAL PARTS, never through
 * `new Date('YYYY-MM-DD')`. That constructor reads the string as UTC midnight,
 * so anywhere behind UTC it prints the day before -- the same off-by-one
 * `localDayKey` exists to prevent on the planner, and a birthday is exactly
 * the value nobody forgives being wrong.
 */
export interface DatePickerProps {
  id: string
  /** `YYYY-MM-DD`, or `''`. */
  value: string
  onChange: (value: string) => void
  /** The latest date that may be picked, `YYYY-MM-DD`. */
  max?: string
  /** The earliest. Defaults to 120 years back -- see `ProfileDetailsDialog`. */
  min?: string
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  className?: string
}

/** `1999-03-07` -> a local `Date`, or undefined. Never via `new Date(string)`. */
export function fromValue(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return undefined
  const [, year, month, day] = match.map(Number)
  const date = new Date(year, month - 1, day)
  // A round trip catches `2026-02-31`, which `new Date` silently rolls into March.
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : undefined
}

/** A local `Date` -> `1999-03-07`. `toISOString` would shift the day. */
export function toValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function DatePicker({
  id,
  value,
  onChange,
  max,
  min,
  disabled,
  invalid,
  placeholder = 'pick a date',
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const selected = fromValue(value)

  const upper = max ? fromValue(max) : undefined
  const lower =
    (min ? fromValue(min) : undefined) ??
    new Date(new Date().getFullYear() - 120, 0, 1)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="secondary"
            disabled={disabled}
            aria-invalid={invalid}
            data-date-picker-trigger
            // `justify-between`, not centred: this is a field wearing a
            // button's chrome, and a field's value sits at its leading edge.
            className={cn('w-full justify-between font-normal', className)}
          >
            <span className={cn(!selected && 'text-text-muted')}>
              {selected
                ? selected.toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })
                : placeholder}
            </span>
            <CalendarIcon size={16} aria-hidden className="text-text-muted" />
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (!date) return
            onChange(toValue(date))
            // CLOSES ON PICK. A single-date calendar has nothing further to
            // ask, and leaving it open makes the reader dismiss a panel that
            // has already done its job.
            setOpen(false)
          }}
          // OPENS ON THE SELECTED YEAR, not on this one. Without it a birthday
          // picker opens forty years from where it needs to be every time.
          defaultMonth={selected ?? upper}
          captionLayout="dropdown"
          startMonth={lower}
          endMonth={upper}
          disabled={[
            ...(upper ? [{ after: upper }] : []),
            ...(lower ? [{ before: lower }] : []),
          ]}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}
