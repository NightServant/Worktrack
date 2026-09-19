'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AppDialog } from '@/components/ui/app-dialog'
import { LinkIcon } from '@/components/icons'
import { EMPTY_PROFILE, type UserProfile } from '@/services/profile'
import { groupSkills } from '@/services/skillGroups'
import { Loading } from './profileChrome'
import { ProfileSections } from './ProfileSections'

/**
 * Settings -> Profile: who you are, as the CV tools see you.
 *
 * IT RENDERS A `UserProfile` AND HAS NO OPINION ABOUT WHERE IT CAME FROM.
 * That has been worth it three times over: this screen outlived a Composio
 * connector, a page scraper and a CSV importer without changing shape, and the
 * Apify route plugged in by filling the same type.
 *
 * WHAT IS LEFT IN THIS FILE, after 2026-09-19: the three states, the two
 * pieces of state the screen owns, and the sources dialog. The profile's own
 * content moved to `ProfileSections` when it became tabbed -- that component
 * decides which sections a profile has and draws them; this one decides
 * whether there is a profile at all.
 *
 * THE LAYOUT IS LINKEDIN'S, at Gabe's instruction (2026-09-10, with his own
 * profile side by side with this panel). That is a real design decision rather
 * than mimicry for its own sake: this data came FROM a LinkedIn profile, and a
 * person checking whether the import got it right is comparing two screens.
 * Every difference in shape between them is a difference they have to hold in
 * their head while they read. So:
 *
 *   A COVER BAND AND AN OVERLAPPING AVATAR open it, the way a profile does.
 *     There is no cover image to show and inventing one would be decoration,
 *     so the band is a flat accent-surface field -- the same token the tables
 *     and the calendar header wear. It is a place, not a picture.
 *   ONE CARD PER KIND OF CONTENT, which is what LinkedIn does too. These were
 *     hairline-separated blocks until 2026-09-10 and a stack of six cards
 *     until 2026-09-19; see `ProfileSections` for why they are now one card
 *     behind a tab strip, and what that trade costs.
 *
 * WHAT IS DELIBERATELY NOT COPIED: the radius (this system caps at 4px and
 * LinkedIn's cards are 8), the drop shadows (there are none anywhere here),
 * and the blue. The accent is orange and a status is never a pill.
 *
 * BY CONTAINER, NOT VIEWPORT, throughout. This panel is full width on the
 * settings page today and sits inside a tab that could narrow tomorrow; a
 * viewport query would keep two columns after the panel itself had stopped
 * being wide enough for them.
 */

export type ProfileState =
  | { status: 'loading' }
  | { status: 'ready'; profile: UserProfile }
  | { status: 'empty'; message: string }

export interface ProfileGroupProps {
  state: ProfileState
  /**
   * The import control -- a list of addresses rather than one field.
   *
   * It moves: in the empty state it IS the call to action and sits under the
   * steps; once a profile exists it is behind the banner's `update sources`
   * button, in a dialog. It sat inside the identity banner until 2026-09-18
   * and was a card at the foot of the page until 2026-09-19 -- see the dialog
   * at the bottom of this file for why neither held.
   */
  source?: React.ReactNode
  /** How to get a profile. Shown only when there is none yet. */
  steps?: React.ReactNode
}

export function ProfileGroup({ state, source, steps }: ProfileGroupProps) {
  const profile = state.status === 'ready' ? state.profile : EMPTY_PROFILE
  const ready = state.status === 'ready'

  /**
   * THE SOURCES FORM IS A DIALOG (Gabe, 2026-09-19: "add a CTA button that
   * opens the dialog for updating sources").
   *
   * IT WAS THE LAST CARD ON A LONG PAGE, reached by a text link buried in the
   * banner's tag row. That arrangement was right for the reading order -- who
   * this is, what they have done, then where it came from -- and wrong for the
   * doing: five address fields with their own per-row warnings is a FORM, and
   * a form at the bottom of a page you have to scroll past a career to reach
   * is one nobody finds twice.
   *
   * A DIALOG PUTS IT ONE CLICK FROM THE TOP and takes about 400px of page with
   * it. The card is gone, not hidden: it would have been the same form in two
   * places, which is exactly the repetition this pass is removing.
   */
  const [sourcesOpen, setSourcesOpen] = React.useState(false)

  /**
   * WHICH SECTION IS OPEN, held here rather than in `ProfileSections` so it
   * survives that component re-deriving its tab list on every profile change.
   * `null` means "whichever section comes first", which is what a reader who
   * has not chosen anything wants.
   */
  const [chosen, setChosen] = React.useState<string | null>(null)

  const skillGroups = groupSkills(profile.skills)

  return (
    <div data-settings-group="profile" className="@container/profile">
      {state.status === 'loading' && <Loading />}

      {/* NO SECOND "profile" HEADING over the stack. The tab above already
          says profile and the page above that says settings; a third one
          between them named the same thing was a level of hierarchy with
          nothing in it. */}
      {state.status === 'empty' && (
        <Card data-profile-state="empty">
          <CardHeader>
            <CardTitle icon="UserRound">
              <h3>profile</h3>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="max-w-prose text-body-m leading-[1.6] text-text-secondary">
              {state.message}
            </p>
            {steps}
            {source}
          </CardContent>
        </Card>
      )}

      {ready && (
        <ProfileSections
          profile={profile}
          skillGroups={skillGroups}
          chosen={chosen}
          onChoose={setChosen}
          action={
            source && (
              /* THE ONE CONTROL ON THE HEADER, and it is a button rather than
                 an anchor to an anchor. What you do to a profile you are
                 looking at is change what it was built FROM. */
              <Button
                type="button"
                variant="secondary"
                data-profile-sources-link
                onClick={() => setSourcesOpen(true)}
                className="w-full @sm/profile:w-auto"
              >
                <LinkIcon size={16} aria-hidden />
                update sources
              </Button>
            )
          }
        />
      )}

      {/* THE SOURCES FORM. Rendered once, outside both branches: the empty
          state shows it inline as its call to action, and a profile that
          exists opens it from the banner. `l` rather than `m` because the form
          is five addresses with a hint and a per-row outcome under each, and
          at 480px every one of those wraps to three lines. */}
      {source && ready && (
        <AppDialog
          open={sourcesOpen}
          onOpenChange={setSourcesOpen}
          title="sources"
          icon="Link"
          description="Every address this profile is built from. Worktrack reads each public page and merges them."
          size="l"
        >
          <div className="@container/profile">{source}</div>
        </AppDialog>
      )}
    </div>
  )
}
