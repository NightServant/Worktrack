'use client'

import * as React from 'react'
import { jobValidation } from '@/services/jobValidation'
import { isSupportedCurrency, type SupportedCurrency } from '@/services/userPreferences'
import type { Job, JobFormData, JobStatus, WorkMode } from '@/types'

/**
 * Every editable value on an application, in one place.
 *
 * IT REPLACES `ApplicationForm`'s NINETEEN `useState` CALLS, and it exists
 * because there are now two surfaces writing the same row: the record dialog,
 * which edits in place, and the add wizard, whose review step is that same
 * editor over a draft the model filled in. One hook means one payload shape,
 * one validation pass and one definition of "dirty" -- the alternative was a
 * second copy of the form that would drift from the first.
 *
 * NOTES AND CONTACT ARE GONE (Gabe, Worktrack Revisions item 4). The four
 * `contact_*` columns and `notes` still exist on `jobs` and are still written
 * by the CSV importer, so nothing stored is destroyed -- they are simply not
 * part of the record any more, and `toPayload` leaves them out so an edit
 * never blanks a value this UI cannot show.
 */
export interface RecordDraft {
  company: string
  role: string
  status: JobStatus
  salaryMin: string
  salaryMax: string
  currency: SupportedCurrency
  location: string
  workMode: WorkMode | ''
  source: string
  dateApplied: string
  url: string
  tags: string
  techStack: string
  isReferral: boolean
  description: string
  /**
   * When the interview is, as an `<input type="datetime-local">` value —
   * local wall-clock, `YYYY-MM-DDTHH:mm`, empty for "none booked".
   *
   * IT IS IN THE DRAFT BUT NOT IN THE PAYLOAD, which looks inconsistent and
   * is not. There is no interview column on `jobs`: the date is a row in
   * `events`, written through `eventService.scheduleInterview` after the
   * application itself saves, exactly like the CV link. What it needs from
   * the draft is the OTHER half of a field's behaviour — being counted as a
   * change. `dirty` drives whether `Save application` is enabled at all
   * (Worktrack Revisions 1.3), so an interview date living outside the draft
   * would be typed into a form whose save button stayed greyed out.
   */
  interviewAt: string
}

export type DraftField = keyof RecordDraft

function toList(value: string): string[] {
  return Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean)))
}

function nullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function toNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * A bare domain typed into the URL field is a URL the user meant, not one they
 * got wrong, so it is completed rather than rejected. Moved here unchanged
 * from `ApplicationForm`; `jobValidation` only accepts `http(s)://` or `//`,
 * and failing someone for omitting a scheme they never type anywhere else is a
 * validation message nobody learns from.
 */
export function normalizePostingUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  if (/^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(trimmed)) return `https://${trimmed}`
  return trimmed
}

export function draftFromJob(
  job: Job | null,
  defaultCurrency: SupportedCurrency,
  interviewAt = ''
): RecordDraft {
  return {
    company: job?.company ?? '',
    role: job?.role ?? '',
    status: job?.status ?? 'wishlist',
    salaryMin: job?.salary_min?.toString() ?? '',
    salaryMax: job?.salary_max?.toString() ?? '',
    // Editing an existing job shows the currency its figures were STORED in.
    // Re-defaulting a USD row to the account currency relabels a number
    // without converting it.
    currency:
      job && isSupportedCurrency(job.salary_currency)
        ? (job.salary_currency as SupportedCurrency)
        : defaultCurrency,
    location: job?.location ?? '',
    workMode: job?.work_mode ?? '',
    source: job?.source ?? '',
    dateApplied: job?.date_applied ?? '',
    url: job?.url ?? '',
    tags: (job?.tags ?? []).join(', '),
    techStack: (job?.tech_stack ?? []).join(', '),
    isReferral: job?.is_referral ?? false,
    description: job?.description ?? '',
    interviewAt,
  }
}

/**
 * What "unchanged" means, and it is deliberately wider than the payload.
 *
 * `toPayload` is what gets written to `jobs`; this is what the record
 * compares against its baseline to decide whether there is anything to save.
 * The interview date is in the second and not the first because it is saved —
 * just to a different table.
 */
export function toBaseline(draft: RecordDraft): string {
  return JSON.stringify({ ...toPayload(draft), interviewAt: draft.interviewAt })
}

export function toPayload(draft: RecordDraft): JobFormData {
  return {
    company: draft.company.trim(),
    role: draft.role.trim(),
    salary_min: toNumber(draft.salaryMin),
    salary_max: toNumber(draft.salaryMax),
    salary_currency: draft.currency,
    url: nullable(normalizePostingUrl(draft.url)),
    description: nullable(draft.description),
    status: draft.status,
    date_applied: nullable(draft.dateApplied),
    location: nullable(draft.location),
    work_mode: draft.workMode === '' ? null : draft.workMode,
    source: nullable(draft.source),
    is_referral: draft.isReferral,
    tags: toList(draft.tags),
    tech_stack: toList(draft.techStack),
  }
}

