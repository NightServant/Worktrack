'use client'

import * as React from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * The 200ms gate the Figma motion spec requires (node 43:523: "Shows after
 * 200ms, so fast loads never flash"). Every cached react-query read on this
 * app resolves well inside that, so without the gate a navigation between two
 * warm screens paints a full fake page for one frame.
 */
export function DelayedSkeleton({
  delayMs = 200,
  children,
}: {
  delayMs?: number
  children: React.ReactNode
}) {
  const [shown, setShown] = React.useState(false)
  React.useEffect(() => {
    const id = window.setTimeout(() => setShown(true), delayMs)
    return () => window.clearTimeout(id)
  }, [delayMs])
  return shown ? <>{children}</> : null
}

function Bar({ className }: { className?: string }) {
  return <Skeleton data-skeleton className={cn('h-4 w-full', className)} />
}

export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <Bar key={i} className={i === rows - 1 ? 'w-2/3' : undefined} />
      ))}
    </div>
  )
}

export type RouteSkeletonVariant =
  | 'dashboard'
  | 'table'
  | 'analytics'
  | 'documents'
  | 'calendar'
  | 'detail'

/** A card-shaped block: the hairline and radius every panel on these screens has. */
function CardBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-md border border-border-subtle p-4',
        className
      )}
    >
      {children ?? (
        <>
          <Bar className="h-4 w-32" />
          <Bar className="h-3 w-48" />
          <Bar className="h-32" />
        </>
      )}
    </div>
  )
}

/** The page title, its sentence, and the action beside it. */
function HeaderBlock({ action = true }: { action?: boolean }) {
  return (
    <div className="flex flex-col gap-2 sm:gap-1">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 max-sm:contents">
        <Bar className="h-8 w-40 max-sm:order-1" />
        {action && <Bar className="h-9 w-24 max-sm:order-3 max-sm:mt-2 max-sm:w-full" />}
      </div>
      <Bar className="h-3 w-64 max-w-full max-sm:order-2" />
    </div>
  )
}

/**
 * Route-level loading, shaped like the route that is loading.
 *
 * WHY PER-ROUTE AND NOT ONE COMPONENT. A skeleton earns its place by telling
 * you what is about to arrive -- where the toolbar will be, how many panels,
 * whether this is a table or a list. The moment it is the same grey rectangle
 * on every screen it has stopped doing that and is only a spinner that takes
 * up more room. The old `RouteLoading` was exactly that: one title bar, four
 * boxes and a slab, on all eight routes.
 *
 * THE SHAPES TRACK THE REAL LAYOUTS, including their breakpoints -- the two
 * chart grids turn at `xl`, the applications table stacks into cards below
 * `sm`, the documents rail is desktop-only. A skeleton that reflows at a
 * different width than the page it stands in for produces a visible jump on
 * every load at those widths, which is worse than no skeleton.
 *
 * Wrapped in the 200ms gate, so a warm navigation never flashes one.
 */
export function RouteSkeleton({
  variant,
  immediate = false,
}: {
  variant: RouteSkeletonVariant
  /**
   * Skips the 200ms gate.
   *
   * THE GATE CANNOT RUN ON THE SERVER, and that is the whole reason this prop
   * exists. `DelayedSkeleton` is `useState(false)` plus an effect, and effects
   * do not run during SSR -- so a server-rendered skeleton is rendered as
   * NOTHING, and stays nothing for another 200ms after hydration. A screen
   * recording on 2026-09-15 caught the result: roughly 900ms of pure white
   * between the sign-in form and the dashboard, on the exact path the gated
   * skeleton was added to cover.
   *
   * WHEN TO PASS IT: only where there is no warm case to protect. The gate
   * earns its keep on a client-side navigation between two cached screens,
   * where a react-query read resolves in single-digit milliseconds and an
   * ungated skeleton would flash for one frame. The auth gate in
   * `(app)/layout` is the opposite situation -- it is only ever reached on a
   * COLD document load, where `getSession()` must make a network round trip
   * and there is nothing cached to be fast about.
   */
  immediate?: boolean
}) {
  if (immediate) return <RouteSkeletonBody variant={variant} />
  return (
    <DelayedSkeleton>
      <RouteSkeletonBody variant={variant} />
    </DelayedSkeleton>
  )
}

