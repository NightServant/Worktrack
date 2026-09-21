'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { MapPinIcon, icons, type IconName } from '@/components/icons'
import type { UserProfile } from '@/services/profile'
import { initialsOf } from './initials'

/**
 * The frame a profile is drawn in: sections, identity, loading, facets.
 *
 * THE OTHER HALF OF THE SPLIT from `profileEntries` (2026-09-11). These four
 * are the containers -- a card with a heading and a count, the banner at the
 * top, the skeleton before anything arrives, and the small labelled block the
 * facets use. None of them knows what goes inside; all of them are about where
 * it sits.
 *
 * `initialsOf` IS SHARED WITH THE ENTRIES and imported rather than duplicated:
 * `OrgTile` needs a letter for an organisation and `Identity` needs one for a
 * person, and two copies of that would drift the first time somebody decided
 * three initials were better than two.
 */

/**
 * One section of the profile, as a card (Gabe, 2026-09-10).
 *
 * THE SECTIONS WERE HAIRLINE-SEPARATED BLOCKS and are now boxed. That is a
 * deliberate departure from this system's default -- separation here is
 * normally a rule, never a border -- and it is the same departure the
 * Overview already runs on: Gabe asked for the card component on these
 * screens specifically. What does NOT change is the rest of the grammar. The
 * radius still caps at 4px, there is still no shadow anywhere, and the card
 * carries a hairline border rather than a ring.
 *
 * WHY IT READS BETTER HERE. A profile is a list of unrelated lists -- four
 * roles, then two degrees, then eight certificates -- and a rule between them
 * says only "a new thing starts". A box says how far the thing extends, which
 * is the question a reader scanning for their education actually has.
 *
 * The count rides in the title rather than under it, so a list never hides
 * its own length.
 */
