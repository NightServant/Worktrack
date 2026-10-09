'use client'

import * as React from 'react'
import Link from 'next/link'
import { AppDialog } from '@/components/ui/app-dialog'
import { Button } from '@/components/ui/button'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { StatusMarker, type Status } from '@/components/ui/status-marker'
import { ArrowRightIcon, ClockIcon } from '@/components/icons'
import { iconMotion } from '@/components/icons/motion'
import { useAppHref } from '@/components/shell/routeBase'
import { pageWindow } from '@/lib/pageWindow'
import { formatTouchedDate } from '@/services/date'
import type { StaleCandidate } from '@/services/followUp'

/**
 * The one thing on the dashboard that asks for an action today.
 *
 * Renders nothing when nothing is stale. An "all caught up" card looks like
 * content, so the eye learns to skip that slot and then skips it on the day it
 * matters. Absence is the stronger signal.
 *
 * A COUNT AND A CONTROL, NOT A LIST. It used to render every quiet application
 * inline, and on a real search that is routinely fifteen rows -- which made
 * the one panel whose job is "the single thing to do today" the longest
 * element on the dashboard, pushing both charts below the fold. A list that
 * long is also not a nudge: nobody chases fifteen companies this morning. The
 * backlog moved into a dialog, so the dashboard states the problem and the
 * dialog is where you work through it.
 *
 * The dialog holds ALL of them rather than a capped subset -- a truncated
 * dialog would understate the backlog, making it look handled when it is not
 * -- but five a page in a table since 2026-10-09 (see `FollowUpTable`): a
 * thirty-row scroll of identical lines was the overload Gabe reported.
 *
 * The rule is neutral, not a status colour: "needs chasing" is a property of
 * your attention, not of the application's status, and the five status hues
 * are spoken for.
 *
 * Rows link to the candidate's own detail route rather than the unfiltered
 * list -- `candidate.id` is the job id, and this is the one element whose
 * entire purpose is "go deal with THIS application", so landing anywhere less
 * specific defeats it. Through `appHref`, so the links stay inside /demo when
 * the demo renders this same component.
 *
 * `last_touched_at` is formatted with `formatTouchedDate`, not
 * `formatShortDate`/`formatAppliedDate` -- it is typically a `TIMESTAMPTZ`
 * instant (see that function's docblock in `services/date.ts`), and this
 * card's whole job is telling the viewer how long it's been sitting, which a
 * UTC read gets wrong for part of every day outside UTC.
 */
export function FollowUpNudge({ stale }: { stale: StaleCandidate[] }) {
  // Above the early return, not below it. This component renders null when
  // nothing is stale, so a hook called after that guard runs on some renders
  // and not others -- and the day a follow-up appears, the hook order changes
  // underneath React.
  const appHref = useAppHref()
  const [open, setOpen] = React.useState(false)

  if (stale.length === 0) return null

  const count = stale.length

  return (
    <section data-follow-up className="border-l-2 border-border-strong pl-4">
      <h2 className="text-label-caps uppercase text-text-muted">needs a follow-up</h2>
      {/*
        The count lives ON the control rather than in a sentence beside it, so
        the whole panel is one line. Splitting it into "15 applications have
        gone quiet" plus a "review" button says the number twice as far as the
        reader is concerned, and the point of this change was to stop this
        panel taking more room than the charts it sits above.
      */}
      <div className="mt-2">
        <Button size="s" variant="secondary" onClick={() => setOpen(true)}>
          <ClockIcon size={16} aria-hidden className={iconMotion('none')} />
          review {count} follow-up{count === 1 ? '' : 's'}
        </Button>
      </div>

      <AppDialog
        open={open}
        onOpenChange={setOpen}
        size="l"
        title="needs a follow-up"
        icon="Clock"
        description="No reply, status change or note in over two weeks. Longest silence first."
      >
        <FollowUpTable stale={stale} appHref={appHref} onOpen={() => setOpen(false)} />
      </AppDialog>
    </section>
  )
}

/** Rows per page in the dialog (Gabe, 2026-10-09: "pagination of 5 rows"). */
const PAGE_SIZE = 5
const DAY_MS = 24 * 60 * 60 * 1000

function daysSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY_MS))
}

/**
 * The backlog as a table, five rows a page (Gabe, 2026-10-09: "The dialog
 * itself is information overload. ... create a table within the dialog with
 * proper pagination of 5 rows, table header, and data").
 *
 * WHAT WAS WRONG. One line per application, company and role run together
 * and truncated, and the same "since Sep 11" down the right edge of thirty
 * rows: everything the same weight, so nothing to read first, and the one
 * figure that matters -- how long each has been waiting -- printed as a date
 * the reader had to subtract from today.
 *
 * WHAT A ROW SAYS NOW, in the order it is read:
 *
 *   application  the company, with the role under it in muted ink.
 *   status       the same `StatusMarker` as the applications table. An
 *                interview that has gone quiet is a different chase from an
 *                application that has.
 *   quiet for    the number, in days, already subtracted, with a hairline bar
 *                scaled to the longest wait in the backlog so the worst stand
 *                out without reading a digit; the last sign of life under it.
 *   open         the way to act on it.
 *
 * Neutral ink for the bar, never a status colour or the accent: "needs
 * chasing" is a property of your attention, not of the application.
 *
 * FIVE A PAGE, OLDEST FIRST, so the first page is always the five most worth
 * chasing; the pager says how many there are and where you are.
 */
