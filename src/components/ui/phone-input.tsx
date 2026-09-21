'use client'

import * as React from 'react'
import PhoneNumberInput, {
  getCountries,
  getCountryCallingCode,
  type Country,
} from 'react-phone-number-input/input'
// FROM THE PACKAGE THAT IS DECLARED, not from `libphonenumber-js` underneath
// it. That one is a transitive dependency: importing it directly works until
// the day the parent bumps its range, and `shadcnHouseRules` fails any ui/
// file that imports a package package.json does not name.
import { parsePhoneNumber } from 'react-phone-number-input'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { detectUserCountry } from '@/services/userLocation'

/**
 * A phone number, with the country said out loud rather than guessed.
 *
 * WHY A LIBRARY AND NOT A REGEX (Gabe, 2026-09-21, pointing at
 * shadcn-phone-input). A number is written differently in every market --
 * `+63 917 123 4567`, `(02) 8123 4567`, `0917-123-4567` -- and the rules for
 * grouping the digits are per-country metadata, not a pattern. Hand-rolling it
 * means getting it wrong for exactly the markets the developer does not live
 * in. `react-phone-number-input` carries libphonenumber's metadata and formats
 * as you type.
 *
 * THE CHROME IS THIS SYSTEM'S, NOT THE REGISTRY'S, and that is the whole
 * difference from pasting shadcn-phone-input in. That component ships a
 * `Command` palette in a `Popover` with a flag per row, `rounded-e-lg` on the
 * input and a `ScrollArea` -- three things this design system does not do: the
 * radius is capped at 4px, the flag images are a second set of artwork for a
 * fact the country name already states, and a searchable palette is a heavy
 * control for a field most people fill once. So the country is this app's own
 * `Select`, the number is this app's own `Input`, and the only thing taken
 * from the registry is the idea and the library underneath it.
 *
 * THE VALUE IS E.164 OR EMPTY. That is what the library emits and it is the
 * one format that round-trips: `+639171234567` is the same number whoever
 * reads it, and the display formatting is applied on the way in rather than
 * stored. `UserProfile.phone` keeps whatever is stored verbatim, so a number
 * typed before this component existed still renders.
 */

/** What the caller stores: E.164, or null when the field is empty. */
export interface PhoneInputProps {
  id: string
  value: string
  /** E.164 (`+639171234567`), or `''`. Never a formatted string. */
  onChange: (value: string) => void
  /** The country whose format is applied. Lifted, so a caller can remember it. */
  country: Country
  onCountryChange: (country: Country) => void
  name?: string
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  className?: string
}

/**
 * Every country the metadata knows, as `Philippines (+63)`.
 *
 * BUILT ONCE AT MODULE SCOPE. It is ~250 entries derived from constants, and
 * rebuilding it per render would run `Intl.DisplayNames` 250 times on every
 * keystroke in the number field beside it.
 *
 * NAMED IN THE READER'S OWN LANGUAGE via `Intl.DisplayNames`, falling back to
 * the code itself where the browser has no name for it -- which is better than
 * a bundled English list that is wrong for everyone else and goes stale.
 */
const COUNTRIES: { value: string; label: string }[] = (() => {
  let names: Intl.DisplayNames | null = null
  try {
    names = new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    names = null
  }
  return getCountries()
    .map((code) => ({
      value: code,
      label: `${names?.of(code) ?? code} (+${getCountryCallingCode(code)})`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
})()

/**
 * The country a number actually belongs to, or null.
 *
 * THE VALUE OUTRANKS EVERY GUESS, which is the bug this exists for. The
 * library warns when the `country` prop disagrees with the number it is given
 * -- "Expected phone number +639282844172 to correspond to country US but in
 * reality it corresponds to country PH" -- and it is right to: a stored number
 * is a fact, and detection is a guess. An E.164 string carries its own calling
 * code, so there is nothing to infer.
 */
export function countryOfNumber(value: string): Country | null {
  if (!value?.startsWith('+')) return null
  try {
    return parsePhoneNumber(value)?.country ?? null
  } catch {
    return null
  }
}

/**
 * The country to open on when there is no number to read one from.
 *
 * IT ASKS THE APP'S ONE RESOLVER (`services/userLocation`) rather than
 * guessing here. The first version of this function did guess, with
 * `new Intl.Locale(navigator.language).maximize().region` -- which turns a
 * bare `en` into `US` for somebody in Manila, and is exactly the failure the
 * calendar's own country detection was written to avoid. Two resolvers meant
 * one of them was wrong.
 *
 * NOT SAFE DURING A SERVER RENDER: it reads `navigator`. Call it from an
 * effect -- `useUserCountry` does.
 *
 * It is a DEFAULT, not an answer. The dropdown is right there, and the value
 * this component produces is E.164 either way.
 */
export function defaultPhoneCountry(fallback: Country = 'PH'): Country {
  const detected = detectUserCountry()
  return detected && getCountries().includes(detected as Country)
    ? (detected as Country)
    : fallback
}

export function PhoneInput({
  id,
  value,
  onChange,
  country,
  onCountryChange,
  name,
  disabled,
  invalid,
  placeholder = '917 123 4567',
  className,
}: PhoneInputProps) {
  /*
    THE NUMBER DECIDES, AND ONLY WHEN THERE IS ONE. A stored `+63...` opened
    with the dropdown saying United States until 2026-09-21: the country came
    from detection, the value came from the database, and the two disagreed
    loudly enough that the library logged it on every render.

    `?? country` rather than replacing the prop: an empty field has no number
    to read, and that is the case the caller's detected default is for.
  */
  const actual = countryOfNumber(value) ?? country

  return (
    // THEY STACK ON A PHONE. Side by side at 375px the country trigger and a
    // ten-digit number each get ~160px, and the country name is cut to
    // "Philipp…". The number is the field being filled in, so it takes the
    // full width first.
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-start', className)}>
      <Select
        id={`${id}-country`}
        aria-label="Country code"
        icon="Globe"
        className="sm:w-56"
        disabled={disabled}
        value={actual}
        onValueChange={(next) => onCountryChange(next as Country)}
        items={COUNTRIES}
      />
      {/*
        `inputComponent` IS WHY THIS IS NOT JUST A STYLED WRAPPER. The library
        owns the caret and the formatting, and it needs to render OUR input to
        do it -- passing it a className instead would give a correctly
        formatted number in a control that is not this system's.
      */}
      <PhoneNumberInput
        id={id}
        name={name}
        // NEITHER `international` NOR `withCountryCallingCode`, and the
        // library warns if you pass them like this: the two are a pair that
        // only mean anything together, and what they would be asking for --
        // "+63" printed inside the field -- is what the dropdown beside it
        // already says. `country` alone gives national formatting, which is
        // how people write their own number.
        country={actual}
        value={value}
        onChange={(next) => onChange(next ?? '')}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={invalid}
        autoComplete="tel"
        inputComponent={Input}
        className="flex-1"
      />
    </div>
  )
}
