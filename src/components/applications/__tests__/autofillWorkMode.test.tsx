import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddApplicationDialog } from '../record/AddApplicationDialog'
import { resolveDefaultCurrency } from '@/services/userPreferences'

afterEach(() => cleanup())

/**
 * WHERE AUTO-FILL LIVES NOW. It used to be a button halfway down a
 * nineteen-field form, next to the posting URL. `ApplicationForm` was deleted
 * on 2026-09-09 and adding an application is four steps whose whole point is
 * that the model does three of them, so every assertion below drives
 * `AddApplicationDialog` to its review step instead. What is being tested --
 * which values survive the trip from a scraped page into the record -- has
 * not changed.
 *
 * Two tests are gone rather than moved: "does not overwrite a description
 * already typed" and the tech-stack equivalent. In the wizard the fetch
 * happens before there is anything to overwrite -- the only thing typed by
 * then is the URL. The rule they guarded still holds and is still covered,
 * on the digest, in postingDigest.test.tsx ("fills empty fields but never
 * overwrites a typed one").
 */
const fill = (values: Record<string, unknown>) =>
  vi.fn().mockResolvedValue({ values, confidence: {}, warnings: [] })

/**
 * Opens the wizard, walks it to the review step, and returns the mock.
 *
 * `status` stays on its default (`wishlist`) throughout: nothing here is about
 * the date or the CV, and choosing `applied` would add two controls every
 * assertion would then have to step around.
 */
async function autofillWith(values: Record<string, unknown>) {
  const onAutofill = fill(values)
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
  await user.type(
    screen.getByLabelText(/job posting url/i),
    'https://careers.example.com/j/1'
  )
  await user.click(screen.getByRole('button', { name: /continue/i }))
  await user.click(screen.getByRole('button', { name: /fill it in/i }))
  // The review step is the one with a Save on it.
  await screen.findByRole('button', { name: /save application/i })
  return onAutofill
}

describe('auto-fill and work mode', () => {
  /**
   * IT NEVER DID, for as long as the feature existed. The extractor computed
   * it -- from JSON-LD's `jobLocationType` and from the page text, with a
   * confidence score attached -- and `JobAutofillResult` did not declare the
   * field, so the form could not read it and dropped it every time. Nothing
   * failed; a select just never filled in. Found by M7's field-parity test
   * (scraper/tests/test_contract.py), which now makes the two sides unable to
   * disagree.
   */
  it('fills the work mode the extractor found', async () => {
    await autofillWith({ company: 'Acme', role: 'Engineer', work_mode: 'remote' })
    expect(screen.getByLabelText('work mode')).toHaveTextContent(/remote/i)
  })

  it('ignores a work mode that is not one of the three the record knows', async () => {
    // It arrives from a remote page. An unrecognised string would put the
    // select into a state none of its options match, which renders as an empty
    // control the user cannot explain.
    await autofillWith({ company: 'Acme', role: 'Engineer', work_mode: 'from-the-moon' })
    expect(screen.getByLabelText('work mode')).not.toHaveTextContent(/from-the-moon/i)
    expect(screen.getByLabelText('work mode')).toHaveTextContent(/not set/i)
  })

  it('fills the company and role, which are the record’s only required fields', async () => {
    await autofillWith({ company: 'Acme', role: 'Engineer' })
    expect(screen.getByLabelText(/^company/i)).toHaveValue('Acme')
    expect(screen.getByLabelText(/^position/i)).toHaveValue('Engineer')
  })
})

/**
 * The same defect class, found the same way, on 2026-09-06.
 *
 * Auto-fill reported "Salary was not found in page metadata" on a page that
 * stated one plainly: the extractor's range pattern was dollar-only, so a
 * Philippine posting's `₱50,000 - ₱70,000` could never match. Fixing the
 * pattern surfaced the second half of the problem -- a currency the contract
 * had no field for, which would have stored pesos under whichever default
 * happened to be set.
 *
 * The description was simply never extracted at all, and it is the field that
 * matters most: the ATS keyword match reads it and AI tailoring is given it,
 * so both were working from an empty string.
 */
