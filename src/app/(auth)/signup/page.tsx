'use client'

import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { SignUpFlow } from '@/components/auth/SignUpFlow'
import { useImportProfileFromUrl, useSaveProfileDetails } from '@/hooks/useUserProfile'

/**
 * Registration: credentials, an emailed code, a profile to read, the dashboard.
 *
 * Thin, like every other route wrapper here -- SignUpFlow takes plain props and
 * owns the steps; this owns the calls and the navigation.
 *
 * THE ORDER OF THE LAST TWO CALLS IS LOAD-BEARING. The import CREATES the
 * profile row; saving the details MERGES into it. Run the other way round, the
 * save has no row to merge into and refuses -- and then the import would
 * overwrite what it had just been told anyway.
 *
 * THE DETAILS ARE SAVED EVEN IF NOBODY GAVE ANY, and that costs a no-op write
 * rather than a branch: the alternative is deciding here what "empty" means
 * for three independent fields, which is the kind of condition that goes
 * wrong the day a fourth is added.
 */
export default function Page() {
  const router = useRouter()
  const { signUp, verifySignUpOtp, resendSignUpOtp } = useAuth()
  const importProfile = useImportProfileFromUrl()
  const saveDetails = useSaveProfileDetails()

  return (
    <SignUpFlow
      onSignUp={signUp}
      onVerify={verifySignUpOtp}
      onResend={resendSignUpOtp}
      onPersonalise={async ({ urls, ...details }) => {
        await importProfile.mutateAsync({ urls })
        if (details.phone || details.birthday) {
          await saveDetails.mutateAsync(details)
        }
      }}
      onDone={() => router.push('/overview')}
    />
  )
}
