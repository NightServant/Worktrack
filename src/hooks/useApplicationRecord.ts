import { useActivity } from '@/hooks/useActivity'
import { useJobStatusHistory } from '@/hooks/useJobs'
import { useDocumentLinks } from '@/hooks/useDocumentLinks'
import { useJobEvents } from '@/hooks/useJobEvents'
import { useCvText } from '@/hooks/useCvText'
import { matchKeywords } from '@/services/atsMatch'
import type { ApplicationRecordData } from '@/components/applications/record/recordData'

/**
 * The four secondary reads an application record needs, plus the ATS match
 * derived from two of them.
 *
 * WHY IT IS A HOOK AND NOT STILL INLINE IN THE ROUTE. This was the body of
 * `applications/[id]/page.tsx`. There are now two surfaces showing the same
 * record -- the desktop dialog on the list screen and the mobile page -- and
 * a second hand-copied edition of "sort the links, take the newest, read its
 * text, match it against the description, and only if both exist" is exactly
 * the kind of duplication that goes quietly wrong in one copy.
 *
 * `id` is nullable because the desktop surface asks for the record of
 * whichever row is open, and usually none is. Every underlying query is
 * `enabled: !!jobId`, so a null id fetches nothing and each query's
 * `isLoading` stays false -- react-query reports a disabled query as pending
 * but NOT loading, which is what keeps `loading` here from being stuck true
 * forever whenever the dialog is shut.
 *
 * `useCvText` is gated one step further, behind the links read resolving and
 * producing something to read. An application with no linked CV never
 * enables it, so it never blocks.
 */
export function useApplicationRecord(
  id: string | null | undefined,
  description?: string | null
): ApplicationRecordData {
  const jobId = id ?? undefined

  const activityQuery = useActivity(jobId)
  const linksQuery = useDocumentLinks(jobId)
  const eventsQuery = useJobEvents(jobId)
  // For the pipeline bar only, and it is the one read that answers a question
  // the `jobs` row cannot: whether a rejected application ever reached
  // interviewing. Same `enabled: !!jobId` gate as the rest.
  const historyQuery = useJobStatusHistory(jobId)

  const activity = activityQuery.data ?? []
  // THE CV LINKS ONLY. An application carries a cover letter too now, and
  // everything this record does with a link -- the ATS score, the "scored
  // against" line -- is about the CV.
  const links = (linksQuery.data ?? []).filter((link) => link.mode === 'word')
  const events = eventsQuery.data ?? []
  const history = historyQuery.data ?? []

  // Newest link first, then read that one CV. Sorted on a copy: `links` is
  // react-query's cached array, and sorting it in place would mutate the
  // cache every other consumer of this key reads from.
  const latestLink =
    links.length > 0
      ? [...links].sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())[0]
      : null
  const cvTextQuery = useCvText(latestLink?.resume_id)
  const cvText = cvTextQuery.data

  const nextEvent = events.find((event) => new Date(event.starts_at).getTime() >= Date.now()) ?? null
  // The interview the record's own date field edits. `listForJob` orders by
  // `starts_at`, so the first match is the earliest -- the same one
  // `eventService.scheduleInterview` writes to.
  const interview = events.find((event) => event.kind === 'interview') ?? null
  const match = description && cvText ? matchKeywords(cvText, description) : null

  return {
    activity,
    history,
    links,
    nextEvent,
    interview,
    match,
    activityError: !!activityQuery.error,
    linksError: !!linksQuery.error,
    nextEventError: !!eventsQuery.error,
    atsError: !!cvTextQuery.error,
    loading:
      activityQuery.isLoading ||
      linksQuery.isLoading ||
      eventsQuery.isLoading ||
      historyQuery.isLoading ||
      cvTextQuery.isLoading,
  }
}
