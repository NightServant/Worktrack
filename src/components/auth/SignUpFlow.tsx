'use client'

import * as React from 'react'
import Link from 'next/link'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input, PasswordInput } from '@/components/ui/input'
import { UserRoundIcon } from '@/components/icons'
import { iconMotion } from '@/components/icons/motion'
import {
  isPasswordStrong,
  isDisposableEmail,
  isValidEmail,
  normalizeEmail,
  PASSWORD_MAX_LENGTH,
} from '@/lib/credentials'
import { takeAuthAttempt, resetAuthAttempts } from '@/lib/authRateLimit'
import { AuthBrandPanel } from './AuthBrandPanel'
import { useHoldAuthGuards } from './authHold'
import { isExistingAccountError } from '@/lib/existingAccount'
import { OtpStep } from './OtpStep'
import { PersonaliseStep, type PersonaliseDetails } from './PersonaliseStep'
import { PasswordRequirements } from './PasswordRequirements'
import { ProgressTrack } from '@/components/ui/progress-track'
import { StatusState } from '@/components/ui/status-state'

/**
 * Registration, as three steps over one layout.
 *
 * credentials -> verify -> done. The steps are state rather than routes: a
 * half-finished sign-up is not a place you should be able to link someone to,
 * bookmark, or return to with the back button, because the only thing that
 * makes step two meaningful is having just completed step one.
 *
 * VALIDATION HAPPENS BEFORE THE NETWORK, and that is the rate-limiting story
 * as much as the usability one. Every request this form does not send is a row
 * the auth server does not have to reject, and a malformed address or a weak
 * password was never going to succeed. What remains is throttled per browser
 * -- see lib/authRateLimit, which is candid about being an affordance rather
 * than a boundary.
 *
 * The email is NORMALISED before it goes anywhere: trimmed and lowercased, so
 * Gabe@x.com and gabe@x.com are one identity. Without that, walking the case
 * permutations of a single address is a way to create many rows that all
 * belong to one person.
 */
export interface SignUpFlowProps {
  onSignUp: (email: string, password: string) => Promise<void>
  onVerify: (email: string, code: string) => Promise<void>
  onResend: (email: string) => Promise<void>
  /**
   * Reads the addresses given at the last step and stores the details.
   *
   * OPTIONAL, so a caller that has no profile story -- every test of the two
   * earlier steps -- gets the three-step flow it always had rather than a step
   * with nothing behind it.
   */
  onPersonalise?: (details: PersonaliseDetails) => Promise<void>
  /** Called after the thank-you has been shown. */
  onDone: () => void
  /** How long the thank-you holds before leaving. Injectable for tests. */
  doneDelayMs?: number
}

/**
 * The glyphs are chosen to say what the step ASKS OF YOU, not what it is
 * called. A person for the details you hand over, a shield for the check that
 * the address is really yours, a tick for being through. A numbered circle
 * would have said nothing the label does not already say.
 */
/**
 * Three steps, named rather than numbered: a bar that says "2 of 3" tells
 * someone how much is left but not what is coming, and "verify" arriving as a
 * surprise after a password form is the moment people abandon a sign-up.
 *
 * The DESCRIPTIONS are new (2026-09-11) and they are the reason this moved to
 * the shared tracker rather than keeping its own: every other progress bar in
 * this app carries a line under each step saying what happens there, and the
 * one on the way IN was the only one that did not.
 */
const STEPS = [
  { id: 'your details', label: 'your details', description: 'an email and a password', icon: 'UserRound' as const },
  { id: 'verify', label: 'verify', description: 'a six-digit code', icon: 'ShieldCheck' as const },
  /*
    THE FOURTH STEP (Gabe, 2026-09-21) and it is deliberately after the code
    rather than before it. Reading a profile WRITES one, and `user_profiles` is
    scoped to `auth.uid()` -- there is no `auth.uid()` until the code is
    accepted, so a sources form earlier would have nowhere to put what it
    found. It also means nobody re-types four links when a code fails to
    arrive. See `PersonaliseStep`.
  */
  { id: 'personalise', label: 'personalise', description: 'a profile to read', icon: 'Link' as const },
  { id: 'done', label: 'done', description: 'you are in', icon: 'CircleCheck' as const },
]
type Step = 0 | 1 | 2 | 3

/** The thank-you. Derived, so adding a step cannot leave it behind. */
const DONE_STEP = (STEPS.length - 1) as Step

