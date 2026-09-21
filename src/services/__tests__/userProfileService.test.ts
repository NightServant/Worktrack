import { describe, it, expect, vi } from 'vitest'
import { userProfileService } from '../userProfileService'

/**
 * Whose email a profile reports.
 *
 * THE DEFECT (Gabe, 2026-09-21, with a screenshot of a CV header reading
 * `email@example.com`): "email used from the account registration must be
 * used". `UserProfile.email` was a field only a PARSER ever wrote, and no
 * public profile publishes an address -- LinkedIn does not, a signed-out
 * JobStreet page does not, GitHub only where somebody made theirs public. So
 * for almost everybody it was null, the settings card drew no email row, and
 * every generated CV fell back to the template's specimen address. The app has
 * known the right answer since the account was verified.
 *
 * The chainable PostgREST stand-in is the one `userPreferencesService.test.ts`
 * uses, with `auth.getSession` added, which is what this service reads.
 */
function fakeClient(profile: unknown, email: string | null = 'gabe@worktrack.test') {
  const result = { data: { profile, fetched_at: '2026-09-21T00:00:00.000Z' }, error: null }
  const query: Record<string, unknown> = {}
  query.select = vi.fn(() => query)
  query.maybeSingle = vi.fn(() => Promise.resolve(result))

  return {
    from: vi.fn(() => query),
    auth: {
      getSession: vi.fn(() =>
        Promise.resolve({ data: { session: email ? { user: { email } } : null } })
      ),
    },
  } as never
}

describe('userProfileService.get — the email on a profile', () => {
  it('reports the address the account registered with', async () => {
    const stored = await userProfileService.get(fakeClient({ name: 'Gabe' }))
    expect(stored.profile?.email).toBe('gabe@worktrack.test')
  })

  it('prefers it over one a source published', async () => {
    /*
      A PUBLIC GITHUB ADDRESS IS THE ONE A PERSON PUBLISHES FOR STRANGERS; the
      one they registered with is the one they read. On a CV, and on the
      profile card, that is the one to print.
    */
    const stored = await userProfileService.get(
      fakeClient({ name: 'Gabe', email: 'scraped-from-github@example.com' })
    )
    expect(stored.profile?.email).toBe('gabe@worktrack.test')
  })

  it('keeps a stored address when there is no session to ask', async () => {
    // Server-side rendering and a signed-out read both land here; losing the
    // parsed address as well would be a second defect wearing the first one.
    const stored = await userProfileService.get(
      fakeClient({ name: 'Gabe', email: 'parsed@example.com' }, null)
    )
    expect(stored.profile?.email).toBe('parsed@example.com')
  })

  it('does not invent a profile for an account that has none', async () => {
    // `null` means "nothing imported yet" and the whole settings screen reads
    // it that way. An object carrying only an email would be a profile as far
    // as every caller is concerned, and the import steps would vanish.
    const stored = await userProfileService.get(fakeClient(null))
    expect(stored.profile).toBeNull()
  })

  it('still reads the profile when the session store throws', async () => {
    const client = fakeClient({ name: 'Gabe', email: 'parsed@example.com' }) as {
      auth: { getSession: () => Promise<unknown> }
    }
    client.auth.getSession = () => Promise.reject(new Error('storage disabled'))
    const stored = await userProfileService.get(client as never)
    expect(stored.profile?.email).toBe('parsed@example.com')
  })
})
