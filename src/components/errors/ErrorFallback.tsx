import * as Sentry from '@sentry/nextjs'

type FallbackProps = {
  error: unknown
  eventId?: string
  resetError?: () => void
  componentStack?: string
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}

export default function ErrorFallback({ error, eventId, resetError }: FallbackProps) {
  // ASK THE SDK, NOT THE ENVIRONMENT. This read `runtimeFlags.sentryDsn`,
  // which is a variable nothing sets any more -- `instrumentation-client.ts`
  // carries the DSN literally, the way Sentry's own setup does, because a DSN
  // is public by design. Reading the env var here would have printed "an error
  // report was sent" exactly when it was NOT sent, and stopped printing it
  // once reporting started working. `getClient()` is undefined until
  // `Sentry.init` has run, so this sentence is true whenever it appears.
  const sentryEnabled = Boolean(Sentry.getClient())
  const message = getErrorMessage(error)

  const handleTryAgain = () => {
    if (resetError) resetError()
    else window.location.reload()
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-6">
      <div className="card w-full max-w-lg p-6">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">
          something went wrong
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          {sentryEnabled
            ? 'The app encountered an unexpected error. An error report was sent — please try again or contact support if the issue continues.'
            : 'The app encountered an unexpected error. Please try again or contact support if the issue continues.'}
        </p>

        {eventId ? (
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-medium">Error ID:</span> {eventId}
          </p>
        ) : null}

        <details className="mt-4">
          <summary className="text-sm text-zinc-600 dark:text-zinc-300 cursor-pointer">
            Show technical details (for support)
          </summary>
          <pre className="mt-2 p-3 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-700 dark:text-zinc-200 overflow-auto">
            {message}
          </pre>
        </details>

        <div className="mt-6 flex flex-col sm:flex-row gap-2">
          <button className="btn-primary" onClick={handleTryAgain}>
            try again
          </button>
          <button className="btn-secondary" onClick={() => window.location.reload()}>
            reload
          </button>
        </div>
      </div>
    </div>
  )
}

export type { FallbackProps as ErrorFallbackProps }
