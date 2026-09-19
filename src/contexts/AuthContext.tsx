'use client'

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { hasValidSupabaseConfig, supabase, supabaseConfigError } from '@/lib/supabase'
import { clearStoredSession } from '@/lib/supabaseSession'
import { currentEnvSource, readSupabaseConfig } from '@/lib/env'
import { normalizeEmail } from '@/lib/credentials'
import { ExistingAccountError } from '@/lib/existingAccount'

/**
 * Turns a Supabase auth error into an Error with a usable message.
 *
 * Replaces three copies of `const anyErr = error as any`. `as any` on an error
 * object is how a message that is actually an object ends up rendered as
 * "[object Object]" in front of a person trying to sign in -- and it silences
 * the compiler on the one value in the function that is least under our
 * control. AuthError always carries a string `message`; the fallback is for
 * the shapes that are not AuthError at all.
 */
function authError(error: unknown): Error {
  if (error instanceof Error && error.message) return new Error(error.message)
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message
    if (typeof message === 'string' && message) return new Error(message)
  }
  return new Error('Authentication failed. Please try again.')
}

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  /**
   * True from the moment a sign-out starts until the page navigates away.
   *
   * It exists so the (app) route guard can tell two different events apart.
   * Both end with `user === null`, and they want opposite destinations:
   * a guard rejection means "you asked for a private page without a session"
   * and belongs at /login; a sign-out means "you chose to leave" and belongs
   * at the home page. Nothing in the session state distinguishes them --
   * only intent does, and this is where intent lives.
   */
  signingOut: boolean
  /**
   * True when a signed-in session ENDED WITHOUT THE USER ASKING.
   *
   * WHY IT IS NOT JUST `user === null`. Three different things end with no
   * user, and only one of them is worth interrupting somebody over:
   *
   *   never signed in     -- the ordinary state of a stranger. Say nothing.
   *   signed out on purpose -- they clicked the button. Say nothing; they know.
   *   the session expired  -- the server refused a refresh, or a token was
   *                          revoked, or they were signed out on another
   *                          device. This one arrives with no warning, in the
   *                          middle of something, and the app owes them a
   *                          sentence.
   *
   * Nothing in the session state distinguishes the third from the first two:
   * only the HISTORY does -- there was a user, the user asked for nothing, and
   * now there is no user. That transition is what this flag records, and it is
   * why `signingOut` sits beside it rather than being folded into it.
   *
   * SERVER-SIDE EXPIRY IS WHAT MAKES THIS FIRE AT ALL. `jwt_expiry` alone
   * never ends a session -- refresh-token rotation renews it forever -- so
   * before supabase/config.toml gained `[auth.sessions]` (2026-09-15) the only
   * way to reach this state was a revoked token. See that file.
   */
  sessionExpired: boolean
  /** Clears `sessionExpired` once the app has told the user about it. */
  acknowledgeSessionExpiry: () => void
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<SignOutResult>
  /**
   * Confirms a sign-up with the 6-digit code emailed to the address.
   *
   * Requires the Supabase email template for "Confirm signup" to contain
   * {{ .Token }}. Out of the box it contains {{ .ConfirmationURL }} only, and
   * with that template no code is ever sent -- the call below will keep
   * returning "Token has expired or is invalid" against a code that never
   * existed. See docs/SECURITY.md.
   */
  verifySignUpOtp: (email: string, token: string) => Promise<void>
  /** Re-sends the sign-up code. Supabase applies its own cooldown. */
  resendSignUpOtp: (email: string) => Promise<void>
  /**
   * Starts a password reset: emails a recovery CODE to the address.
   *
   * IT DOES NOT SAY WHETHER THE ADDRESS HAS AN ACCOUNT, and unlike `signUp`
   * that silence is kept deliberately. Supabase returns success either way,
   * there is no `identities` tell to read, and a reset endpoint that answers
   * "no such user" is the single most-probed enumeration oracle there is. The
   * UI's copy is written to match -- "if that address has an account".
   */
  requestPasswordReset: (email: string) => Promise<void>
  /**
   * Verifies a recovery code. ON SUCCESS THE USER IS SIGNED IN -- that is how
   * Supabase recovery works, and it is what makes `updatePassword` below
   * possible without the old password.
   */
  verifyRecoveryOtp: (email: string, token: string) => Promise<void>
  /** Sets a new password for the session `verifyRecoveryOtp` just created. */
  updatePassword: (password: string) => Promise<void>
}

