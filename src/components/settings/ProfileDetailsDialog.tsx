'use client'

import * as React from 'react'
import { AppDialog } from '@/components/ui/app-dialog'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'
import { PhoneInput, defaultPhoneCountry } from '@/components/ui/phone-input'
import type { Country } from 'react-phone-number-input'
import { PHONE_TYPES, type PhoneType, type UserProfile } from '@/services/profile'

/**
 * The two details a profile cannot import, and the one place they are edited.
 *
 * WHY THEY ARE NOT IMPORTED AND NEVER WILL BE. No public profile publishes a
 * phone number, and none publishes a date of birth with a year -- LinkedIn
 * shows "Mar 7" to a stranger precisely because the year identifies you. So
 * these two are the only fields on the profile screen that can only come from
 * the person, which is why they are collected at registration and editable
 * here rather than being another thing a re-import might fix.
 *
 * A DIALOG RATHER THAN INLINE FIELDS. Everything else on the details card is
 * imported and read-only; two editable rows among eight static ones would make
 * the whole card look like a form that does not save.
 *
 * NOTHING IS REQUIRED HERE, which is the difference from registration. There
 * the sources are required because a profile with no address behind it cannot
 * be built at all; these two are facts about a person, and a person is allowed
 * not to give them. Clearing a field stores null rather than an empty string,
 * so the row disappears from the card instead of rendering as a blank.
 */
export interface ProfileDetails {
  phone: string | null
  phoneType: PhoneType | null
  birthday: string | null
}

export interface ProfileDetailsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: UserProfile
  onSave: (details: ProfileDetails) => Promise<void> | void
}

/**
 * A number a person would recognise as theirs, or null.
 *
 * DIGITS, SPACES, BRACKETS, DASHES AND ONE LEADING `+`. That is every
 * convention a number is written in, and this app does not need more than to
 * know it is a number rather than a sentence -- it stores what was typed and
 * prints it back. A stricter rule here means rejecting somebody's real number
 * over a bracket, which is the one outcome worth avoiding.
 *
 * THE FLOOR IS SEVEN DIGITS. The shortest national subscriber number in use is
 * seven, so anything below that is a typo rather than a number.
 */
export function phoneProblem(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^\+?[\d\s()./-]+$/.test(trimmed)) {
    return 'Use digits, spaces, brackets or dashes, and a leading + for a country code.'
  }
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length < 7) return 'That looks too short to be a phone number.'
  if (digits.length > 15) return 'That is longer than any phone number (15 digits is the maximum).'
  return null
}

/**
 * Whether a date of birth is one a living person could have, or null.
 *
 * THE TWO BOUNDS ARE THE ONLY HONEST CHECKS. A date in the future is not a
 * birthday, and 120 years is past the longest life on record -- everything
 * between them is somebody's actual age and none of this app's business.
 *
 * COMPARED AS LOCAL PARTS, not as parsed dates: `new Date('2026-09-21')` is
 * UTC midnight, so in Manila it is already "tomorrow" for most of the day and
 * today's date would be rejected as being in the future.
 */
