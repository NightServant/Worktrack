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

  /*
    IN THE DESIGN SYSTEM SINCE 2026-09-21, and it was the last screen in the
    app that was not. It was written before the system existed and still read
    that way: raw `zinc` with `dark:` variants rather than semantic tokens,
    Tailwind's own `text-xl`/`text-sm` rather than this app's type scale, an
    8px `rounded-lg` against the 4px cap, and `.btn-primary` -- a legacy class
    whose fill is `bg-primary-600`, the INDIGO this system replaced with
    orange. So the one screen somebody sees when everything else has broken was
    visibly a different application.

    THE COMMENT IN index.css THAT CALLS THIS DEAD CODE IS STALE. It was true on
    2026-09-02; `app/global-error.tsx` imports this now, which makes it the
    last-resort screen for the whole app rather than something nothing renders.

    NO COMPONENT IMPORTS, DELIBERATELY. Every other surface would reach for
    `Button` and `Card` here. This one must not: it is what renders when
    something in the tree has already thrown, and a fallback that depends on
    the component layer can fail for the same reason the page did. Plain
    elements carrying the same tokens cost a little duplication and cannot
    take the error screen down with them.
  */
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-canvas p-6">
      <div className="w-full max-w-lg rounded-md border border-border-subtle bg-bg-surface p-6">
        <h1 className="text-heading-m text-text-primary">something went wrong</h1>
        <p className="mt-2 text-body-m leading-[1.6] text-text-secondary">
          {sentryEnabled
            ? 'The app encountered an unexpected error. An error report was sent — please try again or contact support if the issue continues.'
            : 'The app encountered an unexpected error. Please try again or contact support if the issue continues.'}
        </p>

        {eventId ? (
          <p className="mt-3 text-caption text-text-muted">
            <span className="text-text-secondary">Error ID:</span> {eventId}
          </p>
        ) : null}

        <details className="mt-4">
          <summary className="cursor-pointer text-body-s text-text-secondary">
            Show technical details (for support)
          </summary>
          <pre className="mt-2 overflow-auto rounded-md bg-bg-inset p-3 text-caption text-text-secondary">
            {message}
          </pre>
        </details>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handleTryAgain}
            className="h-10 rounded-md bg-accent-default px-4 text-body-m text-accent-on-accent transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default"
          >
            try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="h-10 rounded-md border border-border-default px-4 text-body-m text-text-primary transition-colors hover:bg-bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default"
          >
            reload
          </button>
        </div>
      </div>
    </div>
  )
}

export type { FallbackProps as ErrorFallbackProps }
