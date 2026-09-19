import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// The route wrapper must read the same react-query cache every other screen
// reads (ApplicationsPage, ApplicationForm, useJobStats) rather than
// fetching on its own -- a second, cache-independent fetch here is exactly
// the stale-KPI bug this hook exists to prevent. Mocking the hook module
// lets these tests drive its isLoading/error/data states directly without
// standing up AuthProvider or QueryClientProvider.
const useJobsMock = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useJobs', () => ({ useJobs: useJobsMock }))

// The Overview reads the calendar as of M5.5 Item 5. Mocked for the same
// reason useJobs is -- and additionally because useEvents pulls in the real
// supabase client at module load, which throws on an unset URL.
const useEventsMock = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useEvents', () => ({ useEvents: useEventsMock }))

import Page from '../page'

describe('Dashboard route wrapper', () => {
  beforeEach(() => {
    useEventsMock.mockReturnValue({ data: [], isLoading: false, error: null })
  })

  it('shows a route skeleton while jobs are loading, not an empty dashboard', async () => {
    useJobsMock.mockReturnValue({ data: undefined, isLoading: true, error: null })
    render(<Page />)
    // `findBy`, not `queryBy`: the route skeleton sits behind a 200ms gate
    // (see ui/loading-skeletons) so a warm navigation never flashes a fake
    // page for one frame. Nothing is in the DOM at t=0 BY DESIGN, and an
    // immediate assertion was testing the absence of that gate.
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'overview' })).toBeNull()
  })

  it('surfaces a fetch error instead of rendering a zeroed-out KPI strip', () => {
    // A KPI strip of zeros is indistinguishable from a real empty account,
    // so a failed fetch has to say so rather than rendering the dashboard
    // body with an empty jobs array.
    useJobsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('network down'),
    })
    render(<Page />)
    expect(screen.getByText(/network down/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'overview' })).toBeNull()
    expect(screen.getByRole('button', { name: 'retry' })).toBeTruthy()
  })

  it('renders the dashboard body from the shared jobs cache once loaded', () => {
    useJobsMock.mockReturnValue({ data: [], isLoading: false, error: null })
    render(<Page />)
    // 'overview', not 'Dashboard': the sidebar nav, the Figma page title and
    // this heading now agree. Only the route path says dashboard.
    expect(screen.getByRole('heading', { name: 'overview' })).toBeTruthy()
    expect(useJobsMock).toHaveBeenCalled()
  })
})
