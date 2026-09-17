'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCreateResume, useDeleteResume, useResume, useUpdateResume } from '@/hooks/useResumes'
import { useJobs } from '@/hooks/useJobs'
import { usePinDocumentLink, useResumeLinks } from '@/hooks/useDocumentLinks'
import { useToast } from '@/contexts/ToastContext'
import { RouteSkeleton } from '@/components/ui/loading-skeletons'
import { RouteError } from '@/components/ui/route-states'
import { buttonVariants } from '@/components/ui/button-variants'
import { AppDialog } from '@/components/ui/app-dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DocumentChooser } from '@/components/documents/DocumentChooser'
import { useCreateDocument } from '@/components/documents/useCreateDocument'
import type { NoticeKind } from '@/components/documents/DocumentsNotice'
import { WordResumeEditor } from '@/components/cv/WordResumeEditor'
import { isRetailorOfSameApplication, tailoredTitle } from '@/components/cv/applyTailoring'
import type { ResumeContent, ResumeMode } from '@/services/resumeService'

const DOCUMENTS = '/documents'

/**
 * What `/cv?draft=new` actually is: the document chooser, and the write it
 * leads to.
 *
 * A CHILD COMPONENT RATHER THAN A BRANCH INSIDE `CvRoute`, and the reason is
 * `useCreateDocument` -- it reads the stored LinkedIn profile so the template
 * it writes is already personalised, and a hook cannot be called
 * conditionally. Inlined, every reader who opened an existing CV would fire a
 * `user_profiles` query for a value only this one state uses, and every test
 * of the editor would have to mock a hook the editor never touches.
 *
 * THE CHOOSER SITS OVER A SKELETON, which is the honest thing to draw here.
 * M5 made this a full page on the argument that a dialog over an empty screen
 * has nothing behind it to protect, and Gabe overruled it (2026-08-29: "the
 * dialog adds user experience"). What is behind it on `/documents` is the
 * list; arriving straight at this URL there is nothing yet, so the skeleton
 * stands in for the editor that is about to exist.
 *
 * DISMISSING GOES BACK TO `/documents` rather than leaving the reader on a
 * skeleton of a document they declined to create. `replace`, so Back does not
 * bounce them straight into the dialog they just closed.
 */
function NewDocumentPrompt() {
  const router = useRouter()
  const { success, error: showError, info } = useToast()

  // The Documents screens report through `useDocumentsNotice`, which this
  // route has no business mounting -- its banner half is positioned against
  // the bottom nav, and the editor has no bottom nav. So the toast context is
  // adapted to the same three-kind signature, which is all the hook asks for.
  const notify = useCallback(
    (kind: NoticeKind, title: string, message?: string) => {
      const send = kind === 'error' ? showError : kind === 'success' ? success : info
      send(title, message)
    },
    [showError, success, info]
  )
  // `replace`, not push: this route is already standing on `?draft=new`, and
  // pushing would leave a history entry that re-opens the chooser on Back.
  const { creating, createBlank } = useCreateDocument({ notify, replace: true })

  return (
    <>
      <RouteSkeleton variant="detail" />
      <AppDialog
        open
        onOpenChange={(next) => {
          if (!next) router.replace(DOCUMENTS)
        }}
        title="new document"
        icon="Documents"
      >
        <DocumentChooser creating={creating} onChoose={(mode) => void createBlank(mode)} />
      </AppDialog>
    </>
  )
}

/**
 * The CV editor route.
 *
 * `src/screens/ResumePage.tsx` used to be three surfaces switched by a local
 * `activeDraftId`: a drafts hub, the Word editor and the LaTeX editor. M5
 * split it. The hub became `/documents`; the two editors moved to
 * `src/components/cv/` and are chosen here by a `?draft=` search param instead
 * of by component state.
 *
 * That param is the URL contract this route publishes:
 *
 *   /cv?draft=<resume-id>  opens that document in the editor
 *   /cv?draft=new          asks which KIND of document, creates it, then
 *                          replaces the URL with the real id
 *   /cv                    has no hub to show any more, so it redirects to
 *                          /documents
 *
 * Moving off local state is what makes a CV linkable at all -- `/documents`
 * links straight into a specific one, and so could an application's linked-CV
 * panel. It also means the browser's back button leaves an editor, which the
 * old in-place switch never allowed.
 *
 * `?draft=new` ASKS AGAIN, having briefly stopped. It was written to ask which
 * EDITOR; when the LaTeX editor went, one editor left it a modal with a single
 * button, so it was changed to create a CV on arrival. `ResumeMode` now names
 * the KIND of document rather than the engine, and a CV and a cover letter are
 * different enough that guessing is worse than asking -- so the dialog is back,
 * as `DocumentChooser`, and this URL behaves exactly as the `new document`
 * button on `/documents` does.
 *
 * THE WRITE ITSELF IS NOT HERE. `useCreateDocument` owns it for all three
 * create paths, because a document created without running the template
 * through `personalizeTemplate` arrives carrying raw `{{name|Your Name}}`.
 * Only the tailoring write below stays local, and it is not a template.
 */
