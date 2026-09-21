'use client'

import * as React from 'react'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  useJobs,
  useCreateJob,
  useCreateJobsBulk,
  useUpdateJob,
  useDeleteJob,
  useAutofillJobFromUrl,
} from '@/hooks/useJobs'
import { useToast } from '@/contexts/ToastContext'
import { ApplicationsPage } from '@/components/applications/ApplicationsPage'
import { useBookmarkletImport } from '@/components/applications/useBookmarkletImport'
import { useApplicationRecord } from '@/hooks/useApplicationRecord'
import { RouteSkeleton } from '@/components/ui/loading-skeletons'
import { RouteError } from '@/components/ui/route-states'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import { useResumes } from '@/hooks/useResumes'
import { linksToUnpin } from '@/services/applicationDocuments'
import { usePostingDigest } from '@/hooks/usePostingDigest'
import {
  useDocumentLinks,
  usePinDocumentLink,
  useUnpinDocumentLink,
} from '@/hooks/useDocumentLinks'
import { useScheduleInterview } from '@/hooks/useJobEvents'
import { resolveDefaultCurrency } from '@/services/userPreferences'
import { useUserCountry } from '@/hooks/useUserCountry'
import type { Job, JobFormData } from '@/types'

function message(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.toLowerCase().includes('permission denied')
    ? 'Permission denied. Check the row-level security policies on jobs.'
    : raw || fallback
}

/**
 * Thin route wrapper. The screen itself is a pure component over props so it
 * can be tested without Next routing or a QueryClient; everything stateful
 * lives here.
 *
 * Every read and write goes through the `useJobs` hooks rather than
 * `jobService` directly, so all of them land on the same `['jobs', user?.id]`
 * cache entry the dashboard reads. Dragging a card between columns here has to
 * move the dashboard's KPI numbers too, and it does so by invalidating one key
 * rather than by anyone re-fetching.
 *
 * Default currency comes from `useUserPreferences`, the read half of the
 * seam Task 4 deliberately left open: `resolveDefaultCurrency` already knows
 * how to turn "no row yet" into PHP, so passing `prefsQuery.data ?? null`
 * straight through covers both the loading state and a genuine first-time
 * user without this route needing to gate the whole board on a preferences
 * fetch the way it already gates on the jobs fetch below.
 */
