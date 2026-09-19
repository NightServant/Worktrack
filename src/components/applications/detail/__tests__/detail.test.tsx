import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Job } from '@/types'
import { AtsPanel } from '../AtsPanel'
import { JobDescription } from '../JobDescription'
import { LinkedCv } from '../LinkedCv'
import { ApplicationRecordView } from '../../record/ApplicationRecordView'
import { EMPTY_RECORD_DATA } from '../../record/recordData'

afterEach(() => cleanup())

const JOB: Job = {
  id: 'job-1',
  user_id: 'user-1',
  company: 'Acme',
  role: 'Staff Engineer',
  salary_min: 90000,
  salary_max: 120000,
  salary_currency: 'PHP',
  url: 'https://example.com/job',
  description: 'We need React and Kubernetes experience.',
  status: 'applied',
  date_applied: '2026-07-20',
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

describe('AtsPanel', () => {
  it('renders the ATS result as a ring and a number, never a pill', () => {
    // CHANGED 2026-09-06: the verdict was a 2px rule beside the number, which
    // drew nothing to scale -- 32% and 82% were the same picture. It is a ring
    // now, and the arc IS the number.
    //
    // The Global Constraint the original assertion guarded still holds and is
    // still checked: no pill, anywhere in this panel.
    const { container } = render(
      <AtsPanel match={{ score: 72, matched: ['react'], missing: ['go'] }} />
    )
    expect(container.querySelector('[data-ats-donut]')).toBeTruthy()
    expect(container.querySelector('[class*="rounded-full"]')).toBeNull()
  })

  it('states the score in text, not only inside the chart', () => {
    // The ring draws the number as an SVG tspan, which a screen reader does
    // not announce and which is absent wherever the chart cannot lay itself
    // out. The panel says what it shows either way.
    const { container } = render(
      <AtsPanel match={{ score: 72, matched: ['react', 'sql'], missing: ['go'] }} />
    )
    const summary = container.querySelector('[data-ats-score]')!
    expect(summary.textContent).toContain('72%')
    expect(summary.textContent).toContain('2 of 3')
  })

  it('names the missing keywords rather than only scoring', () => {
    // A bare 72% tells you nothing you can act on.
    render(<AtsPanel match={{ score: 72, matched: ['react'], missing: ['go', 'kubernetes'] }} />)
    expect(screen.getByText(/kubernetes/)).toBeTruthy()
  })

  it('says so plainly when there is nothing to score', () => {
    render(<AtsPanel match={null} />)
    expect(screen.getByText(/see how closely they match/i)).toBeTruthy()
  })

  it('says the CV read failed rather than claiming there is nothing to score', () => {
    render(<AtsPanel match={null} error />)
    expect(screen.queryByText(/see how closely they match/i)).toBeNull()
    expect(screen.getByText(/could not load your cv/i)).toBeTruthy()
  })

  it('prefers the error state even when a match happens to be present', () => {
    // A settled failure and a settled score can't both be true for the same
    // read, but the panel should still resolve the ambiguity toward "failed"
    // rather than silently trusting stale match data.
    render(<AtsPanel match={{ score: 90, matched: ['react'], missing: [] }} error />)
    expect(screen.getByText(/could not load your cv/i)).toBeTruthy()
    expect(screen.queryByText('90%')).toBeNull()
  })
})

describe('JobDescription', () => {
  it('says so plainly when there is no description', () => {
    render(<JobDescription description={null} />)
    expect(screen.getByText(/no job description saved/i)).toBeTruthy()
  })

  it('renders the posting text when present', () => {
    render(<JobDescription description="Build things." url="https://example.com" />)
    expect(screen.getByText('Build things.')).toBeTruthy()
    expect(screen.getByRole('link', { name: /view posting/i })).toBeTruthy()
  })
})

describe('LinkedCv', () => {
  it('says so plainly when no CV is linked', () => {
    render(<LinkedCv links={[]} />)
    expect(screen.getByText(/no cv linked/i)).toBeTruthy()
  })

  it('does not instruct the user to pin a CV from a control that does not exist', () => {
    render(<LinkedCv links={[]} />)
    // documentLinkService.pin/.unpin have zero callers in src, and DocumentRow
    // renders no pin affordance -- promising one here would send the user to
    // /documents to find nothing to click.
    expect(screen.queryByText(/pin one from documents/i)).toBeNull()
  })

  it('says the read failed rather than claiming no CV is linked', () => {
    render(<LinkedCv links={[]} error />)
    expect(screen.queryByText(/no cv linked/i)).toBeNull()
    expect(screen.getByText(/could not load the linked cv/i)).toBeTruthy()
  })

  it('describes the linked CV', () => {
    render(
      <LinkedCv
        links={[{ resume_id: 'resume-1', title: 'Software Engineer CV', version: 2, sent_at: '2026-07-01' }]}
      />
    )
    expect(screen.getByText(/software engineer cv/i)).toBeTruthy()
  })
})

/**
 * THE RECORD ITSELF, which replaced `ApplicationRecord` on 2026-09-09.
 *
 * WHAT WENT, and why the old table of two layouts went with it. There used to
 * be two surfaces for one application -- a desktop dialog and a mobile page --
 * and this suite ran every assertion against both so they could not drift.
 * There is one now: the dialog is a bottom sheet below 640, so the phone gets
 * the same component rather than a second edition of it, and `/applications/
 * [id]` is a redirect into it. One surface needs no layout matrix.
 *
 * THE PANELS THIS USED TO ASSERT ON -- activity, next event, linked CV, notes,
 * contact -- are not on the record any more either. Gabe's revision specified
 * the record as three columns (basic information, the posting, the ATS match)
 * and removed notes and contact by name. `ActivityTimeline` and `NextEvent`
 * were then deleted outright (Gabe, 2026-09-19: "Remove them completely") --
 * they had been carried for ten days as tested components nothing rendered.
 * `LinkedCv` survives because the record still uses it.
 */
describe('ApplicationRecordView', () => {
  it('shows the form beside a tab for each of the other two surfaces', async () => {
    // THE SECOND COLUMN IS TABS NOW (Gabe, 2026-09-13). The posting and the
    // score are alternatives rather than a sequence -- you are reading the
    // advert or you are checking the match -- and stacked they were more than
    // the frame held. The tab is the heading, which is why neither panel
    // prints one of its own any more.
    const user = userEvent.setup()
    render(
      <ApplicationRecordView
        job={JOB}
        data={EMPTY_RECORD_DATA}
        defaultCurrency="PHP"
        onSubmit={() => {}}
      />
    )
    // The form is a column, not a tab, whenever there is room for one -- so it
    // is on screen at the same time as whichever tab is open.
    expect(screen.getByLabelText('company *')).toBeTruthy()
    expect(screen.getByLabelText('position *')).toBeTruthy()

    expect(screen.getByRole('tab', { name: 'job description' })).toBeTruthy()
    const ats = screen.getByRole('tab', { name: 'ATS match' })
    expect(screen.getByRole('tabpanel')).toContainElement(
      document.querySelector('[data-posting-body], textarea#description')
    )

    await user.click(ats)
    expect(document.querySelector('[data-record-ats]')).toBeTruthy()
  })

  it('carries no notes or contact section', () => {
    // Removed by name in the revision (item 4). The four `contact_*` columns
    // and `notes` still exist on `jobs` and the CSV importer still writes
    // them; nothing stored is destroyed, and `toPayload` leaves them out so an
    // edit here never blanks a value this UI cannot show.
    render(
      <ApplicationRecordView
        job={JOB}
        data={EMPTY_RECORD_DATA}
        defaultCurrency="PHP"
        onSubmit={() => {}}
      />
    )
    expect(screen.queryByRole('heading', { name: 'notes' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'contact' })).toBeNull()
  })

  it('keeps a failed ATS read distinct from having nothing to compare', async () => {
    const user = userEvent.setup()
    render(
      <ApplicationRecordView
        job={JOB}
        data={{ ...EMPTY_RECORD_DATA, atsError: true }}
        defaultCurrency="PHP"
        onSubmit={() => {}}
      />
    )
    // The panel lives behind its tab now; the distinction it draws does not.
    await user.click(screen.getByRole('tab', { name: 'ATS match' }))
    expect(screen.getByText(/could not load your cv/i)).toBeTruthy()
    expect(screen.queryByText(/see how closely they match/i)).toBeNull()
  })

  it('leads with the pipeline bar, and marks the stages already reached', () => {
    const { container } = render(
      <ApplicationRecordView
        job={{ ...JOB, status: 'interviewing' }}
        data={EMPTY_RECORD_DATA}
        defaultCurrency="PHP"
        onSubmit={() => {}}
      />
    )
    const bar = container.querySelector('[data-application-pipeline]')!
    expect(bar.getAttribute('data-application-pipeline')).toBe('interviewing')
    // `data-state` replaced `data-reached` when the three progress bars in
    // this app were unified on `ui/progress-track` (2026-09-11). It carries
    // three values where the old boolean carried two, which is the point --
    // "reached" could not tell the stage you are ON from the ones behind it.
    const states = [...bar.querySelectorAll('[data-step]')].map((li) => [
      li.getAttribute('data-step'),
      li.getAttribute('data-state'),
    ])
    expect(states).toEqual([
      ['wishlist', 'done'],
      ['applied', 'done'],
      ['interviewing', 'current'],
      ['offer', 'todo'],
    ])
    // AND WHICH ONE YOU ARE AT, which "reached" alone could not say -- three
    // of the four are reached. It is `aria-current="step"` now rather than a
    // 3px rule, which is the same fact said in a way a screen reader also
    // gets, and the tracker marks it visually with a pulsing ring.
    const current = [...bar.querySelectorAll('[data-step]')].filter(
      (li) => li.getAttribute('data-state') === 'current'
    )
    expect(current).toHaveLength(1)
    expect(current[0].getAttribute('data-step')).toBe('interviewing')
    expect(current[0].getAttribute('aria-current')).toBe('step')
    expect(current[0].querySelector('[data-progress-pulse]')).toBeTruthy()
  })

  it('hides the fields this application has never filled in, behind one control', () => {
    // "Do not display placeholder with NULL value (no input)" -- the old
    // summary printed nine rows of `not set` / `none` / `no` under a record
    // that had a salary and a location. They are one click away rather than
    // gone: a field you cannot reach is a value you can never add.
    render(
      <ApplicationRecordView
        job={JOB}
        data={EMPTY_RECORD_DATA}
        defaultCurrency="PHP"
        onSubmit={() => {}}
      />
    )
    // JOB leaves work_mode null.
    expect(screen.queryByLabelText('work mode')).toBeNull()
    expect(screen.queryByText(/not set/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /add more details/i }))
    expect(screen.getByLabelText('work mode')).toBeTruthy()
  })

  it('commits through one Save, at the foot of the record', () => {
    // The header's edit and delete buttons are gone: editing is what this
    // surface does, and delete is on the row in the table.
    const onSubmit = vi.fn()
    render(
      <ApplicationRecordView
        job={JOB}
        data={EMPTY_RECORD_DATA}
        defaultCurrency="PHP"
        onSubmit={onSubmit}
      />
    )
    // NO RECORD-LEVEL `delete`. The one on screen belongs to a job-description
    // SECTION -- its name says which -- and delete for the application itself
    // is on the row in the table beside the row it destroys.
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull()
    // The `edit` controls left are the posting's, one per section, each naming
    // the section it opens. They are toggles over a field rather than a mode
    // switch over the whole record, which is what `aria-expanded` says.
    const sectionEdits = screen.getAllByRole('button', { name: /^edit / })
    expect(sectionEdits.length).toBeGreaterThan(0)
    expect(sectionEdits[0].getAttribute('aria-expanded')).toBe('false')
    // DISABLED UNTIL SOMETHING CHANGES. An untouched record has nothing to
    // save, and a live button over a no-op invites the click that teaches you
    // it was one.
    const save = screen.getByRole('button', { name: /save application/i })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/^company/), { target: { value: 'Acme Two' } })
    fireEvent.click(save)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ company: 'Acme Two', role: JOB.role })
  })
})

