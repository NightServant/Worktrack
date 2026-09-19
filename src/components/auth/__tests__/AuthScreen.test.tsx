import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthScreen } from '../AuthScreen'

/**
 * Labels are matched with anchored regexes, not exact strings: Field appends a
 * required marker, so the accessible name is "Email *". Anchoring at the start
 * is what keeps /^Password/ from also matching "Confirm password *".
 */

describe('AuthScreen in sign-in mode', () => {
  it('asks for an email and a password and nothing else', () => {
    render(<AuthScreen mode="signin" onSubmit={vi.fn()} />)
    expect(screen.getByLabelText(/^Email/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument()
    // Positive companions above: without them this negative would hold for a
    // component that rendered nothing at all.
    expect(screen.queryByLabelText(/^Confirm password/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('offers the switch to sign up', () => {
    render(<AuthScreen mode="signin" onSubmit={vi.fn()} />)
    expect(screen.getAllByRole('link', { name: 'sign up' })[0]).toHaveAttribute(
      'href',
      '/signup'
    )
  })
})

describe('AuthScreen in sign-up mode', () => {
  it('adds a confirm-password field and relabels the submit', () => {
    render(<AuthScreen mode="signup" onSubmit={vi.fn()} />)
    expect(screen.getByLabelText(/^Confirm password/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
  })

  it('inverts the switch link', () => {
    render(<AuthScreen mode="signup" onSubmit={vi.fn()} />)
    expect(screen.getAllByRole('link', { name: 'sign in' })[0]).toHaveAttribute(
      'href',
      '/login'
    )
  })

  it('refuses to submit when the two passwords disagree', async () => {
    const onSubmit = vi.fn()
    render(<AuthScreen mode="signup" onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText(/^Email/), 'a@b.test')
    await userEvent.type(screen.getByLabelText(/^Password/), 'hunter22')
    await userEvent.type(screen.getByLabelText(/^Confirm password/), 'hunter23')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Those passwords do not match.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('AuthScreen failure handling', () => {
  it('keeps what was typed when the submit fails', async () => {
    // This milestone has already shipped this defect class twice: a failed
    // save that discarded nineteen typed fields, and an editor that dropped
    // keystrokes mid-save. A rejected sign-in must not clear the form.
    const onSubmit = vi.fn().mockRejectedValue(new Error('Invalid login credentials'))
    render(<AuthScreen mode="signin" onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText(/^Email/), 'a@b.test')
    await userEvent.type(screen.getByLabelText(/^Password/), 'hunter22')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument()
    expect((screen.getByLabelText(/^Email/) as HTMLInputElement).value).toBe('a@b.test')
    expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe('hunter22')
  })

  it('re-enables the submit after a failure so it can be retried', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Network error'))
    render(<AuthScreen mode="signin" onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText(/^Email/), 'a@b.test')
    await userEvent.type(screen.getByLabelText(/^Password/), 'hunter22')
    const submit = screen.getByRole('button', { name: 'Sign in' })
    await userEvent.click(submit)
    expect(await screen.findByText('Network error')).toBeInTheDocument()
    expect(submit).toBeEnabled()
  })
})

describe('AuthScreen password field', () => {
  it('reveals and re-hides through the field control, not a separate button', async () => {
    // M4's PasswordInput anchors its reveal to the field's right edge, which is
    // the fix for the Figma frame's off-canvas control at 335px. Reusing it is
    // the point; this proves it is actually the component being used.
    render(<AuthScreen mode="signin" onSubmit={vi.fn()} />)
    const field = screen.getByLabelText(/^Password/) as HTMLInputElement
    expect(field.type).toBe('password')
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(field.type).toBe('text')
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(field.type).toBe('password')
  })
})

describe('AuthScreen layout', () => {
  it('drops the brand panel below lg, where there is no room for it', () => {
    const { container } = render(<AuthScreen mode="signin" onSubmit={vi.fn()} />)
    const panel = container.querySelector('[data-brand-panel]')
    expect(panel).not.toBeNull()
    expect(panel!.className).toContain('hidden')
    expect(panel!.className).toContain('lg:flex')
  })

  it('puts the switch link top-right on desktop and inline on mobile', () => {
    // A top-right link on a 375px screen is an awkward tap target next to
    // nothing else, so there are two and each hides at the other's breakpoint.
    const { container } = render(<AuthScreen mode="signin" onSubmit={vi.fn()} />)
    const desktop = container.querySelector('[data-switch-desktop]')
    const mobile = container.querySelector('[data-switch-mobile]')
    expect(desktop).not.toBeNull()
    expect(mobile).not.toBeNull()
    expect(desktop!.className).toContain('hidden')
    expect(desktop!.className).toContain('lg:block')
    expect(mobile!.className).toContain('lg:hidden')
  })
})
