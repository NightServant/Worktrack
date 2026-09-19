'use client'

import * as React from 'react'
import Link from 'next/link'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input, PasswordInput } from '@/components/ui/input'
import { LockIcon, MailIcon } from '@/components/icons'
import { iconMotion } from '@/components/icons/motion'
import { isPasswordStrong, isValidEmail, normalizeEmail, PASSWORD_MAX_LENGTH } from '@/lib/credentials'
import { takeAuthAttempt, resetAuthAttempts } from '@/lib/authRateLimit'
import { ProgressTrack } from '@/components/ui/progress-track'
import { AuthBrandPanel } from './AuthBrandPanel'
import { OtpStep } from './OtpStep'
import { PasswordRequirements } from './PasswordRequirements'
import { useHoldAuthGuards } from './authHold'

/**
 * Getting back in, as three steps over one layout.
 *
 * address -> code -> new password, then the dashboard. It mirrors `SignUpFlow`
 * deliberately: same shell, same progress bar, same `OtpStep`, same
 * step-as-state rather than step-as-route. Somebody who has just failed to
 * sign in should not also have to learn a second set of conventions.
 *
 * IT SENDS A CODE, NOT A LINK, and that only works because
 * `supabase/templates/recovery.html` exists. Supabase's stock recovery
 * template carries `{{ .ConfirmationURL }}` and no token, so a project on the
 * default never issues a recovery code and step two can never pass.
 *
 * STEP TWO SIGNS THE PERSON IN. That is how Supabase recovery works:
 * `verifyOtp({ type: 'recovery' })` returns a session, and that session is
 * what makes step three possible without asking for the old password -- which
 * they do not have, or they would not be here.
 *
 * WHICH IS ALSO WHY `useHoldAuthGuards` IS NOT OPTIONAL. The (auth) layout
 * treats a new session as a reason to leave: `SignedInRedirect` navigates to
 * /overview and `SignedOutOnly` returns null for this whole subtree. Without
 * the hold, verifying the code would throw the person onto the dashboard with
 * their OLD password still set and the form they came for unmounted
 * mid-flight. See ./authHold; the sign-up thank-you learned this first.
 *
 * IT NEVER SAYS WHETHER THE ADDRESS HAS AN ACCOUNT. `signUp` does, on purpose,
 * because the alternative there is a person waiting forever for a code that
 * will not come. Here the same disclosure would be the most-probed enumeration
 * oracle on the internet, and Supabase gives us nothing to disclose WITH --
 * `resetPasswordForEmail` reports success either way. So the copy is written
 * to be true in both cases: "if that address has an account".
 */

export interface ForgotPasswordFlowProps {
  onRequest: (email: string) => Promise<void>
  onVerify: (email: string, code: string) => Promise<void>
  onSetPassword: (password: string) => Promise<void>
  /** Called once the password is changed. The session already exists. */
  onDone: () => void
}

const STEPS = [
  { id: 'email', label: 'your email', description: 'where to send the code', icon: 'Mail' as const },
  { id: 'verify', label: 'verify', description: 'a six-digit code', icon: 'ShieldCheck' as const },
  { id: 'reset', label: 'new password', description: 'and you are back in', icon: 'Lock' as const },
]

type Step = 0 | 1 | 2

