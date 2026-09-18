'use client'

import { cn } from '@/lib/utils'
import { icons, type IconName } from '@/components/icons'

/**
 * One entry in a profile list: a role, a degree, a certificate, a project.
 *
 * SPLIT OUT OF `ProfileGroup` ON 2026-09-11, which was 568 lines. The seam
 * here is NOT state -- this whole file has none, and neither did the component
 * it came from. It is what the pieces DRAW: these three render the contents of
 * a list, and `profileChrome` renders the frame around them. Before the split
 * both halves plus the composition shared one file, so "how is an experience
 * row laid out" and "what cards does the profile have" were the same question.
 *
 * THE GROUP IS CLOSED, which is what made this the right cut rather than a
 * tidy one: `OrgTile` is used only by `Records`, `RecordRow` and `BulletRow`
 * are used only here, and nothing outside needs any of them. Only the two list
 * components and `initialsOf` are exported.
 */


/**
 * A node on the timeline: the section's own glyph, on the rail.
 *
 * IT REPLACED THE INITIALS TILE (Gabe, 2026-09-18: "vertical progress bar with
 * icon nodes"). That tile stood in for a company logo -- one letter on a
 * square, because this app has no logos and will not fetch them -- and beside
 * a rail it was doing two jobs badly: it read as a node without looking like
 * one, and the initials it carried are the first word of the line beside it.
 * The employer is still named, one line down, in words.
 *
 * ONE GLYPH PER SECTION, not per entry: a briefcase down the experience list,
 * a document down the education list. The node marks WHERE ON THE LINE an
 * entry sits; what it is about is the heading above the whole list.
 *
 * `bg-bg-canvas` RATHER THAN A SURFACE TINT, because the rail runs behind it:
 * the node has to paint over the line to break it, and the card's own ground
 * is what it breaks it with.
 */
function TimelineNode({
  icon,
  current = false,
}: {
  icon: IconName
  /** Still going on. Marked, because a CV's reader looks for it first. */
  current?: boolean
}) {
  const Icon = icons[icon]
  return (
    <span
      aria-hidden
      data-profile-node
      data-current={current ? '' : undefined}
      className={cn(
        // `relative z-10` so the node sits ON the rail rather than under it.
        'relative z-10 grid size-8 shrink-0 place-items-center rounded-md border bg-bg-canvas',
        current ? 'border-accent-default text-accent-default' : 'border-border-subtle text-text-muted'
      )}
    >
      <Icon size={15} />
    </span>
  )
}

export interface RecordRow {
  lead: string
  detail: string | null
  period: string | null
  meta?: string | null
  body?: string | null
  /**
   * The organisation, named explicitly.
   *
   * IT NO LONGER DRAWS ANYTHING. It fed the initials tile the timeline node
   * replaced (2026-09-18), and it stays on the row because it cannot be
   * inferred and the next thing to want it -- a logo, a link to the company,
   * a group-by-employer -- would have to ask every caller for it again. On an
   * experience the organisation is the SUBTITLE and on an education it is the
   * LEAD, which is exactly why guessing produced a "BC" tile beside Tarlac
   * State University: the initials of "BS, Computer Science".
   */
  org: string | null
}

/** A period that has not ended. `2025 – Present`, `Jan 2025 - Present · 9 mos`. */
function isCurrent(period: string | null): boolean {
  return !!period && /present|now/i.test(period)
}

/**
 * Experience and education: a dated record with a body, read one at a time.
 *
 * THE TILE, THE STACK, THE DATE ON THE RIGHT -- LinkedIn's own arrangement,
 * and it scans faster than three stacked lines because one column answers
 * "what" and the other "when". Below the container's `sm` the date drops under
 * the title, where two columns would leave the role about 120px wide.
 *
 * THE TILES ARE STRUNG ON A RAIL NOW (Gabe, 2026-09-18, asking for a vertical
 * progress bar on experience and education). A hairline runs from each tile to
 * the next, so four roles read as ONE career in order rather than as four
 * cards that happen to be stacked -- which is the fact a reader is actually
 * after: how long, and in what sequence.
 *
 * IT IS DRAWN BEHIND THE TILES, not beside them. A second column for a
 * timeline would cost 24px of a 190px-wide entry on a phone and buy nothing:
 * the tile is already the node, already aligned, and already the anchor the
 * eye follows down the list.
 *
 * NOTHING IS INVENTED ABOUT DURATION. The rail's segments are equal whatever
 * the dates say -- a proportional one would need a start and an end for every
 * entry, and half of these arrive with `period: null`. It reports ORDER, which
 * this data really does have, and it says so by being uniform.
 *
 * A CURRENT ROLE GETS THE ACCENT, the same 2px vocabulary `Status Marker` and
 * the nav item use for "this one". `Present` in the period is the only test
 * that works across every source's date formatting.
 */