/** The markup itself, shared by the gated and ungated paths. */
function RouteSkeletonBody({ variant }: { variant: RouteSkeletonVariant }) {
  return (
    <div role="status" aria-busy="true" data-route-skeleton={variant} className="flex flex-col gap-8">
        <span className="sr-only">Loading</span>

        {variant === 'dashboard' && (
          <>
            <HeaderBlock action={false} />
            <Bar className="h-0.5" />
            {/* Four headline stat cards: two columns on a phone, four from
                xl, matching `OverviewStats` -- and matching its GAP too, so
                the pairs land on the panels below rather than shifting when
                the real thing arrives. */}
            <div className="grid grid-cols-2 gap-section xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Bar key={i} className="h-24" />
              ))}
            </div>
            {/* The follow-up nudge, then four panels, two more stat cards and
                a full-width table. */}
            <Bar className="h-14 w-full sm:w-72" />
            <div className="grid gap-section xl:grid-cols-2">
              {Array.from({ length: 4 }, (_, i) => (
                <CardBlock key={i} />
              ))}
              <Bar className="h-24" />
              <Bar className="h-24" />
              <CardBlock className="xl:col-span-2" />
            </div>
          </>
        )}

        {variant === 'table' && (
          <>
            <HeaderBlock />
            {/* The insights band: a chart on the left third, four stat cards
                two-up on the right two thirds. */}
            <div className="grid gap-section xl:grid-cols-3">
              <CardBlock />
              <div className="grid gap-section sm:grid-cols-2 xl:col-span-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <Bar key={i} className="h-24" />
                ))}
              </div>
            </div>
            {/* Toolbar: search, then the two CSV controls. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Bar className="h-9 w-full sm:max-w-sm" />
              <div className="flex gap-2 sm:ml-auto">
                <Bar className="h-9 w-28 max-sm:flex-1" />
                <Bar className="h-9 w-28 max-sm:flex-1" />
              </div>
            </div>
            <Bar className="h-8" />
            <CardBlock>
              {Array.from({ length: 6 }, (_, i) => (
                <Bar key={i} className="h-8" />
              ))}
            </CardBlock>
            <div className="flex items-center justify-between">
              <Bar className="h-3 w-24" />
              <Bar className="h-8 w-48" />
            </div>
          </>
        )}

        {variant === 'analytics' && (
          <>
            <HeaderBlock />
            {/* Six panels: overview full width, four half, cohort full. */}
            <div className="grid gap-section xl:grid-cols-2">
              <CardBlock className="xl:col-span-2" />
              {Array.from({ length: 4 }, (_, i) => (
                <CardBlock key={i} />
              ))}
              <CardBlock className="xl:col-span-2" />
            </div>
          </>
        )}

        {variant === 'documents' && (
          <>
            <HeaderBlock />
            {/* The template rail is desktop-only; below lg it is its own page. */}
            <div className="hidden gap-4 lg:flex">
              {Array.from({ length: 6 }, (_, i) => (
                <Bar key={i} className="h-40 w-32 shrink-0" />
              ))}
            </div>
            <Bar className="h-4 w-40" />
            <div className="flex flex-col">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 border-b border-border-subtle py-4">
                  <Bar className="h-5 w-5 shrink-0 md:hidden" />
                  <Bar className="h-4 flex-1" />
                  <Bar className="hidden h-4 w-24 md:block" />
                  <Bar className="hidden h-4 w-20 md:block" />
                </div>
              ))}
            </div>
          </>
        )}

        {variant === 'calendar' && (
          <>
            <HeaderBlock action={false} />
            {/* The week strip, then the agenda beneath it. */}
            <div className="grid grid-cols-7 gap-2">
              {Array.from({ length: 7 }, (_, i) => (
                <Bar key={i} className="h-12" />
              ))}
            </div>
            <div className="flex flex-col gap-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Bar key={i} className="h-12" />
              ))}
            </div>
          </>
        )}

        {variant === 'detail' && (
          <>
            <Bar className="h-3 w-40" />
            <Bar className="h-8 w-72 max-w-full" />
            <div className="grid gap-section lg:grid-cols-2">
              <CardBlock />
              <CardBlock />
            </div>
          </>
        )}
      </div>
  )
}

/**
 * A page of a document, loading.
 *
 * WHY THE GENERIC ONE WOULD NOT DO (Gabe, 2026-09-19: "there must be a
 * customized skeleton for the document itself"). `RouteSkeleton variant="detail"`
 * draws two boxes side by side, which is the shape of a record screen and the
 * shape of nothing in a word processor -- so the pause before a CV appeared
 * looked like the wrong screen loading rather than like this one working.
 *
 * IT IS A CV'S OWN SHAPE: a name, a contact line, then sections of a heading
 * and a few lines of body, the last of each run short the way a paragraph
 * ends. The widths are fixed rather than random, because a skeleton that
 * reflows on every render draws attention to itself -- the one thing it is
 * there not to do.
 *
 * `aria-hidden` AND A LABEL ON THE WRAPPER: a screen reader is told the
 * document is being written, once, instead of reading out fourteen empty
 * boxes.
 */
const DOCUMENT_ROWS: number[][] = [
  [92, 64],
  [40, 96, 88, 72],
  [34, 94, 90, 58],
  [44, 92, 86, 96, 61],
]

export function DocumentSkeleton({ label = 'Writing your document' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      data-document-skeleton
      className="flex flex-col gap-8"
    >
      {DOCUMENT_ROWS.map((row, section) => (
        <div key={section} className="flex flex-col gap-2.5">
          {row.map((width, line) => (
            <Skeleton
              key={line}
              aria-hidden
              // The first line of each block is its heading: taller, and it
              // carries the weight the real one will.
              className={line === 0 && section > 0 ? 'h-4' : 'h-3'}
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