function FollowUpTable({
  stale,
  appHref,
  onOpen,
}: {
  stale: StaleCandidate[]
  appHref: (path: string) => string
  onOpen: () => void
}) {
  const [page, setPage] = React.useState(1)
  // Read once per mount: the dialog is opened on a click, so this is "now"
  // for as long as anybody reads it.
  const [now] = React.useState(() => Date.now())

  const pageCount = Math.max(1, Math.ceil(stale.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const rows = stale.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const longest = stale.length ? daysSince(stale[0].last_touched_at, now) : 0
  const interviewing = stale.filter((candidate) => candidate.status === 'interviewing').length

  return (
    <div className="flex flex-col gap-4" data-follow-up-table>
      {/* THE BACKLOG IN ONE LINE, before the rows: how many, the worst of
          them, and the ones mid-interview, which are the costliest silences. */}
      <p className="text-body-s text-text-muted" data-follow-up-summary>
        <span className="tabular-nums text-text-primary">{stale.length}</span>{' '}
        {stale.length === 1 ? 'application' : 'applications'} waiting, the longest for{' '}
        <span className="tabular-nums text-text-primary">{longest}</span> days
        {interviewing > 0 && (
          <>
            ;{' '}
            <span className="tabular-nums text-text-primary">{interviewing}</span> at the interview stage
          </>
        )}
        .
      </p>

      <table className="w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="border-b border-border-subtle">
            <th scope="col" className="pb-2 text-label-caps font-normal uppercase text-text-muted">
              application
            </th>
            <th scope="col" className="w-28 pb-2 text-label-caps font-normal uppercase text-text-muted max-sm:hidden">
              status
            </th>
            <th scope="col" className="w-36 pb-2 text-label-caps font-normal uppercase text-text-muted">
              quiet for
            </th>
            <th scope="col" className="w-10 pb-2">
              <span className="sr-only">open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((candidate) => {
            const days = daysSince(candidate.last_touched_at, now)
            const href = appHref(`/applications/${candidate.id}`)
            return (
              <tr
                key={candidate.id}
                data-follow-up-row
                className="border-b border-border-subtle transition-colors duration-(--duration-fast) hover:bg-bg-surface/60"
              >
                <td className="py-3 pr-4 align-top">
                  <Link
                    href={href}
                    onClick={onOpen}
                    className="flex min-w-0 flex-col gap-0.5 focus-visible:outline-none"
                  >
                    <span className="truncate text-body-m text-text-primary hover:text-accent-default">
                      {candidate.company}
                    </span>
                    <span className="truncate text-body-s text-text-muted">{candidate.role}</span>
                  </Link>
                </td>
                <td className="py-3 pr-4 align-top max-sm:hidden">
                  <StatusMarker status={candidate.status as Status} />
                </td>
                <td className="py-3 pr-4 align-top">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-body-s tabular-nums text-text-primary">
                      {days} {days === 1 ? 'day' : 'days'}
                    </span>
                    <div className="h-1 rounded-[1px] bg-border-subtle" aria-hidden>
                      <div
                        className="h-full origin-left rounded-[1px] bg-text-muted"
                        style={{ transform: `scaleX(${longest ? days / longest : 0})` }}
                      />
                    </div>
                    <time dateTime={candidate.last_touched_at} className="text-body-s text-text-muted">
                      since {formatTouchedDate(candidate.last_touched_at)}
                    </time>
                  </div>
                </td>
                <td className="py-3 text-right align-top">
                  <Link
                    href={href}
                    onClick={onOpen}
                    aria-label={`open ${candidate.company}`}
                    className="group inline-flex size-8 items-center justify-center rounded-[4px] text-text-muted transition-colors hover:bg-bg-surface hover:text-accent-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default"
                  >
                    <ArrowRightIcon size={16} aria-hidden className={iconMotion('forward')} />
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* THE PAGER, only when there is more than one page. Where you are on
          the left, the way through on the right. */}
      {pageCount > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3" data-follow-up-pager>
          <p className="text-body-s tabular-nums text-text-muted">
            {(current - 1) * PAGE_SIZE + 1}&ndash;{Math.min(current * PAGE_SIZE, stale.length)} of{' '}
            {stale.length}
          </p>
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  aria-disabled={current === 1}
                  className={current === 1 ? 'pointer-events-none opacity-40' : undefined}
                  onClick={(event) => {
                    event.preventDefault()
                    setPage(Math.max(1, current - 1))
                  }}
                />
              </PaginationItem>
              {pageWindow(current, pageCount).map((number, index) =>
                number === null ? (
                  <PaginationItem key={`gap-${index}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={number}>
                    <PaginationLink
                      href="#"
                      isActive={number === current}
                      onClick={(event) => {
                        event.preventDefault()
                        setPage(number)
                      }}
                    >
                      {number}
                    </PaginationLink>
                  </PaginationItem>
                )
              )}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  aria-disabled={current === pageCount}
                  className={current === pageCount ? 'pointer-events-none opacity-40' : undefined}
                  onClick={(event) => {
                    event.preventDefault()
                    setPage(Math.min(pageCount, current + 1))
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  )
}
