import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * The label-hint-control wrapper every form row in this system uses.
 *
 * Extracted from `ApplicationForm`, where it was a private function serving
 * that form's fourteen fields alone. Settings' three groups need the same
 * label-above-control shape for the one row that owns it (the default
 * currency control) -- a second private copy is how the two drift, so this
 * moves to `ui/` as the one definition both consume.
 *
 * `span` is a two-column-grid concern (`sm:col-span-2`), not this
 * component's own layout -- it opts a field out of the grid its caller
 * already runs, the same way `ApplicationForm`'s job description and notes
 * fields do.
 */
export interface FieldProps {
  id: string
  label: string
  required?: boolean
  hint?: string
  /**
   * What is wrong with the value, in the danger hue -- the same treatment
   * `Input` gives its own `error`. For controls that cannot draw one
   * themselves (a DatePicker, a Select). Replaces the hint while it shows:
   * a grey sentence beside a red one splits the reader's attention.
   */
  error?: string
  span?: boolean
  children: React.ReactNode
}

export function Field({ id, label, required, hint, error, span, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', span && 'sm:col-span-2')}>
      <label htmlFor={id} className="text-label-caps uppercase text-text-secondary">
        {label}
        {required && (
          <span aria-hidden className="text-text-muted">
            {' *'}
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-body-s text-status-rejected-mark">
          {error}
        </p>
      ) : (
        hint && <p className="text-body-s text-text-muted">{hint}</p>
      )}
    </div>
  )
}
