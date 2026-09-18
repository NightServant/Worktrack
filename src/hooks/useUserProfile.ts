import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { userProfileService } from '@/services/userProfileService'
import { importLinkedInExport, type ImportResult } from '@/services/linkedinExport'
import { authedFetch } from '@/lib/authedFetch'
import { EMPTY_PROFILE, type ProfileSource, type UserProfile } from '@/services/profile'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

/**
 * The stored profile, and the import that fills it.
 *
 * THERE IS A FETCH AGAIN, and this time it is Firecrawl's (Gabe, Worktrack
 * Revisions item 8). Two earlier versions of this hook called a route -- one
 * to a Composio connector, which returned eight OIDC fields, and one to a page
 * scraper, which got an authentication wall from a datacenter address. What is
 * different now is the fetcher: Firecrawl runs the page and proxies it, so
 * what comes back is the logged-out profile a browser would see, JSON-LD and
 * all. See `scraper/extractor/profile.py` for exactly what that does and does
 * not carry.
 *
 * `useImportProfile` -- the CSV-export parser -- is left in place and unused,
 * on Gabe's instruction not to remove what this supersedes. It is still the
 * only source that has ever carried the bullet text under a role, so it is
 * worth having when the fetch turns out not to be enough.
 */
export function useUserProfile() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['user-profile', user?.id],
    queryFn: () => userProfileService.get(supabase),
    enabled: !!user,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

/**
 * Parses the export and stores the result.
 *
 * The parse is synchronous and local, so the only thing that can fail here is
 * the write -- which is why the mutation resolves the `ImportResult` rather
 * than swallowing it: the caller needs to say which tables were understood and
 * which files were not.
 */
export function useImportProfile() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation<ImportResult, Error, { name: string; text: string }[]>({
    mutationFn: async (files) => {
      const result = importLinkedInExport(files)
      // A file set that matched nothing is not written -- storing an empty
      // profile over a good one because someone picked the wrong CSV is a
      // worse outcome than an error message.
      if (result.recognised.length) {
        await userProfileService.saveProfile(supabase, result.profile)
      }
      return result
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-profile', user?.id] })
    },
  })
}

/** What `/api/profile` resolves to. Mirrors the extractor's `/profile`. */
export interface ProfileFetchResult {
  profile: UserProfile
  warnings: string[]
  /** One row per address asked for, in the order they were sent. */
  sources: ProfileSource[]
}

/**
 * Reads every address the reader gave and stores the merged result.
 *
 * SEVERAL SOURCES, ONE PROFILE (Gabe, 2026-09-18: "aggregate data sources and
 * combine them into one large single profile"). The addresses go in order of
 * authority -- LinkedIn first, because a CV is written from it -- and the
 * extractor merges them: first non-empty value per field, union of every list,
 * and the same role from two sources filled in rather than listed twice.
 *
 * IT MERGES OVER WHAT IS ALREADY STORED, the same rule the CSV import follows:
 * a fetch that came back with a name and no work history must not blank work
 * history somebody typed in by hand. Only the fields the fetch actually filled
 * are written over.
 *
 * THAT MERGE WAS BROKEN UNTIL 2026-09-18, and the bug is worth naming because
 * the docblock claimed the opposite: it spread `userProfileService.get()` --
 * which returns `{ profile, fetchedAt }` -- into a `UserProfile`, so the
 * existing profile arrived as a nested `profile` key that nothing reads and
 * every stored field was replaced rather than merged. A second import with a
 * thinner source silently dropped the first one's fields.
 */
export function useImportProfileFromUrl() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation<ProfileFetchResult, Error, string[]>({
    mutationFn: async (urls) => {
      const response = await authedFetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      })
      const payload = (await response.json()) as
        | { profile?: Partial<UserProfile>; warnings?: string[]; sources?: unknown }
        | { error?: string; reason?: string }
      if (!response.ok) {
        const message = ('error' in payload && payload.error) || 'Could not read that profile.'
        // THE RAW REASON RIDES ALONG. `/profile` distinguishes an exhausted
        // quota from a sign-in wall from a refused host, and every one of them
        // has a different fix -- collapsing them into one sentence is what
        // sent Gabe to check a link that was fine (2026-09-10).
        const reason = 'reason' in payload && payload.reason ? ` (${payload.reason})` : ''
        throw new Error(`${message}${reason}`)
      }
      const fetched = ('profile' in payload && payload.profile) || {}
      const sources = readSources('sources' in payload ? payload.sources : null)
      const stored = await userProfileService.get(supabase)

      const merged: UserProfile = { ...EMPTY_PROFILE, ...(stored.profile ?? {}) }
      for (const [key, value] of Object.entries(fetched) as [keyof UserProfile, unknown][]) {
        // An empty string, an empty array and null all mean "the page did not
        // have this", and none of them should overwrite something that does.
        if (value === null || value === undefined) continue
        if (Array.isArray(value) && value.length === 0) continue
        if (typeof value === 'string' && value.trim() === '') continue
        ;(merged as unknown as Record<string, unknown>)[key] = value
      }
      // THE ADDRESSES ARE REPLACED, NOT MERGED, and they are the one field
      // where that is right: this list IS what was just asked for, so a source
      // the reader removed has to disappear rather than linger as a row they
      // cannot delete.
      merged.sources = sources
      merged.fetchedAt = new Date().toISOString()

      await userProfileService.saveProfile(supabase, merged)
      return {
        profile: merged,
        warnings: ('warnings' in payload && payload.warnings) || [],
        sources,
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-profile', user?.id] })
    },
  })
}

/**
 * The per-source rows, read defensively.
 *
 * It is a response body, so it is data rather than a type: a deployment
 * running an older extractor returns no `sources` at all, and the panel must
 * render rather than throw on the first `.map`.
 */
function readSources(value: unknown): ProfileSource[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const source = row as Record<string, unknown>
    if (typeof source.url !== 'string') return []
    return [
      {
        url: source.url,
        site: typeof source.site === 'string' ? source.site : source.url,
        ok: source.ok === true,
        note: typeof source.error === 'string' ? source.error : null,
      },
    ]
  })
}

export function useClearUserProfile() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => userProfileService.clear(supabase),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-profile', user?.id] })
    },
  })
}
