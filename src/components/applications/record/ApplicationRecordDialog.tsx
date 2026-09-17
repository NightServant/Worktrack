'use client'

import * as React from 'react'
import { AppDialog } from '@/components/ui/app-dialog'
import { ApplicationRecordView } from './ApplicationRecordView'
import { EMPTY_RECORD_DATA, type ApplicationRecordData } from './recordData'
import type { SupportedCurrency } from '@/services/userPreferences'
import type { Job, JobFormData } from '@/types'

/**
 * One application, in a dialog: the record and its editor, which are now the
 * same thing.
 *
 * WHAT CHANGED, and why the header is nearly empty (Worktrack Revisions items
 * 2 and 3):
 *
 * - NO `edit` BUTTON. There is no read-only mode left to leave -- every field
 *   in the first two columns is a control. A button that switched between two
 *   renderings of the same data was a mode that existed only because the form
 *   used to live somewhere else.
 * - NO `delete` BUTTON. Delete is a row-level action and it is on the row, in
 *   the table, beside the row it destroys. Having it here as well meant the
 *   confirm dialog sat on top of a record of something that no longer existed.
 * - SAVE MOVED INSIDE, to the foot of the record. It is the only thing this
 *   dialog commits, and it belongs at the end of what it commits.
 *
 * A BOTTOM SHEET BELOW 640, which is `AppDialog`'s own behaviour and is why
 * the mobile surface is this dialog rather than a route now: the phone gets
 * the same record, anchored to the edge a thumb can reach.
 *
 * A NEW APPLICATION DOES NOT COME HERE. It goes through `AddApplicationDialog`,
 * which is four steps and a model, so `job` is never null.
 *
 * TWO VIEWS, ONE DIALOG (Gabe, 2026-09-13: "when I open the job desc, overview
 * dialog must be replaced ... when I close the job desc dialog, the
 * application dialog must appear, do not close the entire section"). The
 * posting gets the whole surface, and coming back from it lands on the record
 * rather than on the table.
 *
 * IT IS NOT TWO DIALOGS, and that is the load-bearing decision here. Base UI
 * unmounts a closed dialog's children, so a second `AppDialog` beside this one
 * would tear `ApplicationRecordView` down every time somebody read the posting
 * -- and with it the draft: every typed-but-unsaved field, the pending CV
 * pick, which fields `add more details` had revealed. That is precisely the
 * silent loss the discard confirmation in ApplicationsPage exists to prevent,
 * except it would happen on a button that only promised to show more text.
 *
 * So the state is here and the panels are both inside the one dialog. The
 * record's columns hide behind the `hidden` attribute rather than unmounting
 * (see ApplicationRecordView), the posting's own panel renders from inside the
 * record's form because that is where the draft lives, and what changes at
 * this level is the chrome: the title, the glyph, the back control, and what
 * Escape means.
 */
export interface ApplicationRecordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  job: Job | null
  data?: ApplicationRecordData
  defaultCurrency: SupportedCurrency
  saving?: boolean
  /**
   * Resolves `false` on a rejected save. See ApplicationRecordView.
   *
   * `interviewAt` is the interview date the record's own field carries —
   * `undefined` when it was not touched, `null` when it was cleared. It is a
   * row in `events` rather than a column on `jobs`, so it cannot travel
   * inside `JobFormData`.
   */
  onSubmit: (
    data: JobFormData,
    interviewAt?: string | null
  ) => void | boolean | Promise<void | boolean>
  onDirtyChange?: (dirty: boolean) => void
  /** For the record's "cv used" field. */
  resumes?: { id: string; title: string }[]
  linkedResumeId?: string | null
  onLinkedResumeChange?: (resumeId: string | null) => void
}

export function ApplicationRecordDialog({
  open,
  onOpenChange,
  job,
  data = EMPTY_RECORD_DATA,
  defaultCurrency,
  saving = false,
  onSubmit,
  onDirtyChange,
  resumes,
  linkedResumeId,
  onLinkedResumeChange,
}: ApplicationRecordDialogProps) {
  const [view, setView] = React.useState<'record' | 'description'>('record')

  // Back to the record when the dialog closes, and when the row underneath it
  // changes -- reopening on the posting of the application you looked at last
  // time is a surface nobody asked for. Cheaper than resetting from the close
  // handler, which the discard guard can decline to honour.
  React.useEffect(() => setView('record'), [open, job?.id])

  return (
    <AppDialog
      open={open}
      onOpenChange={(next, reason) => {
        // ESCAPE MEANS BACK WHILE THE POSTING IS OPEN, and only Escape: the
        // header's close button and a click on the overlay still mean close,
        // because both are aimed at the dialog rather than at the panel. The
        // guard in ApplicationsPage then does what it always does with a dirty
        // record.
        if (!next && reason === 'escape-key' && view === 'description') {
          setView('record')
          return
        }
        onOpenChange(next)
      }}
      size="xl"
      // THE HEADING NAMES THE SCREEN, NOT THE ROW (Gabe, 2026-09-10). It was
      // the job title, and above it an eyebrow repeating the company and the
      // status -- all three of which the first column carries as editable
      // fields a few lines below. So the widest type on the dialog was a
      // duplicate of a field, the eyebrow was a duplicate of two more, and
      // nothing on it said what the dialog actually was.
      //
      // Gabe removed the eyebrow on sight ("remove this header, its
      // unnecessary"), which is the right call for the same reason: a record
      // whose first column opens with COMPANY and POSITION does not need them
      // printed twice, and the status marker is a read-only copy of a dropdown
      // sitting under it.
      // The record keeps its own chrome still and scrolls only its columns.
      bodyScroll={false}
      headerSeparator={false}
      title={view === 'record' ? 'application overview' : 'job description'}
      icon={view === 'record' ? 'Briefcase' : 'Documents'}
      // THE WAY BACK IS IN THE HEADER, opposite the title it replaced, which
      // is where the thing it undoes happened. `autoFocus` because the control
      // that opened this view has just been hidden: without it focus falls to
      // the body, and a keyboard or screen reader lands nowhere.
      // NO ACTIONS IN THE HEADER (Gabe, 2026-09-13: the posting's controls
      // "must be a new row"). `back to application` and `show posting` lived
      // here, opposite the title. They belong to the POSTING rather than to
      // the dialog, and `add a new section` could never have joined them in a
      // title bar -- so all three moved into a control row inside the view.
      // See RecordDescription.
      // NO DESCRIPTION (Gabe, 2026-09-11: "remove the description of the
      // description"). It was four lines explaining that the bar below tracks
      // progress and the three columns hold the job, the posting and the ATS
      // match -- all of which the bar and the three headings say for
      // themselves, in place, where somebody is already looking.
      //
      // It cost about 130px at the top of every open, which on a 900px laptop
      // is a fifth of the record pushed under the fold to explain a layout
      // nobody had trouble reading. A dialog that has to narrate itself is a
      // dialog with a labelling problem; the fix is the labels, not the essay.
    >
      {job && (
        <ApplicationRecordView
          // Keyed so switching rows without closing the dialog rebuilds the
          // draft against the new job rather than keeping the previous row's
          // typed values in the same mounted component.
          key={job.id}
          job={job}
          data={data}
          defaultCurrency={defaultCurrency}
          saving={saving}
          onSubmit={onSubmit}
          onDirtyChange={onDirtyChange}
          resumes={resumes}
          linkedResumeId={linkedResumeId}
          onLinkedResumeChange={onLinkedResumeChange}
          postingOpen={view === 'description'}
          onReadMore={() => setView('description')}
          onBack={() => setView('record')}
        />
      )}
    </AppDialog>
  )
}