describe('auto-fill, salary currency and the posting body', () => {
  it('fills the currency the salary was quoted in', async () => {
    await autofillWith({ salary_min: 50000, salary_max: 70000, salary_currency: 'PHP' })
    expect(screen.getByLabelText(/min salary/i)).toHaveValue(50000)
    expect(screen.getByLabelText(/currency/i)).toHaveTextContent('PHP')
  })

  it('takes a foreign currency rather than assuming the default', async () => {
    // The whole point: a USD posting must not be stored as pesos because that
    // is what this user's default happens to be.
    await autofillWith({ salary_min: 120000, salary_max: 150000, salary_currency: 'USD' })
    expect(screen.getByLabelText(/min salary/i)).toHaveValue(120000)
    expect(screen.getByLabelText(/currency/i)).toHaveTextContent('USD')
  })

  it('ignores a currency the record cannot store', async () => {
    // It arrives from a remote page, and an unrecognised code would fail the
    // jobs_salary_currency_check constraint at the insert rather than here.
    await autofillWith({ salary_min: 1000, salary_max: 2000, salary_currency: 'XYZ' })
    expect(screen.getByLabelText(/min salary/i)).toHaveValue(1000)
    expect(screen.getByLabelText(/currency/i)).not.toHaveTextContent('XYZ')
  })

  it('fills the posting body', async () => {
    await autofillWith({ description: 'Build things. React, TypeScript.' })
    expect(screen.getByText(/Build things\./)).toBeInTheDocument()
  })
})

describe('auto-fill, tech stack and tags', () => {
  it('fills the tech stack as a comma list', async () => {
    // `tech_stack` is what the ATS keyword match reads, so an empty one scored
    // a CV against nothing.
    await autofillWith({ tech_stack: ['React', 'TypeScript', 'GraphQL'] })
    expect(screen.getByLabelText(/tech stack/i)).toHaveValue('React, TypeScript, GraphQL')
  })

  it('fills the tags', async () => {
    await autofillWith({ tags: ['full-time', 'Software'] })
    expect(screen.getByLabelText(/^tags/i)).toHaveValue('full-time, Software')
  })

  it('ignores empty arrays rather than clearing the field', async () => {
    await autofillWith({ tech_stack: [], tags: [] })
    expect(screen.getByLabelText(/tech stack/i)).toHaveValue('')
  })
})

/**
 * Walks the wizard to its review step with a read that fails on the way.
 *
 * `mockRejectedValueOnce` rather than `mockRejectedValue`, so the same mock
 * can answer a SECOND call differently -- which is the only way to tell
 * `try again` re-ran the fetch from `try again` merely redrawing the step.
 */
const READ_URL = 'https://careers.example.com/j/1'

async function failTheRead(onAutofill: ReturnType<typeof vi.fn>) {
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
  await user.type(screen.getByLabelText(/job posting url/i), READ_URL)
  await user.click(screen.getByRole('button', { name: /continue/i }))
  await user.click(screen.getByRole('button', { name: /fill it in/i }))
  await screen.findByRole('button', { name: /save application/i })
  return user
}

