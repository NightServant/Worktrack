'use client'

import * as React from 'react'
import { AppDialog } from '@/components/ui/app-dialog'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'
import { PhoneInput } from '@/components/ui/phone-input'
import { useUserCountry } from '@/hooks/useUserCountry'
import type { Country } from 'react-phone-number-input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PHONE_TYPES, type PhoneType } from '@/services/profile'
import {
  birthdayProblem,
  phoneProblem,
} from '@/components/settings/ProfileDetailsDialog'

/**
 * The last thing registration asks for: where to read you from, and two facts.
 *
 * WHY IT IS AFTER THE CODE AND NOT BEFORE IT (Gabe, 2026-09-21: "put the
 * sources form after email registration, password creation, and OTP
 * verification for profile personalization"). Two reasons, and the second is
 * the one that decides it.
 *
 * The first is that it is the only order that does not waste somebody's
 * typing: an address entered before verification is lost if the code never
 * arrives, and nobody re-types four links.
 *
 * The second is that reading a profile WRITES one, and writing needs a
 * session. Row-level security scopes `user_profiles` to `auth.uid()`, and
 * there is no `auth.uid()` until the code is accepted -- so a sources form
 * before that step would have nowhere to put what it found.
 *
 * AT LEAST ONE ADDRESS IS REQUIRED, which is the difference between this and
 * the same form in settings. A tracker with no profile behind it cannot tailor
 * a CV or score one against a posting, and an account that starts empty tends
 * to stay empty -- the import is the step people skip and then never come back
 * to. More than one is better and the form says so, but one is the floor.
 *
 * THE OTHER TWO ARE NOT REQUIRED. A phone number and a birthday are facts
 * about a person rather than material for a CV, and a person is allowed not to
 * give them. They are here because this is the one moment somebody is already
 * filling a form in -- not because the app needs them.
 */

/** One row: what to call it, what it looks like, how to recognise its address. */
interface SourceField {
  id: string
  label: string
  placeholder: string
  hint: string
}

/**
 * THE SAME FIVE THE SETTINGS FORM OFFERS, in the same order, and the order is
 * authority rather than preference -- the extractor takes the first non-empty
 * value for each field, so LinkedIn leads because a CV is written from it and
 * GitHub fills the gaps it leaves.
 *
 * LINKEDIN AND GITHUB ARE DRAWN ON THE FORM AND THE REST ARE IN A DIALOG.
 * Five empty fields on a sign-up form reads as five things to do; two reads as
 * a question. The other three are one press away for anybody who has them.
 */
const SOURCES: SourceField[] = [
  {
    id: 'linkedin',
    label: 'LinkedIn profile',
    placeholder: 'https://www.linkedin.com/in/your-name',
    hint: 'roles, dates and education',
  },
  {
    id: 'github',
    label: 'GitHub',
    placeholder: 'https://github.com/your-username',
    hint: 'what you have built, and in which languages',
  },
  {
    id: 'jobstreet',
    label: 'JobStreet',
    placeholder: 'https://ph.jobstreet.com/profiles/your-name-abc123',
    hint: 'your current role and location',
  },
  {
    id: 'indeed',
    label: 'Indeed',
    placeholder: 'https://profile.indeed.com/p/yourname-abc123',
    hint: 'if your Indeed profile is public',
  },
  {
    id: 'glassdoor',
    label: 'Glassdoor',
    placeholder: 'https://www.glassdoor.com/member/profile/...',
    hint: 'only if it is public to a signed-out visitor',
  },
]

/**
 * The two that are asked for outright, and the three that are not.
 *
 * THE SPLIT IS 2/3 AND THE REASON IS WHAT A SIGN-UP FORM CAN ASK FOR. LinkedIn
 * and GitHub are the two almost everybody has and the two that carry the most
 * -- roles and dates from one, what was actually built from the other. The
 * remaining three are real sources for the people who have them and dead
 * fields for everybody else, and a form cannot tell which reader it has.
 *
 * ORDER IS STILL AUTHORITY across both halves: `entered` below reads `SOURCES`,
 * not these, so a JobStreet address added in the dialog still ranks after
 * LinkedIn's wherever the two disagree.
 */