export function Records({
  rows,
  icon,
}: {
  rows: RecordRow[]
  icon: IconName
}) {
  return (
    <ul className="flex flex-col">
      {rows.map((row, index) => (
        <li
          key={`${row.lead}-${index}`}
          className="relative flex gap-3 py-4 first:pt-0 last:pb-0 @sm/profile:gap-4"
          data-profile-record
        >
          {/* THE RAIL. From under this node to the bottom of the row, so the
              last entry ENDS the line rather than trailing it into the card's
              padding. `left-4` is the node's centre: 32px wide, so 16px in. */}
          {index < rows.length - 1 && (
            <span
              aria-hidden
              data-profile-rail
              className="absolute bottom-0 left-4 top-9 w-px bg-border-subtle"
            />
          )}
          <TimelineNode icon={icon} current={isCurrent(row.period)} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-col gap-0.5 @md/profile:flex-row @md/profile:items-baseline @md/profile:justify-between @md/profile:gap-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                {/* THE TITLE IS THE BOLD LINE, as on a CV and on LinkedIn.
                    It can be empty: a signed-out LinkedIn profile routinely
                    withholds the job title, so the employer takes the lead
                    line rather than leaving a blank one above it. */}
                <p className="break-words text-body-m font-medium text-text-primary">
                  {row.lead || row.detail || 'untitled'}
                </p>
                {row.lead && row.detail && (
                  <p className="break-words text-body-s text-text-secondary">{row.detail}</p>
                )}
              </div>
              {row.period && (
                <p className="tabular shrink-0 text-caption text-text-muted @md/profile:text-right">
                  {row.period}
                </p>
              )}
            </div>
            {row.meta && <p className="text-caption text-text-muted">{row.meta}</p>}
            {/* `whitespace-pre-line` so the source's own line breaks survive --
                the bullets under a role are the point of importing it. */}
            {row.body && (
              <p className="whitespace-pre-line text-body-s leading-[1.6] text-text-secondary">
                {row.body}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

export interface BulletRow {
  lead: string
  detail: string | null
  period: string | null
  body?: string | null
  href?: string | null
}

/**
 * Certifications and projects, as an actual bulleted list (Gabe, 2026-09-10).
 *
 * WHY THESE TWO AND NOT THE OTHER TWO. A role and a degree are dated records
 * with paragraphs under them; a certificate is one line and a project is
 * close to it. Eight certificates set as eight bordered records makes a short
 * list look like a long one and buries the two that matter.
 *
 * A REAL `list-disc` LIST, not a stack of rows with a glyph in front. The
 * marker is the browser's, the indent is the browser's, and a screen reader
 * announces "list, 4 items" -- which a div wearing a bullet character does
 * not.
 */
export function Bullets({ rows }: { rows: BulletRow[] }) {
  return (
    <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-text-muted">
      {rows.map((row, index) => (
        <li key={`${row.lead}-${index}`} className="pl-1" data-profile-bullet>
          <div className="flex flex-col gap-0.5 @md/profile:flex-row @md/profile:items-baseline @md/profile:justify-between @md/profile:gap-4">
            <p className="min-w-0 break-words text-body-m text-text-primary">
              {row.href ? (
                <a
                  href={row.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-default underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default"
                >
                  {row.lead}
                </a>
              ) : (
                row.lead
              )}
              {row.detail && (
                <span className="text-text-secondary">
                  {' — '}
                  {row.detail}
                </span>
              )}
            </p>
            {row.period && (
              <p className="tabular shrink-0 text-caption text-text-muted @md/profile:text-right">
                {row.period}
              </p>
            )}
          </div>
          {row.body && (
            <p className="mt-1 whitespace-pre-line text-body-s leading-[1.6] text-text-secondary">
              {row.body}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