describe('when the posting cannot be read at all', () => {
  it('carries on to the review step and says why, rather than dead-ending', async () => {
    // Several boards are JavaScript-rendered or refuse datacenter traffic, and
    // no amount of retrying changes that. Blocking the whole flow on a fetch
    // nobody controls would make the unreliable half the required half.
    await failTheRead(vi.fn().mockRejectedValue(new Error('Could not fetch this URL')))

    expect(screen.getByRole('button', { name: /save application/i })).toBeTruthy()
    expect(screen.getByText(/Could not fetch this URL/)).toBeInTheDocument()
    // WHERE TO PASTE IT, which is the only thing left to do here.
    expect(screen.getByText(/description column/i)).toBeInTheDocument()
  })

  it('names no control that was deleted', async () => {
    // `tidy and summarise` went on 2026-09-10, when the wizard started
    // summarising every posting it FETCHES -- so this copy was read only by
    // the one person the digest never runs for, and it sent them hunting the
    // screen for a button that is not on it.
    await failTheRead(vi.fn().mockRejectedValue(new Error('Could not fetch this URL')))
    expect(screen.queryByText(/tidy and summarise/i)).toBeNull()
  })

  it('re-runs the read on the same URL when asked to try again', async () => {
    const onAutofill = vi
      .fn()
      .mockRejectedValueOnce(new Error('Could not fetch this URL'))
      .mockResolvedValueOnce({ values: { company: 'Acme' }, confidence: {}, warnings: [] })
    const user = await failTheRead(onAutofill)

    await user.click(screen.getByRole('button', { name: /try again/i }))
    await screen.findByRole('button', { name: /save application/i })

    expect(onAutofill).toHaveBeenCalledTimes(2)
    // THE SAME URL, not a re-typed one: the link is the thing the reader
    // already gave and the thing they would otherwise have to give again.
    expect(onAutofill.mock.calls[1][0]).toBe(READ_URL)
    expect(screen.getByLabelText(/^company/i)).toHaveValue('Acme')
    // And the failure is gone with it, rather than sitting over a record that
    // has since filled in.
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
    expect(screen.queryByText(/Could not fetch this URL/)).toBeNull()
  })

  it('drops the link and the message on discard, leaving a clean manual form', async () => {
    const user = await failTheRead(
      vi.fn().mockRejectedValue(new Error('Could not fetch this URL'))
    )

    await user.click(screen.getByRole('button', { name: /discard/i }))

    // THE URL GOES WITH IT. Left in the field it would be saved onto the
    // application and read back later as "this is where I applied", for a page
    // the app has just proved it cannot open.
    expect(screen.getByLabelText(/posting url/i)).toHaveValue('')
    expect(screen.queryByText(/Could not fetch this URL/)).toBeNull()
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
    // Still on the review step, with a form to fill in by hand.
    expect(screen.getByRole('button', { name: /save application/i })).toBeTruthy()
    expect(screen.getByLabelText(/^company/i)).toBeTruthy()
  })

  it('will not start at all without a link, rather than reaching the read step with nothing to read', async () => {
    // REPLACES "does not call the extractor at all when no link was given"
    // (Gabe, 2026-09-11). That test pinned the old contract: continue past an
    // empty field and discover on step three that a four-step flow whose whole
    // promise is "the model does three of them" has nothing to work from. The
    // gate moved to the first step, where the fix is obvious.
    const onAutofill = fill({})
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
    const advance = screen.getByRole('button', { name: /continue/i })
    expect(advance).toBeDisabled()

    // A bare domain counts -- `normalizePostingUrl` completes it -- so the gate
    // is "is there anything here", not "did you type the scheme".
    await user.type(screen.getByLabelText(/job posting url/i), 'careers.example.com/j/1')
    expect(advance).not.toBeDisabled()
    expect(onAutofill).not.toHaveBeenCalled()
  })

  it('offers no way back once the wizard has started', async () => {
    // Gabe, 2026-09-11: "remove the back button in general, it destroys the
    // whole process of creation." Nothing is stranded by it -- the review step
    // renders every field open, the posting URL among them.
    const onAutofill = fill({})
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
    expect(screen.queryByRole('button', { name: /^back$/i })).toBeNull()

    await user.click(screen.getByRole('button', { name: /fill it in/i }))
    await screen.findByRole('button', { name: /save application/i })
    expect(screen.queryByRole('button', { name: /^back$/i })).toBeNull()
    // The URL is still editable from the review step, which is what makes the
    // removal safe rather than merely shorter.
    expect(screen.getByLabelText(/posting url/i)).toHaveValue('https://careers.example.com/j/1')
  })
})
