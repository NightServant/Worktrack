'use client'

import * as React from 'react'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useUserPreferences, useSetDefaultCurrency } from '@/hooks/useUserPreferences'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { ProfileSources, ProfileSourceSteps } from '@/components/settings/ProfileImport'
import type { ProfileState } from '@/components/settings/ProfileGroup'
import type { ProfileDetails } from '@/components/settings/ProfileDetailsDialog'
import {
  useUserProfile,
  useImportProfileFromUrl,
  useClearUserProfile,
  useSaveProfileDetails,
} from '@/hooks/useUserProfile'
import { useBookmarkletImport } from '@/components/applications/useBookmarkletImport'
import { RouteSkeleton } from '@/components/ui/loading-skeletons'
import { toError } from '@/services/supabaseHelpers'
import type { SupportedCurrency } from '@/services/userPreferences'

/**
 * Thin route wrapper, the same split as every other `(app)` route: the
 * screen takes plain props so it renders without Next routing, AuthProvider
 * or react-query, and this file owns every read and write.
 *
 * `prefs` flows from `useUserPreferences`, the same hook `/applications`
 * now reads to close the seam it left open on purpose. Before this task
 * nothing read the stored `user_preferences` row, so every new application
 * defaulted to PHP regardless of what a user chose here. Both routes go
 * through the hook rather than calling `userPreferencesService` directly so
 * a write from either one invalidates the single
 * `['user-preferences', user?.id]` cache entry the other reads.
 *
 * Account deletion has no self-service call on the client SDK --
 * `auth.admin.deleteUser` needs the service role key, which must never reach
 * the browser -- so it goes through `delete_own_account`, a SECURITY
 * DEFINER Postgres function (see the migration alongside this file) that
 * every user-owned table already cascades from on an `auth.users` deletion.
 * A failure here surfaces as a real toast rather than a silent no-op: the
 * button genuinely attempts the deletion and reports what actually
 * happened, rather than pretending to succeed.
 */
