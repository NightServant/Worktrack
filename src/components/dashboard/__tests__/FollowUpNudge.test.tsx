import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FollowUpNudge } from '../FollowUpNudge'
import { RouteBaseProvider } from '@/components/shell/routeBase'
import type { StaleCandidate } from '@/services/followUp'

/** Oldest first, the order getStaleApplications already returns. */
function candidates(n: number): StaleCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `job-${i}`,
    company: `Company ${i}`,
    role: 'Engineer',
    status: 'applied' as const,
    last_touched_at: new Date(2026, 0, i + 1).toISOString(),
  }))
}

const trigger = () => screen.getByRole('button', { name: /follow/i })

describe('FollowUpNudge when nothing is stale', () => {
  it('renders nothing at all', () => {
    // Absence is the stronger signal: an "all caught up" card looks like
    // content, so the eye learns to skip that slot and then skips it on the
    // day it matters.
    const { container } = render(<FollowUpNudge stale={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('FollowUpNudge on the dashboard', () => {
  // It used to render every quiet application inline, which on a real search
  // is routinely fifteen rows -- turning the one panel whose job is "the
  // single thing to do today" into the longest element on the page and pushing
  // both charts below the fold. It is now a count and a control.
  it('shows the count without listing anything', () => {
    render(<FollowUpNudge stale={candidates(15)} />)
    expect(trigger()).toHaveTextContent('15')
    // The list is the dialog's job now. Nothing is rendered inline.
    expect(screen.queryByTestId('follow-up-list')).toBeNull()
    expect(screen.queryByText('Company 0')).toBeNull()
  })

  it('counts one follow-up in the singular', () => {
    // "review 1 follow-ups" is the kind of thing that ships.
    render(<FollowUpNudge stale={candidates(1)} />)
    expect(trigger().textContent).toMatch(/1 follow-up\b/)
    expect(trigger().textContent).not.toMatch(/follow-ups/)
  })
})

/** The dialog's data rows, header excluded. */
function dataRows(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>('[data-follow-up-row]')]
}

/**
 * The dialog as a table, five rows a page (Gabe, 2026-10-09: "create a table
 * within the dialog with proper pagination of 5 rows, table header, and
 * data").
 */
describe('FollowUpNudge dialog', () => {
  it('is a table with a header, five rows a page, and every application reachable', async () => {
    const user = userEvent.setup()
    render(<FollowUpNudge stale={candidates(12)} />)
    await user.click(trigger())

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByRole('columnheader').map((th) => th.textContent?.trim())).toEqual([
      'application',
      'status',
      'quiet for',
      'open',
    ])
    expect(dataRows(dialog)).toHaveLength(5)
    expect(within(dialog).getByText(/1.5 of 12/)).toBeInTheDocument()

    // ALL of them, not a capped subset -- the last page holds the remainder,
    // and a truncated dialog would understate the backlog.
    await user.click(within(dialog).getByRole('button', { name: '3' }))
    expect(dataRows(dialog)).toHaveLength(2)
    expect(within(dialog).getByText(/11.12 of 12/)).toBeInTheDocument()
  })

  it('keeps the most stale ones first, where they are worth chasing', async () => {
    // getStaleApplications returns oldest-first, and that order is the point:
    // the first page is always the five most worth chasing.
    const user = userEvent.setup()
    render(<FollowUpNudge stale={candidates(12)} />)
    await user.click(trigger())

    const dialog = await screen.findByRole('dialog')
    expect(dataRows(dialog)[0]).toHaveTextContent('Company 0')
    await user.click(within(dialog).getByRole('button', { name: /next page/i }))
    expect(dataRows(dialog)[0]).toHaveTextContent('Company 5')
  })

  it('says how long each has waited in days, already subtracted', async () => {
    const user = userEvent.setup()
    const stale: StaleCandidate[] = [
      {
        id: 'job-0',
        company: 'Acme',
        role: 'Engineer',
        status: 'interviewing',
        last_touched_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]
    render(<FollowUpNudge stale={stale} />)
    await user.click(trigger())

    const dialog = await screen.findByRole('dialog')
    expect(dataRows(dialog)[0]).toHaveTextContent('30 days')
    // The summary leads with the size of the backlog and the costliest kind.
    expect(dialog.querySelector('[data-follow-up-summary]')!.textContent).toMatch(
      /1 application waiting, the longest for 30 days; 1 at the interview stage\./
    )
    // One page needs no pager.
    expect(dialog.querySelector('[data-follow-up-pager]')).toBeNull()
  })

  it('links each row to its own application', async () => {
    // This is the one element whose entire purpose is "go deal with THIS
    // application", so landing anywhere less specific defeats it.
    render(<FollowUpNudge stale={candidates(3)} />)
    await userEvent.click(trigger())

    const dialog = await screen.findByRole('dialog')
    for (const link of within(dialog).getAllByRole('link', { name: /Company 0/ })) {
      expect(link).toHaveAttribute('href', '/applications/job-0')
    }
  })

  it('keeps those links inside the demo when it is rendered there', async () => {
    // The demo renders the REAL screens. An unprefixed /applications/<id>
    // leaves the demo, hits the (app) auth guard and lands on /login, which
    // reads as the demo being broken rather than as a boundary working.
    render(
      <RouteBaseProvider base="/demo">
        <FollowUpNudge stale={candidates(3)} />
      </RouteBaseProvider>
    )
    await userEvent.click(trigger())

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByRole('link', { name: /Company 0/ })[0]).toHaveAttribute(
      'href',
      '/demo/applications/job-0'
    )
  })
})
