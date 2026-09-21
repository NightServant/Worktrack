'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/ui/date-picker'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { PlusIcon } from '@/components/icons'
import { iconMotion } from '@/components/icons/motion'
import { STATUSES } from '@/components/ui/status-marker'
import { SUPPORTED_CURRENCIES, type SupportedCurrency } from '@/services/userPreferences'
import type { JobStatus, WorkMode } from '@/types'
import type { DraftField, UseRecordDraftResult } from './useRecordDraft'

const STATUS_LABELS: Record<JobStatus, string> = {
  wishlist: 'Wishlist',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
}

const WORK_MODES: { value: WorkMode; label: string }[] = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
]

/**
 * The first column of the record: what this application IS.
 *
 * TWO RULES FROM THE REVISION, and they pull against each other:
 *
 *   "Do not display placeholder with NULL value (no input)."
 *   "Allow dropdowns to be accessible in the first column of the dialog."
 *
 * Read together they mean: show me what is filled in, let me change it here,
 * and stop printing twelve rows of `not set` / `none` / `no` at me. The old
 * read-only summary printed every field whether or not it held anything, and
 * a record with a salary and a location still rendered nine empty labels.
 *
 * So a field appears when it HAS a value, and every field that appears is its
 * own control -- typed in place, no edit mode, no second dialog. Company,
 * role and status are unconditional: the first two are the only required
 * columns on `jobs`, and status always has a value.
 *
 * THE EMPTY ONES ARE ONE CLICK AWAY, not gone. Hiding a field you have never
 * filled in is tidy; making it unreachable would mean an application saved
 * without a salary could never be given one. `add more details` reveals the
 * rest, and stays open for the life of the dialog.
 */
export interface RecordBasicsProps {
  form: UseRecordDraftResult
  /** Forces every field open. The add wizard's review step wants them all. */
  showAll?: boolean
  /**
   * `cv used` MOVED IN HERE (2026-09-13) and it is a layout fix, not a
   * tidy-up. It was rendered by ApplicationRecordView directly under this
   * component, which made it a block of its own in a flex column -- a whole
   * 86px row for one dropdown, outside the grid that pairs everything else.
   * Inside, it is a cell like any other and pairs with its neighbour.
   *
   * It is still not a column on `jobs` -- it lives in `application_documents`,
   * keyed on a job id that does not exist yet while the wizard is creating one
   * -- so it still leaves through its own callback rather than through the
   * draft.
   */
  resumes?: { id: string; title: string }[]
  resumeId?: string
  onResumeIdChange?: (resumeId: string) => void
}

