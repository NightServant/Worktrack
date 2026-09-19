import type { ReactNode } from 'react'
import * as Sentry from '@sentry/nextjs'
import ErrorFallback from './ErrorFallback'
import { runtimeFlags } from '@/lib/env'

export default function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <Sentry.ErrorBoundary
      fallback={(props) => <ErrorFallback {...props} />}
      onError={(error) => {
        if (runtimeFlags.isDev) {
          console.error(error)
        }
      }}
    >
      {children}
    </Sentry.ErrorBoundary>
  )
}
