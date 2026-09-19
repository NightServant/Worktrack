import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { SignedInRedirect } from '../SignedInRedirect'

const useAuthMock = vi.hoisted(() => vi.fn())
const replaceMock = vi.hoisted(() => vi.fn())

vi.mock('@/contexts/AuthContext', () => ({ useAuth: useAuthMock }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}))

beforeEach(() => {
  replaceMock.mockClear()
  useAuthMock.mockReset()
})

/**
 * Gabe's 2026-09-03 ruling: typing the bare domain while signed in should land
 * on the dashboard. It partially reverses 2026-09-02, when `/` was made the
 * homepage for everyone.
 */
describe('the homepage redirect', () => {
  it('sends a signed-in visitor to the dashboard', () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, loading: false })
    render(<SignedInRedirect />)
    expect(replaceMock).toHaveBeenCalledWith('/overview')
  })

  it('leaves a signed-out visitor on the landing page', () => {
    // The overwhelming majority of this route's traffic, and the reason the
    // component renders nothing and blocks nothing.
    useAuthMock.mockReturnValue({ user: null, loading: false })
    render(<SignedInRedirect />)
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('waits for the session to resolve before deciding', () => {
    // supabase-js reads the session from localStorage asynchronously, so the
    // first render always has user: null. Acting on that would be a redirect
    // decision made before the answer exists -- and since it only ever
    // decides "stay", the bug would be silent: signed-in visitors would just
    // never be moved.
    useAuthMock.mockReturnValue({ user: null, loading: true })
    const { rerender } = render(<SignedInRedirect />)
    expect(replaceMock).not.toHaveBeenCalled()

    useAuthMock.mockReturnValue({ user: { id: 'u1' }, loading: false })
    rerender(<SignedInRedirect />)
    expect(replaceMock).toHaveBeenCalledWith('/overview')
  })

  it('renders nothing at all', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false })
    const { container } = render(<SignedInRedirect />)
    expect(container.innerHTML).toBe('')
  })
})