export function ForgotPasswordFlow({
  onRequest,
  onVerify,
  onSetPassword,
  onDone,
}: ForgotPasswordFlowProps) {
  const [step, setStep] = React.useState<Step>(0)
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  /*
    FROM THE CODE STEP, NOT FROM THE PASSWORD STEP, and the difference is a
    real bug rather than caution.

    The session is created INSIDE `onVerify`, which resolves before `setStep(2)`
    runs. Holding on `step === 2` therefore leaves a window -- one await -- in
    which the session exists and the guards are still armed. They fire in that
    window: SignedOutOnly returns null and the flow is unmounted a beat before
    it would have shown the password form.

    Caught by `app/(auth)/__tests__/forgotPasswordRoute`, but only after its
    auth mock was made to notify consumers. The first version of that mock
    just flipped a variable, nothing re-rendered, and the window was invisible.
  */
  useHoldAuthGuards(step >= 1)

  async function handleEmail(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    const cleanEmail = normalizeEmail(email)
    if (!isValidEmail(cleanEmail)) {
      setError('That does not look like an email address we can reach.')
      return
    }

    // A reset email is the one message a stranger can cause to land in
    // somebody else's inbox, so the throttle matters more here than on a form
    // that only wastes the sender's own time.
    const limit = takeAuthAttempt('reset')
    if (!limit.allowed) {
      setError(`Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`)
      return
    }

    setBusy(true)
    try {
      await onRequest(cleanEmail)
      setEmail(cleanEmail)
      setStep(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code.')
    } finally {
      setBusy(false)
    }
  }

  async function handlePassword(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (!isPasswordStrong(password)) {
      setError(
        password.length > PASSWORD_MAX_LENGTH
          ? `That password is longer than ${PASSWORD_MAX_LENGTH} characters.`
          : 'That password does not meet the requirements below.'
      )
      return
    }
    // Checked before anything is sent: a mistyped confirmation caught here
    // costs a glance, and caught later costs another reset email.
    if (password !== confirm) {
      setError('Those passwords do not match.')
      return
    }

    setBusy(true)
    try {
      await onSetPassword(password)
      resetAuthAttempts('reset')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the new password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen">
      <AuthBrandPanel />

      <div className="flex w-full flex-col px-gutter py-10 lg:min-w-0 lg:flex-1 lg:px-24">
        <div className="hidden text-body-s lg:block lg:self-end">
          <span className="text-text-muted">remembered it? </span>
          <Link href="/login" className="text-accent-default underline underline-offset-4">
            sign in
          </Link>
        </div>

        <div className="flex-1" />

        <div className="mx-auto flex w-full max-w-[480px] flex-col gap-8">
          <div data-reset-progress>
            <ProgressTrack label="Password reset progress" steps={STEPS} current={step} />
          </div>

          {step === 0 && (
            <form onSubmit={handleEmail} className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <h1 className="text-heading-l text-text-primary">reset your password</h1>
                <p className="text-body-m text-text-secondary">
                  Tell us the address on the account. We will send a six-digit code to it.
                </p>
              </div>

              {error && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Field id="reset-email" label="Email" required>
                <Input
                  id="reset-email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  autoFocus
                />
              </Field>

              <Button type="submit" variant="primary" size="m" loading={busy} loadingText="Sending the code...">
                {!busy && <MailIcon size={16} aria-hidden className={iconMotion('lift')} />}
                Send the code
              </Button>

              <div className="text-body-s lg:hidden">
                <span className="text-text-muted">remembered it? </span>
                <Link href="/login" className="text-accent-default underline underline-offset-4">
                  sign in
                </Link>
              </div>
            </form>
          )}

          {step === 1 && (
            <OtpStep
              email={email}
              heading="check your email"
              // True whether or not the address has an account -- see the
              // docblock on why this flow does not disclose that.
              purpose="choose a new password"
              backLabel="use a different email"
              onVerify={async (code) => {
                await onVerify(email, code)
                setStep(2)
              }}
              onResend={() => onRequest(email)}
              onBack={() => {
                setError(null)
                setStep(0)
              }}
            />
          )}

          {step === 2 && (
            <form onSubmit={handlePassword} className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <h1 className="text-heading-l text-text-primary">choose a new password</h1>
                <p className="text-body-m text-text-secondary">
                  You are signed in as <strong className="text-text-primary">{email}</strong>. Set
                  a new password and we will take you to your dashboard.
                </p>
              </div>

              {error && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Field id="reset-password" label="New password" required>
                <PasswordInput
                  id="reset-password"
                  name="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  // `new-password`, so a password manager offers to GENERATE
                  // one and then to save it, rather than autofilling the old
                  // one into the field meant to replace it.
                  autoComplete="new-password"
                  required
                  autoFocus
                />
              </Field>

              <PasswordRequirements password={password} />

              <Field id="reset-confirm" label="Confirm new password" required>
                <PasswordInput
                  id="reset-confirm"
                  name="confirm-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </Field>

              <Button type="submit" variant="primary" size="m" loading={busy} loadingText="Saving your password...">
                {!busy && <LockIcon size={16} aria-hidden className={iconMotion('lift')} />}
                Save and continue
              </Button>
            </form>
          )}
        </div>

        <div className="flex-1" />
      </div>
    </div>
  )
}
