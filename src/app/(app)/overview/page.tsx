'use client'

import { useJobs } from '@/hooks/useJobs'
import { useEvents } from '@/hooks/useEvents'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { RouteSkeleton } from '@/components/ui/loading-skeletons'
import { RouteError } from '@/components/ui/route-states'

/**
 * Thin route wrapper. All the layout lives in `Dashboard`, which takes its
 * data as props so it can be rendered directly in tests without going
 * through Next routing -- this component's only job is to fetch and hand it
 * off.
 *
 * Goes through `useJobs()` rather than calling `jobService.getJobs()`
 * directly, because `ApplicationsPage`, `ApplicationForm` and `useJobStats`
 * all read the same react-query cache under the `['jobs', user?.id]` key. A
 * separate `useEffect` fetch here would be a second, cache-independent copy
 * of the list: edit an application on `/applications` and land back here,
 * and the KPI strip would show pre-edit numbers until a hard reload --
 * exactly what mounting react-query is meant to prevent.
 */
export default function Page() {
  const { data: jobs = [], isLoading, error } = useJobs()
  // The Overview never read the calendar before M5.5: its "upcoming events"
  // block printed a sentence derived from job statuses, so there was nothing
  // to be empty about. `useEvents` already existed and /planner already used
  // it. Deliberately NOT part of the route's loading/error gate -- a calendar
  // that is slow or failing must not blank the whole Overview, so its three
  // states are handled inside the panel that owns them.
  const events = useEvents()

  if (isLoading) {
    return <RouteSkeleton variant="dashboard" />
  }

  // A KPI strip full of zeros looks exactly like an empty account, so a
  // failed fetch has to say so rather than silently rendering one.
  if (error) {
    return (
      <RouteError
        title="could not load your dashboard."
        message={error instanceof Error ? error.message : 'An error occurred while loading your applications.'}
        // See RouteError: a refusal gets its own screen and no retry button.
        error={error}
      />
    )
  }

  return (
    <Dashboard
      jobs={jobs}
      events={events.data ?? []}
      eventsLoading={events.isLoading}
      eventsError={!!events.error}
    />
  )
}
