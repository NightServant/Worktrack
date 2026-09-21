'use client'

import * as React from 'react'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * A day and a time on it, in this system's chrome rather than the browser's.
 *
 * WHAT IT REPLACES AND WHY (Gabe, 2026-09-21: components "such as date picker,
 * dropdown etc. does not use the native select and must adhere to the design
 * system properly"). The interview field was `<input type="datetime-local">`,
 * and the note beside it argued for that deliberately: the native control is
 * the one a phone opens its own wheel for. That reasoning was real and is
 * overruled -- what it cost was the biggest visual surface in the form being
 * Chrome's blue calendar on a Swiss screen with a 4px radius cap, which is the
 * same trade `DatePicker` already refused for plain dates.
 *
 * THE DAY IS A PANEL AND THE TIME IS A FIELD, which is where the split falls
 * honestly. A calendar is a large opinionated surface and it is now ours. A
 * time is four characters, and `<input type="time">` renders inside this
 * system's own `Input` with nothing but a small glyph of the browser's own --
 * so it keeps the phone keypad and the locale's 12/24-hour convention without
 * putting a foreign panel on the screen. Rebuilding that would mean owning
 * every locale's clock format to gain almost nothing.
 *
 * THE VALUE IS `YYYY-MM-DDTHH:mm`, byte for byte what `datetime-local`
 * produced, so `useRecordDraft`, `services/date` and every stored row are
 * untouched. This is a chrome swap, not a format change.
 *
 * A DAY WITHOUT A TIME IS NOT A VALUE HERE. `events.starts_at` is an instant
 * and "the 14th" is not something anyone can turn up to, so a date picked
 * alone defaults the clock to 09:00 rather than emitting a half-value the
 * caller has to guess at.
 */
export interface DateTimePickerProps {
  id: string
  /** `YYYY-MM-DDTHH:mm`, or `''`. */
  value: string
  onChange: (value: string) => void
  /** The latest day that may be picked, `YYYY-MM-DD`. */
  max?: string
  min?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
}

/** The hour a day-only pick lands on. Late enough to be a working time. */
const DEFAULT_TIME = '09:00'

/** `2026-09-14T10:00` -> `['2026-09-14', '10:00']`, either half possibly ''. */
export function splitValue(value: string): [string, string] {
  const [day = '', clock = ''] = (value || '').split('T')
  // Seconds are dropped: the field offers minutes and a stored `:00` tail
  // would render as an empty time input, which reads as "not set".
  return [day, clock.slice(0, 5)]
}

/** The two halves back into one value, or `''` when there is no day. */
export function joinValue(day: string, clock: string): string {
  if (!day) return ''
  return `${day}T${clock || DEFAULT_TIME}`
}

export function DateTimePicker({
  id,
  value,
  onChange,
  max,
  min,
  disabled,
  invalid,
  className,
}: DateTimePickerProps) {
  const [day, clock] = splitValue(value)

  return (
    // STACKED ON A PHONE. Side by side at 375px the date trigger carries a
    // written-out date and the time takes a fixed width, and neither has room.
    // `w-full`, OR THE ROW COLLAPSES. A bare flex container shrinks to its
    // content, so the date half got whatever the time input did not want and
    // the written-out date truncated to nothing but its glyph.
    <div className={cn('flex w-full flex-col gap-2 sm:flex-row sm:items-start', className)}>
      {/* THE FLEX CHILD IS THIS WRAPPER, NOT THE TRIGGER. `DatePicker` renders
          its button through Base UI's `PopoverTrigger`, and a `flex-1` handed
          to that button measured 34px inside a 448px row -- the growth never
          reached it. A plain div takes the space and the button fills the div,
          which is the arrangement that does not depend on what the primitive
          does with the class it is given. */}
      {/* `w-full` AS WELL AS `flex-1`, and both are needed. Below `sm` the row
          is a COLUMN, where `flex-1` sizes the HEIGHT and the width comes from
          nothing -- the trigger collapsed to its glyph at 34px. `w-full`
          covers the column case; `flex-1` covers the row. */}
      <div className="w-full min-w-0 sm:flex-1">
        <DatePicker
          id={id}
          value={day}
          onChange={(next) => onChange(joinValue(next, clock))}
          max={max}
          min={min}
          disabled={disabled}
          invalid={invalid}
          placeholder="pick a day"
        />
      </div>
      {/* THE WIDTH GOES ON THE WRAPPER, NOT ON THE INPUT, and this was the
          whole bug. `Input` carries its own `w-full`; a `sm:w-32` handed to it
          does not win, so the field took the entire 448px row and left the
          date beside it nothing -- which is why the trigger measured 34px, the
          width of its glyph. Sizing the box around it is the arrangement that
          does not depend on which class the primitive puts last. */}
      <div className="w-full sm:w-32 sm:shrink-0">
        <Input
          id={`${id}-time`}
          aria-label="Time"
          // `time`, and it is the one native control kept here on purpose --
          // see the docblock. It renders inside this system's own Input.
          type="time"
          disabled={disabled}
          aria-invalid={invalid}
          value={clock}
          onChange={(event) => onChange(joinValue(day, event.target.value))}
        />
      </div>
    </div>
  )
}
