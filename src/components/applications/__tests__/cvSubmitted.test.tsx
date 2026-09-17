import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApplicationRecordView } from '../record/ApplicationRecordView'
import { resolveDefaultCurrency } from '@/services/userPreferences'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

afterEach(() => cleanup())

const CURRENCY = resolveDefaultCurrency(null)
const RESUMES = [
  { id: 'r1', title: 'frontend cv' },
  { id: 'r2', title: 'backend cv' },
]

/**
 * The two ends of `application_documents`.
 *
 * Before this pair existed the table had a migration, a service and NO
 * CALLERS: `documentLinkService.pin` and `.unpin` were dead code, and
 * `LinkedCv` rendered "no CV linked" over an application there was no way to
 * link one to. These tests are what keep both ends wired.
 *
 * THE FIELD READS `cv used` SINCE 2026-09-17 and this file is still called
 * cvSubmitted. The queries below moved with the label because they find the
 * control BY ITS LABEL -- which is the point of querying that way, and is why
 * the rename could not be silent. The filename did not, because the thing it
 * names is the `application_documents` link rather than the words on screen,
 * and renaming a test file rewrites its history for a word.
 */
describe('the "CV used" field on an application', () => {
  it('offers every CV the user has written', async () => {
    render(<ApplicationRecordView job={null} onSubmit={vi.fn()} defaultCurrency={CURRENCY} resumes={RESUMES} />)
    await userEvent.click(screen.getByLabelText(/cv used/i))
    expect(await screen.findByRole('option', { name: 'frontend cv' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'backend cv' })).toBeTruthy()
  })

  it('reports the chosen CV to the caller', async () => {
    // NOT through JobFormData: the link lives in a different table, keyed on a
    // job id that does not exist yet when creating one.
    const onLinkedResumeChange = vi.fn()
    render(
      <ApplicationRecordView
        job={null}
        onSubmit={vi.fn()}
        defaultCurrency={CURRENCY}
        resumes={RESUMES}
        onLinkedResumeChange={onLinkedResumeChange}
      />
    )
    await userEvent.click(screen.getByLabelText(/cv used/i))
    await userEvent.click(await screen.findByRole('option', { name: 'backend cv' }))
    expect(onLinkedResumeChange).toHaveBeenCalledWith('r2')
  })

  it('reports "none" as null, not as an empty string', async () => {
    // The caller reads null as "remove the link" and undefined as "leave it
    // alone". An empty string would be neither.
    const onLinkedResumeChange = vi.fn()
    render(
      <ApplicationRecordView
        job={null}
        onSubmit={vi.fn()}
        defaultCurrency={CURRENCY}
        resumes={RESUMES}
        linkedResumeId="r1"
        onLinkedResumeChange={onLinkedResumeChange}
      />
    )
    await userEvent.click(screen.getByLabelText(/cv used/i))
    await userEvent.click(await screen.findByRole('option', { name: 'none' }))
    expect(onLinkedResumeChange).toHaveBeenCalledWith(null)
  })

  it('starts on the CV already linked to this application', () => {
    render(
      <ApplicationRecordView
        job={null}
        onSubmit={vi.fn()}
        defaultCurrency={CURRENCY}
        resumes={RESUMES}
        linkedResumeId="r2"
      />
    )
    expect(screen.getByLabelText(/cv used/i)).toHaveTextContent('backend cv')
  })

  it('says so, rather than offering an empty dropdown, before any CV exists', () => {
    // Somebody tracking their first application has not written a CV yet.
    render(
      <ApplicationRecordView
        job={null}
        onSubmit={vi.fn()}
        defaultCurrency={CURRENCY}
        resumes={[]}
      />
    )
    const field = screen.getByLabelText(/cv used/i)
    expect(field).toBeDisabled()
    // Deliberately said twice: once as the field's hint, once as the only
    // thing the disabled control can show.
    expect(screen.getAllByText(/no CVs yet/i).length).toBeGreaterThan(0)
  })

  it('MAKES THE RECORD SAVABLE, which is what "not functioning" meant', async () => {
    // Gabe, 2026-09-11: the dropdown looked broken because the pick was
    // unreachable. `dirty` compares the `jobs` payload, and which CV was sent
    // is a row in `application_documents` -- so changing only the CV left Save
    // disabled and the status line claiming everything was saved.
    const onDirtyChange = vi.fn()
    render(
      <ApplicationRecordView
        job={null}
        onSubmit={vi.fn()}
        defaultCurrency={CURRENCY}
        resumes={RESUMES}
        linkedResumeId="r1"
        onLinkedResumeChange={vi.fn()}
        onDirtyChange={onDirtyChange}
      />
    )
    const save = screen.getByRole('button', { name: /save application/i })
    expect(save).toBeDisabled()

    await userEvent.click(screen.getByLabelText(/cv used/i))
    await userEvent.click(await screen.findByRole('option', { name: 'backend cv' }))

    expect(save).toBeEnabled()
    expect(document.querySelector('[data-record-save-state]')).toHaveTextContent(/unsaved/i)
    // And the dialog hears about it, or Escape drops the pick with no prompt.
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  })

  it('goes quiet again when the original CV is picked back', async () => {
    render(
      <ApplicationRecordView
        job={null}
        onSubmit={vi.fn()}
        defaultCurrency={CURRENCY}
        resumes={RESUMES}
        linkedResumeId="r1"
        onLinkedResumeChange={vi.fn()}
      />
    )
    const save = screen.getByRole('button', { name: /save application/i })
    await userEvent.click(screen.getByLabelText(/cv used/i))
    await userEvent.click(await screen.findByRole('option', { name: 'backend cv' }))
    expect(save).toBeEnabled()

    await userEvent.click(screen.getByLabelText(/cv used/i))
    await userEvent.click(await screen.findByRole('option', { name: 'frontend cv' }))
    expect(save).toBeDisabled()
  })

  it('keeps the link out of the submitted job payload', async () => {
    // `resume_id` is not a column on `jobs`; sending it would put a non-column
    // straight into jobService.createJob.
    const onSubmit = vi.fn()
    render(
      <ApplicationRecordView
        job={null}
        defaultCurrency={CURRENCY}
        resumes={RESUMES}
        onSubmit={onSubmit}
        onLinkedResumeChange={vi.fn()}
      />
    )
    await userEvent.type(screen.getByLabelText(/^company/i), 'Acme')
    await userEvent.type(screen.getByLabelText(/^position/i), 'Engineer')
    await userEvent.click(screen.getByLabelText(/cv used/i))
    await userEvent.click(await screen.findByRole('option', { name: 'frontend cv' }))
    // The record's one commit, named exactly: `add more details` in the first
    // column also matches a loose /save|add/.
    await userEvent.click(screen.getByRole('button', { name: /save application/i }))

    expect(onSubmit).toHaveBeenCalled()
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('resume_id')
  })
})

/**
 * THE `sent to N applications` DROPDOWN WAS TESTED HERE, and it is gone
 * (Gabe, Worktrack Revisions item 6). It listed every application a CV had
 * been pinned to, which on an account that pins one CV to everything is a
 * dropdown of every job in the tracker sitting in the editor's toolbar --
 * "it displays all the job positions".
 *
 * The relationship is still readable from the other end, on the record's `cv
 * used` field above, which is where somebody asks the question that way
 * round. `LinkedApplications` and `useResumeLinks` still exist and are
 * deliberately unused.
 */
