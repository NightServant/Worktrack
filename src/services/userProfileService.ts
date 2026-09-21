import type { SupabaseClient } from '@supabase/supabase-js'
import { requireUserId, toError } from './supabaseHelpers'
import { normalizeProfile, type UserProfile } from './profile'

/**
 * The read/write half of `user_profiles`: the LinkedIn URL a user gave, and
 * the profile parsed from it.
 *
 * THE PARSED RESULT IS CACHED ON PURPOSE. LinkedIn serves its sign-in wall to
 * most requests that do not come from a signed-in browser, so a fetch that
 * worked once is worth keeping -- without this the panel would be empty on
 * every visit where LinkedIn happened to say no.
 *
 * `get` never filters on `user_id`, matching userPreferencesService and
 * eventService: the table is behind owner-only RLS, so a redundant filter
 * would hide a broken policy instead of surfacing it.
 */

export interface StoredProfile {
  /** Null until an export has been imported. */
  profile: UserProfile | null
  fetchedAt: string | null
}

export const EMPTY_STORED: StoredProfile = {
  profile: null,
  fetchedAt: null,
}

/**
 * The address this account signed up with, or null.
 *
 * `getSession` RATHER THAN `getUser`: the session is already in memory and a
 * `getUser` is a round trip to Supabase on every profile read, for a value
 * that is on the token this client is holding.
 */
async function accountEmail(client: SupabaseClient): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await client.auth.getSession()
    const email = session?.user?.email?.trim()
    return email && email.length > 0 ? email : null
  } catch {
    // A read of the profile must not fail because the session store did.
    return null
  }
}

export const userProfileService = {
  async get(client: SupabaseClient): Promise<StoredProfile> {
    const { data, error } = await client
      .from('user_profiles')
      .select('profile, fetched_at')
      .maybeSingle()
    if (error) throw toError(error)
    if (!data) return EMPTY_STORED

    const row = data as {
      profile: unknown
      fetched_at: string | null
    }
    // Normalised rather than cast: a row written by an older version of the
    // parser is missing whatever fields were added since, and the panel
    // would read `undefined.length` on the first list it rendered. The
    // top-level spread used to be enough; the records inside it are covered
    // now too -- see `normalizeProfile`, and the crash that earned it.
    const profile = normalizeProfile(row.profile as Partial<UserProfile> | null)

    return {
      /*
        THE ACCOUNT'S EMAIL WINS OVER A SOURCE'S (Gabe, 2026-09-21: "email used
        from the account registration must be used").

        IT WAS NEVER WRITTEN AT ALL, WHICH IS THE ACTUAL DEFECT. `email` is a
        field only a PARSER ever filled, and no public profile publishes an
        address -- LinkedIn does not, a signed-out JobStreet page does not, and
        GitHub only where somebody made theirs public. So for almost everybody
        it was null, the profile card drew no email row, and every CV fell back
        to the template's `email@example.com`. The app has known the right
        answer since the moment the account was verified.

        AND IT WINS RATHER THAN FILLING A GAP. A public GitHub address is the
        one a person publishes for strangers; the one they registered with is
        the one they read. On a CV, and on the card, that is the one to print.

        HERE RATHER THAN IN THE CV TOKENS, so the profile card and the document
        cannot disagree -- two answers to "what is my email" on one screen is
        worse than the missing row this replaces. It is not persisted: nothing
        is written back, so changing the account's email changes this on the
        next read rather than leaving a stale copy in a JSONB column.

        AN ABSENT PROFILE STAYS ABSENT. `null` means "nothing imported yet" and
        the whole settings screen reads it that way; an object carrying only an
        email would be a profile as far as every caller is concerned.
      */
      profile: profile && { ...profile, email: (await accountEmail(client)) ?? profile.email },
      fetchedAt: row.fetched_at,
    }
  },

  async saveProfile(client: SupabaseClient, profile: UserProfile): Promise<void> {
    const userId = await requireUserId(client)
    const { error } = await client.from('user_profiles').upsert(
      {
        user_id: userId,
        profile,
        fetched_at: profile.fetchedAt ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    if (error) throw toError(error)
  },

  /** Forgets the stored profile and the URL behind it. */
  async clear(client: SupabaseClient): Promise<void> {
    const userId = await requireUserId(client)
    const { error } = await client.from('user_profiles').delete().eq('user_id', userId)
    if (error) throw toError(error)
  },
}
