import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { describe } from 'vitest'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const email = process.env.TEST_USER_EMAIL
const password = process.env.TEST_USER_PASSWORD

export const integrationConfigured = Boolean(url && anonKey && email && password)

export const missingIntegrationConfig = [
  !url && 'NEXT_PUBLIC_SUPABASE_URL',
  !anonKey && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  !email && 'TEST_USER_EMAIL',
  !password && 'TEST_USER_PASSWORD',
].filter(Boolean)

/**
 * Skips the suite instead of failing it when credentials are absent.
 *
 * These tests hit the real project, so they cannot run on a machine that has
 * not been given a test account. Skipping keeps `npm test` meaningful for
 * everyone else rather than turning a missing env var into a red build.
 */
export const describeIntegration = integrationConfigured ? describe : describe.skip

/**
 * Signs in as the dedicated test user and returns that client.
 *
 * Deliberately the anon key, not the service role: the service role bypasses
 * RLS, so a test using it would pass whether or not the policies are correct.
 * Everything here runs as a real authenticated user, so auth.uid() resolves and
 * the owner-only policies and demo guard are genuinely exercised.
 */
export async function signInTestUser(): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(url as string, anonKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInWithPassword({
    email: email as string,
    password: password as string,
  })
  if (error) throw new Error(`Integration sign-in failed: ${error.message}`)
  if (!data.user) throw new Error('Integration sign-in returned no user')
  return { client, userId: data.user.id }
}

/**
 * Deletes rows created by a test, newest dependency first.
 *
 * Integration tests write to the same project the app uses, so every test owns
 * its cleanup. Ordering matters where foreign keys do not cascade in the
 * direction being removed.
 */
export async function cleanup(
  client: SupabaseClient,
  deletions: Array<{ table: string; column: string; value: string }>
): Promise<void> {
  for (const { table, column, value } of deletions) {
    await client.from(table).delete().eq(column, value)
  }
}
