'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useAuthHeld } from './authHold'

/**
 * Sends a signed-in visitor from a public route to `/overview`.
 *
 * IT IS NO LONGER THE GATE. Middleware answers all three of the routes that
 * mount it -- `/`, `/login` and `/signup` -- before a page is sent, so a
 * visitor who ARRIVES with a session never reaches this component. What is
 * left is the case middleware structurally cannot see: a session that comes
 * into existence WHILE the page is open. Signing in is exactly that, which is
 * why the auth pages still need this and why it is cheap to leave on `/` for
 * the visitor who signs in elsewhere and comes back to a tab left open.
 *
 * THIS REVERSES A SETTLED DECISION, so the record should say so rather than
 * quietly changing. `/` was made the homepage for everyone on 2026-09-02, on
 * the reasoning that a portfolio piece whose landing page is the thing a
 * reviewer looks at should not hide it from the only people with accounts.
 * Gabe overruled that on 2026-09-03: typing the bare domain while signed in
 * should land on the dashboard. That is the behaviour of every product this
 * one is competing with, and the reviewer case is still served -- the landing
 * page is one click away on the lockup, and reviewers are signed out anyway.
 *
 * IT RENDERS NOTHING AND BLOCKS NOTHING, which is still right: `/` is static
 * and almost all of its traffic is signed out, so holding the page blank until
 * auth resolves would make every anonymous visitor wait on a check whose
 * answer is nearly always no.
 *
 * THE FRAME THIS FILE USED TO APOLOGISE FOR IS GONE. It said a signed-in
 * visitor would see the top of the landing page before being moved, and that
 * removing that needed the session readable on the SERVER -- "a migration, not
 * a fix". The migration happened on 2026-09-11: sessions are cookie-backed via
 * @supabase/ssr and middleware redirects `/` before anything is rendered. The
 * paint-then-vanish only remains for a session that appears mid-visit, where
 * there was nothing to redirect at request time.
 *
 * `replace`, not `push`: otherwise Back from the dashboard returns to `/`,
 * which immediately redirects forward again, and the Back button stops working.
 */
export function SignedInRedirect() {
  const { user, loading } = useAuth()
  const held = useAuthHeld()
  const router = useRouter()

  useEffect(() => {
    // `held` is a flow on this route asking for its last screen -- /signup's
    // thank-you, which this redirect used to delete before it painted. See
    // ./authHold. Without a provider it is always false, so `/` is unchanged.
    if (held) return
    if (!loading && user) router.replace('/overview')
  }, [loading, user, held, router])

  return null
}