export function SignUpFlow({
  onSignUp,
  onVerify,
  onResend,
  onPersonalise,
  onDone,
  doneDelayMs = 2500,
}: SignUpFlowProps) {
  const [step, setStep] = React.useState<Step>(0)

  /*
    THE THANK-YOU ONLY EXISTS BECAUSE OF THIS LINE. Verifying the code creates
    a session, and both guards in the (auth) layout treat a new session as a
    reason to leave -- one navigates, the other unmounts the subtree.

    `step >= 1`, NOT `step === 2`, and the difference was a live bug for a few
    hours. The session is created inside `onVerify`, which resolves BEFORE
    `setStep(2)` runs, so holding on step 2 leaves a one-await window in which
    the session exists and the guards are still armed. They fire in it.

    It shipped that way because this file's composition test mocked `useAuth`
    as a variable nobody re-read: flipping it re-rendered nothing, so the
    window was invisible and the test was green on a broken flow. The mock now
    notifies its consumers the way the real context does, and both it and the
    password-reset flow are held from the code step.
  */
  useHoldAuthGuards(step >= 1)
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  // Separate from `error`, because this one is not a message to read -- it is
  // a message plus the action that resolves it. See the catch below.
  const [existingAccount, setExistingAccount] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    // THE LAST STEP, WHICH IS NOW 3 (2026-09-21). A literal that tracked the
    // end of the flow and did not move with it would leave the thank-you on
    // screen forever.
    if (step !== DONE_STEP) return
    const id = setTimeout(onDone, doneDelayMs)
    // Cleared on unmount so a navigation away cannot fire a redirect into a
    // page the person has already left.
    return () => clearTimeout(id)
  }, [step, onDone, doneDelayMs])

  async function handleDetails(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setExistingAccount(null)

    const cleanEmail = normalizeEmail(email)

    if (!isValidEmail(cleanEmail)) {
      setError('That does not look like an email address we can reach.')
      return
    }
    // Checked BEFORE anything is sent. A throwaway inbox passes the emailed
    // code -- mail really does arrive there -- so the code cannot be what
    // catches it, and refusing after the send would waste the send and leave a
    // half-made account behind.
    if (isDisposableEmail(cleanEmail)) {
      setError(
        'That is a temporary inbox. Use an address you will still have later, ' +
          'or you will not be able to get back into this account.'
      )
      return
    }
    if (!isPasswordStrong(password)) {
      setError(
        password.length > PASSWORD_MAX_LENGTH
          ? `Passwords are limited to ${PASSWORD_MAX_LENGTH} characters.`
          : 'Your password does not meet every requirement below yet.'
      )
      return
    }
    if (password !== confirm) {
      setError('Those passwords do not match.')
      return
    }

    // Only now does anything leave the browser.
    const limit = takeAuthAttempt('signup')
    if (!limit.allowed) {
      setError(
        `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`
      )
      return
    }

    setBusy(true)
    try {
      await onSignUp(cleanEmail, password)
      setEmail(cleanEmail)
      setStep(1)
    } catch (err) {
      /*
        THE ONE ERROR THAT IS NOT JUST TEXT. Every other failure here is prose
        from Supabase rendered verbatim; this one needs a route out, because
        the person is not doing anything wrong -- they already have what they
        are trying to create, and the only useful next move is to sign in.
        Without it they were shown "check your email" and waited for a code
        that is never sent, since there is nothing to confirm.

        The address is captured so the sign-in link can carry it and they do
        not have to type it a third time.
      */
      if (isExistingAccountError(err)) {
        setExistingAccount(cleanEmail)
      } else {
        setError(err instanceof Error ? err.message : 'Could not create the account.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen">
      <AuthBrandPanel />

      <div className="flex w-full flex-col px-gutter py-10 lg:min-w-0 lg:flex-1 lg:px-24">
        <div data-switch-desktop className="hidden text-body-s lg:block lg:self-end">
          <span className="text-text-muted">have an account? </span>
          <Link href="/login" className="text-accent-default underline underline-offset-4">
            sign in
          </Link>
        </div>

        <div className="flex-1" />

        <div className="mx-auto flex w-full max-w-[480px] flex-col gap-8">
          {/* `data-registration-progress` is kept on the wrapper: it is what
              the sign-up tests reach for, and the flow's own identity does not
              change just because the bar inside it is now shared. */}
          <div data-registration-progress>
            <ProgressTrack label="Registration progress" steps={STEPS} current={step} />
          </div>

          {step === 0 && (
            <form onSubmit={handleDetails} className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <h1 className="text-heading-l text-text-primary">create an account</h1>
                <p className="text-body-m text-text-secondary">
                  An email and a password. We will send a code to check the address works.
                </p>
              </div>

              {error && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {existingAccount && (
                /*
                  NOT `variant="destructive"`. Nothing failed and the person
                  did nothing wrong -- they have an account. Painting that red
                  tells them they made a mistake when the honest reading is
                  "you are already done, go this way".
                */
                <Alert role="alert" data-existing-account>
                  <AlertDescription>
                    <span>
                      You already have an account with{' '}
                      <strong className="text-text-primary">{existingAccount}</strong>. No code
                      was sent, because there is nothing to confirm.
                    </span>{' '}
                    {/*
                      NO `?email=` ON THIS LINK. It would have to be read back
                      by AuthScreen, which does not read it, so it was a
                      promise the next page does not keep -- and an address in
                      a query string is copied into history and into every
                      referrer the next page sends. Saving one field of typing
                      is not worth either.

                      NO "reset your password" EITHER, which the first draft
                      offered: this app has no password-reset flow at all --
                      `resetPasswordForEmail` appears nowhere -- so the link
                      would have gone to the sign-in form and left somebody
                      hunting for a button that does not exist.
                    */}
                    <Link
                      href="/login"
                      className="text-accent-default underline underline-offset-4"
                    >
                      Sign in instead
                    </Link>
                  </AlertDescription>
                </Alert>
              )}

              <Field id="signup-email" label="Email" required>
                <Input
                  id="signup-email"
                  name="email"
                  icon="Mail"
                  type="text"
                  inputMode="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  smoothCaret
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>

              <div className="flex flex-col gap-3">
                <Field id="signup-password" label="Password" required>
                  <PasswordInput
                    id="signup-password"
                    name="password"
                    icon="Lock"
                    autoComplete="new-password"
                    required
                    // The rules are listed under this field, so the
                    // placeholder names only the one people get wrong.
                    placeholder="at least 10 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <PasswordRequirements password={password} />
              </div>

              <Field id="signup-confirm" label="Confirm password" required>
                <PasswordInput
                  id="signup-confirm"
                  name="confirmPassword"
                  icon="Lock"
                  autoComplete="new-password"
                  required
                  placeholder="type it again"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>

              {/* The glyph is dropped while busy: Button's spinner uses the
                  same leading slot. */}
              <Button
                type="submit"
                variant="primary"
                size="m"
                loading={busy}
                loadingText="Creating your account..."
              >
                {!busy && <UserRoundIcon size={16} aria-hidden className={iconMotion('lift')} />}
                Create account
              </Button>

              <div data-switch-mobile className="text-body-s lg:hidden">
                <span className="text-text-muted">have an account? </span>
                <Link href="/login" className="text-accent-default underline underline-offset-4">
                  sign in
                </Link>
              </div>
            </form>
          )}

          {step === 1 && (
            <OtpStep
              email={email}
              onVerify={async (code) => {
                await onVerify(email, code)
                resetAuthAttempts('signup')
                // STRAIGHT TO THE THANK-YOU WHEN NOBODY IS LISTENING for a
                // profile -- a step whose submit handler does not exist is a
                // dead end, and every test of the first two steps passes no
                // `onPersonalise`.
                setStep(onPersonalise ? 2 : DONE_STEP)
              }}
              onResend={() => onResend(email)}
              onBack={() => {
                setStep(0)
                setError(null)
              }}
            />
          )}

          {step === 2 && onPersonalise && (
            <PersonaliseStep
              onSubmit={async (details) => {
                await onPersonalise(details)
                setStep(DONE_STEP)
              }}
              // SKIPPING IS STILL FINISHING. The account exists and is
              // verified; what is skipped is the import, not the sign-up.
              onSkip={() => setStep(DONE_STEP)}
            />
          )}

          {step === DONE_STEP && (
            /*
              `StatusState kind="success"` since 2026-09-15, replacing a
              hand-rolled block that drew its own 48px circle badge, its own
              green token and its own centred stack. Every one of those
              decisions was right; the problem was that they were made HERE,
              so the app's only success screen shared nothing with the app's
              other nine states and would have drifted from them the first
              time either was touched.

              `titleAs="h1"` is the one thing this caller needs that a state
              inside a panel must not have: this IS the page, and a page whose
              only text is a paragraph has no heading for a screen reader to
              navigate by. It matches step 0's own `<h1>` exactly.

              The glyph changes from a filled circle badge to `CircleCheck` at
              the state's own scale. That is the vocabulary rule rather than a
              preference: `icons` is the one drawing set, and a bespoke badge
              built from a background colour and a bare tick is a second one.
            */
            <div data-signup-done>
              <StatusState
                kind="success"
                titleAs="h1"
                compact
                title="you are all set"
                message="Your account is verified. Taking you to your overview now."
                action={
                  /*
                    A link beside the automatic redirect, not instead of it: an
                    automatic navigation that fails silently leaves someone on
                    a thank-you page forever, and this is the way out.
                  */
                  <Link
                    href="/overview"
                    className="text-body-s text-accent-default underline underline-offset-4"
                  >
                    go to the overview now
                  </Link>
                }
              />
            </div>
          )}
        </div>

        <div className="flex-1" />
      </div>
    </div>
  )
}