/** Today as `YYYY-MM-DD`, locally. `toISOString` is UTC and shifts the day. */
function todayValue(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function RecordBasics({
  form,
  showAll = false,
  resumes = [],
  resumeId = '',
  onResumeIdChange,
}: RecordBasicsProps) {
  const { draft, set, errorFor, blur } = form
  const [expanded, setExpanded] = React.useState(false)
  const open = expanded || showAll

  /** Which optional fields hold something. Drives what is on screen. */
  const filled: Record<string, boolean> = {
    salary: draft.salaryMin.trim() !== '' || draft.salaryMax.trim() !== '',
    location: draft.location.trim() !== '',
    workMode: draft.workMode !== '',
    source: draft.source.trim() !== '',
    dateApplied: draft.dateApplied.trim() !== '',
    url: draft.url.trim() !== '',
    tags: draft.tags.trim() !== '',
    techStack: draft.techStack.trim() !== '',
    isReferral: draft.isReferral,
  }

  const shows = (key: string) => open || filled[key]
  const hiddenCount = Object.keys(filled).filter((key) => !filled[key]).length

  const text = (
    field: Extract<DraftField, 'company' | 'role' | 'location' | 'source' | 'url' | 'tags' | 'techStack' | 'salaryMin' | 'salaryMax' | 'dateApplied' | 'interviewAt'>,
    props: {
      label: string
      id: string
      icon?: React.ComponentProps<typeof Input>['icon']
      type?: string
      placeholder?: string
      hint?: string
      required?: boolean
      inputMode?: React.ComponentProps<typeof Input>['inputMode']
    }
  ) => (
    <Field id={props.id} label={props.label} required={props.required} hint={props.hint}>
      <Input
        id={props.id}
        icon={props.icon}
        type={props.type}
        inputMode={props.inputMode}
        value={draft[field]}
        onChange={(e) => set(field, e.target.value)}
        onBlur={blur(props.id)}
        error={errorFor(props.id)}
        placeholder={props.placeholder}
      />
    </Field>
  )

  return (
    // ONE FIELD PER ROW (Gabe, 2026-09-13: "remove the two-column layout (not
    // entirely) because it is a bad practice in UI/UX. Reserve the two column
    // layout to the components needed it such as salary").
    //
    // IT WAS TWO-UP FOR TWO DAYS AND HE IS RIGHT TO TAKE IT BACK. The pairing
    // was introduced to stop this column scrolling -- it got a full record from
    // 1185px to 623px, which fitted -- and it bought that by asking the eye to
    // track two label/field pairs across a row and by halving the width of a
    // company name. A form is a single column of one question at a time; the
    // scroll is the cheaper cost.
    //
    // THE ONE PAIR THAT STAYS is min/max salary, and it stays because it is not
    // two fields. It is one value with two ends, the way a date range is, and
    // splitting it over two rows reads as two unrelated numbers. That is the
    // test for anything else that wants a row: does the pair say ONE thing.
    //
    // WHAT IT COSTS, measured so nobody has to wonder: the columns get 633px of
    // frame at a 982px viewport, and a record with every optional field filled
    // is about 1100px again. It scrolls. `add more details` still keeps the
    // empty ones one click away rather than gone.
    <div className="flex flex-col gap-4" data-record-basics>
      {text('company', { id: 'company', label: 'company', icon: 'Building', required: true, placeholder: 'acme' })}
      {text('role', { id: 'role', label: 'position', icon: 'UserRound', required: true, placeholder: 'frontend engineer' })}

      <Field id="status" label="status">
        <Select
          id="status"
          icon="Flag"
          value={draft.status}
          onValueChange={(next) => set('status', next as JobStatus)}
          items={STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }))}
        />
      </Field>

      {shows('location') &&
        text('location', { id: 'location', label: 'location', icon: 'MapPin', placeholder: 'manila / remote' })}

      {/* THE INTERVIEW DATE APPEARS WITH THE STATUS THAT NEEDS IT (Gabe,
          2026-09-10). It is the one field here whose relevance is conditional
          on another field rather than on whether it is filled in: a wishlist
          entry has no interview to book, and an offer's interview has already
          happened.

          A DAY AND A TIME, because an interview is both -- "the 14th" is not
          something anyone can turn up to, and `events.starts_at` stores an
          instant. The value is still `YYYY-MM-DDTHH:mm`, byte for byte what
          `datetime-local` produced, so `useRecordDraft` and `services/date`
          are untouched.

          IT IS NO LONGER THE NATIVE CONTROL (Gabe, 2026-09-21). The note here
          used to argue for it -- the phone opens its own wheel -- and what
          that cost was Chrome's blue calendar, at Chrome's radius, as the
          largest surface in a form whose every other control is this system's.
          `DateTimePicker` keeps the day in our own panel and leaves the time
          as a native field inside our own Input, which is the half where the
          browser's locale knowledge is worth more than the chrome.

          IT WRITES TO `events`, NOT TO `jobs` (see useRecordDraft's
          `interviewAt`), and only when it CHANGES -- so moving an application
          on to `offer` afterwards leaves the interview that happened sitting
          on the calendar rather than quietly deleting it. */}
      {draft.status === 'interviewing' && (
        <Field
          id="interview_at"
          label="interview"
          hint="goes on your calendar when you save."
        >
          <DateTimePicker
            id="interview_at"
            value={draft.interviewAt}
            onChange={(next) => set('interviewAt', next)}
            invalid={Boolean(errorFor('interview_at'))}
          />
        </Field>
      )}

      {shows('salary') && (
        <>
          {/* THE ONE ROW THAT IS STILL TWO COLUMNS. A minimum and a maximum
              are one value with two ends; stacked, they read as two unrelated
              numbers with no hint that either bounds the other. */}
          <div className="grid grid-cols-2 gap-3">
            {text('salaryMin', { id: 'salary_min', label: 'min salary', icon: 'BankNote', type: 'number', inputMode: 'numeric', placeholder: '60000' })}
            {text('salaryMax', { id: 'salary_max', label: 'max salary', icon: 'BankNote', type: 'number', inputMode: 'numeric', placeholder: '90000' })}
          </div>
          <Field
            id="salary_currency"
            label="currency"
            // SHORTENED FROM "figures are stored in this currency and never
            // converted." A hint that wraps to a second line costs 19px on its
            // whole ROW, not just its own cell, and this one wrapped at every
            // width a half column has ever been. The fact worth keeping is
            // that nothing converts.
            hint="stored as entered; never converted."
          >
            <Select
              id="salary_currency"
              icon="Coins"
              value={draft.currency}
              onValueChange={(next) => set('currency', next as SupportedCurrency)}
              items={SUPPORTED_CURRENCIES.map((code) => ({ value: code, label: code }))}
            />
          </Field>
        </>
      )}

      {shows('workMode') && (
        <Field id="work_mode" label="work mode">
          <Select
            id="work_mode"
            icon="Monitor"
            value={draft.workMode}
            onValueChange={(next) => set('workMode', next as WorkMode | '')}
            items={[
              { value: '', label: 'not set' },
              ...WORK_MODES.map((mode) => ({ value: mode.value, label: mode.label })),
            ]}
          />
        </Field>
      )}

      {shows('dateApplied') &&
        (
          <Field id="date_applied" label="date applied">
            <DatePicker
              id="date_applied"
              value={draft.dateApplied}
              onChange={(next) => set('dateApplied', next)}
              max={todayValue()}
              invalid={Boolean(errorFor('date_applied'))}
            />
          </Field>
        )}

      {shows('source') && text('source', { id: 'source', label: 'source', icon: 'Globe', placeholder: 'LinkedIn' })}

      {shows('url') &&
        text('url', { id: 'url', label: 'posting url', icon: 'Link', type: 'url', placeholder: 'careers.acme.com/123' })}

      {/* THE HINT IS GONE, not the field. "which CV you sent for this
          application" restates the label in a sentence, and a redundant hint
          costs a real 26px on its row. The one that is NOT redundant -- the
          empty case, which says where CVs come from -- still shows. */}
      {/* `cv used`, NOT `cv submitted` (Gabe, 2026-09-17). "Submitted" is
          false at most of this pipeline and the field is reachable at all of
          it: a `wishlist` row has sent nothing to anyone, and a tailored CV is
          attached and ATS-scored here long before it goes anywhere. A label
          that claims an application was sent is the kind of wrong that is
          never noticed and quietly makes the record untrue.

          THE LABEL ONLY. The column is `application_documents`, the prop is
          `resumeId`, and both keep their names -- renaming a database column
          to fix a word on screen is a migration bought with nothing. */}
      <Field
        id="resume_id"
        label="cv used"
        hint={resumes.length ? undefined : 'no CVs yet — write one in Documents and it will appear here.'}
      >
        <Select
          id="resume_id"
          icon="Documents"
          disabled={resumes.length === 0}
          value={resumeId}
          onValueChange={(next) => onResumeIdChange?.(next)}
          items={[
            { value: '', label: resumes.length ? 'none' : 'no CVs yet' },
            ...resumes.map((resume) => ({ value: resume.id, label: resume.title })),
          ]}
        />
      </Field>

      {/* NO "separated by commas." ON EITHER OF THESE ANY MORE. The
          placeholders are `new-grad, fintech` and `react, postgres`, which
          demonstrate the comma instead of describing it -- and each hint was
          26px on its row. */}
      {shows('tags') &&
        text('tags', { id: 'tags', label: 'tags', icon: 'Tag', placeholder: 'new-grad, fintech' })}

      {shows('techStack') &&
        text('techStack', { id: 'tech_stack', label: 'tech stack', icon: 'Code', placeholder: 'react, postgres' })}

      {shows('isReferral') && (
        <div className="flex items-center gap-3">
          <Checkbox
            id="is_referral"
            checked={draft.isReferral}
            onCheckedChange={(checked) => set('isReferral', checked === true)}
          />
          <Label htmlFor="is_referral" className="text-body-m font-normal text-text-primary">
            came through a referral
          </Label>
        </div>
      )}

      {!open && hiddenCount > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="s"
          className="self-start px-0"
          onClick={() => setExpanded(true)}
        >
          <PlusIcon size={16} aria-hidden className={iconMotion('open')} />
          add more details
        </Button>
      )}
    </div>
  )
}
