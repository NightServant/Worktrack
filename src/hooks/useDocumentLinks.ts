import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { documentLinkService, type DocumentLinkInput } from '@/services/documentLinkService'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Hook to fetch the CVs linked to one application.
 *
 * Same shape as `useJob` -- keyed on `['document-links', user?.id, jobId]`,
 * enabled only once both the id and the user are known.
 */
export function useDocumentLinks(jobId?: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['document-links', user?.id, jobId],
    queryFn: () => documentLinkService.listForJob(supabase, jobId as string),
    enabled: !!jobId && !!user,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

/**
 * The reverse read: which applications this CV was submitted to.
 *
 * Powers the document editor's application dropdown, so someone editing a CV
 * can see where it has already gone. Keyed separately from `document-links`
 * because it is a different question over the same table, and a write has to
 * invalidate BOTH -- pinning a CV to an application changes the answer on the
 * application screen and in the editor at the same time.
 */
export function useResumeLinks(resumeId?: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['resume-links', user?.id, resumeId],
    queryFn: () => documentLinkService.listForResume(supabase, resumeId as string),
    enabled: !!resumeId && !!user,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

/**
 * Which applications already have a document attached.
 *
 * FOR THE TAILORING PICKER, which must not offer a role that has already been
 * tailored for. Keyed without an id because it is the whole account's answer,
 * and invalidated by the same helper as the other two -- pinning a CV changes
 * this list as surely as it changes the other directions.
 */
export function useLinkedJobIds() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['linked-job-ids', user?.id],
    queryFn: () => documentLinkService.listLinkedJobIds(supabase),
    enabled: !!user,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

/**
 * Both directions of the same table go stale on any write, and forgetting one
 * is how the application screen and the editor come to disagree about a link
 * that was just made. One helper, called by both mutations.
 */
function useInvalidateLinks() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['document-links', user?.id] })
    void queryClient.invalidateQueries({ queryKey: ['resume-links', user?.id] })
    void queryClient.invalidateQueries({ queryKey: ['linked-job-ids', user?.id] })
  }
}

/** Records that a CV was submitted to an application. */
export function usePinDocumentLink() {
  const invalidate = useInvalidateLinks()
  return useMutation({
    mutationFn: (input: DocumentLinkInput) => documentLinkService.pin(supabase, input),
    onSuccess: invalidate,
  })
}

export function useUnpinDocumentLink() {
  const invalidate = useInvalidateLinks()
  return useMutation({
    mutationFn: ({ jobId, resumeId }: { jobId: string; resumeId: string }) =>
      documentLinkService.unpin(supabase, jobId, resumeId),
    onSuccess: invalidate,
  })
}
