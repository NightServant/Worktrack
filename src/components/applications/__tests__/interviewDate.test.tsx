import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApplicationRecordView } from '../record/ApplicationRecordView'
import { resolveDefaultCurrency } from '@/services/userPreferences'
import { toLocalDateTimeInput } from '@/services/date'
import { makeJob } from '@/test/fixtures'
import type { CalendarEvent } from '@/services/events'
import type { ApplicationRecordData } from '../record/recordData'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

afterEach(() => cleanup())

const CURRENCY = resolveDefaultCurrency(null)

const INTERVIEWING = makeJob({ id: 'job-1', status: 'interviewing', company: 'Acme' })

/** 20 September 2026, 14:30 local — an instant, written the way the DB holds it. */
const BOOKED = new Date(2026, 8, 20, 14, 30).toISOString()

const interviewEvent: CalendarEvent = {
  id: 'evt-1',
  job_id: 'job-1',
  user_id: 'user-1',
  kind: 'interview',
  title: 'Interview — Acme',
  starts_at: BOOKED,
  duration_minutes: 60,
  notes: null,
}

const withInterview: Partial<ApplicationRecordData> = {
  activity: [],
  history: [],
  links: [],
  nextEvent: interviewEvent,
  interview: interviewEvent,
  match: null,
}

/**
 * The interview date field (Gabe, 2026-09-10).
 *
 * It is the second thing on this form that saves to a table other than `jobs`
 * — the CV link was the first — so the tests that matter are the ones about
 * the seam rather than about the input: does it appear only for the status
 * that needs it, does it round-trip an instant through a local-time control,
 * and does an untouched field stay untouched when something else is saved.
 */
describe('the interview date on an application record', () => {
  it('appears only once the status is interviewing', async () => {
    render(
      <ApplicationRecordView
        job={makeJob({ id: 'job-1', status: 'applied' })}
        onSubmit={vi.fn()}
        defaultCurrency={CURRENCY}
      />
    )
    expect(screen.queryByLabelText(/^interview$/i)).toBeNull()

    await userEvent.click(screen.getByLabelText('status'))
    await userEvent.click(await screen.findByRole('option', { name: 'Interviewing' }))
    expect(screen.getByLabelText(/^interview$/i)).toBeTruthy()
  })

  it('shows the booked interview in the reader’s own wall clock', () => {
    // `toISOString().slice(0, 16)` would put the UTC clock in the box, so an
    // interview at 14:30 in Manila would read 06:30 to the person who booked
    // it. The control means local time; the column means an instant.
    render(
      <ApplicationRecordView
        job={INTERVIEWING}
        data={withInterview as ApplicationRecordData}
        onSubmit={vi.fn()}
        defaultCurrency={CURRENCY}
      />
    )
    // TWO CONTROLS NOW, not one input (2026-09-21): the day is this app's own
    // calendar and the time is a field beside it. What must not change is the
    // reading -- an interview at 14:30 in Manila must not show as 06:30
    // because `toISOString` was used somewhere.
    const [day, clock] = toLocalDateTimeInput(BOOKED).split('T')
    expect(screen.getByLabelText(/^interview$/i).textContent).toContain('20/09/2026')
    expect((document.getElementById('interview_at-time') as HTMLInputElement).value).toBe(clock)
    expect(clock).toBe('14:30')
    expect(day).toBe('2026-09-20')
  })

  it('sends an untouched field as undefined, so an unrelated save changes no calendar', async () => {
    // The destructive case this guards: moving an application from
    // interviewing to offer must not delete the interview that got it there.
    const onSubmit = vi.fn().mockResolvedValue(true)
    render(
      <ApplicationRecordView
        job={INTERVIEWING}
        data={withInterview as ApplicationRecordData}
        onSubmit={onSubmit}
        defaultCurrency={CURRENCY}
      />
    )
    // `company` rather than an optional field: it is always on screen, so the
    // test is editing something unrelated without first opening a disclosure.
    await userEvent.type(screen.getByLabelText(/company/i), ' Ltd')
    await userEvent.click(screen.getByRole('button', { name: /save application/i }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][1]).toBeUndefined()
  })

  it('sends a changed date as an instant to store', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true)
    render(
      <ApplicationRecordView
        job={INTERVIEWING}
        data={withInterview as ApplicationRecordData}
        onSubmit={onSubmit}
        defaultCurrency={CURRENCY}
      />
    )
    // Pick the 21st from the calendar, then set the clock beside it.
    await userEvent.click(screen.getByLabelText(/^interview$/i))
    await userEvent.click(await screen.findByRole('button', { name: /September 21st, 2026/ }))
    /*
      `fireEvent.change` RATHER THAN TYPING. A `type="time"` input is segmented,
      and in jsdom `userEvent.clear` leaves it reading 09:00 while typing four
      digits walks the segments and lands on 09:59 -- a wrong minute that has
      nothing to do with this component. Setting the value is what a picked
      time actually does.
    */
    const time = document.getElementById('interview_at-time') as HTMLInputElement
    fireEvent.change(time, { target: { value: '09:00' } })

    await userEvent.click(screen.getByRole('button', { name: /save application/i }))
    // Still an instant, and still the reader's own wall clock rather than UTC.
    expect(onSubmit.mock.calls[0][1]).toBe(new Date(2026, 8, 21, 9, 0).toISOString())
  })

  it('counts a date change as a change, so Save is offered at all', async () => {
    // `dirty` gates the save button (Worktrack Revisions 1.3), and the
    // interview date is not part of the jobs payload — so if it were left out
    // of the baseline this field would be typed into a dead form.
    render(
      <ApplicationRecordView
        job={INTERVIEWING}
        data={withInterview as ApplicationRecordData}
        onSubmit={vi.fn()}
        defaultCurrency={CURRENCY}
      />
    )
    const save = screen.getByRole('button', { name: /save application/i })
    expect(save).toBeDisabled()

    // The time half alone is enough of a change to open the form.
    const time = document.getElementById('interview_at-time') as HTMLInputElement
    fireEvent.change(time, { target: { value: '11:15' } })
    expect(save).not.toBeDisabled()
  })
})
