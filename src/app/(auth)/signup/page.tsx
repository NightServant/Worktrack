'use client'

import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { SignUpFlow } from '@/components/auth/SignUpFlow'

/**
 * Registration: credentials, then an emailed code, then the dashboard.
 *
 * Thin, like every other route wrapper here -- SignUpFlow takes plain props and
 * owns the steps; this owns the calls and the navigation.
 */
export default function Page() {
  const router = useRouter()
  const { signUp, verifySignUpOtp, resendSignUpOtp } = useAuth()

  return (
    <SignUpFlow
      onSignUp={signUp}
      onVerify={verifySignUpOtp}
      onResend={resendSignUpOtp}
      onDone={() => router.push('/overview')}
    />
  )
}
