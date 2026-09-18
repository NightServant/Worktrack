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

        {/* TWO COLUMNS ONCE THE CARD IS WIDE ENOUGH (Gabe, 2026-09-18, with
            four reference profiles). A single stack put `details` -- skills,
            languages, websites -- below four sections of records, so the
            facts somebody scans for were the last thing on the page and the
            right half of a 1200px panel was empty the whole way down.

            THE SPLIT IS BY HOW A THING IS READ, not by length: the left
            column is the NARRATIVE (about, roles, education) which is read in
            order, and the right is the LOOKUP (details, skills, certificates,
            projects) which is scanned. `1.6fr / 1fr` gives the prose a
            readable measure and the lookup column enough width for a
            two-column tag wall.

            BY CONTAINER, NOT VIEWPORT, like everything else on this panel. */}
        <div className="grid gap-6 @4xl/profile:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] @4xl/profile:items-start">
        <div className="flex min-w-0 flex-col gap-6">
        {/* ABOUT IS ITS OWN SECTION, as it is on LinkedIn, rather than a
            paragraph welded to the identity block. It is prose about a
            person and it belongs with the other things they wrote, not
            with their name and their photo.

            IT CARRIES EVERY SOURCE THAT HAD ONE, EACH NAMED (Gabe,
            2026-09-18: "about section information must come from other sources
            such as LinkedIn, JobStreet"). `summary` is a single field, so the
            merge keeps the first non-empty one -- which is how this panel came
            to introduce somebody with a three-word GitHub bio while nothing on
            screen said that was what it was. Naming each is both the fix and
            the answer to "why does my profile say that".

            NOT CONCATENATED. Two Abouts are two things the same person wrote
            for two audiences, and running them together makes one paragraph
            that argues with itself.

            `summary` ALONE IS THE FALLBACK, for a profile stored before the
            attributed list existed. */}
        {(profile.about.length > 0 || profile.summary) && (
          <Section title="about" icon="Info">
            {profile.about.length > 0 ? (
              <div className="flex flex-col gap-4">
                {profile.about.map((entry) => (
                  <div key={entry.site} className="flex flex-col gap-1.5">
                    {/* ALWAYS NAMED, even when there is only one. The first
                        draft drew the label only when there were two to tell
                        apart, which is the tidier rule and the wrong one here:
                        a lone paragraph is exactly the case Gabe reported --
                        a profile introducing him with a three-word GitHub bio
                        and nothing on screen saying where it came from. The
                        label is what turns that from a mystery into a link to
                        go and fix. */}
                    <p className="text-label-caps uppercase text-text-muted">{entry.site}</p>
                    <p className="max-w-prose whitespace-pre-line text-body-m leading-[1.6] text-text-secondary">
                      {entry.text}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="max-w-prose whitespace-pre-line text-body-m leading-[1.6] text-text-secondary">
                {profile.summary}
              </p>
            )}
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

        </div>

        <div className="flex min-w-0 flex-col gap-6">
        {/* THE LOOKUP COLUMN OPENS WITH `details`, which is the block a reader
            came for: skills, languages, websites. It was the LAST card on the
            page before this. */}
        {facets && (
          <Section title="details" icon="Tag">
            <div className="flex flex-col gap-5">
              {profile.skills.length > 0 && (
                <Facet title="skills">
                  {/* TAGS, NOT A COMMA-JOINED PARAGRAPH (Gabe, 2026-09-18:
                      "consider using other UI components such as tags"). The
                      note that used to sit here said the system forbids pills
                      -- it forbids STATUS pills, which is a different thing:
                      those are a hue with a meaning, and the rule is that
                      status is a rule plus a label. These carry no status and
                      no fill, and a wall of forty is exactly what a skills
                      list is; as prose it was a paragraph nobody finishes. */}
                  <div className="flex flex-wrap gap-1.5">
                    {profile.skills.map((skill) => (
                      <Tag key={skill}>{skill}</Tag>
                    ))}
                  </div>
                </Facet>
              )}
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
              {/* LABELLED FOR WHAT IT IS. A home address and a birth date are
                  a different category of fact from a job title, and a source
                  hands them over whether or not anyone wanted them. Shown
                  plainly, so a reader who does not want them stored knows to
                  clear the profile. */}
              {(profile.address || profile.birthDate) && (
                <div className="grid gap-4 @sm/profile:grid-cols-2">
                  {profile.address && <Detail label="address">{profile.address}</Detail>}
                  {profile.birthDate && <Detail label="born">{profile.birthDate}</Detail>}
                </div>
              )}
            </div>
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

        {/* PROJECTS ARE A RAIL, NOT A LIST (Gabe, 2026-09-18: "projects sits
            too tall at the right column -- my suggestion is to use carousel").
            Ten of them with a description each ran to about nine hundred
            pixels in a column beside `experience`, so the page ended in a
            single tall box with nothing opposite it.

            THE SAME CAROUSEL `up next` AND `fresh remote roles` USE, which is
            what makes this a borrowing rather than a new pattern: one card
            tall, the width doing the work, arrows flanking the track. A
            project is exactly the shape that suits it -- a name, two lines,
            and a link out. */}
        {profile.projects.length > 0 && (
          <Section title="projects" icon="Code" count={profile.projects.length}>
            <Carousel
              opts={{ align: 'start', dragFree: true, containScroll: 'trimSnaps' }}
              className="flex flex-col gap-3"
            >
              <CarouselRow>
                <CarouselPrevious />
                <CarouselContent className="-ml-3">
                  {profile.projects.map((project) => (
                    <CarouselItem key={project.title} className="basis-auto pl-3">
                      <article
                        data-profile-project
                        className="flex h-full w-60 flex-col gap-1.5 rounded-md border border-border-subtle bg-bg-surface p-3"
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

        </div>
        </div>

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