export interface UseRecordDraftResult {
  draft: RecordDraft
  set: <K extends DraftField>(field: K, value: RecordDraft[K]) => void
  /** Replaces the whole draft -- what auto-fill hands back. */
  replace: (next: Partial<RecordDraft>) => void
  /**
   * Fills only the fields that are still empty.
   *
   * IT USES THE FUNCTIONAL UPDATER, which is the whole reason it exists rather
   * than being a `replace` the caller filtered itself. The add wizard applies
   * auto-fill and then the digest in one pass, and a caller comparing against
   * the `draft` it closed over would be reading the state from BEFORE the
   * first of those landed -- so the digest would overwrite what auto-fill had
   * just found, on exactly the fields auto-fill is better at.
   */
  fillEmpty: (next: Partial<RecordDraft>) => void
  payload: JobFormData
  errors: Record<string, string>
  /** An error only once the field has been left, or a save has been attempted. */
  errorFor: (field: string) => string | undefined
  blur: (field: string) => () => void
  attempt: () => void
  dirty: boolean
  /** Accepts the current values as the new baseline, after a successful save. */
  commit: () => void
}

export function useRecordDraft(
  job: Job | null,
  defaultCurrency: SupportedCurrency,
  onDirtyChange?: (dirty: boolean) => void,
  /** The interview already on the calendar, as a datetime-local value. */
  interviewAt = ''
): UseRecordDraftResult {
  const [draft, setDraft] = React.useState<RecordDraft>(() =>
    draftFromJob(job, defaultCurrency, interviewAt)
  )
  const [touched, setTouched] = React.useState<Record<string, boolean>>({})
  const [attempted, setAttempted] = React.useState(false)
  const [baseline, setBaseline] = React.useState<string>(() =>
    toBaseline(draftFromJob(job, defaultCurrency, interviewAt))
  )

  const set = React.useCallback(
    <K extends DraftField>(field: K, value: RecordDraft[K]) =>
      setDraft((prev) => ({ ...prev, [field]: value })),
    []
  )
  const replace = React.useCallback(
    (next: Partial<RecordDraft>) => setDraft((prev) => ({ ...prev, ...next })),
    []
  )
  const fillEmpty = React.useCallback(
    (next: Partial<RecordDraft>) =>
      setDraft((prev) => {
        const merged = { ...prev }
        for (const [key, value] of Object.entries(next) as [keyof RecordDraft, unknown][]) {
          if (value === undefined || value === null || value === '') continue
          // Empty means empty: a whitespace-only field is one nobody filled
          // in, and `false` on the referral checkbox is a real answer.
          const current = prev[key]
          if (typeof current === 'string' && current.trim() !== '') continue
          if (typeof current === 'boolean') continue
          ;(merged as unknown as Record<string, unknown>)[key] = value
        }
        return merged
      }),
    []
  )

  const payload = toPayload(draft)

  const errors: Record<string, string> = {}
  for (const issue of jobValidation.validateJobFormData(payload)) {
    if (!errors[issue.field]) errors[issue.field] = issue.message
  }
  // AN APPLIED APPLICATION HAS A DATE (Gabe, 2026-10-01: "APPLIED status must
  // require an application date"). A rule of the DIALOGS, not of
  // `jobValidation`: that also gates CSV import and the status-only update
  // behind the table, where an old row without a date is still a valid row.
  if (draft.status === 'applied' && !payload.date_applied && !errors.date_applied) {
    errors.date_applied = 'Date applied is required for an applied application'
  }

  const serialised = toBaseline(draft)
  const dirty = serialised !== baseline

  /**
   * A FRESH ROW ARRIVING FROM THE LIST REACHES AN OPEN RECORD.
   *
   * This is the 2026-09-06 bug in its new home: "saved the application, new
   * data is not rendering immediately". The dialog is derived from `jobs` on
   * every render, so the row is always current -- but seeding a draft from it
   * ONCE, at mount, reintroduces exactly the snapshot that caused it. A save
   * invalidates the query, the refetch lands, the row changes underneath, and
   * a draft that only reads it at mount goes on showing what it read then.
   *
   * ONLY WHEN THE DRAFT IS CLEAN. Typing wins over a refetch, always: dropping
   * somebody's half-typed salary because a background fetch resolved is a
   * worse failure than a stale field, and it is one they cannot undo. A dirty
   * record keeps what was typed and picks the new values up when it is saved.
   *
   * Keyed on the incoming row's own payload, so it fires when the DATA changes
   * rather than on every render of a parent.
   */
  const incoming = toBaseline(draftFromJob(job, defaultCurrency, interviewAt))
  React.useEffect(() => {
    if (incoming === baseline) return
    if (dirty) return
    setDraft(draftFromJob(job, defaultCurrency, interviewAt))
    setBaseline(incoming)
    // `job` and `defaultCurrency` are exactly what `incoming` is computed
    // from, and `dirty` is read rather than depended on -- re-running when the
    // user's own typing makes it true is the one thing this must not do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming])

  React.useEffect(() => {
    onDirtyChange?.(dirty)
    // Only `dirty` should re-fire this. `onDirtyChange` is a fresh closure on
    // every parent render, and including it would report on every keystroke
    // whether or not dirtiness actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  return {
    draft,
    set,
    replace,
    fillEmpty,
    payload,
    errors,
    errorFor: (field) => (attempted || touched[field] ? errors[field] : undefined),
    blur: (field) => () => setTouched((prev) => ({ ...prev, [field]: true })),
    attempt: () => setAttempted(true),
    dirty,
    commit: () => {
      setBaseline(serialised)
      setAttempted(false)
    },
  }
}
