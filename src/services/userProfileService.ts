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
    return {
      // Normalised rather than cast: a row written by an older version of the
      // parser is missing whatever fields were added since, and the panel
      // would read `undefined.length` on the first list it rendered. The
      // top-level spread used to be enough; the records inside it are covered
      // now too -- see `normalizeProfile`, and the crash that earned it.
      profile: normalizeProfile(row.profile as Partial<UserProfile> | null),
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