/**
 * What a sign-out achieved. `revokedEverywhere` is false when this browser is
 * signed out but the server could not be told -- a real outcome worth naming,
 * because the two differ for anyone signed in elsewhere.
 */
export interface SignOutResult {
  revokedEverywhere: boolean
  message?: string
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const supabaseUrl = readSupabaseConfig(currentEnvSource()).url

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [signingOut, setSigningOut] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  /**
   * Whether a session has EVER been seen in this provider's lifetime.
   *
   * A ref, not state, and that is load-bearing rather than an optimisation:
   * `onAuthStateChange`'s callback closes over whatever it captured when the
   * subscription was made, and the effect below is deliberately mounted once
   * with `[]`. A `useState` value read in there would be frozen at `false`
   * forever and the expiry would never fire. A ref is the same object on every
   * render, so reading `.current` inside the callback reads the present.
   */
  const hadSession = useRef(false)
  /**
   * The same problem for `signingOut`. The callback has to be able to tell a
   * deliberate sign-out from an expiry, and the state variable it would
   * otherwise read is the one captured at subscribe time -- always `false`,
   * which would report every sign-out as an expiry.
   */
  const signingOutRef = useRef(false)

  useEffect(() => {
    /**
     * `loading` MUST reach false on every path, and it did not.
     *
     * The bug Gabe hit: restart the dev server, open the app while signed in,
     * and land on the marketing page instead of the dashboard.
     * `getSession()` had no `.catch()`, so a rejected call -- a refresh that
     * cannot reach Supabase, a network blip on the first load -- left
     * `loading` true forever and raised an unhandled rejection. Nothing
     * recovers from that state:
     *
     *   - `SignedInRedirect` fires on `!loading && user`, so `/` shows the
     *     landing page and never moves. That is the reported symptom.
     *   - `AppLayout` returns `null` while `loading || !user`, so a private
     *     route renders a blank screen rather than redirecting.
     *
     * Both read as "signed out" while actually being "never finished asking".
     *
     * Two changes make the flag unwedgeable. The `.catch()` is the obvious
     * one. The second is that `onAuthStateChange` now clears it too:
     * supabase-js emits `INITIAL_SESSION` on subscribe, so if `getSession()`
     * fails but the listener later delivers a session -- a refresh that
     * succeeds on the retry -- the app notices instead of staying stuck
     * behind a flag the failed call was the only thing able to clear.
     *
     * A CAUGHT FAILURE IS NOT A SIGN-OUT. It sets `user` to null because
     * nothing better is known yet, and `onAuthStateChange` corrects that the
     * moment a session turns up. Clearing the stored session here would turn
     * one bad request into a real logout.
     */
    let active = true

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!active) return
        // Seeds the expiry test: a page loaded WITH a session is the "there
        // was one" half. Without this a token that dies moments after load
        // would be indistinguishable from never having signed in.
        if (session) hadSession.current = true
        setSession(session)
        setUser(session?.user ?? null)
      })
      .catch((err) => {
        console.warn('Could not read the stored session', err)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return

      /*
        THE EXPIRY TEST, and it is a TRANSITION rather than a state.
        "There was a session, the user did not ask to leave, and now there is
        none" is the only shape an expiry has -- see `sessionExpired` on the
        context type for why the three ways to have no user cannot be told
        apart any other way.

        It is deliberately NOT keyed on the event name. supabase-js emits
        SIGNED_OUT for a revoked token, for a failed refresh AND for our own
        `signOut()`, and it emits nothing at all when a refresh quietly returns
        a null session -- so a switch on the event would both false-positive on
        the deliberate case and miss a real one.
      */
      if (hadSession.current && !signingOutRef.current && !session) {
        setSessionExpired(true)
      }
      if (session) {
        hadSession.current = true
        // A fresh session ends the expired state. This is what clears the
        // notice when somebody signs back in, without the dialog having to
        // reach into auth to do it.
        setSessionExpired(false)
      }

      setSession(session)
      setUser(session?.user ?? null)
      // Whichever of the two answers first releases the app.
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    if (!hasValidSupabaseConfig) {
      throw new Error(supabaseConfigError || 'Supabase is not configured')
    }
    // Normalised at the boundary, so Gabe@x.com and gabe@x.com are one
    // identity rather than two rows -- see lib/credentials.
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizeEmail(email),
      password,
    })
    if (error) throw authError(error)
  }

  /**
   * Register, and say so when the address already has an account.
   *
   * SUPABASE DELIBERATELY WILL NOT TELL YOU. Signing up with an address that
   * already has a CONFIRMED account returns HTTP 200, no error, and a user
   * object with a freshly minted decoy `id` -- verified against this project
   * on 2026-09-15: the real row is 0b3a7a93… and the response carried
   * b6cbddb0…. That is anti-enumeration: an endpoint that answers "taken"
   * lets anyone test addresses against your user table one request at a time.
   *
   * THE COST OF THAT SILENCE, which is why this exists (Gabe, 2026-09-15:
   * "add an alert when users are trying to sign up with an existing
   * account"): the person is shown "check your email" and no email is ever
   * sent, because there is nothing to confirm. They wait, they resend, they
   * conclude the app is broken. That is a guaranteed dead end for a real
   * person, weighed against a probing risk that a determined attacker can
   * approach other ways -- and this is a job tracker, not a bank. Disclosure
   * is the right trade HERE; it would not be everywhere.
   *
   * `identities` IS THE TELL, and the empirical check matters because a
   * wrong reading fires this on EVERY signup and blocks registration
   * entirely. Probed against the live project both ways:
   *
   *     existing confirmed address ->  identities: []        (0 entries)
   *     brand new address          ->  identities: [ … ]     (1 entry)
   *
   * `length === 0` and not a falsy check: `identities` is absent rather than
   * empty on some responses, and treating absent as "exists" would be the
   * false positive that stops everyone signing up.
   */
  const signUp = async (email: string, password: string) => {
    if (!hasValidSupabaseConfig) {
      throw new Error(supabaseConfigError || 'Supabase is not configured')
    }
    const { data, error } = await supabase.auth.signUp({
      email: normalizeEmail(email),
      password,
    })
    if (error) throw authError(error)
    if (data.user && data.user.identities?.length === 0) {
      throw new ExistingAccountError()
    }
  }

  const verifySignUpOtp = async (email: string, token: string) => {
    if (!hasValidSupabaseConfig) {
      throw new Error(supabaseConfigError || 'Supabase is not configured')
    }
    // `type: 'signup'` and not 'email': they are different flows, and using
    // the wrong one rejects a perfectly good code.
    const { error } = await supabase.auth.verifyOtp({
      email: normalizeEmail(email),
      token: token.trim(),
      type: 'signup',
    })
    if (error) throw new Error(error.message)
  }

  const resendSignUpOtp = async (email: string) => {
    if (!hasValidSupabaseConfig) {
      throw new Error(supabaseConfigError || 'Supabase is not configured')
    }
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: normalizeEmail(email),
    })
    if (error) throw new Error(error.message)
  }

  const requestPasswordReset = async (email: string) => {
    if (!hasValidSupabaseConfig) {
      throw new Error(supabaseConfigError || 'Supabase is not configured')
    }
    // NO `redirectTo`. That option exists to make the emailed LINK land
    // somewhere, and this flow sends a code instead -- see
    // supabase/templates/recovery.html. Passing one would imply a round trip
    // through the inbox that no route in this app implements.
    const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email))
    if (error) throw authError(error)
  }

  const verifyRecoveryOtp = async (email: string, token: string) => {
    if (!hasValidSupabaseConfig) {
      throw new Error(supabaseConfigError || 'Supabase is not configured')
    }
    // `type: 'recovery'`, not 'signup' and not 'email'. They are three
    // different flows and the wrong one rejects a perfectly good code.
    const { error } = await supabase.auth.verifyOtp({
      email: normalizeEmail(email),
      token: token.trim(),
      type: 'recovery',
    })
    if (error) throw new Error(error.message)
  }

  const updatePassword = async (password: string) => {
    if (!hasValidSupabaseConfig) {
      throw new Error(supabaseConfigError || 'Supabase is not configured')
    }
    // Relies on the session `verifyRecoveryOtp` just created. Called without
    // one, Supabase rejects it -- which is the correct failure, since the
    // alternative would be changing a password on the strength of nothing.
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw authError(error)
  }

  /**
   * Sign out of this browser, unconditionally.
   *
   * IT USED TO BE POSSIBLE TO FAIL. `supabase.auth.signOut()` calls the server
   * to revoke the token, and auth-js's `_signOut` returns early on any error
   * that is not a 401/403/404 -- a 500, or an offline
   * `AuthRetryableFetchError` -- WITHOUT reaching `_removeSession()`. The old
   * code then threw, Settings caught it, showed "Sign out failed", and never
   * navigated. The session was still in localStorage and the user was still
   * signed in.
   *
   * That made signing out a request the network could veto, which is
   * backwards. Revoking the token on the server is best-effort and worth
   * attempting -- it is what ends the session on other devices -- but clearing
   * it HERE is the part the user actually asked for, and it now happens
   * whatever the server said.
   *
   * It no longer throws on a server failure, because throwing would mean the
   * caller treats a successful local sign-out as a failure. The result says
   * what happened instead, so the UI can leave AND mention that other devices
   * may still be signed in.
   */
  const signOut = async (): Promise<SignOutResult> => {
    if (!hasValidSupabaseConfig) {
      throw new Error(supabaseConfigError || 'Supabase is not configured')
    }
    // Raised BEFORE the call, not after. onAuthStateChange can fire while
    // signOut() is still in flight, and the guard reads this flag on the very
    // next render -- setting it afterwards would leave exactly the window this
    // is meant to close.
    setSigningOut(true)
    // The ref, not just the state: the auth listener reads this to tell a
    // deliberate sign-out from an expiry, and it cannot see a state update
    // made after it subscribed. Set BEFORE the call for the same reason
    // `signingOut` is -- onAuthStateChange can fire while signOut() is still
    // in flight, and a sign-out reported as an expiry would pop a dialog at
    // somebody who just asked to leave.
    signingOutRef.current = true

    let serverError: Error | null = null
    try {
      const { error } = await supabase.auth.signOut()
      if (error) serverError = authError(error)
    } catch (err) {
      // A rejected call is the same situation as a returned error: the local
      // session still has to go.
      serverError = err instanceof Error ? err : new Error('Sign out failed')
    }

    // THE PART THAT CANNOT FAIL. Whatever happened above, this browser is
    // signed out when this line has run.
    clearStoredSession(supabaseUrl)
    setSession(null)
    setUser(null)

    // `signingOut` stays raised deliberately. The caller navigates away with a
    // document load and this provider is torn down with it; lowering the flag
    // here would re-arm AppLayout's guard during the navigation it is standing
    // aside for, which is the bug it was added to fix.
    return serverError
      ? {
          revokedEverywhere: false,
          message:
            'Signed out on this device. We could not reach the server, so other devices may still be signed in.',
        }
      : { revokedEverywhere: true }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        signingOut,
        sessionExpired,
        acknowledgeSessionExpiry: () => setSessionExpired(false),
        signIn,
        signUp,
        verifySignUpOtp,
        resendSignUpOtp,
        requestPasswordReset,
        verifyRecoveryOtp,
        updatePassword,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
