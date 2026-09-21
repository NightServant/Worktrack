import * as React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PersonaliseStep } from '../PersonaliseStep'

afterEach(() => cleanup())

/**
 * The three sources that are not on the sign-up form, and the dialog that
 * holds them (Gabe, 2026-09-21: "CTA for adding more links must open a dialog
 * that contains input forms for other profile sources. Add cancel and save
 * CTAs in the dialog itself").
 *
 * AUTHENTICATION ONLY. The settings screen has its own sources form, which
 * shows all five at once inside a dialog of its own and is untouched by this.
 */
const renderStep = (over: { onSubmit?: () => Promise<void>; onSkip?: () => void } = {}) => {
  const onSubmit = vi.fn(over.onSubmit ?? (async () => {}))
  const onSkip = vi.fn(over.onSkip ?? (() => {}))
  render(<PersonaliseStep onSubmit={onSubmit} onSkip={onSkip} />)
  return { onSubmit, onSkip, user: userEvent.setup() }
}

const openTheDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(document.querySelector('[data-personalise-more]') as HTMLElement)
  return screen.findByRole('dialog')
}

describe('PersonaliseStep — the other profiles dialog', () => {
  it('keeps the other three off the form until they are asked for', () => {
    renderStep()
    // The two that almost everybody has are the form; five empty inputs on a
    // sign-up screen reads as five things to do.
    expect(document.getElementById('signup-source-linkedin')).toBeTruthy()
    expect(document.getElementById('signup-source-github')).toBeTruthy()
    expect(document.getElementById('signup-source-jobstreet')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens a dialog holding an input for each of the other sources', async () => {
    const { user } = renderStep()
    const dialog = await openTheDialog(user)

    // IN THE DIALOG, not revealed on the step behind it. Revealing them grew
    // the form by three empty inputs with no way to put them back.
    for (const id of ['jobstreet', 'indeed', 'glassdoor']) {
      expect(within(dialog).getByRole('textbox', { name: new RegExp(id, 'i') })).toBeTruthy()
    }
    expect(within(dialog).getByRole('button', { name: 'cancel' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'save' })).toBeTruthy()
  })

  it('saves an address onto the step and says so there', async () => {
    const { user } = renderStep()
    const dialog = await openTheDialog(user)

    await user.type(
      document.getElementById('signup-source-jobstreet') as HTMLElement,
      'https://ph.jobstreet.com/profiles/me-abc123'
    )
    await user.click(within(dialog).getByRole('button', { name: 'save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // READ BACK ON THE FORM. A save that closes a panel and changes nothing
    // anybody can see is a save that looks broken -- and these fields are not
    // on the form to check it against.
    const added = document.querySelector('[data-personalise-added-source="jobstreet"]')
    expect(added?.textContent).toContain('https://ph.jobstreet.com/profiles/me-abc123')
  })

  it('counts a saved address towards the one the step requires', async () => {
    // The step refuses to submit with no address at all. One added through the
    // dialog is an address like any other.
    const { user } = renderStep()
    const build = screen.getByRole('button', { name: /build my profile/i })
    expect(build).toHaveProperty('disabled', true)

    const dialog = await openTheDialog(user)
    await user.type(
      document.getElementById('signup-source-indeed') as HTMLElement,
      'https://profile.indeed.com/p/me-abc123'
    )
    await user.click(within(dialog).getByRole('button', { name: 'save' }))

    await waitFor(() => expect(build).toHaveProperty('disabled', false))
  })

  it('keeps nothing when the dialog is cancelled', async () => {
    const { user } = renderStep()
    const dialog = await openTheDialog(user)

    await user.type(
      document.getElementById('signup-source-glassdoor') as HTMLElement,
      'https://www.glassdoor.com/member/profile/1'
    )
    await user.click(within(dialog).getByRole('button', { name: 'cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.querySelector('[data-personalise-added]')).toBeNull()

    // AND THE ABANDONED DRAFT DOES NOT COME BACK. This component stays
    // mounted between openings, so the draft has to be rebuilt from the form
    // rather than left where it was.
    const reopened = await openTheDialog(user)
    expect(
      (document.getElementById('signup-source-glassdoor') as HTMLInputElement).value
    ).toBe('')
    expect(reopened).toBeTruthy()
  })

  it('will not let a malformed address out of the dialog', async () => {
    /*
      THE ONE THAT WOULD HAVE BEEN INVISIBLE. These three fields are not on the
      form behind the dialog, so an address saved malformed would block `build
      my profile` with its explanation two layers away in a panel that is now
      shut.
    */
    const { user } = renderStep()
    const dialog = await openTheDialog(user)

    await user.type(document.getElementById('signup-source-jobstreet') as HTMLElement, 'not a url')
    expect(within(dialog).getByRole('button', { name: 'save' })).toHaveProperty('disabled', true)
    expect(within(dialog).getByRole('alert').textContent).toContain('web address')
  })

  it('saving in the dialog does not submit the step behind it', async () => {
    /*
      A DIALOG IS A REACT PORTAL AS WELL AS A DOM ONE, so a submit inside it
      bubbles up the COMPONENT tree to the sign-up form's own `onSubmit` --
      which would read the profile and leave the page with this panel still
      open. `stopPropagation` is what stops that, and this is the test that
      fails without it.
    */
    const { user, onSubmit } = renderStep()
    await user.type(
      document.getElementById('signup-source-linkedin') as HTMLElement,
      'https://www.linkedin.com/in/me'
    )
    const dialog = await openTheDialog(user)
    await user.type(
      document.getElementById('signup-source-indeed') as HTMLElement,
      'https://profile.indeed.com/p/me-abc123'
    )
    await user.click(within(dialog).getByRole('button', { name: 'save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
