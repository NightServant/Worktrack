import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { eventService } from '@/services/eventService'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Hook to fetch the calendar events scheduled against one application.
 *
 * Same shape as `useJob` -- keyed on `['job-events', user?.id, jobId]`,
 * enabled only once both the id and the user are known. Named `useJobEvents`
 * rather than `useEvents` so it does not collide with the calendar's own
 * hook over `eventService.listFrom`, which Task 6 adds.
 */
export function useJobEvents(jobId?: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['job-events', user?.id, jobId],
    queryFn: () => eventService.listForJob(supabase, jobId as string),
    enabled: !!jobId && !!user,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

/**
 * Puts the record dialog's interview date on the calendar.
 *
 * THE INVALIDATIONS ARE THE FEATURE (Gabe, 2026-09-10: "after saving the
 * applications, Calendar page and upcoming events card must be updated
 * properly"). Three caches hold events and all three have to hear about a
 * write, or the interview lands in the database and none of the three screens
 * showing events moves:
 *
 *   `['events', user, 'upcoming']`  -- /calendar AND the Overview's
 *                                      "upcoming events" card, which is the
 *                                      same cache entry read twice.
 *   `['job-events', user, jobId]`   -- the record's own next-event panel.
 *   `['jobs', user]`                -- not events at all, but the status that
 *                                      came with them; the save that carried
 *                                      this already invalidates it, and
 *                                      re-invalidating is cheap next to the
 *                                      class of bug where it does not happen.
 *
 * Prefix-matched, so every user's entry and every jobId under those keys is
 * covered without this having to know which one it is.
 */
export function useScheduleInterview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { jobId: string; startsAt: string | null; title: string }) =>
      eventService.scheduleInterview(supabase, input.jobId, input.startsAt, input.title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] })
      queryClient.invalidateQueries({ queryKey: ['job-events'] })
    },
  })
}
