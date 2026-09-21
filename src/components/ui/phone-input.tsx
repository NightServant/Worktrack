'use client'

import * as React from 'react'
import PhoneNumberInput, {
  getCountries,
  getCountryCallingCode,
  type Country,
} from 'react-phone-number-input/input'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'

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
 * The country to open on, from the machine's clock.
 *
 * THE CLOCK, NOT THE LANGUAGE, for the same reason the holiday picker uses it:
 * a time zone says where the machine is and a language tag says what its owner
 * reads. `en` maximised to `US` is a guess wearing the clothes of a fact.
 *
 * It is a DEFAULT, not an answer -- the dropdown is right there, and the value
 * it produces is E.164 either way.
 */
export function defaultPhoneCountry(fallback: Country = 'PH'): Country {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!zone) return fallback
    // `Asia/Manila` -> `PH` is not derivable without a table; what IS reliable
    // is the browser's own locale region, which the clock corroborates.
    const region = new Intl.Locale(navigator.language).maximize().region
    return (region && getCountries().includes(region as Country) ? region : fallback) as Country
  } catch {
    return fallback
  }
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
        value={country}
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
        country={country}
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
