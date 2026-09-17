'use client'

import Link from 'next/link'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BriefcaseIcon, ChevronDownIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { describeResumeLink, type ResumeLinkSummary } from '@/services/applicationDocuments'

/**
 * Which applications this CV was submitted to, in the editor's command row.
 *
 * THE OTHER HALF OF THE APPLICATION FORM'S "CV SUBMITTED" FIELD. Pinning a CV
 * to an application there is what fills this in here -- one row in
 * `application_documents`, read from both ends. Before this pair existed the
 * table had a service, a migration and no callers at all: `pin` and `unpin`
 * were dead code and `LinkedCv` said "no CV linked" over an application nobody
 * could link one to.
 *
 * IT ANSWERS "WHERE HAS THIS GONE", which is the question worth asking with a
 * CV open: the roles it was already sent for are what the next edit should be
 * tailored against, and sending the same untailored draft to a fourth company
 * is the thing this makes visible.
 *
 * A DROPDOWN, NOT A LIST. The command row is a row of controls above a
 * document; a list of applications inlined there would push the page down for
 * information that is context rather than content. Most CVs have one or two
 * links, so the menu is short.
 *
 * RENDERED AT EVERY WIDTH, unlike `ResumeVersionHistory` beside it. That one
 * is desktop-only because a dated snapshot list wants more room than a sheet
 * over a document can give; this is one or two rows, which a sheet holds
 * comfortably.
 *
 * Each entry links to the application record, so the CV and the job it went to
 * are one click apart in both directions.
 */
export interface LinkedApplicationsProps {
  links: ResumeLinkSummary[]
  /** Where an application record lives. `/demo` passes its own base. */
  basePath?: string
  className?: string
}

export function LinkedApplications({
  links,
  basePath = '/applications',
  className,
}: LinkedApplicationsProps) {
  const label = links.length
    ? `sent to ${links.length} ${links.length === 1 ? 'application' : 'applications'}`
    : 'not sent yet'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-linked-applications
        aria-label={
          links.length
            ? `Applications this CV was sent to: ${links.length}`
            : 'This CV has not been sent to any application'
        }
        className={cn(
          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-body-s',
          'text-text-secondary hover:text-text-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default',
          className
        )}
      >
        <BriefcaseIcon size={14} aria-hidden />
        <span className="truncate">{label}</span>
        <ChevronDownIcon size={14} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-80">
        {links.length === 0 ? (
          // Not an empty menu. It says where the link is made, because the
          // control that makes it is on a different screen entirely.
          <DropdownMenuItem disabled>
            record it in an application&rsquo;s &ldquo;cv used&rdquo; field
          </DropdownMenuItem>
        ) : (
          links.map((link) => (
            // `render`, not `asChild`: these are Base UI menu items, and
            // Base UI's escape hatch for "be this element instead" is a
            // render prop. Nesting an <a> inside the item would leave the
            // menu item itself focusable beside the link.
            <DropdownMenuItem
              key={`${link.job_id}-${link.sent_at}`}
              render={<Link href={`${basePath}/${link.job_id}`} />}
            >
              <span className="truncate">{describeResumeLink(link)}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
