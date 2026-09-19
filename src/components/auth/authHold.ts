'use client'

import * as React from 'react'

/**
 * Lets a flow on an auth route finish its last screen before the guards act.
 *
 * WHY IT HAS TO EXIST. `/signup`'s whole job is to bring a session into
 * existence, and both guards on that route treat a new session as "you are in
 * the wrong place": `SignedInRedirect` navigates to /overview and
 * `SignedOutOnly` returns null. On /login that is exactly right -- the form
 * has done its work and the page should get out of the way. On /signup it
 * deleted a screen. SignUpFlow's third step is a thank-you that holds for
 * 2.5s and then leaves; the session appears the instant the code verifies, so
 * both guards fired first and the step never got a frame. Gabe, 2026-09-15:
 * "there is no auth layout thank you page before dashboard." The step had been
 * written, tested and shipped, and was unreachable in a browser -- its tests
 * mounted `SignUpFlow` directly, where neither guard exists.
 *
 * WHY A CONTEXT RATHER THAN A PROP. The guards are mounted by the LAYOUT and
 * the flow lives inside the page, so there is no prop path between them
 * without threading state through a layout that has no business knowing what
 * step a form is on.
 *
 * WHY NOT JUST DROP THE GUARDS ON /signup. Because the hold is temporary and
 * failure-shaped: if the redirect never fires, someone is parked on a
 * thank-you page with a session. Holding for the duration of one screen keeps
 * the guards as the backstop for every other way a session can appear here --
 * a second tab signing in, a restored session, a link followed mid-flow.
 *
 * NO PROVIDER MEANS NO HOLD. `SignedInRedirect` is also mounted on `/`, which
 * has no provider, and every test that renders these components in isolation
 * has none either. Both hooks degrade to "not held", so the guards behave
 * exactly as they did before this file existed.
 */
const HoldContext = React.createContext<{
  held: boolean
  setHeld: (held: boolean) => void
} | null>(null)

/** Internal: the provider component is the only other thing that needs this. */
export const AuthHoldContext = HoldContext

/** For a guard: is a flow asking to be left alone? False without a provider. */
export function useAuthHeld(): boolean {
  return React.useContext(HoldContext)?.held ?? false
}

/**
 * For a flow: hold the guards while `hold` is true.
 *
 * The cleanup releases on unmount, so a flow that is navigated away from
 * mid-screen cannot leave the guards suppressed for the next page.
 */
export function useHoldAuthGuards(hold: boolean): void {
  const setHeld = React.useContext(HoldContext)?.setHeld
  React.useEffect(() => {
    if (!setHeld) return
    setHeld(hold)
    return () => setHeld(false)
  }, [setHeld, hold])
}