const INLINE_SOURCES = SOURCES.slice(0, 2)
const EXTRA_SOURCES = SOURCES.slice(2)

export interface PersonaliseDetails {
  urls: string[]
  phone: string | null
  phoneType: PhoneType | null
  birthday: string | null
}

export interface PersonaliseStepProps {
  /**
   * Reads the addresses and stores the details.
   *
   * IT MAY FAIL AND THE STEP STAYS PUT. A source that could not be read is
   * worth saying out loud -- the reader can fix a link or skip -- rather than
   * being swallowed on the way to a dashboard.
   */
  onSubmit: (details: PersonaliseDetails) => Promise<void>
  /**
   * Leaves without reading anything.
   *
   * IT EXISTS EVEN THOUGH AN ADDRESS IS REQUIRED, and the two are not in
   * conflict. Required means the form will not submit empty; it does not mean
   * somebody who cannot find their own profile URL is locked out of the
   * account they have just verified. What it must not be is the easy path, so
   * it is a quiet link under the button rather than a second button beside it.
   */
  onSkip: () => void
}

/** An address that is at least shaped like one, or a reason it is not. */
export function addressProblem(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return 'That is not a web address. It should start with https://'
  }
  // http(s) ONLY, checked here as well as on the server. This value is sent to
  // a service that fetches it; `file:` and `javascript:` are not addresses a
  // fetcher should ever be handed, and the route refuses them too.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'That is not a web address. It should start with https://'
  }
  return null
}

