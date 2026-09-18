import { useQuery } from '@tanstack/react-query'
import { eventService } from '@/services/eventService'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Every scheduled item in the calendar's window, for the calendar screen.
 * Named `useEvents` rather than `useUpcomingEvents` to mirror
 * `useJobs`/`useJob`'s naming (the plural hook is the list read); see
 * `useJobEvents`'s docblock for why that one hook, over
 * `eventService.listForJob`, is named the way it is instead of colliding
 * with this one.
 *
 * THE WINDOW REACHES BACK NOW, and until 2026-09-18 it did not: the anchor was
 * `now`, so an interview that had already been held simply did not exist on
 * this screen -- the month grid drew an empty cell on the day of it, and `up
 * next` could not report it however hard it looked. That is the read behind
 * Gabe's "up next section must show the past activities occurred ... and past
 * interviews".
 *
 * SIXTY DAYS, which is a judgement rather than a measurement: it covers the
 * month the grid opens on and the one before it, which is as far back as
 * anybody scrolls looking for what happened, and it keeps a first-of-the-month
 * visit from showing a grid with the previous three weeks blank. The rail's
 * own memory is much shorter -- see `RECENT_WINDOW_DAYS`.
 *
 * `fromIso` is computed at call time rather than passed in, since both readers
 * want the same window and there is no second caller that would need another.
 */
const WINDOW_DAYS = 60
export function useEvents() {
  const { user } = useAuth()
  return useQuery({
    // The key names the window rather than `upcoming`, so a client holding a
    // cached future-only list from the previous build does not serve it.
    queryKey: ['events', user?.id, 'window', WINDOW_DAYS],
    queryFn: () =>
      eventService.listFrom(
        supabase,
        new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
      ),
    enabled: !!user,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}
