'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EMPTY_PROFILE, hasProfileContent, type UserProfile } from '@/services/profile'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  CarouselRow,
} from '@/components/ui/carousel'
import { Bullets, Records } from './profileEntries'
import { Detail, Facet, Identity, Loading, Section, Tag } from './profileChrome'

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

  // SKILLS LEFT `details` and became a section of their own, so they no longer
  // decide whether `details` is drawn at all: a profile with skills and
  // nothing else would otherwise render an empty card.
  const facets =
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
        {/* WHAT THIS PROFILE WAS BUILT FROM, on the header itself. Four
            reference screens all put a short row of tags under the name, and
            the honest thing to put in ours is the sources: it answers "where
            did this come from" at a glance, and it is the fact a merged
            profile most needs to carry. Only the ones that READ -- a tag for a
            link that failed would be a claim the sources card below already
            contradicts. */}
        <Identity
          profile={profile}
          tags={
            <>
              {profile.sources
                .filter((source) => source.ok)
                .map((source) => (
                  <Tag key={source.url} icon="Link">
                    {source.site}
                  </Tag>
                ))}
              {/* THE ONE CONTROL ON THE HEADER, and it is navigation rather
                  than an action: the thing you do to a profile you are looking
                  at is change what it was built FROM, and that form is now the
                  last card on a long page. Every reference screen carries a
                  control in this position -- `Edit Profile`, `Share profile` --
                  and this is the honest equivalent for a profile that is
                  fetched rather than typed. A link, not a button, because it
                  goes somewhere. */}
              {source && (
                <a
                  href="#profile-sources"
                  data-profile-sources-link
                  className="text-body-s text-accent-default underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default"
                >
                  update sources
                </a>
              )}
            </>
          }
        />

        {/* ONE COLUMN, FULL WIDTH, EVERY SECTION (Gabe, 2026-09-18: "relayout
            the profile page ... there are missing spaces in that profile
            section", and "I want project and skills sections to span full
            width").

            THE TWO-COLUMN VERSION WAS THE WRONG FIX FOR THE RIGHT COMPLAINT.
            It was introduced to stop `details` being the last card under four
            sections of records, and it did -- by trading one kind of empty
            space for another: the columns are independent, so the shorter one
            ends wherever it ends and leaves a hole beside the longer. On a
            real profile that hole was most of the page, which is the gap Gabe
            is pointing at.

            SO THE WIDTH IS SPENT INSIDE EACH SECTION INSTEAD, where the
            content can actually use it: skills wrap across the full measure
            rather than down a 300px column, projects get a rail wide enough to
            show three cards, and the short facts sit in a multi-column grid
            that is as tall as its tallest item and no taller. Nothing can be
            left beside anything, because there is no beside.

            THE ORDER IS WHO, THEN FACTS, THEN THE LONG READ. Identity, then
            `details` -- four lines somebody came for -- then experience,
            education, skills, projects, and the paperwork last. A CV's own
            order puts experience first; a PANEL is read differently, and short
            blocks above long ones is what keeps the facts on screen with the
            name (Gabe, 2026-09-18: "details first before experience"). */}
        {facets && (
          <Section title="details" icon="Info">
            {/* A GRID INSIDE ONE SECTION, so four short facts are four columns
                rather than four scrolls -- and the section is as tall as its
                tallest item, which is what stops it leaving a hole. */}
            <div className="grid gap-5 @lg/profile:grid-cols-2 @3xl/profile:grid-cols-3">
              {profile.languages.length > 0 && (
                <Facet title="languages">
                  <div className="flex flex-wrap gap-1.5">
                    {profile.languages.map((language) => (
                      <Tag key={language}>{language}</Tag>
                    ))}
                  </div>
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
                          {site.replace(/^https?:\/\/(www\.)?/, '')}
                        </a>
                      </li>
                    ))}
                  </ul>
                </Facet>
              )}
              {/* LABELLED FOR WHAT IT IS. A home address and a birth date are a
                  different category of fact from a job title, and a source
                  hands them over whether or not anyone wanted them. Shown
                  plainly, so a reader who does not want them stored knows to
                  clear the profile. */}
              {profile.address && <Detail label="address">{profile.address}</Detail>}
              {profile.birthDate && <Detail label="born">{profile.birthDate}</Detail>}
            </div>
          </Section>
        )}

        {/* DETAILS BEFORE EXPERIENCE (Gabe, 2026-09-18: "details first before
            experience"). It is the block a reader came for -- languages, a
            website, where somebody lives -- and it is four lines tall, so
            putting it above the career means the facts are on screen with the
            identity rather than under a scroll. Experience is the long read;
            long reads go after short ones. */}

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

        {profile.skills.length > 0 && (
          <Section title="skills" icon="Tag" count={profile.skills.length}>
            {/* TAGS, ACROSS THE WHOLE WIDTH. Forty of them in a 300px column
                is a wall; across 1200px it is three lines you can scan. */}
            <div className="flex flex-wrap gap-1.5">
              {profile.skills.map((skill) => (
                <Tag key={skill}>{skill}</Tag>
              ))}
            </div>
          </Section>
        )}

        {profile.projects.length > 0 && (
          <Section title="projects" icon="Code" count={profile.projects.length} bare>
            <Carousel
              opts={{ align: 'start', dragFree: true, containScroll: 'trimSnaps' }}
              className="flex flex-col gap-3"
            >
              <CarouselRow>
                <CarouselPrevious />
                <CarouselContent className="-ml-3">
                  {profile.projects.map((project) => (
                    <CarouselItem key={project.title} className="basis-auto pl-3">
                      {/* THE CARD KEEPS ITS FILL while the section loses its
                          own -- Gabe's instruction, and the same arrangement
                          the calendar's roles rail arrived at: the fill is
                          what makes one project read as one object, and a
                          second frame around all of them made them look nested
                          inside something. */}
                      <article
                        data-profile-project
                        className="flex h-full w-60 flex-col gap-1.5 rounded-md border border-border-subtle bg-card p-3"
                      >
                        {project.url ? (
                          <a
                            href={project.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-body-s text-accent-default underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default"
                          >
                            {project.title}
                          </a>
                        ) : (
                          <p className="text-body-s text-text-primary">{project.title}</p>
                        )}
                        {project.description && (
                          // FOUR LINES, then it stops. A repository description
                          // runs to forty words and every card in a rail is one
                          // height; the link is the way to read the rest.
                          <p className="line-clamp-4 text-caption leading-[1.6] text-text-secondary">
                            {project.description}
                          </p>
                        )}
                      </article>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselNext />
              </CarouselRow>
            </Carousel>
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
          <div id="profile-sources" className="scroll-mt-6">
            <Section title="sources" icon="Link">
              {source}
            </Section>
          </div>
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
