import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUser = vi.hoisted(() => vi.fn())
const createClient = vi.hoisted(() => vi.fn(() => ({ auth: { getUser } })))
const readSupabaseConfig = vi.hoisted(() => vi.fn())

vi.mock('@supabase/supabase-js', () => ({ createClient }))
vi.mock('../env', () => ({
  currentEnvSource: () => ({}),
  readSupabaseConfig,
}))

import { authenticate } from '../apiAuth'

function request(headers: Record<string, string> = {}) {
  return new Request('https://worktrack.test/api/tailor', { method: 'POST', headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  readSupabaseConfig.mockReturnValue({
    isConfigured: true,
    url: 'https://project.supabase.co',
    anonKey: 'anon',
  })
  getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'g@example.com' } }, error: null })
})

describe('who is allowed to spend the quota', () => {
  it('accepts a valid bearer token and reports who it is', async () => {
    const result = await authenticate(request({ Authorization: 'Bearer good-token' }))
    expect(result).toMatchObject({ ok: true, user: { id: 'u1' } })
    // The TOKEN is handed to Supabase, not decoded here.
    expect(getUser).toHaveBeenCalledWith('good-token')
  })

  it('rejects a request with no Authorization header at all', async () => {
    // The state those routes shipped in. Anyone with the path could drain a
    // paid LLM or Apify allowance from a curl loop.
    const result = await authenticate(request())
    expect(result).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects a token Supabase does not recognise', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } })
    expect(await authenticate(request({ Authorization: 'Bearer forged' }))).toMatchObject({
      ok: false,
      status: 401,
    })
  })

  it('VERIFIES the token rather than reading its claims', async () => {
    // The failure mode this guards is the tempting one: decode the JWT locally
    // and trust the `sub`. That accepts any well-formed token, including one
    // the caller wrote themselves -- a formality that looks like
    // authentication. Asserted by the fact that a rejection from Supabase is
    // decisive even though the token is perfectly well-formed.
    const wellFormed =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciIsImV4cCI6OTk5OTk5OTk5OX0.not-a-real-signature'
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid signature' } })
    const result = await authenticate(request({ Authorization: `Bearer ${wellFormed}` }))
    expect(result).toMatchObject({ ok: false, status: 401 })
    expect(getUser).toHaveBeenCalledWith(wellFormed)
  })

  it('rejects a header that is not a bearer scheme', async () => {
    for (const header of ['good-token', 'Basic Z2FiZTpwdw==', 'Bearer', 'Bearer   ']) {
      expect(
        await authenticate(request({ Authorization: header })),
        `"${header}" was accepted`
      ).toMatchObject({ ok: false, status: 401 })
    }
    expect(getUser).not.toHaveBeenCalled()
  })

  it('accepts a lowercase scheme, which RFC 7235 makes legal', async () => {
    expect(await authenticate(request({ Authorization: 'bearer good-token' }))).toMatchObject({
      ok: true,
    })
  })

  it('FAILS CLOSED when Supabase cannot be reached', async () => {
    // An outage must not become an open door on an endpoint that spends money.
    // 503 rather than 401 so the caller is told to retry rather than to sign
    // in again -- their session is fine.
    getUser.mockRejectedValue(new Error('network'))
    expect(await authenticate(request({ Authorization: 'Bearer good-token' }))).toMatchObject({
      ok: false,
      status: 503,
    })
  })

  it('says a misconfigured deployment is misconfigured, not that the user is unauthorised', async () => {
    // A 401 here would send someone to sign in again over and over against a
    // deployment that can never verify anyone.
    readSupabaseConfig.mockReturnValue({ isConfigured: false, url: '', anonKey: '' })
    expect(await authenticate(request({ Authorization: 'Bearer good-token' }))).toMatchObject({
      ok: false,
      status: 503,
    })
    expect(createClient).not.toHaveBeenCalled()
  })

  it('builds a client that remembers nothing between requests', async () => {
    // This runs on a shared server. A client that persisted a session would be
    // a route for one user's token to answer another user's request.
    await authenticate(request({ Authorization: 'Bearer good-token' }))
    expect(createClient).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'anon',
      expect.objectContaining({
        auth: expect.objectContaining({ persistSession: false, autoRefreshToken: false }),
      })
    )
  })
})
