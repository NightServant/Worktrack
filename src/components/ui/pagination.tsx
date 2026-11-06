import * as React from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/shadcn-button"
import { ChevronLeftIcon } from "@/components/icons/chevron-left"
import { ChevronRightIcon } from "@/components/icons/chevron-right"
import { EllipsisIcon } from "@/components/icons/ellipsis"
import { pageWindow } from "@/lib/pageWindow"

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  )
}

function PaginationContent({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex items-center gap-0.5", className)}
      {...props}
    />
  )
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
} & Pick<React.ComponentProps<typeof Button>, "size"> &
  React.ComponentProps<"a">

function PaginationLink({
  className,
  isActive,
  size = "icon",
  ...props
}: PaginationLinkProps) {
  return (
    <Button
      variant={isActive ? "outline" : "ghost"}
      size={size}
      className={cn(className)}
      nativeButton={false}
      render={
        <a
          aria-current={isActive ? "page" : undefined}
          data-slot="pagination-link"
          data-active={isActive}
          {...props}
        />
      }
    />
  )
}

function PaginationPrevious({
  className,
  text = "Previous",
  ...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
  return (
    <PaginationLink
      aria-label="Go to previous page"
      size="default"
      className={cn("pl-1.5!", className)}
      {...props}
    >
      <ChevronLeftIcon
        data-icon="inline-start"
      />
      <span className="hidden sm:block">{text}</span>
    </PaginationLink>
  )
}

function PaginationNext({
  className,
  text = "Next",
  ...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
  return (
    <PaginationLink
      aria-label="Go to next page"
      size="default"
      className={cn("pr-1.5!", className)}
      {...props}
    >
      <span className="hidden sm:block">{text}</span>
      <ChevronRightIcon
        data-icon="inline-end"
      />
    </PaginationLink>
  )
}

function PaginationEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn(
        "flex size-8 items-center justify-center [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <EllipsisIcon />
      <span className="sr-only">More pages</span>
    </span>
  )
}

type PageNavProps = {
  /** The page on screen, 1-based. */
  current: number
  pageCount: number
  onPageChange: (page: number) => void
  className?: string
}

const pageButton =
  "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-[4px] px-2 text-body-s tabular-nums text-text-muted transition-colors duration-(--duration-fast) hover:bg-bg-surface hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default disabled:pointer-events-none disabled:opacity-40"

/**
 * THE PAGER, one component for every paged list in the app.
 *
 * Three screens each hand-rolled their own, and two of them printed EVERY page
 * number: 38 pages of applications became a 38-button row that ran off the
 * screen, squeezed the "1–10 of 380" count beside it into a four-line column,
 * and pushed `next` out of reach on a phone. The fix is structural, not
 * cosmetic:
 *
 * - The numbers come from `pageWindow`, which holds the strip at a FIXED seven
 *   slots (first, last, the current page and its neighbours, an ellipsis for
 *   each gap). Its width no longer depends on how much data there is, and it
 *   does not change as you page, so next/previous stay under the pointer.
 * - Below `sm` the numbers give way to "3 / 38": a phone cannot hold seven
 *   targets plus two arrows at a usable size, and position is what matters.
 * - Real `<button>`s. These page in place; the old `href="#"` anchors claimed
 *   to be links, put `#` in the status bar, and needed `preventDefault`.
 * - The current page is the one filled slot, in the accent, and carries
 *   `aria-current="page"` -- position is stated, not just coloured.
 */
function PageNav({ current, pageCount, onPageChange, className }: PageNavProps) {
  const count = Math.max(1, pageCount)
  const page = Math.min(Math.max(1, current), count)
  const go = (target: number) => {
    const next = Math.min(Math.max(1, target), count)
    if (next !== page) onPageChange(next)
  }

  return (
    <Pagination className={cn("mx-0 w-auto shrink-0 justify-end", className)}>
      <PaginationContent className="gap-1">
        <PaginationItem>
          <button
            type="button"
            aria-label="Go to previous page"
            aria-disabled={page === 1}
            disabled={page === 1}
            onClick={() => go(page - 1)}
            className={cn(pageButton, "pl-1.5")}
          >
            <ChevronLeftIcon size={16} aria-hidden />
            <span className="hidden sm:inline">Previous</span>
          </button>
        </PaginationItem>

        {/* Phone: position only. */}
        <PaginationItem className="sm:hidden">
          <span
            data-page-position
            className="inline-flex h-8 items-center px-2 text-body-s tabular-nums text-text-muted"
          >
            <span className="text-text-primary">{page}</span>
            <span aria-hidden className="px-1">/</span>
            <span className="sr-only">of</span>
            {count}
          </span>
        </PaginationItem>

        {pageWindow(page, count).map((number, index) =>
          number === null ? (
            <PaginationItem key={`gap-${index}`} className="max-sm:hidden">
              <PaginationEllipsis className="text-text-muted" />
            </PaginationItem>
          ) : (
            <PaginationItem key={number} className="max-sm:hidden">
              <button
                type="button"
                aria-current={number === page ? "page" : undefined}
                onClick={() => go(number)}
                className={cn(
                  pageButton,
                  number === page &&
                    "bg-accent-default/15 text-accent-default ring-1 ring-inset ring-accent-default/40 hover:bg-accent-default/15 hover:text-accent-default"
                )}
              >
                {number}
              </button>
            </PaginationItem>
          )
        )}

        <PaginationItem>
          <button
            type="button"
            aria-label="Go to next page"
            aria-disabled={page === count}
            disabled={page === count}
            onClick={() => go(page + 1)}
            className={cn(pageButton, "pr-1.5")}
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRightIcon size={16} aria-hidden />
          </button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}

export {
  PageNav,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
}
