'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { SessionExpiredDialog } from '@/components/auth/SessionExpiredDialog'
import { HandoffScreen } from '@/components/auth/HandoffScreen'
import { AppShell } from '@/components/shell/AppShell'
import { RouteSkeleton, type RouteSkeletonVariant } from '@/components/ui/loading-skeletons'

/**
 * The authenticated shell.
 *
 * This is the client-side half of the guard and exists so a signed-out visitor
 * is not left staring at an empty frame. It is not the security boundary --
 * every table is behind owner-only RLS, so an unauthenticated request returns
 * nothing regardless of what the UI renders.
 */
/**
 * Which skeleton to show for a path, while auth is still resolving.
 *
 * THE SHAPE IS THE POINT. A generic spinner tells somebody that something is
 * happening; a skeleton in the shape of the route tells them WHAT is arriving,
 * and the page then resolves into the outline they were already reading rather
 * than replacing it. That is the whole difference between a loading screen and
 * a page that is loading.
 *
 * Longest prefix first, so `/applications/123` gets `detail` rather than the
 * `table` that `/applications` matches.
 *
 * `dashboard` IS THE FALLBACK rather than a blank, because an unknown route
 * under this layout is still a page with a heading and panels -- and the worst
 * case is showing a plausible outline for a beat, which is what every skeleton
 * does anyway.
 */
const SKELETON_BY_PREFIX: ReadonlyArray<readonly [string, RouteSkeletonVariant]> = [
  ['/applications/', 'detail'],
  ['/applications', 'table'],
  ['/analytics', 'analytics'],
  ['/documents', 'documents'],
  ['/planner', 'calendar'],
  ['/cv', 'detail'],
  ['/settings', 'detail'],
  ['/overview', 'dashboard'],
]

function skeletonVariantFor(pathname: string | null): RouteSkeletonVariant {
  const match = SKELETON_BY_PREFIX.find(([prefix]) => pathname?.startsWith(prefix))
  return match ? match[1] : 'dashboard'
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signingOut, sessionExpired } = useAuth()
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    // `signingOut` is what stops this guard from overriding a deliberate
    // sign-out. Reported from the deployed app on 2026-09-03: signing out from
    // /settings landed on /login rather than the home page.
    //
    // Both redirects really did fire. The settings page calls replace('/') as
    // soon as signOut() resolves; a beat later onAuthStateChange sets user to
    // null, this layout re-renders while still mounted, and this effect calls
    // replace('/login'). Second one wins.
    //
    // The fix is not ordering -- it is that these are two different events
    // that happen to share a state. A guard rejection is "you asked for a
    // private page without a session", and /login is right for it. A sign-out
    // is "you chose to leave", and answering that with a sign-in form reads as
    // the app refusing to let go.
    // AN EXPIRY IS THE THIRD EVENT THAT LANDS HERE, and like a sign-out it is
    // not a guard rejection -- so the silent bounce is wrong for it too, for a
    // different reason. A rejection means "you asked for a private page
    // without a session" and /login answers it. An expiry means "you HAD a
    // session and the server ended it while you were reading", and answering
    // that with a sign-in form and no sentence is how somebody concludes the
    // app logged them out at random.
    //
    // `SessionExpiredDialog` below says what happened and carries them to
    // /login itself, with `?next=` set to the screen they were on. Returning
    // early here is what gives it the chance to be read; without it this
    // effect navigates first and the dialog is never seen.
    if (sessionExpired) return
    if (!loading && !user && !signingOut) router.replace('/login')
  }, [loading, user, signingOut, sessionExpired, router])

  // Render nothing while auth resolves. Showing the shell and then redirecting
  // flashes protected chrome at someone who is not signed in.
  //
  // THE ONE EXCEPTION IS AN EXPIRY. It arrives as `user === null` like every
  // other signed-out state, so it falls into this branch -- and rendering
  // nothing would leave the reader looking at a blank page with no idea why.
  // The dialog is rendered INSTEAD OF the shell rather than inside it: the
  // session is gone, so every panel behind it would be showing data this
  // browser no longer has rights to fetch again.
  //
  // It is mounted HERE and not in `AppShell` because the demo renders that
  // same shell with no AuthProvider above it at all -- `useAuth` throws there,
  // which is correct and is how /demo stays a route space rather than an
  // account.
  /*
    THE EXPIRY DIALOG OUTRANKS EVERYTHING, including the skeleton below. An
    expiry arrives as `user === null` like every other signed-out state, and
    showing a loading skeleton to somebody whose session just ended would be
    telling them to wait for something that is never coming.
  */
  if (sessionExpired) return <SessionExpiredDialog />

  /*
    A SKELETON WHILE AUTH RESOLVES, NOT A BLANK PAGE (Gabe, 2026-09-15:
    "there are blank pages").

    This line used to return `null` for `loading`, which meant every cold load
    of a signed-in route painted an empty white document until
    `supabase.auth.getSession()` came back -- a network round trip, so tens of
    milliseconds on a good connection and a great deal more on a bad one. The
    page's OWN skeleton could not help: it lives inside `children`, which this
    gate had already refused to render.

    THE SHELL IS SAFE TO RENDER WITHOUT A USER. `AppShell` takes plain props
    and never calls `useAuth` -- it is the same component /demo mounts with no
    AuthProvider above it at all. So the chrome can paint immediately and the
    content area can carry the skeleton, which is what makes this feel like a
    page arriving rather than a page missing.

    IT IS NOT A FLASH OF PROTECTED CHROME. Middleware turns an unauthenticated
    request away before this page is ever generated, so anyone who reaches
    this branch has a cookie and is nearly always about to resolve to a user.
    The skeleton carries no data -- it is grey blocks in the shape of the route
    that is loading.
  */
  if (loading) {
    return (
      <AppShell>
        {/* `immediate`, because this skeleton has to exist in the SERVER's
            HTML. RouteSkeleton's usual 200ms gate is `useState` plus an
            effect, and effects do not run during SSR -- so the gated version
            renders as nothing in the delivered document and stays nothing for
            another 200ms after hydration. That is precisely the window this
            branch was written to cover, and a screen recording caught it:
            ~900ms of white between the sign-in form and the dashboard.

            There is no warm case to protect here. This branch is only ever
            reached on a cold document load, where `getSession()` must go to
            the network. See RouteSkeleton's `immediate`. */}
        <RouteSkeleton immediate variant={skeletonVariantFor(pathname)} />
      </AppShell>
    )
  }

  /*
    SIGNING OUT. Measured on 2026-09-15 by rendering this layout across every
    state it can be in: this branch and the one below were the last two that
    produced a completely empty document, on the server AND in the browser.

    It is a DIFFERENT SENTENCE from the sign-in one, not a shared "please
    wait". Somebody who pressed sign out and is told "signing you in" will
    believe they pressed the wrong control.

    No skeleton and no shell here: the shell is the thing being left, and an
    outline of the dashboard would be a promise of a page nobody is going to.
  */
  if (signingOut) {
    return (
      <HandoffScreen
        title="signing you out"
        message="Clearing this browser and taking you back to the home page."
      />
    )
  }

  /*
    Signed out and NOT signing out: the effect above is sending this visitor
    to /login because they asked for a private page without a session. The
    navigation is already in flight, so the honest thing to show is where they
    are going -- not a skeleton of the page they cannot have.
  */
  if (!user) {
    return (
      <HandoffScreen
        title="taking you to sign in"
        message="You need to be signed in to see that page."
      />
    )
  }

  return <AppShell>{children}</AppShell>
}
