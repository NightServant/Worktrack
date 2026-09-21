import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'

import { DatePicker, fromValue, toValue } from '../date-picker'
import { PhoneInput } from '../phone-input'

afterEach(cleanup)

/**
 * The two controls added on 2026-09-21, and the rules they exist to obey.
 *
 * WHAT IS WORTH TESTING HERE is not that a calendar renders -- react-day-picker
 * tests itself -- but the three decisions that were made on top of it and that
 * a later edit could silently undo: the date is this app's panel rather than
 * the browser's, the country dropdown is this app's `Select` rather than a
 * native one, and neither control shifts a day across a timezone.
 */

describe('the date picker', () => {
  it('is this app’s calendar rather than the browser’s', () => {
    // `<input type="date">` opens Chrome's own panel -- Chrome's blue, radius
    // and type -- on a screen whose design system is enforced by tests
    // everywhere else. The trigger is a button; there is no native date input.
    const { container } = render(<DatePicker id="d" value="" onChange={() => {}} />)
    expect(container.querySelector('input[type="date"]')).toBeNull()
    expect(container.querySelector('[data-date-picker-trigger]')).toBeTruthy()
  })

  it('opens the calendar and reports the day that was pressed', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DatePicker id="d" value="1999-03-07" onChange={onChange} max="2026-09-21" />)

    await user.click(screen.getByRole('button', { name: /7 March 1999/ }))
    // OPENS ON THE SELECTED YEAR, not on this one: without `defaultMonth` a
    // birthday picker opens forty years from where it needs to be.
    await screen.findByRole('grid')
    // The year lives in the caption dropdown, not in the grid of numbers --
    // `captionLayout="dropdown"` is what turns "back forty years" into two
    // selects rather than 480 presses of a chevron.
    const day = await screen.findByRole('button', { name: /March 12th, 1999/ })
    expect(day).toBeTruthy()

    await user.click(day)
    expect(onChange).toHaveBeenCalledWith('1999-03-12')
  })

  it('never shifts a day across a timezone', () => {
    // `new Date('1999-03-07')` is UTC midnight, so anywhere behind UTC it
    // prints the 6th -- the same off-by-one `localDayKey` exists to prevent,
    // on the one value nobody forgives being wrong.
    const parsed = fromValue('1999-03-07')!
    expect(parsed.getDate()).toBe(7)
    expect(parsed.getMonth()).toBe(2)
    expect(toValue(parsed)).toBe('1999-03-07')
  })

  it('refuses a date that does not exist rather than rolling it forward', () => {
    // `new Date(2026, 1, 31)` silently becomes 3 March.
    expect(fromValue('2026-02-31')).toBeUndefined()
    expect(fromValue('not a date')).toBeUndefined()
  })
})

describe('the phone input', () => {
  it('uses this app’s own dropdown for the country, not a native select', async () => {
    // A bare `<select>` is the browser's widget: its own chrome, its own
    // radius, its own focus ring. Every other dropdown on this screen is
    // `ui/select`, which is the design system's.
    const { container } = render(
      <PhoneInput id="p" value="" onChange={() => {}} country="PH" onCountryChange={() => {}} />
    )
    expect(container.querySelector('select')).toBeNull()
    expect(screen.getByRole('combobox', { name: /country code/i })).toBeTruthy()
  })

  it('emits E.164 rather than what was typed', async () => {
    // E.164 is the one format that round-trips: `+639171234567` is the same
    // number whoever reads it, and the grouping is display only.
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <PhoneInput id="p" value="" onChange={onChange} country="PH" onCountryChange={() => {}} />
    )
    await user.type(screen.getByRole('textbox'), '9171234567')
    expect(onChange).toHaveBeenLastCalledWith('+639171234567')
  })
})

describe('both controls, against the house rules', () => {
  const read = (file: string) => readFileSync(`src/components/ui/${file}`, 'utf8')

  it('carries no radius above the 4px cap and no drop shadow', () => {
    // The same two rules `shadcnHouseRules` applies to the vendored set. Asserted
    // here as well because these two are OURS: a file nobody installed is a file
    // nobody re-checks after an edit.
    for (const file of ['date-picker.tsx', 'phone-input.tsx']) {
      const src = read(file)
      expect(src, `${file} exceeds the radius cap`).not.toMatch(
        /rounded-(lg|xl|2xl|3xl|full)(?![\w-])/
      )
      expect(src, `${file} has a shadow`).not.toMatch(/\bshadow-(sm|md|lg|xl|2xl)\b/)
      expect(src, `${file} imports lucide`).not.toMatch(/from\s+['"]lucide-react['"]/)
    }
  })

  it('reaches for the design system rather than the registry’s own chrome', () => {
    // shadcn-phone-input ships a Command palette in a Popover with a flag per
    // row. The idea was taken; the chrome was not.
    const src = read('phone-input.tsx')
    expect(src).toContain("from '@/components/ui/select'")
    expect(src).toContain("from '@/components/ui/input'")
    expect(src, 'a command palette came back with it').not.toContain('ui/command')
  })
})
