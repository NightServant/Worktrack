import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddApplicationDialog } from '../record/AddApplicationDialog'
import { ApplicationRecordView } from '../record/ApplicationRecordView'
import { resolveDefaultCurrency } from '@/services/userPreferences'
import { chooseOption } from '@/test/select'

afterEach(() => cleanup())

/**
 * Gabe, 2026-10-01: the add wizard's review step takes the record's layout
 * minus the ATS match, its posting is a preview with a way into its own view,
 * and `applied` requires a date in both dialogs.
 */

async function reachReview(values: Record<string, unknown>) {
  const onAutofill = vi.fn().mockResolvedValue({ values, confidence: {}, warnings: [] })
  render(
    <AddApplicationDialog
      open
      onOpenChange={vi.fn()}
      defaultCurrency={resolveDefaultCurrency(null)}
      onSubmit={vi.fn()}
      onAutofill={onAutofill}
    />
  )
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/job posting url/i), 'https://careers.example.com/j/1')
  await user.click(screen.getByRole('button', { name: /continue/i }))
  await user.click(screen.getByRole('button', { name: /fill it in/i }))
  await screen.findByRole('button', { name: /save application/i })
  return user
}

describe('the add wizard’s review step', () => {
  it('has no ATS match, and shows only the fields that hold something', async () => {
    await reachReview({ company: 'Acme', role: 'Engineer', description: 'Build things.' })
    expect(screen.queryByText(/ATS match/i)).toBeNull()
    expect(screen.getByLabelText(/^company/)).toHaveValue('Acme')
    expect(screen.queryByLabelText(/tech stack/i)).toBeNull()
    expect(screen.getByRole('button', { name: /add more details/i })).toBeInTheDocument()
  })

  it('opens the posting in its own view of the dialog, and comes back to the draft', async () => {
    const user = await reachReview({ company: 'Acme', role: 'Engineer', description: 'Build things.' })
    await user.click(document.querySelector<HTMLElement>('[data-posting-read-more]')!)

    expect(screen.getByRole('heading', { name: 'job description' })).toBeInTheDocument()
    // The full view is where the posting is edited.
    expect(screen.getByRole('button', { name: /edit overview/i })).toBeInTheDocument()
    // HIDDEN, not unmounted: the draft lives in that subtree.
    expect(screen.getByLabelText(/^company/)).not.toBeVisible()

    await user.click(screen.getByRole('button', { name: /back to application/i }))
    expect(screen.getByLabelText(/^company/)).toBeVisible()
    expect(screen.getByLabelText(/^company/)).toHaveValue('Acme')
  })

  it('keeps the paste field in the column while there is no posting', async () => {
    await reachReview({ company: 'Acme', role: 'Engineer' })
    expect(screen.getByLabelText('job description')).toBeInTheDocument()
    expect(document.querySelector('[data-posting-read-more]')).toBeNull()
  })
})

describe('applied requires a date', () => {
  it('stops the wizard at the status step until the date is given', async () => {
    const onAutofill = vi.fn()
    render(
      <AddApplicationDialog
        open
        onOpenChange={vi.fn()}
        defaultCurrency={resolveDefaultCurrency(null)}
        onSubmit={vi.fn()}
        onAutofill={onAutofill}
      />
    )
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/job posting url/i), 'https://careers.example.com/j/1')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await chooseOption(user, screen.getByLabelText('status'), /^Applied/)
    await user.click(screen.getByRole('button', { name: /fill it in/i }))

    expect(onAutofill).not.toHaveBeenCalled()
    expect(screen.getByText(/needs the day it was sent/i)).toBeInTheDocument()
  })

  it('shows the date field on `applied` in the record and refuses to save without it', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ApplicationRecordView job={null} defaultCurrency="PHP" onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText(/^company/), { target: { value: 'Acme' } })
    fireEvent.change(screen.getByLabelText(/^position/), { target: { value: 'Engineer' } })
    expect(document.getElementById('date_applied')).toBeNull()

    await chooseOption(user, screen.getByLabelText('status'), 'Applied')
    expect(document.getElementById('date_applied')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /save application/i }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/date_applied/)
  })
})
