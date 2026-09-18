'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EMPTY_PROFILE, hasProfileContent, type UserProfile } from '@/services/profile'
import { Bullets, Records } from './profileEntries'
import { Facet, Identity, Loading, Section } from './profileChrome'

/**
 * Settings -> Profile: who you are, as the CV tools see you.
 *
 * IT RENDERS A `UserProfile` AND HAS NO OPINION ABOUT WHERE IT CAME FROM.
 * That has been worth it three times over: this screen outlived a Composio
 * connector, a page scraper and a CSV importer without changing shape, and the
 * Apify route plugged in by filling the same type.
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
 *   STACKED CARDS, one per kind of content, each with its own heading and
 *     count -- which is what LinkedIn does too. These were hairline-separated
 *     blocks until 2026-09-10; see `Section` below for why the box earns its
 *     place on this particular screen and what stays unchanged (radius, no
 *     shadow, hairline border).
 *   A SQUARE TILE LEADS EVERY ENTRY, where LinkedIn puts a company logo. We
 *     have no logos and will not fetch them, so it carries the organisation's
 *     initial. Square, not round: round is a person, square is an institution,
 *     and that distinction is doing real work two inches under a round avatar.
 *
 * WHAT IS DELIBERATELY NOT COPIED: the radius (this system caps at 4px and
 * LinkedIn's cards are 8), the drop shadows (there are none anywhere here),
 * and the blue. The accent is orange and a status is never a pill.
 *
 * CERTIFICATIONS AND PROJECTS ARE BULLETED LISTS, also at Gabe's instruction.
 * They earn it and the other two sections do not: a role and a degree are
 * dated records with bodies, read one at a time, while a certificate is one
 * line and a project is close to it. Setting eight certificates as eight
 * bordered records makes a short list look like a long one.
 *
 * BY CONTAINER, NOT VIEWPORT, throughout. This panel is full width on the
 * settings page today and sits inside a tab that could narrow tomorrow; a
 * viewport query would keep two columns after the panel itself had stopped
 * being wide enough for them.
 *
 * THE PHOTO IS RENDERED NOW. The docblock here used to say "NO PHOTO -- the
 * export is CSVs and carries no image", which stopped being true the moment
 * the Apify route landed and started returning `profilePicture`. Initials
 * remain the fallback, which is honest for a source that has none.
 */

export type ProfileState =
  | { status: 'loading' }
  | { status: 'ready'; profile: UserProfile }
  | { status: 'empty'; message: string }

export interface ProfileGroupProps {
  state: ProfileState
  /**
   * The import control -- now a list of addresses rather than one field.
   *
   * It moves: in the empty state it IS the call to action and sits under the
   * steps; once a profile exists it becomes the last card in the stack, where
   * a re-fetch reads as maintenance rather than as the next thing to do. It
   * sat inside the identity banner until 2026-09-18, which stopped working the
   * moment it grew from one field to four -- see the ready branch.
   */
  source?: React.ReactNode
  /** How to get a profile. Shown only when there is none yet. */
  steps?: React.ReactNode
}

