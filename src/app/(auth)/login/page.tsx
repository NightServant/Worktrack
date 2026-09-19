'use client'

import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { safeNextPath } from '@/lib/authRoutes'

/**
 * Thin route wrapper, the same split every (app) route uses: AuthScreen takes
 * plain props and renders without Next routing or AuthProvider, and this file
 * owns the call and the navigation.
 *
 * The redirect is inside the RESOLVED path only. The screen surfaces a
 * rejection as its own error and keeps what was typed; navigating on a
 * rejection is how the old single-screen version lost a form.
 *
 * `?next=` IS HONOURED, and it is the other half of the middleware added on
 * 2026-09-11: a signed-out visitor who asked for `/applications?application=x`
 * is sent here with that path attached, and finishing the sign-in should
 * finish the journey rather than dropping them on a dashboard they never asked
 * for. `safeNextPath` is what stops that parameter being an open redirect --
 * it is in a URL somebody can send you, so `//evil.com` is refused rather than
 * trusted.
 *
 * IT IS READ AT SUBMIT TIME, FROM `window.location`, AND NOT VIA
 * `useSearchParams`. That is not a style preference, it is the difference
 * between this page having a server render and not having one. Calling
 * `useSearchParams` in a client component opts it out of static prerendering,
 * and Next 15 only permits that behind a Suspense boundary -- so the first
 * version of this file wrapped itself in one and shipped HTML whose boundary
 * was EMPTY. Measured on the production build: `/signup` had its three inputs
 * in the markup and `/login` had none at all, the form appearing only after
 * hydration. SignedOutOnly's docblock calls losing an auth form's server
 * render a worse regression than the flash it was fixing; it was right, and
 * this was the same mistake wearing a different hat.
 *
 * Reading the parameter when the form is actually submitted costs nothing: it
 * only matters after a click, which is long after hydration, and it is the
 * same string either way. The page goes back to being fully static.
 */
export default function Page() {
  const router = useRouter()
  const { signIn } = useAuth()

  return (
    <AuthScreen
      mode="signin"
      onSubmit={async (email, password) => {
        await signIn(email, password)
        const next = safeNextPath(
          new URLSearchParams(window.location.search).get('next')
        )
        router.push(next ?? '/overview')
      }}
    />
  )
}
