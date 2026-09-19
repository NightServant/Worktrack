import { beforeAll, afterAll, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { describeIntegration, signInTestUser } from '@/test/integration/client'

/**
 * Proves the deployment is safe to ship with a public anon key.
 *
 * The anon key ships to every browser by design, so the only thing standing
 * between a stranger and the data is RLS. These tests act as a stranger: no
 * sign-in, no session, exactly what an attacker has after reading the JS bundle.
 */
describeIntegration('RLS holds against an unauthenticated client', () => {
  const USER_TABLES = [
    'jobs', 'resumes', 'resume_snapshots', 'application_documents',
    'events', 'activity_log', 'contacts', 'application_contacts',
    'user_preferences', 'job_status_history', 'user_profiles',
  ] as const

  let anon: SupabaseClient
  let ownedJobId: string
  let signedIn: SupabaseClient

  beforeAll(async () => {
    anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    // A real row that definitely exists, so "no rows" cannot be a false pass
    // caused by the table simply being empty.
    const session = await signInTestUser()
    signedIn = session.client
    const { data, error } = await signedIn
      .from('jobs')
      .insert({ user_id: session.userId, company: 'RLS Probe Co', role: 'Probe' })
      .select()
      .single()
    if (error) throw new Error(`probe row failed: ${error.message}`)
    ownedJobId = data.id
  })

  afterAll(async () => {
    if (signedIn) {
      await signedIn.from('jobs').delete().eq('id', ownedJobId)
      await signedIn.auth.signOut()
    }
  })

  it('the probe row really exists, so an empty anon read means something', async () => {
    const { data } = await signedIn.from('jobs').select('id').eq('id', ownedJobId)
    expect(data).toHaveLength(1)
  })

  it.each(USER_TABLES)('returns no rows to an anonymous reader of %s', async (table) => {
    const { data, error } = await anon.from(table).select('*').limit(5)
    // RLS filters rather than errors, so the pass condition is an empty result.
    // An error is also acceptable; what is not acceptable is rows coming back.
    if (!error) expect(data ?? []).toHaveLength(0)
  })

  it('refuses an anonymous insert into jobs', async () => {
    const { error } = await anon
      .from('jobs')
      .insert({ user_id: '00000000-0000-0000-0000-000000000000', company: 'X', role: 'Y' })
    expect(error).not.toBeNull()
  })

  it('refuses an anonymous update of a row that exists', async () => {
    const { data, error } = await anon
      .from('jobs')
      .update({ company: 'hijacked' })
      .eq('id', ownedJobId)
      .select()
    // Either refused outright, or matched nothing because RLS hid the row.
    if (!error) expect(data ?? []).toHaveLength(0)
  })

  it('refuses an anonymous delete of a row that exists', async () => {
    const { data, error } = await anon.from('jobs').delete().eq('id', ownedJobId).select()
    if (!error) expect(data ?? []).toHaveLength(0)

    // and the row is still there afterwards
    const { data: still } = await signedIn.from('jobs').select('id').eq('id', ownedJobId)
    expect(still).toHaveLength(1)
  })
})