export function ProfileGroup({ state, source, steps }: ProfileGroupProps) {
  const profile = state.status === 'ready' ? state.profile : EMPTY_PROFILE
  const ready = state.status === 'ready'

  const facets =
    profile.skills.length > 0 ||
    profile.languages.length > 0 ||
    profile.websites.length > 0 ||
    !!profile.address ||
    !!profile.birthDate

  return (
    <div data-settings-group="profile" className="@container/profile">
      {state.status === 'loading' && <Loading />}

      {/* NO SECOND "profile" HEADING over the stack. The tab above already
          says profile and the page above that says settings; a third one
          between them named the same thing was a level of hierarchy with
          nothing in it. Each card now carries its own heading, which is the
          same shape the general tab has. */}
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
      <div className="flex flex-col gap-6" data-profile-state="ready">
        <Identity profile={profile} />

        {/* ABOUT IS ITS OWN SECTION, as it is on LinkedIn, rather than a
            paragraph welded to the identity block. It is prose about a
            person and it belongs with the other things they wrote, not
            with their name and their photo. */}
        {profile.summary && (
          <Section title="about" icon="Info">
            <p className="max-w-prose whitespace-pre-line text-body-m leading-[1.6] text-text-secondary">
              {profile.summary}
            </p>
          </Section>
        )}

        {profile.experiences.length > 0 && (
          <Section title="experience" icon="Briefcase" count={profile.experiences.length}>
            <Records
              icon="Briefcase"
              rows={profile.experiences.map((e) => ({
                lead: e.title,
                detail: e.company,
                org: e.company,
                period: e.period,
                meta: e.location,
                body: e.description,
              }))}
            />
          </Section>
        )}

        {profile.education.length > 0 && (
          <Section title="education" icon="Documents" count={profile.education.length}>
            <Records
              icon="Documents"
              rows={profile.education.map((e) => ({
                lead: e.school,
                detail: e.degree,
                org: e.school,
                period: e.period,
              }))}
            />
          </Section>
        )}

        {profile.certifications.length > 0 && (
          <Section
            title="licenses & certifications"
            icon="ShieldCheck"
            count={profile.certifications.length}
          >
            <Bullets
              rows={profile.certifications.map((c) => ({
                lead: c.name,
                detail: c.authority,
                period: c.period,
              }))}
            />
          </Section>
        )}

        {profile.projects.length > 0 && (
          <Section title="projects" icon="Code" count={profile.projects.length}>
            <Bullets
              rows={profile.projects.map((p) => ({
                lead: p.title,
                detail: null,
                period: null,
                body: p.description,
                href: p.url,
              }))}
            />
          </Section>
        )}

        {facets && (
          <Section title="details" icon="Tag">
            {/* THE SHORT LISTS SHARE A ROW once there is width for it.
                Each is looked up rather than read, so four of them in
                one column is three scrolls for four facts. */}
            <div className="grid gap-5 @lg/profile:grid-cols-2 @3xl/profile:grid-cols-3">
              {profile.skills.length > 0 && (
                <Facet title="skills">
                  {/* Comma-joined prose, not chips: the system forbids
                      pills, and forty skills as forty boxes is a wall
                      either way. */}
                  <p className="text-body-s leading-[1.6] text-text-secondary">
                    {profile.skills.join(', ')}
                  </p>
                </Facet>
              )}
              {profile.languages.length > 0 && (
                <Facet title="languages">
                  <p className="text-body-s text-text-secondary">
                    {profile.languages.join(', ')}
                  </p>
                </Facet>
              )}
              {profile.websites.length > 0 && (
                <Facet title="websites">
                  <ul className="flex flex-col gap-1">
                    {profile.websites.map((site) => (
                      <li key={site} className="min-w-0">
                        <a
                          href={site}
                          target="_blank"
                          rel="noreferrer"
                          className="block break-all text-body-s text-accent-default underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default"
                        >
                          {site}
                        </a>
                      </li>
                    ))}
                  </ul>
                </Facet>
              )}
              {/* LABELLED FOR WHAT IT IS. A home address and a birth date
                  are a different category of fact from a job title, and
                  a source hands them over whether or not anyone wanted
                  them. Shown plainly, so a reader who does not want them
                  stored knows to clear the profile. */}
              {(profile.address || profile.birthDate) && (
                <Facet title="personal details">
                  <div className="flex flex-col gap-1">
                    {profile.address && (
                      <p className="text-body-s leading-[1.6] text-text-secondary">
                        {profile.address}
                      </p>
                    )}
                    {profile.birthDate && (
                      <p className="text-body-s text-text-secondary">
                        Born {profile.birthDate}
                      </p>
                    )}
                  </div>
                </Facet>
              )}
            </div>
          </Section>
        )}

        {!hasProfileContent(profile) && (
          <p className="text-body-s text-text-muted">This import came back empty.</p>
        )}

        {/* THE SOURCES, AT THE FOOT, IN A CARD OF THEIR OWN (2026-09-18).
            They used to sit INSIDE the identity banner, which was right while
            the form was one field and a button: a re-fetch read as maintenance
            under the person it maintains. With four addresses it became the
            largest thing on the banner, so the first block of a profile was a
            form rather than a person.

            LAST, because that is the order of the reading: who this is, what
            they have done, and then -- for anyone who came to fix a link --
            where it all came from. */}
        {source && (
          <Section title="sources" icon="Link">
            {source}
          </Section>
        )}

        {profile.fetchedAt && (
          <p className="text-caption text-text-muted">
            imported {new Date(profile.fetchedAt).toLocaleDateString()}
          </p>
        )}
        </div>
      )}
    </div>
  )
}
