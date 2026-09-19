import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { CalendarEvent } from '@/services/events'
import type { Job } from '@/types'

// The route wrapper owns both reads Calendar needs: useEvents (primary,
// gates loading/error) and useJobs (supplementary, builds companyByJobId).
// Mocking both modules lets these tests drive their states directly without
// standing up AuthProvider or QueryClientProvider -- same technique
// dashboard/__tests__/page.test.tsx uses for its one hook. Fix round 2
// hoisted useJobs() out of the Calendar component and into this file, so
// this is now where that hook's mock belongs.
//
// The public-holidays pair is mocked for the same reason and one more: they
// are the only hooks in the app that talk to a THIRD-PARTY host
// (date.nager.at). A unit test must not depend on somebody else's uptime, and
// an unmocked one here would make the suite fail offline.
const useEventsMock = vi.hoisted(() => vi.fn())
const useJobsMock = vi.hoisted(() => vi.fn())
const useHolidaysMock = vi.hoisted(() => vi.fn(() => ({ data: [] })))
const useHolidayCountriesMock = vi.hoisted(() => vi.fn(() => ({ data: [] })))
vi.mock('@/hooks/useEvents', () => ({ useEvents: useEventsMock }))
vi.mock('@/hooks/useJobs', () => ({ useJobs: useJobsMock }))
vi.mock('@/hooks/usePublicHolidays', () => ({
  usePublicHolidays: useHolidaysMock,
  useHolidayCountries: useHolidayCountriesMock,
}))
// The remote-jobs feed under the month, same reasoning: a third-party host
// (jobicy.com) must never be reached from a unit test.
vi.mock('@/hooks/useJobFeed', () => ({
  useJobFeed: () => ({ data: [], isLoading: false, error: null }),
  useJobFeedIndustries: () => ({ data: [] }),
  useJobFeedLocations: () => ({ data: [] }),
}))

import Page from '../page'

const EVENT: CalendarEvent = {
  id: 'evt-1',
  job_id: 'job-1',
  user_id: 'user-1',
  kind: 'interview',
  title: 'Technical interview',
  starts_at: new Date().toISOString(),
  duration_minutes: 60,
  notes: null,
}

const JOB: Job = {
  id: 'job-1',
  user_id: 'user-1',
  company: 'Acme Corp',
  role: 'Staff Engineer',
  salary_min: null,
  salary_max: null,
  salary_currency: 'PHP',
  url: null,
  description: null,
  status: 'applied',
  date_applied: null,
  notes: null,
  contact_name: null,
  contact_email: null,
  contact_linkedin: null,
  contact_notes: null,
  location: null,
  work_mode: null,
  source: null,
  is_referral: false,
  tags: [],
  tech_stack: [],
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
}

describe('Calendar route wrapper', () => {
  it('shows a route skeleton while events are loading, not an empty calendar', async () => {
    useEventsMock.mockReturnValue({ data: undefined, isLoading: true, error: null })
    useJobsMock.mockReturnValue({ data: [], isLoading: false, error: null })
    render(<Page />)
    // `findBy`, not `queryBy`: the route skeleton sits behind a 200ms gate
    // (see ui/loading-skeletons) so a warm navigation never flashes a fake
    // page for one frame. Nothing is in the DOM at t=0 BY DESIGN, and an
    // immediate assertion was testing the absence of that gate.
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'calendar' })).toBeNull()
  })

  it('surfaces a failed events fetch rather than rendering an empty calendar', () => {
    useEventsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('network down'),
    })
    useJobsMock.mockReturnValue({ data: [], isLoading: false, error: null })
    render(<Page />)
    expect(screen.getByText(/network down/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'calendar' })).toBeNull()
    expect(screen.getByRole('button', { name: 'retry' })).toBeTruthy()
  })

  it('does not block on the supplementary jobs read -- a loading or failed jobs fetch still renders events', () => {
    useEventsMock.mockReturnValue({ data: [EVENT], isLoading: false, error: null })
    useJobsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    })
    render(<Page />)
    expect(screen.getByRole('heading', { name: 'planner' })).toBeTruthy()
  })

  it('joins event.job_id against the jobs cache and carries the company into the agenda', () => {
    useEventsMock.mockReturnValue({ data: [EVENT], isLoading: false, error: null })
    useJobsMock.mockReturnValue({ data: [JOB], isLoading: false, error: null })
    render(<Page />)
    expect(screen.getByRole('heading', { name: 'planner' })).toBeTruthy()
    // SCOPED TO THE MOBILE BLOCK, which is where the agenda lives. It used to
    // count every `Acme Corp` on the screen, and that number moved the moment
    // the rail started reporting what had already happened -- an event at
    // `now` is a held interview, so the company appeared once more. What this
    // test is about is the JOIN, not how many surfaces show its result.
    const agenda = document.querySelector('[data-week-strip]') as HTMLElement
    expect(within(agenda).getAllByText('Acme Corp').length).toBeGreaterThan(0)
  })
})