function ApplicationsRoute() {
  const { data: jobs = [], isLoading, error } = useJobs()
  const { data: prefs = null } = useUserPreferences()
  /*
    THE OPENING CURRENCY FOLLOWS THE READER when they have never set one. The
    preferences row is created lazily on first write, so most people have none
    and every one of them used to start a new application in PHP. Detected
    after mount -- see `useUserCountry`.
  */
  const country = useUserCountry('PH')
  const createJob = useCreateJob()
  const createJobsBulk = useCreateJobsBulk()
  const updateJob = useUpdateJob()
  const deleteJob = useDeleteJob()
  const autofill = useAutofillJobFromUrl()
  const { success, error: showError } = useToast()
  const [pendingDelete, setPendingDelete] = React.useState<Job | null>(null)

  // WHICH RECORD IS OPEN, and its four secondary reads.
  //
  // The screen owns the selection and reports it here; this route owns the
  // reads, the same division every other screen in the app uses. Every query
  // behind `useApplicationRecord` is `enabled: !!jobId`, so nothing is
  // fetched at all while the dialog is shut.
  //
  // It is kept as the whole `Job` rather than an id because the ATS match
  // needs the row's `description`, and holding the row avoids a second lookup
  // through `jobs` on every render.
  const [openJob, setOpenJob] = React.useState<Job | null>(null)
  // THE SAME SNAPSHOT PROBLEM AS THE SCREEN'S OWN, one level up. `openJob` is
  // the row as it was when the dialog opened; `useApplicationRecord` reads the
  // DESCRIPTION off it to score the ATS match. Save a description and the
  // match would keep scoring against the old one -- part of what Gabe saw as
  // "new data is not rendering immediately" (2026-09-06).
  //
  // Only the id is really being held; the row is re-read from the list every
  // render, so a save, a refetch or an edit in another tab all reach it.
  const liveOpenJob = openJob
    ? (jobs.find((candidate) => candidate.id === openJob.id) ?? openJob)
    : null
  const record = useApplicationRecord(liveOpenJob?.id, liveOpenJob?.description)
  // The CVs offered by the form's "cv used" field, and whichever one is
  // already pinned to the row that is open.
  const { data: resumes = [] } = useResumes()
  const { data: openLinks = [] } = useDocumentLinks(liveOpenJob?.id)
  const digest = usePostingDigest()
  const pinLink = usePinDocumentLink()
  const unpinLink = useUnpinDocumentLink()
  const scheduleInterview = useScheduleInterview()

  // A desktop visitor landing on `/applications/<id>` is redirected here with
  // the id in the query, because that route is the mobile surface now.
  const params = useSearchParams()
  const openParam = params.get('application')
  // `?add=<url>` is how the calendar's job feed hands a posting to the add
  // wizard. It carries no id because there is no row yet.
  const addParam = params.get('add')
  /**
   * The bookmarklet's payload, if the reader arrived from one.
   *
   * The URL rides `addParam` above -- the same parameter the calendar's
   * `track it` uses -- because only the page SOURCE is too big for a query
   * string. See `useBookmarkletImport` for why any origin may send it and what
   * stops that mattering.
   */
  // `.html` only: a posting is one page, and the profile bookmarklet is the
  // one that fetches subpages for itself.
  const importedHtml =
    useBookmarkletImport(params.get('import') === 'bookmarklet')?.html ?? null

  if (isLoading) {
    return <RouteSkeleton variant="table" />
  }

  // An empty board and a failed fetch look identical, so the failure has to
  // say so rather than falling through to the "no applications yet" state.
  if (error) {
    return (
      <RouteError
        title="could not load your applications."
        message={error instanceof Error ? error.message : 'An error occurred while loading them.'}
        // See RouteError: a refusal gets its own screen and no retry button.
        error={error}
      />
    )
  }

  /**
   * Records which CV was submitted, after the application itself is saved.
   *
   * IT RUNS AFTER, and for creates it has to: `application_documents.job_id`
   * references a row that does not exist until the insert returns. That is
   * also why `createJob` is awaited for its RESULT here rather than fired and
   * forgotten.
   *
   * A FAILED LINK DOES NOT FAIL THE SAVE. The application is the thing the
   * person was writing; losing it because a secondary row would not write
   * would be the wrong trade. The toast says which half worked.
   */
  const linkResume = async (jobId: string, resumeId: string | null | undefined) => {
    // `undefined` means the field was never touched. Only an explicit `null`
    // means "no CV", and only that should remove an existing link.
    if (resumeId === undefined) return
    try {
      // THE OLD CV HAS TO GO FIRST. `application_documents` is unique on the
      // PAIR, so pinning a different CV adds a row instead of replacing one --
      // the application ends up linked to both and the dialog reads whichever
      // came back first. That is Gabe's "not functioning when I select the new
      // CV": the pick was stored, beside the one it was meant to replace. See
      // `linksToUnpin`.
      //
      // Reads the links already loaded for the open row rather than
      // re-fetching: a newly created application cannot have any, so the only
      // case with something to remove is the one where `openLinks` is already
      // the right list.
      for (const staleId of linksToUnpin(openLinks, resumeId)) {
        await unpinLink.mutateAsync({ jobId, resumeId: staleId })
      }
      if (resumeId) await pinLink.mutateAsync({ job_id: jobId, resume_id: resumeId })
    } catch (err) {
      showError('Saved, but the CV link did not', message(err, 'Unknown error'))
    }
  }

  /**
   * Puts the record's interview date on the calendar, after the application
   * itself is saved.
   *
   * SAME SHAPE AS `linkResume`, ABOVE, AND FOR THE SAME THREE REASONS: it
   * writes a different table (`events`), it needs a job id that does not
   * exist until a create returns, and a failure here must not fail the save.
   * The application is what the person was editing; losing it because a
   * calendar row would not write is the wrong trade, and the toast says which
   * half worked.
   *
   * `undefined` means the field was never touched -- see
   * `ApplicationRecordView`'s `onSubmit`. Only an explicit `null` removes an
   * interview, and only a real edit writes one at all, so an ordinary save
   * makes no event request.
   *
   * `useScheduleInterview` invalidates `['events']` on success, which is the
   * single cache entry both /planner and the Overview's "upcoming events"
   * card read -- so both move on their own the moment this lands.
   */
  const saveInterview = async (
    jobId: string,
    interviewAt: string | null | undefined,
    job: { company: string }
  ) => {
    if (interviewAt === undefined) return
    try {
      await scheduleInterview.mutateAsync({
        jobId,
        startsAt: interviewAt,
        title: `Interview — ${job.company}`,
      })
    } catch (err) {
      showError('Saved, but the interview did not reach your calendar', message(err, 'Unknown error'))
    }
  }

  const handleCreate = async (
    data: JobFormData,
    resumeId?: string | null,
    interviewAt?: string | null
  ) => {
    try {
      const created = await createJob.mutateAsync(data)
      success('Application added')
      if (created?.id) {
        await linkResume(created.id, resumeId)
        await saveInterview(created.id, interviewAt, data)
      }
      return true
    } catch (err) {
      showError('Could not add the application', message(err, 'Unknown error'))
      return false
    }
  }

  const handleUpdate = async (
    id: string,
    data: JobFormData,
    resumeId?: string | null,
    interviewAt?: string | null
  ) => {
    try {
      await updateJob.mutateAsync({ id, data })
      success('Application updated')
      await linkResume(id, resumeId)
      await saveInterview(id, interviewAt, data)
      return true
    } catch (err) {
      showError('Could not update the application', message(err, 'Unknown error'))
      return false
    }
  }

  const handleDelete = (job: Job) => setPendingDelete(job)

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const job = pendingDelete
    try {
      await deleteJob.mutateAsync(job.id)
      success('Application deleted')
    } catch (err) {
      showError('Could not delete the application', message(err, 'Unknown error'))
    } finally {
      setPendingDelete(null)
    }
  }

  const handleImport = async (rows: JobFormData[]) => {
    try {
      await createJobsBulk.mutateAsync(rows)
      success('CSV imported', `${rows.length} added`)
      return true
    } catch (err) {
      showError('Import failed', message(err, 'Unknown error'))
      return false
    }
  }

  return (
    <>
      <ApplicationsPage
        jobs={jobs}
        defaultCurrency={resolveDefaultCurrency(prefs, country)}
        onDigest={(text) => digest.mutateAsync(text)}
        resumes={resumes.map((resume) => ({ id: resume.id, title: resume.title }))}
        linkedResumeId={openLinks[0]?.resume_id ?? null}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        onImport={handleImport}
        onAutofill={(url, html) => autofill.mutateAsync({ url, html })}
        onCsvError={(msg) => showError('CSV import failed', msg)}
        saving={createJob.isPending || updateJob.isPending}
        importing={createJobsBulk.isPending}
        autofilling={autofill.isPending}
        record={record}
        onOpenJobChange={setOpenJob}
        initialOpenId={openParam}
        initialAddUrl={addParam}
        initialAddHtml={importedHtml}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={pendingDelete ? `Delete ${pendingDelete.role} at ${pendingDelete.company}?` : ''}
        body="This cannot be undone."
        confirmLabel="delete"
        destructive
        onConfirm={confirmDelete}
      />
    </>
  )
}

/**
 * `useSearchParams` opts a client page out of static prerendering, which Next
 * 15 fails the build over unless the read sits behind a Suspense boundary --
 * the same wrapper `/cv` needs for the same reason.
 */
export default function Page() {
  return (
    <Suspense fallback={<RouteSkeleton variant="table" />}>
      <ApplicationsRoute />
    </Suspense>
  )
}
