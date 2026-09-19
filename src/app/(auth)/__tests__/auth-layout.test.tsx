import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const readSupabaseConfig = vi.hoisted(() => vi.fn())
vi.mock('@/lib/env', () => ({ currentEnvSource: () => ({}), readSupabaseConfig }))

const authState = vi.hoisted(() => ({
  current: { user: null as { id: string } | null, loading: false },
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => authState.current }))

const replace = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }) }))

import AuthLayout from '../layout'

beforeEach(() => {
  replace.mockClear()
  authState.current = { user: null, loading: false }
  readSupabaseConfig.mockReturnValue({
    isConfigured: true,
    url: 'https://somyuulytwgzltiboewm.supabase.co',
    anonKey: 'anon',
  })
})

/**
 * Gabe's 2026-09-05 ruling: somebody who is already signed in should get the
 * dashboard, not a form asking them to sign in again.
 */
describe('the sign-in and sign-up shell', () => {
  it('leaves the before-paint decision to middleware, not an inline script', () => {
    // REPLACES "decides before the form paints". That test pinned an inline
    // `<script>` that read localStorage and redirected before hydration -- a
    // workaround for the server being unable to see a session at all. The
    // session is in cookies now and `src/middleware.ts` turns a signed-in
    // visitor away before this page is generated, so the workaround is gone
    // rather than merely unused. See lib/authRoutes for the rule it enforces.
    const { container } = render(<AuthLayout>{<p>form</p>}</AuthLayout>)
    expect(container.querySelector('[data-instant-redirect]')).toBeNull()
  })

  it('also moves somebody who signs in while the page is open', async () => {
    // The case the script structurally cannot cover -- on these two routes it
    // is not an edge case, it is what the pages are for.
    authState.current = { user: { id: 'u1' }, loading: false }
    render(<AuthLayout>{<p>form</p>}</AuthLayout>)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/overview'))
  })

  it('leaves a signed-out visitor on the form', async () => {
    // The overwhelming majority of this route group's traffic, and the reason
    // /login is not simply guarded like an (app) route.
    const { getByText } = render(<AuthLayout>{<p>form</p>}</AuthLayout>)
    expect(getByText('form')).toBeTruthy()
    await Promise.resolve()
    expect(replace).not.toHaveBeenCalled()
  })

  it('does not act while the session is still being read', async () => {
    // The context reports `user: null` before it has an answer. Redirecting on
    // that would only ever decide "stay", so the bug would be silent.
    authState.current = { user: null, loading: true }
    render(<AuthLayout>{<p>form</p>}</AuthLayout>)
    await Promise.resolve()
    expect(replace).not.toHaveBeenCalled()
  })
})
