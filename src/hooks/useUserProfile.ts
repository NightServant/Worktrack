import type { PhoneType } from '@/services/profile'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { userProfileService } from '@/services/userProfileService'
import { importLinkedInExport, type ImportResult } from '@/services/linkedinExport'
import { authedFetch } from '@/lib/authedFetch'
import {
  EMPTY_PROFILE,
  normalizeProfile,
  type ProfileSource,
  type UserProfile,
} from '@/services/profile'
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
      if (!result.recognised.length) return result

      /*
       * MERGED OVER WHAT THE LINKS READ, NOT WRITTEN OVER IT (2026-09-18).
       * This used to save the export's profile whole, which was right while
       * the export was the ONLY way in: everything else was empty. Now that a
       * profile is built from four addresses, saving it whole would delete the
       * GitHub projects and the JobStreet role on the way to adding an About.
       *
       * THE EXPORT WINS FIELD BY FIELD WHERE IT HAS ANYTHING, which is the
       * right precedence rather than a tie-break: it is the person's own data
       * as LinkedIn holds it, and it is the only source that carries the
       * bullet text under a role. Empty stays empty and never overwrites.
       */
      const stored = await userProfileService.get(supabase)
      const merged: UserProfile = { ...EMPTY_PROFILE, ...(stored.profile ?? {}) }
      for (const [key, value] of Object.entries(result.profile) as [
        keyof UserProfile,
        unknown,
      ][]) {
        if (value === null || value === undefined) continue
        if (Array.isArray(value) && value.length === 0) continue
        if (typeof value === 'string' && value.trim() === '') continue
        ;(merged as unknown as Record<string, unknown>)[key] = value
      }
      // THE EXPORT'S ABOUT LEADS, ATTRIBUTED. It is the one the person wrote
      // for an employer to read; a GitHub bio underneath it is context rather
      // than competition. Keyed by site, so importing twice does not stack.
      if (result.profile.summary) {
        merged.about = [
          { site: 'LinkedIn export', text: result.profile.summary },
          ...merged.about.filter((entry) => entry.site !== 'LinkedIn export'),
        ]
      }
      merged.fetchedAt = new Date().toISOString()
      await userProfileService.saveProfile(supabase, merged)
      return { ...result, profile: merged }
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
 * IT ALSO TAKES A CAPTURED PAGE. `html` is the profile bookmarklet's payload
 * -- a logged-in LinkedIn page, which is the only client that can see the
 * About, the skills and the bullet text under each role. It belongs to the
 * first address and the extractor fetches nothing for that one.
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

  return useMutation<
    ProfileFetchResult,
    Error,
    { urls: string[]; html?: string; pages?: { url: string; html: string }[] }
  >({
    mutationFn: async ({ urls, html, pages }) => {
      const response = await authedFetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `pages` ARE THE SUBPAGES THE BOOKMARKLET FETCHED FOR ITSELF -- a
        // LinkedIn profile keeps a long section's tail on its own
        // `/details/` page, so one captured document is never the whole
        // profile. Omitted rather than sent empty, like `html`.
        body: JSON.stringify({
          urls,
          ...(html ? { html } : {}),
          ...(pages && pages.length > 0 ? { pages } : {}),
        }),
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

      // NORMALISED BEFORE IT IS STORED. What comes back is whatever shape the
      // deployed extractor produces, and a deployment lagging this one by a
      // release sends records without the fields added since -- see
      // `normalizeProfile`. Doing it here means the row written is already the
      // current shape rather than one the next read has to repair.
      const complete = normalizeProfile(merged) ?? merged
      await userProfileService.saveProfile(supabase, complete)
      return {
        profile: complete,
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
    // THE RAW REASON RIDES WITH THE SENTENCE, in parentheses, the same way the
    // whole-request failure already carries it. `Could not read that JobStreet
    // page` is a dead end for anybody trying to fix their link; the same line
    // with `(fetch: challenge, firecrawl: http-403)` says which route was tried
    // and what each one said. It is the difference between a report and a
    // shrug -- and it is how the JobStreet failure was diagnosed at all.
    const sentence = typeof source.error === 'string' ? source.error : null
    const reason = typeof source.reason === 'string' ? source.reason : null
    return [
      {
        url: source.url,
        site: typeof source.site === 'string' ? source.site : source.url,
        ok: source.ok === true,
        note:
          sentence && reason && reason !== 'ok' ? `${sentence} (${reason})` : sentence,
        warnings: Array.isArray(source.warnings)
          ? source.warnings.filter((warning): warning is string => typeof warning === 'string')
          : [],
        via: typeof source.via === 'string' ? source.via : null,
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

/**
 * Saves the two details the person owns rather than imports.
 *
 * IT READS, MERGES AND WRITES BACK rather than patching a column, because the
 * profile is one JSONB document -- there is no `phone` column to update on its
 * own. The read is the cache's copy, so this costs one write and no round trip
 * to fetch what is already on screen.
 *
 * IT REFUSES TO WRITE INTO NOTHING. Registration now guarantees a profile
 * exists before this screen can be reached, but a failed first import could
 * still leave an account with none -- and upserting a document whose only
 * fields are a phone number would create a "profile" with no name, no roles
 * and no sources, which every other part of this app would then render as a
 * successful import.
 */
export function useSaveProfileDetails() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (details: {
      phone: string | null
      phoneType: PhoneType | null
      birthday: string | null
    }) => {
      const current = await userProfileService.get(supabase)
      if (!current.profile) {
        throw new Error('There is no profile to add these to yet.')
      }
      await userProfileService.saveProfile(supabase, { ...current.profile, ...details })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-profile', user?.id] })
    },
  })
}