function SettingsRoute() {
  const { user, signOut } = useAuth()
  const { data: prefs = null } = useUserPreferences()
  const { data: stored, isPending: profileLoading } = useUserProfile()
  const fetchProfile = useImportProfileFromUrl()
  const clearProfile = useClearUserProfile()
  const saveDetails = useSaveProfileDetails()
  // What the last fetch did, kept here rather than read off the mutation: a
  // page that returned only a name and a headline resolves SUCCESSFULLY with
  // warnings, so `mutation.error` is empty on exactly the case worth saying
  // something about.
  const [profileNote, setProfileNote] = React.useState<string | null>(null)

  /**
   * `?import=bookmarklet&profile=<url>` is how the profile bookmarklet hands
   * this screen a page. The URL rides the query string; the source follows on
   * `postMessage`, because a LinkedIn profile is megabytes of markup.
   */
  const params = useSearchParams()
  const captureUrl = params.get('profile')
  const captured = useBookmarkletImport(
    params.get('import') === 'bookmarklet' && !!captureUrl,
    'profile'
  )
  const setDefaultCurrency = useSetDefaultCurrency()
  const { success, error: showError } = useToast()

  const handleDefaultCurrencyChange = async (code: SupportedCurrency) => {
    try {
      await setDefaultCurrency.mutateAsync(code)
      success('Default currency updated')
    } catch (err) {
      showError(
        'Could not update default currency',
        err instanceof Error ? err.message : 'Unknown error'
      )
    }
  }

  const handleSignOut = async () => {
    try {
      const result = await signOut()
      // A SERVER FAILURE NO LONGER STOPS THE SIGN-OUT. This browser is signed
      // out by the time signOut() resolves, so the navigation happens either
      // way -- previously an unreachable server threw, showed "Sign out
      // failed", and left the user sitting on Settings still signed in.
      //
      // The partial outcome is still worth saying: other devices keep their
      // session until their own token expires, and someone signing out on a
      // shared machine deserves to know that did not reach the rest.
      if (!result.revokedEverywhere && result.message) {
        showError('Signed out here only', result.message)
      }
      // A HARD NAVIGATION, NOT router.replace, and the reason is not style.
      //
      // Gabe reported from the deployed app on 2026-09-03 that this landed on
      // /login. Both redirects were firing: this one, and AppLayout's guard a
      // beat later when onAuthStateChange set the user to null while the
      // layout was still mounted. Whichever ran second won, and it was not
      // reliably this one.
      //
      // `signingOut` on the context now stops the guard from firing at all,
      // which removes the flash. This closes the other half. AuthProvider
      // lives in the ROOT layout, so a client-side navigation to `/` leaves it
      // mounted and leaves that flag raised -- and a raised flag on a later
      // visit to a private route would make the guard stand aside from a
      // rejection it should make, rendering a blank page instead of the
      // sign-in form. A document load tears the provider down, so the flag
      // cannot outlive the sign-out that set it.
      //
      // It also drops every in-memory cache. React Query is still holding the
      // rows of the person who just left; on a shared machine, a client-side
      // navigation keeps them one render away.
      window.location.assign('/')
    } catch (err) {
      showError('Sign out failed', err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const handleDeleteAccount = async () => {
    try {
      // supabase.rpc() resolves { error } as a plain Postgrest error shape
      // ({message, details, hint, code}), not an Error instance -- that only
      // happens when .throwOnError() is chained, which this call does not
      // do. toError() normalizes it the same way userPreferencesService and
      // every other M2 service already do, so the real message (e.g. "The
      // demo account cannot be deleted") reaches the toast instead of
      // silently falling through to "Unknown error".
      const { error } = await supabase.rpc('delete_own_account')
      if (error) throw toError(error)
      await signOut()
      // Same destination and the same mechanism as an ordinary sign-out, and
      // more obviously right here: there is no account left to sign back into,
      // and no cached row that should survive the deletion. The result is not
      // inspected -- the account is gone, so there is no other session left to
      // warn about.
      window.location.assign('/')
    } catch (err) {
      showError('Could not delete account', err instanceof Error ? err.message : 'Unknown error')
    }
  }



  const handleFetchProfile = async (urls: string[]) => {
    setProfileNote(null)
    try {
      await fetchProfile.mutateAsync({ urls })
      success('Profile updated')
      // THE WARNINGS ARE NOT JOINED INTO THIS NOTE ANY MORE (Gabe, 2026-09-18,
      // pasting the result back). Five sources produced seven sentences, each
      // an instruction about a different link, run together into one grey
      // paragraph under the button. They ride on their own source's row now --
      // see `ProfileSources` -- which is where the address they are about is.
      // This note is for the one thing that has no row: a request that threw.
    } catch (err) {
      setProfileNote(err instanceof Error ? err.message : 'Could not read that profile.')
    }
  }

  /**
   * A LinkedIn profile captured by the bookmarklet.
   *
   * IT ARRIVES BY `postMessage`, NOT BY NAVIGATION. The bookmarklet runs on
   * linkedin.com and this app runs on its own origin, so nothing is shared --
   * not storage, not cookies, not the session. The ADDRESS travels in the
   * query string; only the page source is too large for one, so only the
   * source needs a channel. See `useBookmarkletImport`, which both bookmarklets
   * now share.
   *
   * IT IMPORTS ITSELF once, on arrival. The reader clicked a button on their
   * own profile and landed here; asking them to press a second one would be
   * asking them to confirm the thing they just asked for. The guard is the
   * ref: a re-render, a refetch or a second message cannot run it twice.
   */
  const captureRan = React.useRef(false)
  React.useEffect(() => {
    if (!captured || !captureUrl || captureRan.current) return
    captureRan.current = true
    void (async () => {
      setProfileNote(null)
      try {
        // THE SUBPAGES RIDE ALONG. A LinkedIn profile page does not carry a
        // long section in full, so the bookmarklet fetches each `/details/`
        // page from the session it is running in -- see `BookmarkletCapture`.
        await fetchProfile.mutateAsync({
          urls: [captureUrl],
          html: captured.html,
          pages: captured.pages,
        })
        success(
          captured.pages.length > 0
            ? `Profile updated from your page and ${captured.pages.length} more`
            : 'Profile updated from the page you captured'
        )
      } catch (err) {
        setProfileNote(err instanceof Error ? err.message : 'Could not read that page.')
      }
    })()
  }, [captured, captureUrl, fetchProfile, success])

  /**
   * Saving the person's own two details.
   *
   * THE ERROR IS RE-THROWN rather than only toasted, because the dialog that
   * called this stays open on a failure and shows the reason in place -- a
   * toast that disappears while an unsaved form is still on screen is the one
   * arrangement guaranteed to lose somebody's typing.
   */
  const handleSaveDetails = async (details: ProfileDetails) => {
    try {
      await saveDetails.mutateAsync(details)
      success('Details saved')
    } catch (err) {
      showError('Could not save those details', err instanceof Error ? err.message : 'Unknown error')
      throw err
    }
  }

  const profileState: ProfileState = profileLoading
    ? { status: 'loading' }
    : stored?.profile
      ? { status: 'ready', profile: stored.profile }
      : {
          status: 'empty',
          message:
            'No profile yet. Paste the addresses of the profiles you already have — LinkedIn, ' +
            'GitHub, a job board — and Worktrack reads each public page and combines them into ' +
            'one profile that feeds CV tailoring.',
        }

  return (
    <SettingsPage
      prefs={prefs}
      profile={profileState}
      profileSource={
        <ProfileSources
          onFetch={(urls) => void handleFetchProfile(urls)}
          fetching={fetchProfile.isPending}
          clearing={clearProfile.isPending}
          hasProfile={!!stored?.profile}
          note={profileNote}
          sources={stored?.profile?.sources ?? []}
        />
      }
      profileSteps={<ProfileSourceSteps />}
      onSaveDetails={handleSaveDetails}
      email={user?.email ?? null}
      onDefaultCurrencyChange={(code) => void handleDefaultCurrencyChange(code)}
      savingCurrency={setDefaultCurrency.isPending}
      onSignOut={() => void handleSignOut()}
      onDeleteAccount={() => void handleDeleteAccount()}
    />
  )
}

/**
 * `useSearchParams` needs a Suspense boundary in the App Router, the same
 * wrapper `/applications` carries for the same reason.
 */
export default function Page() {
  return (
    <Suspense fallback={<RouteSkeleton variant="table" />}>
      <SettingsRoute />
    </Suspense>
  )
}
