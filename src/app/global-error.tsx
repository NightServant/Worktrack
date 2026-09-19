'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import ErrorFallback from '@/components/errors/ErrorFallback'
import '../index.css'

/**
 * The last-resort boundary: an error thrown by the ROOT LAYOUT itself.
 *
 * It replaces the whole document, which is why it renders `<html>` and `<body>`
 * of its own and why it imports the stylesheet directly -- the root layout is
 * the thing that failed, so nothing it set up is available, including the CSS
 * it imports. Miss that import and this page renders as unstyled black serif
 * text, which is how most global-error implementations ship.
 *
 * WHAT THE WIZARD WROTE HERE WAS `NextError statusCode={0}`, Next's stock error
 * page. It works, and it looks like somebody else's product -- a grey
 * Helvetica strip in an app that is otherwise Swiss and orange. `ErrorFallback`
 * already exists, is already the fallback for every other error in the app via
 * `AppErrorBoundary`, and offers a way out rather than a full stop.
 *
 * The `captureException` stays exactly as the wizard wrote it: `AppErrorBoundary`
 * cannot catch this one, so without this line a root-layout failure -- the worst
 * kind -- would be the only error that never reached Sentry.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body>
        <ErrorFallback error={error} />
      </body>
    </html>
  )
}
