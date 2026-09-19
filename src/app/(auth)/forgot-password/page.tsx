'use client'

import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { ForgotPasswordFlow } from '@/components/auth/ForgotPasswordFlow'

/**
 * Password reset: an address, an emailed code, a new password, the dashboard.
 *
 * Thin, like every other route wrapper here -- ForgotPasswordFlow takes plain
 * props and owns the steps; this owns the calls and the navigation.
 *
 * `replace`, NOT `push`. Back from the dashboard should not return to a reset
 * form whose code has already been spent and whose session already exists.
 */
export default function Page() {
  const router = useRouter()
  const { requestPasswordReset, verifyRecoveryOtp, updatePassword } = useAuth()

  return (
    <ForgotPasswordFlow
      onRequest={requestPasswordReset}
      onVerify={verifyRecoveryOtp}
      onSetPassword={updatePassword}
      onDone={() => router.replace('/overview')}
    />
  )
}
