'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { icons, type IconName } from '@/components/icons'
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
  children,
}: {
  title: string
  icon: IconName
  count?: number
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
  children: React.ReactNode
}) {
  const heading = (
    <CardTitle icon={icon}>
      <h3>{title}</h3>
      {count !== undefined && count > 0 && (
        <span className="tabular text-body-s font-normal text-text-muted">({count})</span>
      )}
    </CardTitle>
  )

  if (bare) {
    return (
      <section aria-label={title} data-profile-section={title} className="flex flex-col gap-4">
        {heading}
        {children}
      </section>
    )
  }

  return (
    <Card aria-label={title} data-profile-section={title}>
      <CardHeader>{heading}</CardHeader>
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
 * The identity: cover band, overlapping avatar, name, headline, and the facts
 * a reader looks for first.
 *
 * THE OVERLAP IS THE WHOLE GESTURE and it is what makes this read as a profile
 * rather than as a row with a picture. `-mt-10` pulls the avatar up over the
 * band by half its height; the band's own height is what reserves the space
 * that pull takes back, so nothing collides at any width.
 *
 * IT CARRIES CONTACT DETAILS NOW (2026-09-18, against the reference screens
 * Gabe supplied). Every one of them puts the identity and the four or five
 * facts you would copy out of it -- email, phone, staff id, location -- in ONE
 * header block, and this app had them scattered: the email was nowhere, the
 * websites were in a `details` card below three other sections, and the header
 * held a name and a place.
 *
 * ON THE RIGHT AT WIDTH, UNDER THE NAME BELOW IT. The reference's vertical
 * rule between the two halves is drawn only where there are two halves; at
 * card widths under 3xl they stack, and a rule across a stack is a rule
 * between a name and its own details.
 *
 * WHAT IS NOT INVENTED: there is no phone number, no staff id and no
 * employment status in this data, so those rows from the reference do not
 * appear. A header of plausible empty fields is worse than a shorter one.
 */
export function Identity({
  profile,
  action,
  tags,
}: {
  profile: UserProfile
  action?: React.ReactNode
  /** Rendered under the headline -- what this profile was built from. */
  tags?: React.ReactNode
}) {
  const place = [profile.location, profile.industry].filter(Boolean).join(' · ')
  const facts: { label: string; value: React.ReactNode }[] = []
  if (profile.email) {
    facts.push({
      label: 'email',
      value: (
        <a
          href={`mailto:${profile.email}`}
          className="break-all text-accent-default underline-offset-4 hover:underline"
        >
          {profile.email}
        </a>
      ),
    })
  }
  if (profile.url) {
    facts.push({
      label: 'profile',
      value: (
        <a
          href={profile.url}
          target="_blank"
          rel="noreferrer"
          className="break-all text-accent-default underline-offset-4 hover:underline"
        >
          {profile.url.replace(/^https?:\/\/(www\.)?/, '')}
        </a>
      ),
    })
  }
  if (profile.location) facts.push({ label: 'location', value: profile.location })
  if (profile.fetchedAt) {
    facts.push({
      label: 'last read',
      value: new Date(profile.fetchedAt).toLocaleDateString(),
    })
  }

  return (
    <Card className="gap-0 py-0" data-profile-banner>
      {/* A FLAT FIELD, NOT A PICTURE. There is no cover image in any source
          this app has, and generating one would be decoration pretending to be
          data. `accent-surface` is the token for a field of accent -- the same
          one the applications table's header band and the calendar's weekday
          row wear -- so this belongs to the app rather than to LinkedIn. */}
      <div aria-hidden className="h-16 bg-accent-surface @sm/profile:h-20" />

      <div className="flex flex-col gap-5 p-4 @sm/profile:p-5">
        <div className="flex flex-col gap-5 @3xl/profile:flex-row @3xl/profile:items-start @3xl/profile:gap-8">
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

              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="break-words text-heading-m text-text-primary">
                  {profile.name ?? 'unnamed'}
                </h3>
                {/* THE HEADLINE GETS A MEASURE, NOT A LINE. Out of LinkedIn it
                    is routinely a whole sentence about what someone is looking
                    for. */}
                {profile.headline && (
                  <p className="max-w-prose text-body-m leading-[1.5] text-text-secondary">
                    {profile.headline}
                  </p>
                )}
                {place && <p className="text-body-s text-text-muted">{place}</p>}
              </div>
            </div>

            {tags && <div className="flex flex-wrap items-center gap-2">{tags}</div>}
          </div>

          {facts.length > 0 && (
            <div className="grid grid-cols-1 gap-4 @sm/profile:grid-cols-2 @3xl/profile:w-[420px] @3xl/profile:shrink-0 @3xl/profile:border-l @3xl/profile:border-border-subtle @3xl/profile:pl-8">
              {facts.map((fact) => (
                <Detail key={fact.label} label={fact.label}>
                  {fact.value}
                </Detail>
              ))}
            </div>
          )}
        </div>

        {action}
      </div>
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