export function birthdayProblem(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (!match) return 'Pick a date.'
  const [, year, month, day] = match.map(Number)
  const chosen = new Date(year, month - 1, day)
  if (chosen.getFullYear() !== year || chosen.getMonth() !== month - 1 || chosen.getDate() !== day) {
    return 'That date does not exist.'
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (chosen > today) return 'A date of birth cannot be in the future.'
  if (year < today.getFullYear() - 120) return 'Please check the year.'
  return null
}

/** Today as `YYYY-MM-DD`, in the reader's own timezone. */
function todayValue(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function ProfileDetailsDialog({
  open,
  onOpenChange,
  profile,
  onSave,
}: ProfileDetailsDialogProps) {
  const [phone, setPhone] = React.useState(profile.phone ?? '')
  const [phoneType, setPhoneType] = React.useState<PhoneType>(profile.phoneType ?? 'mobile')
  /*
    THE COUNTRY IS NOT STORED, and it does not need to be. The value is
    E.164, which carries its own calling code -- this state only decides how
    the digits are grouped while somebody types them.
  */
  const [country, setCountry] = React.useState<Country>(() => defaultPhoneCountry())
  const [birthday, setBirthday] = React.useState(profile.birthday ?? '')
  const [saving, setSaving] = React.useState(false)
  const [failed, setFailed] = React.useState<string | null>(null)

  /*
    RE-SEEDED EACH TIME IT OPENS, not once at mount. This component stays
    mounted between openings, so without this a reader who typed something,
    closed without saving and opened again would find their abandoned draft
    still sitting there as though it had been stored.
  */
  React.useEffect(() => {
    if (!open) return
    setPhone(profile.phone ?? '')
    setPhoneType(profile.phoneType ?? 'mobile')
    setBirthday(profile.birthday ?? '')
    setFailed(null)
  }, [open, profile.phone, profile.phoneType, profile.birthday])

  const phoneError = phoneProblem(phone)
  const birthdayError = birthdayProblem(birthday)
  const blocked = Boolean(phoneError || birthdayError)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (blocked || saving) return
    setSaving(true)
    setFailed(null)
    try {
      await onSave({
        // EMPTY IS NULL, NOT "". A blank string would draw an empty `phone` row
        // on the card rather than removing it, and would count as a filled
        // field the next merge refuses to overwrite.
        phone: phone.trim() || null,
        phoneType: phone.trim() ? phoneType : null,
        birthday: birthday.trim() || null,
      })
      onOpenChange(false)
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'That could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="your details"
      icon="UserRound"
      description="These two are yours rather than imported, so nothing else can fill them in."
      size="m"
    >
      <form className="flex flex-col gap-5" onSubmit={submit} data-profile-details-form>
        {/* THE NUMBER AND ITS KIND ARE ONE ROW, because the kind is a property
            of the number rather than a second question. On a phone they stack;
            the number takes the width it needs and the kind takes what it
            needs, which is much less. */}
        <div className="flex flex-col gap-1.5">
          <Field id="profile-phone" label="phone number">
            <PhoneInput
              id="profile-phone"
              name="phone"
              country={country}
              onCountryChange={setCountry}
              value={phone}
              onChange={setPhone}
              invalid={Boolean(phone && phoneError)}
            />
          </Field>
          {phone && phoneError && (
            <p role="alert" className="text-body-s text-status-rejected-mark">
              {phoneError}
            </p>
          )}
        </div>

        <Field id="profile-phone-type" label="type">
          <Select
            id="profile-phone-type"
            name="phoneType"
            aria-label="What kind of number this is"
            // A kind with no number to describe is a control that means
            // nothing, so it waits for one.
            disabled={!phone.trim()}
            value={phoneType}
            onValueChange={(next) => setPhoneType(next as PhoneType)}
            items={PHONE_TYPES.map((kind) => ({ value: kind, label: kind }))}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <Field id="profile-birthday" label="birthday">
          {/* THIS APP'S CALENDAR, NOT THE BROWSER'S. `<input type="date">`
              was here first and is genuinely the accessible default -- but the
              panel it opens is Chrome's blue, Chrome's radius and Chrome's
              type, which on a Swiss screen with one orange accent reads as a
              piece of a different application. See `DatePicker`. */}
            <DatePicker
              id="profile-birthday"
              value={birthday}
              onChange={setBirthday}
              // Nobody picks tomorrow as their birthday, and the calendar
              // itself should say so rather than the error underneath it.
              max={todayValue()}
              invalid={Boolean(birthday && birthdayError)}
              placeholder="pick your birthday"
            />
          </Field>
          {birthday && birthdayError && (
            <p role="alert" className="text-body-s text-status-rejected-mark">
              {birthdayError}
            </p>
          )}
        </div>

        {failed && (
          <p role="alert" className="text-body-s text-status-rejected-mark">
            {failed}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            cancel
          </Button>
          <Button type="submit" disabled={blocked} loading={saving} loadingText="saving">
            save
          </Button>
        </div>
      </form>
    </AppDialog>
  )
}