function CvRoute() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // For the CV editor's tailoring rail: the applications this CV can be
  // tailored to. Read at the route, like every other read in this app, so the
  // editors stay renderable with plain props and no QueryClient.
  const { data: jobs = [] } = useJobs()
  const draftParam = searchParams.get('draft')
  const isNew = draftParam === 'new'

  const { success, error: showError } = useToast()
  const draftQuery = useResume(isNew ? null : draftParam)
  const createResume = useCreateResume()
  const updateResume = useUpdateResume()
  // Which applications the OPEN CV has already been tailored for. Read here
  // rather than inside the handler because it decides between two different
  // writes, and a hook cannot be called from inside a callback.
  const resumeLinks = useResumeLinks(isNew ? null : draftParam)
  const pinLink = usePinDocumentLink()
  const deleteResume = useDeleteResume()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  useEffect(() => {
    if (!draftParam) router.replace(DOCUMENTS)
  }, [draftParam, router])

  const deleteDraft = (draftId: string) => setPendingDeleteId(draftId)

  const confirmDeleteDraft = async () => {
    if (!pendingDeleteId) return
    const draftId = pendingDeleteId
    try {
      await deleteResume.mutateAsync(draftId)
      success('CV deleted', 'The draft was removed.')
      router.replace(DOCUMENTS)
    } catch (err) {
      showError('Delete failed', err instanceof Error ? err.message : 'Could not delete the CV')
    } finally {
      setPendingDeleteId(null)
    }
  }

  /**
   * A TAILORED CV IS A NEW DOCUMENT, and this is where it gets made.
   *
   * The rail produces a title and a rewritten body; everything after that is
   * route work -- `useCreateResume` wants a QueryClient, the redirect wants
   * the router, and the editors are kept clear of both so they stay
   * renderable with plain props. `push`, not `replace`: the CV you tailored
   * from is where the back button should land, since comparing the two is the
   * first thing anyone does.
   *
   */
  const tailorIntoDraft = async (input: {
    title: string
    content: ResumeContent
    jobId: string
  }): Promise<'created' | 'updated'> => {
    // A NEW APPLICATION IS A NEW FILE; THE SAME ONE AGAIN IS A REWRITE.
    //
    // Every run used to create a document, which is right the first time and
    // wrong every time after: tailoring against one posting, reading it, and
    // running it again is an ordinary thing to do, and it left a pile of files
    // with the same name differing only in which run produced them. Nothing in
    // /documents told them apart, and the pile grew per re-run rather than per
    // application.
    //
    // `application_documents` already records which CV went to which
    // application, so the question "have I tailored THIS file for THIS posting
    // before?" is a row that either exists or does not -- no new column, and
    // no guessing from the title, which would collide on two roles at the same
    // company.
    // `input.title` is `tailoredTitle`'s answer for this run; when the open
    // document is already called that, it IS the tailored CV for this company
    // rather than a master that happens to have been sent there.
    const isRetailor = isRetailorOfSameApplication({
      draftId: isNew ? null : draftParam,
      draftTitle: draftQuery.data?.title ?? '',
      tailoredName: input.title,
      jobId: input.jobId,
      links: resumeLinks.data ?? [],
    })

    try {
      if (isRetailor) {
        // IN PLACE, AND THE TITLE IS LEFT ALONE. It is the same document for
        // the same posting; renaming it on every re-run is how "CV — Initech"
        // becomes a title nobody can read. The previous text is not lost: the
        // editor forces a snapshot before handing off, so the version being
        // overwritten is in the history this CV already keeps.
        await updateResume.mutateAsync({
          id: draftParam as string,
          patch: { content: input.content },
        })
        success('Tailored CV updated', 'Rewritten for the same application.')
        return 'updated'
      }

      const created = await createResume.mutateAsync({
        mode: 'word',
        title: input.title,
        content: input.content,
      })
      // LINKED IMMEDIATELY, because the link is what makes the NEXT run a
      // rewrite instead of a third file. Tailoring never wrote one before, so
      // "same application" was a question nothing in the data could answer.
      if (input.jobId) {
        await pinLink.mutateAsync({ job_id: input.jobId, resume_id: created.id })
      }
      success('Tailored CV created', `${input.title} is ready.`)
      router.push(`/cv?draft=${created.id}`)
      return 'created'
    } catch (err) {
      // NOT "Tailoring failed" (found in review, 2026-09-13). The rewrite is
      // the expensive half and it succeeded; the rail says so in as many
      // words, and a louder toast claiming the opposite sent people back to
      // re-run a request that costs metered allowance.
      showError(
        'Could not save the tailored CV',
        err instanceof Error ? err.message : 'The rewrite is still on screen. Try again.'
      )
      // Rethrown so the rail can say the rewrite survived and only the save
      // failed -- a swallowed failure here leaves it claiming success over a
      // document that was never written.
      throw err
    }
  }

  const persistDraft = (
    draftId: string,
    title: string,
    mode: ResumeMode,
    content: ResumeContent
  ) => updateResume.mutateAsync({ id: draftId, patch: { title, mode, content } })

  if (!draftParam) return <RouteSkeleton variant="detail" />

  if (isNew) return <NewDocumentPrompt />

  if (draftQuery.isLoading) return <RouteSkeleton variant="detail" />

  // A failed read and a CV that is not there are different facts, and the
  // second one cannot be fixed by reloading the same URL -- RLS makes a bad id
  // and someone else's CV indistinguishable, exactly as on the application
  // detail route -- so only the first keeps RouteError's default retry.
  if (draftQuery.error) {
    return (
      <RouteError
        title="could not open that CV."
        message={
          draftQuery.error instanceof Error
            ? draftQuery.error.message
            : 'An error occurred while loading it.'
        }
        // See RouteError. This route already reasoned about the distinction in
        // prose above -- "RLS makes a bad id and someone else's CV
        // indistinguishable" -- and this is what finally acts on it.
        error={draftQuery.error}
      />
    )
  }

  const draft = draftQuery.data
  if (!draft) {
    return (
      <RouteError
        title="could not find that CV."
        message="It may have been deleted, or the link may be wrong."
        action={
          <Link href={DOCUMENTS} className={buttonVariants({ variant: 'secondary', size: 's' })}>
            back to documents
          </Link>
        }
      />
    )
  }

  return (
    <>
      <WordResumeEditor
        key={draft.id}
        draft={draft}
        // The tailoring rail's application picker. Read here rather than in
        // the editor, so the editors stay renderable without a QueryClient.
        jobs={jobs}
        /*
          WHICH APPLICATION THIS CV WAS TAILORED FOR, or nothing if it is an
          ordinary CV.

          TITLE-PLUS-LINK, NOT MERELY LINKED, and the distinction is the whole
          correctness of it: a master CV can be pinned to fifty applications,
          and "has a link" would call every one of those a tailored copy and
          hide the picker on the document most in need of it. `tailoredTitle`
          is idempotent, so re-deriving it here and comparing is the same
          evidence `isRetailorOfSameApplication` already trusts.
        */
        tailoredForJobId={
          (resumeLinks.data ?? []).find(
            (link) => tailoredTitle(draft.title, link.company) === draft.title
          )?.job_id
        }
        backHref={DOCUMENTS}
        onDelete={(id) => deleteDraft(id)}
        onPersistDraft={persistDraft}
        onTailored={(input) => tailorIntoDraft(input)}
      />
      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null)
        }}
        title="delete this CV?"
        body="This cannot be undone."
        confirmLabel="delete"
        destructive
        onConfirm={confirmDeleteDraft}
      />
    </>
  )
}

/**
 * `useSearchParams` opts a client page out of static prerendering, which Next
 * 15 fails the build over unless the read sits behind a Suspense boundary.
 */
export default function Page() {
  return (
    <Suspense fallback={<RouteSkeleton variant="detail" />}>
      <CvRoute />
    </Suspense>
  )
}