/** Today as `YYYY-MM-DD`, locally. `toISOString` is UTC and shifts the day. */
function todayValue(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * One address field, used by the form AND by the dialog behind it.
 *
 * SHARED RATHER THAN COPIED because the two are the same control in two
 * places, and the thing that would drift is the part that matters -- the
 * `type="url"`, the `inputMode`, and the message under it when the address is
 * not one. A source moved between the form and the dialog should not change
 * how it behaves.
 */
function SourceRow({
  source,
  value,
  onChange,
}: {
  source: SourceField
  value: string
  onChange: (next: string) => void
}) {
  const problem = addressProblem(value)
  return (
    <div className="flex flex-col gap-1.5">
      <Field id={`signup-source-${source.id}`} label={source.label} hint={source.hint}>
        <Input
          id={`signup-source-${source.id}`}
          name={source.id}
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder={source.placeholder}
          aria-invalid={Boolean(problem)}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
      {problem && (
        <p role="alert" className="text-body-s text-status-rejected-mark">
          {problem}
        </p>
      )}
    </div>
  )
}

export function PersonaliseStep({ onSubmit, onSkip }: PersonaliseStepProps) {
  const [urls, setUrls] = React.useState<Record<string, string>>({})
  /**
   * The other three sources, and the draft the dialog is editing (Gabe,
   * 2026-09-21: "CTA for adding more links must open a dialog that contains
   * input forms for other profile sources").
   *
   * A DRAFT RATHER THAN THE REAL VALUES, which is what makes `cancel` mean
   * anything. Editing `urls` directly would leave a dialog whose cancel button
   * only closed a panel -- everything typed would already be on the form
   * behind it, and there would be nothing to cancel.
   *
   * SEEDED EACH TIME IT OPENS, not once. This component stays mounted, so
   * without re-seeding an address typed, cancelled, and then reopened would
   * still be sitting there as though it had been kept.
   */
  const [extrasOpen, setExtrasOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<Record<string, string>>({})
  const [phone, setPhone] = React.useState('')
  const [phoneType, setPhoneType] = React.useState<PhoneType>('mobile')
  /*
    DETECTED AFTER MOUNT, not during render: `navigator` does not exist on the
    server, and a country resolved while rendering is a hydration mismatch on
    the dropdown that shows it. `useUserCountry` owns that; this state exists
    so the reader can override whatever it lands on.
  */
  const detected = useUserCountry('PH')
  const [chosen, setChosen] = React.useState<Country | null>(null)
  const country = chosen ?? (detected as Country)
  const [birthday, setBirthday] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [failed, setFailed] = React.useState<string | null>(null)

  const entered = SOURCES.map((source) => urls[source.id]?.trim() ?? '').filter(Boolean)
  const malformed = SOURCES.some((source) => addressProblem(urls[source.id] ?? ''))
  /** The extras that have an address, listed under the button that edits them. */
  const added = EXTRA_SOURCES.filter((source) => (urls[source.id] ?? '').trim())
  /** A draft cannot be saved with a malformed address in it -- see `saveExtras`. */
  const draftBlocked = EXTRA_SOURCES.some((source) => addressProblem(draft[source.id] ?? ''))

  const openExtras = () => {
    setDraft(Object.fromEntries(EXTRA_SOURCES.map((source) => [source.id, urls[source.id] ?? ''])))
    setExtrasOpen(true)
  }

  /*
    SAVED ONLY WHEN EVERY ROW IS AN ADDRESS OR EMPTY. These fields are not on
    the form behind the dialog, so a malformed one committed here would block
    `build my profile` with its explanation two layers away in a panel that is
    now shut. The button is disabled and each row says which one; nothing
    invalid can leave this dialog.
  */
  const saveExtras = () => {
    if (draftBlocked) return
    setUrls((current) => ({ ...current, ...draft }))
    setExtrasOpen(false)
  }
  const phoneError = phoneProblem(phone)
  const birthdayError = birthdayProblem(birthday)
  const blocked = entered.length === 0 || malformed || Boolean(phoneError || birthdayError)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (blocked || busy) return
    setBusy(true)
    setFailed(null)
    try {
      await onSubmit({
        urls: entered,
        phone: phone.trim() || null,
        // A kind with no number is not a fact about anything.
        phoneType: phone.trim() ? phoneType : null,
        birthday: birthday.trim() || null,
      })
    } catch (error) {
      setFailed(
        error instanceof Error ? error.message : 'Those could not be read. Try again, or skip.'
      )
      setBusy(false)
    }
    // NO `setBusy(false)` ON SUCCESS. The caller navigates away; clearing it
    // here would re-enable the button for the frame before the route changes,
    // which is long enough to press twice.
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={submit} data-personalise-step>
      <div className="flex flex-col gap-2">
        <h1 className="text-heading-l text-text-primary">where should we read you from?</h1>
        <p className="max-w-prose text-body-m leading-[1.6] text-text-secondary">
          Paste a link to a profile you already have. Worktrack reads the public page and builds
          your profile from it, so your CV has something to start from. One is enough; more
          makes it fuller.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {INLINE_SOURCES.map((source) => (
          <SourceRow
            key={source.id}
            source={source}
            value={urls[source.id] ?? ''}
            onChange={(next) => setUrls((current) => ({ ...current, [source.id]: next }))}
          />
        ))}

        {/* WHAT THE DIALOG ADDED, READ BACK ON THE FORM. Without this the save
            button would close a panel and change nothing anybody can see, and
            an address stored where it cannot be seen is one nobody can correct
            -- these three fields are not on the form to correct it in. The
            address itself is shown rather than a count, because "JobStreet
            added" does not tell you whether it is the right JobStreet link. */}
        {added.length > 0 && (
          <ul className="flex flex-col gap-1" data-personalise-added>
            {added.map((source) => (
              <li
                key={source.id}
                data-personalise-added-source={source.id}
                className="flex min-w-0 items-baseline gap-2 text-body-s"
              >
                <span className="shrink-0 text-text-secondary">{source.label}</span>
                <span className="truncate text-text-muted">{urls[source.id]?.trim()}</span>
              </li>
            ))}
          </ul>
        )}

        {/* IT OPENS A DIALOG RATHER THAN REVEALING THREE MORE FIELDS (Gabe,
            2026-09-21). Revealing them made the step grow by three empty
            inputs the moment it was pressed, on the screen where the only
            question that matters is the one at the top -- and the press was
            one-way, with no way to put them back. A dialog is the same three
            fields with somewhere to put `cancel`. */}
        <Button
          type="button"
          variant="ghost"
          size="s"
          className="self-start"
          data-personalise-more
          onClick={openExtras}
        >
          {added.length > 0 ? 'edit other profiles' : 'add another profile'}
        </Button>
      </div>

      <AppDialog
        open={extrasOpen}
        onOpenChange={setExtrasOpen}
        title="other profiles"
        icon="Link"
        description="Worktrack reads whichever of these you have. LinkedIn still leads where two sources disagree."
        size="m"
      >
        {/* A FORM OF ITS OWN, SO ENTER SAVES rather than submitting the step
            behind it. `stopPropagation` is what makes that true: a dialog is a
            DOM portal but a React one too, so a submit here bubbles up the
            component tree to the sign-up form's own `onSubmit` -- which would
            read the profile and leave the page while this panel was still
            open. */}
        <form
          data-personalise-extras-form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            saveExtras()
          }}
        >
          {EXTRA_SOURCES.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              value={draft[source.id] ?? ''}
              onChange={(next) => setDraft((current) => ({ ...current, [source.id]: next }))}
            />
          ))}

          {/* CANCEL LEFT, SAVE RIGHT, which is this app's footer everywhere a
              dialog edits something -- see `ProfileDetailsDialog`. Cancel keeps
              nothing: the draft is rebuilt from the form the next time this
              opens. */}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              data-personalise-extras-cancel
              onClick={() => setExtrasOpen(false)}
            >
              cancel
            </Button>
            <Button type="submit" disabled={draftBlocked} data-personalise-extras-save>
              save
            </Button>
          </div>
        </form>
      </AppDialog>

      {/* THE TWO OPTIONAL FACTS, under a rule that separates them from the
          thing the step is actually about. They are not sources and nothing
          reads them -- grouping them with the addresses would suggest they
          are. */}
      <div className="flex flex-col gap-4 border-t border-border-subtle pt-6">
        <p className="text-label-caps uppercase text-text-secondary">
          about you <span className="normal-case text-text-muted">— optional</span>
        </p>
        <div className="flex flex-col gap-1.5">
          <Field id="signup-phone" label="phone number">
            <PhoneInput
              id="signup-phone"
              name="phone"
              country={country}
              onCountryChange={setChosen}
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

        <Field id="signup-phone-type" label="type">
          <Select
            id="signup-phone-type"
            name="phoneType"
            aria-label="What kind of number this is"
            disabled={!phone.trim()}
            value={phoneType}
            onValueChange={(next) => setPhoneType(next as PhoneType)}
            items={PHONE_TYPES.map((kind) => ({ value: kind, label: kind }))}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <Field id="signup-birthday" label="birthday">
            <DatePicker
              id="signup-birthday"
              value={birthday}
              onChange={setBirthday}
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
      </div>

      {failed && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{failed}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3">
        <Button
          type="submit"
          disabled={blocked}
          loading={busy}
          loadingText="reading your profile"
          className="w-full"
        >
          build my profile
        </Button>
        {/* READING A PROFILE TAKES A MOMENT and the button alone does not say
            why it is still spinning. A page fetches and parses somebody else's
            site; silence here reads as a hang. */}
        {busy && (
          <p className="text-center text-body-s text-text-muted">
            this reads each page you gave, so it takes a few seconds.
          </p>
        )}
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          data-personalise-skip
          className="self-center text-body-s text-text-muted underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default disabled:opacity-60"
        >
          skip for now — you can add these in settings
        </button>
      </div>
    </form>
  )
}