export function Section({
  title,
  icon,
  count,
  bare = false,
  heading = true,
  action,
  children,
}: {
  title: string
  icon: IconName
  count?: number
  /**
   * One control opposite the heading -- `view all`, or the details pencil.
   *
   * ON THE HEADING ROW RATHER THAN UNDER THE CONTENT, which is where a "show
   * more" usually goes. Under it, the control moves every time the content
   * above it changes height and a reader scanning a stack of sections has to
   * find it again in each one; on the heading it is in the same place in every
   * card, and it reads as belonging to the section rather than to its last
   * row.
   */
  action?: React.ReactNode
  /**
   * No card around it: the heading and the content sit on the page ground.
   *
   * FOR A SECTION WHOSE CONTENTS ARE ALREADY BOXED (Gabe, 2026-09-18: "remove
   * the background color of the project section but do not remove the
   * background color of the carousel cards itself"). A rail of bordered cards
   * inside a bordered card draws two frames a few pixels apart and makes the
   * projects look nested inside something -- the same call the calendar's
   * roles rail already made, for the same reason. See JobFeed.
   */
  bare?: boolean
  /**
   * Whether the card draws its own title row.
   *
   * OFF WHEN A TAB ALREADY NAMES IT (2026-09-19). The section tabs carry the
   * name and the count, so a card heading under them is the same two words
   * twice, four pixels apart -- the repetition Gabe has now asked to have
   * removed twice. The `data-profile-section` hook and the accessible name
   * stay either way, because a panel still has to be findable and announced.
   */
  heading?: boolean
  children: React.ReactNode
}) {
  const title_row = (
    // THE ACTION TRAILS THE TITLE on the same line. `justify-between` rather
    // than a grid: the title group is one thing and the control is another,
    // and there is never a third.
    <div className="flex items-center justify-between gap-3">
      <CardTitle icon={icon}>
        <h3>{title}</h3>
        {count !== undefined && count > 0 && (
          <span className="tabular text-body-s font-normal text-text-muted">({count})</span>
        )}
      </CardTitle>
      {action}
    </div>
  )

  if (bare) {
    return (
      <section aria-label={title} data-profile-section={title} className="flex flex-col gap-4">
        {heading && title_row}
        {children}
      </section>
    )
  }

  return (
    <Card aria-label={title} data-profile-section={title}>
      {heading && <CardHeader>{title_row}</CardHeader>}
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/**
 * A fact with its name over it, as the reference profiles set them out.
 *
 * THE LABEL IS ABOVE THE VALUE, in the caps-label style every form row in this
 * app already uses -- so a column of these reads as a record rather than as a
 * paragraph, and the eye can find `email` without reading the value beside it.
 * It is the one layout all four reference screens share.
 */
export function Detail({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1" data-profile-detail={label}>
      <p className="text-label-caps uppercase text-text-muted">{label}</p>
      <div className="min-w-0 break-words text-body-s text-text-primary">{children}</div>
    </div>
  )
}

/**
 * A tag: one short fact, in a hairline box.
 *
 * THIS IS NOT A STATUS PILL, and the distinction is the design system's
 * (2026-08-23, settled): a status is a 2px rule plus a label in its own hue,
 * never a filled chip. A tag carries no status, no hue and no fill -- it is a
 * hairline, the 4px radius cap, and ordinary ink. What it buys is a skills
 * list that can be SCANNED: forty skills as comma-joined prose is a paragraph
 * nobody reads to the end of, which is what this screen had (Gabe, 2026-09-18,
 * asking for tags among other components).
 */
export function Tag({
  children,
  icon,
}: {
  children: React.ReactNode
  icon?: IconName
}) {
  const Icon = icon ? icons[icon] : null
  return (
    <span
      data-profile-tag
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border-subtle bg-bg-surface px-2 py-1 text-body-s text-text-secondary"
    >
      {Icon && <Icon size={12} aria-hidden className="shrink-0 text-text-muted" />}
      <span className="truncate">{children}</span>
    </span>
  )
}

/**
 * The identity: cover band, overlapping avatar, name, headline, and the one
 * control this screen has.
 *
 * THE OVERLAP IS THE WHOLE GESTURE and it is what makes this read as a profile
 * rather than as a row with a picture. `-mt-10` pulls the avatar up over the
 * band by half its height; the band's own height is what reserves the space
 * that pull takes back, so nothing collides at any width.
 *
 * THE CONTACT COLUMN IS GONE (Gabe, 2026-09-19: "remove the profile and
 * location at the right side of the banner and add a CTA button that opens the
 * dialog for updating sources"). It was added on 2026-09-18 against reference
 * screens that put four or five copyable facts beside a name -- an employee
 * record's staff id, phone and desk. This profile has two of them, and both
 * were already on screen: `location` sat under the headline as well as in the
 * column, and `profile` was the address typed into the sources form three
 * cards below. So the column was the same two facts said twice, and it was
 * half the banner's width.
 *
 * WHAT TOOK ITS PLACE IS THE ACTION. Every reference screen carries a control
 * in that position -- `Edit Profile`, `Share profile` -- and the honest
 * equivalent for a profile that is FETCHED rather than typed is "change what it
 * was built from". It was a text link buried in a row of source tags, which is
 * the least findable thing on the screen and the one thing somebody arrives
 * here to do twice.
 *
 * WHAT IS NOT INVENTED: there is no phone number, no staff id and no
 * employment status in this data, so those rows from the reference do not
 * appear. A header of plausible empty fields is worse than a shorter one.
 */
export function Identity({
  profile,
  action,
  tags,
  nav,
}: {
  profile: UserProfile
  /** The one control: opposite the name at width, under it below `sm`. */
  action?: React.ReactNode
  /** Rendered under the headline -- what this profile was built from. */
  tags?: React.ReactNode
  /**
   * The section navigation, along this card's bottom edge.
   *
   * ON THE CARD RATHER THAN UNDER IT, and that is the whole reason it reads
   * as navigation for a profile instead of as a second settings tab bar
   * (2026-09-19). Settings already carries a tab row -- `profile | general` --
   * directly above this card, and two identical rows stacked four pixels
   * apart is a hierarchy nobody can parse. Attached to the header it belongs
   * to, it is the arrangement a code host uses for exactly this problem.
   */
  nav?: React.ReactNode
}) {
  const place = [profile.location, profile.industry].filter(Boolean).join(' · ')

  return (
    <Card className="gap-0 py-0" data-profile-banner>
      {/* A FLAT FIELD, NOT A PICTURE. There is no cover image in any source
          this app has, and generating one would be decoration pretending to be
          data. `accent-surface` is the token for a field of accent -- the same
          one the applications table's header band and the calendar's weekday
          row wear -- so this belongs to the app rather than to LinkedIn. */}
      <div aria-hidden className="h-16 bg-accent-surface @sm/profile:h-20" />

      <div className="flex flex-col gap-5 p-4 @sm/profile:p-5">
        <div className="flex flex-col gap-4 @2xl/profile:flex-row @2xl/profile:items-start @2xl/profile:justify-between @2xl/profile:gap-8">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="-mt-10 flex flex-col gap-3 @sm/profile:-mt-12">
              <Avatar className="size-16 shrink-0 border-2 border-bg-canvas @sm/profile:size-20">
                {profile.pictureUrl && (
                  <AvatarImage src={profile.pictureUrl} alt="" referrerPolicy="no-referrer" />
                )}
                <AvatarFallback className="bg-bg-surface text-body-l text-text-secondary">
                  {initialsOf(profile.name)}
                </AvatarFallback>
              </Avatar>

              <div className="flex min-w-0 flex-col gap-1.5">
                {/* A STEP ABOVE EVERY SECTION HEADING (Gabe, 2026-09-19:
                    "better typography sizing"). `heading-m` is the same size a
                    `CardTitle` renders at, so the person's own name read as
                    level with the word `skills` four cards down. `heading-l`
                    is the next step the scale has and the only thing on this
                    screen that wears it. */}
                <h3 className="break-words text-heading-l text-text-primary">
                  {profile.name ?? 'unnamed'}
                </h3>
                {/* THE HEADLINE GETS A MEASURE, NOT A LINE. Out of LinkedIn it
                    is routinely a whole sentence about what someone is looking
                    for. */}
                {profile.headline && (
                  <p className="max-w-prose text-body-m leading-[1.6] text-text-secondary">
                    {profile.headline}
                  </p>
                )}
                {place && (
                  <p className="flex items-center gap-1.5 text-body-s text-text-muted">
                    <MapPinIcon size={13} aria-hidden className="shrink-0" />
                    {place}
                  </p>
                )}
              </div>
            </div>

            {tags && <div className="flex flex-wrap items-center gap-2">{tags}</div>}
          </div>

          {/* FULL WIDTH ON A NARROW PANEL, natural once the card has room --
              the standing rule for primary actions on this screen. */}
          {action && (
            <div className="flex shrink-0 flex-col @sm/profile:flex-row @2xl/profile:justify-end">
              {action}
            </div>
          )}
        </div>
      </div>

      {/* FULL-BLEED ON THE BOTTOM EDGE, over the card's own hairline. The
          horizontal padding matches the block above so the first tab lines up
          with the name. */}
      {nav && (
        <div className="border-t border-border-subtle px-4 @sm/profile:px-5" data-profile-nav>
          {nav}
        </div>
      )}
    </Card>
  )
}

export function Loading() {
  return (
    <div className="flex flex-col gap-4" data-profile-state="loading">
      <Card className="gap-0 py-0">
        <Skeleton className="h-16 w-full rounded-none sm:h-20" />
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <Skeleton className="-mt-10 size-16 rounded-full sm:-mt-12 sm:size-20" />
          <Skeleton className="h-4 w-40 max-w-full" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
      </Card>
      <Card>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    </div>
  )
}


export function Facet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-label-caps uppercase text-text-secondary">{title}</p>
      {children}
    </div>
  )
}