describe('the keyword lists', () => {
  /**
   * A real posting yields sixty-odd terms. Rendered as one comma-joined
   * string that is eleven lines of prose in a 320px rail, which made the most
   * actionable thing on the panel also the least readable.
   */
  const MANY = Array.from({ length: 40 }, (_, i) => `term${i + 1}`)

  it('folds a long list and says how many there are', () => {
    render(<AtsPanel match={{ score: 30, matched: [], missing: MANY }} />)
    // The count is beside the heading whether folded or not: "how much work
    // is this" is the first thing a reader wants.
    expect(screen.getByText('(40)')).toBeTruthy()
    expect(screen.getByRole('button', { name: /show 22 more/i })).toBeTruthy()
    expect(screen.queryByText(/term40/)).toBeNull()
  })

  it('shows the rest on request, and folds back', async () => {
    render(<AtsPanel match={{ score: 30, matched: [], missing: MANY }} />)
    await userEvent.click(screen.getByRole('button', { name: /show 22 more/i }))
    expect(screen.getByText(/term40/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /show fewer/i }))
    expect(screen.queryByText(/term40/)).toBeNull()
  })

  it('does not offer to expand a list that already fits', () => {
    render(<AtsPanel match={{ score: 30, matched: [], missing: ['go', 'rust'] }} />)
    expect(screen.queryByRole('button', { name: /show .* more/i })).toBeNull()
  })

  it('keeps the posting\'s own order rather than inventing a ranking', () => {
    // `atsMatch` yields terms in the order the posting uses them, which is a
    // weak but real signal. Re-ranking in a view would be a relevance model
    // nobody could see.
    render(<AtsPanel match={{ score: 30, matched: [], missing: ['zebra', 'apple', 'mango'] }} />)
    expect(screen.getByText(/zebra, apple, mango/)).toBeTruthy()
  })
})
