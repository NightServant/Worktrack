'use client'

import * as React from 'react'
import { AppDialog } from '@/components/ui/app-dialog'
import { Button } from '@/components/ui/button'
import { PencilIcon, type IconName } from '@/components/icons'
import { cn } from '@/lib/utils'
import { hasProfileContent, type UserProfile } from '@/services/profile'
import type { SkillGroup } from '@/services/skillGroups'
import { Bullets, Records } from './profileEntries'
import { Detail, Facet, Identity, Section, Tag } from './profileChrome'
import { ProfileProjects } from './ProfileProjects'

/**
 * A profile's content, in three tabs (Gabe, 2026-09-19: "consider to break the
 * profile sections with tab navigations", then the grouping itself -- "first
 * tab: details, experience, and education; second: skills; third: projects and
 * credentials").
 *
 * WHAT IT REPLACES AND WHAT THAT COST. These six sections were a single
 * stacked column, which on a real profile ran to about 2,400px: checking
 * whether skills imported correctly meant scrolling past a career to find out,
 * and the two shortest cards -- details and certifications -- sat at opposite
 * ends of it. Tabbed, each group is about one screen.
 *
 * WHY THREE RATHER THAN ONE PER SECTION, which is where this started. Six tabs
 * is the arrangement that needs no decisions: four of them held a single short
 * card, and `details` and `education` -- two things a reader checks in the same
 * breath -- were a click apart for no reason anyone would give. Three groups
 * answer three questions: who this person is and what they have done, what
 * they can do, and what they have to show for it.
 *
 * The trade is still the sweep. Reviewing a whole import used to be one scroll
 * and is now three clicks. The identity banner stays above the tabs in every
 * one of them, so the thing being described never leaves the screen, and each
 * section inside a group keeps its own heading and count.
 *
 * THE TAB BAR LIVES ON THE BANNER'S BOTTOM EDGE. Settings already has a tab
 * row -- `profile | general` -- immediately above this component, and a second
 * row of the same treatment under it is two hierarchies drawn identically. See
 * `Identity`'s `nav` slot: attached to the card it belongs to, it reads as
 * navigation for THIS profile, which is also what a code host does with the
 * same problem. The vocabularies are kept apart on purpose too -- the settings
 * tabs are uppercase `label-caps`, these are lowercase body text with a glyph,
 * the same way each section's own heading was written.
 *
 * NO HEADING INSIDE A PANEL. The tab names the section and carries its count,
 * so a card heading repeating both four pixels below it is exactly the
 * duplication Gabe has now asked to have removed twice. `Section`'s
 * `heading={false}` keeps the card, the test hook and the accessible name.
 *
 * ADAPTIVE, THE SAME RULE AS EVERY OTHER PANEL IN THIS APP: a section with
 * nothing in it has no tab, and a profile with only one section worth showing
 * gets no tab bar at all -- a tab strip with one tab is chrome that decides
 * nothing.
 */
export interface ProfileSectionsProps {
  profile: UserProfile
  /** Computed once by the caller; this component only renders it. */
  skillGroups: SkillGroup[]
  /**
   * Opens the dialog that edits the person's own two details.
   *
   * Absent means no pencil is drawn, which is what the read-only surfaces
   * want -- a control that cannot save is worse than no control.
   */
  onEditDetails?: () => void
  /** The banner's one control -- opening the sources form. */
  action?: React.ReactNode
}

/** One card on the profile. */
interface ProfileSectionPanel {
  id: string
  label: string
  icon: IconName
  /** Omitted where a count means nothing -- `details` is not a list. */
  count?: number
  /** No card around it. See `Section`'s `bare`. */
  bare?: boolean
  /**
   * What the card shows in place. A section with more than this says so and
   * offers the rest in a dialog -- see `render`.
   */
  render: () => React.ReactNode
  /**
   * The whole list, for the dialog behind `view all`.
   *
   * ABSENT MEANS THE CARD IS ALREADY WHOLE, which is most of them: details,
   * projects and credentials render everything they have. Only the three that
   * run long on a real profile -- experience, education and skills -- are cut
   * down in place, and only those get a dialog.
   */
  renderAll?: () => React.ReactNode
}

export function ProfileSections({
  profile,
  skillGroups,
  onEditDetails,
  action,
}: ProfileSectionsProps) {
  const sections = buildSections(profile, skillGroups)

  /**
   * Which section has its `view all` dialog open, if any.
   *
   * ONE PIECE OF STATE FOR ALL OF THEM rather than one per section: only one
   * dialog can be open at a time, so a boolean each would be three ways to
   * describe the same fact and a way to get them out of step.
   */
  const [expanded, setExpanded] = React.useState<string | null>(null)
  const open = sections.find((section) => section.id === expanded) ?? null

  return (
    <div className="flex flex-col gap-6" data-profile-state="ready">
      {/* WHAT THIS PROFILE WAS BUILT FROM, on the header itself. Four
          reference screens all put a short row of tags under the name, and
          the honest thing to put in ours is the sources: it answers "where
          did this come from" at a glance, and it is the fact a merged
          profile most needs to carry. Only the ones that READ -- a tag for a
          link that failed would be a claim the sources form contradicts. */}
      <Identity
        profile={profile}
        tags={profile.sources
          .filter((entry) => entry.ok)
          .map((entry) => (
            <Tag key={entry.url} icon="Link">
              {entry.site}
            </Tag>
          ))}
        action={action}
      />

      {/* NO TAB BAR ANY MORE (Gabe, 2026-09-21: "remove the tab navigation of
          user's profile ... to reduce the scroll of the user profile, I highly
          recommend to use a dialog for viewing all information").

          THE TABS WERE SOLVING THE SCROLL BY HIDING TWO THIRDS OF IT, which
          cost the sweep: reviewing a whole import was one scroll and became
          three clicks, and the reader had to remember which tab a section was
          in. Cutting each long section to its first few rows solves the same
          2,400px column without hiding anything -- every section is on screen,
          in order, and the part that ran long is one press away in a dialog
          rather than behind a tab somebody has to find.

          NOTHING IS HIDDEN, WHICH IS THE POINT. A section that fits renders
          whole; a section that does not says how many it is holding back. */}
      {sections.map((section) => (
        <Section
          key={section.id}
          title={section.label}
          icon={section.icon}
          count={section.count}
          bare={section.bare}
          action={
            section.renderAll ? (
              <Button
                variant="ghost"
                size="s"
                data-profile-view-all={section.id}
                onClick={() => setExpanded(section.id)}
              >
                view all{section.count === undefined ? '' : ` (${section.count})`}
              </Button>
            ) : section.id === 'details' && onEditDetails ? (
              /* THE PENCIL SITS BESIDE THE HEADING, NOT INSIDE THE LIST
                 (Gabe, 2026-09-21: "allow users also to update phone number
                 and birthday information in the details section by using a
                 dialog accessible via icon beside the indicator"). Two of the
                 rows in this card are the person's own rather than imported,
                 and an edit control per row would draw two pencils in a grid
                 whose other cells cannot be edited at all. */
              <Button
                variant="ghost"
                size="icon-s"
                aria-label="Edit your phone number and birthday"
                data-profile-edit-details
                onClick={onEditDetails}
              >
                <PencilIcon size={16} aria-hidden />
              </Button>
            ) : undefined
          }
        >
          {section.render()}
        </Section>
      ))}

      {/* THE REST OF WHICHEVER SECTION ASKED FOR IT. One dialog, reused: its
          title and body come from the open section, so a fourth long section
          later needs no new markup here. */}
      <AppDialog
        open={open !== null}
        onOpenChange={(next) => !next && setExpanded(null)}
        title={open?.label ?? ''}
        icon={open?.icon}
        size="l"
      >
        {open?.renderAll?.()}
      </AppDialog>

      {!hasProfileContent(profile) && (
        <p className="text-body-s text-text-muted">This import came back empty.</p>
      )}
    </div>
  )
}

/**
 * Which sections this profile has, in the order they read.
 *
 * ONE FLAT LIST, NOT THREE TABS (Gabe, 2026-09-21). The grouping existed to
 * shorten a 2,400px column and it worked by hiding two thirds of it; cutting
 * each long section down in place shortens the same column without taking
 * anything off the screen. Every section is here, in order, and the three that
 * run long carry the rest in a dialog.
 *
 * THE ORDER IS WHO, THEN FACTS, THEN THE LONG READ -- unchanged, because it was
 * right for the same reason: `details` is the handful of facts somebody came
 * for (Gabe, 2026-09-18: "details first before experience"), and everything
 * after it is a list you read one of.
 *
 * A SECTION WITH NOTHING IN IT IS NOT LISTED. Nothing here renders an empty
 * card, so nothing here needs a heading over one.
 */

/**
 * How much of a long section shows before `view all`.
 *
 * TWO RECORDS AND FOUR SKILL ROWS (Gabe, 2026-09-21: "in experience and
 * education - display two pieces of information, in skills - display four row
 * of skills"). Two is enough to show what the section holds and what a row
 * looks like; the reader is deciding whether to open it, not reading it here.
 */
const PREVIEW_RECORDS = 2
const PREVIEW_SKILL_ROWS = 4

function buildSections(profile: UserProfile, skillGroups: SkillGroup[]): ProfileSectionPanel[] {

  // SKILLS LEFT `details` and became a section of their own, so they no longer
  // decide whether `details` is drawn at all: a profile with skills and
  // nothing else would otherwise render an empty card.
  //
  // `location` IS NOT AMONG THESE. It is printed under the name in the banner,
  // and a `location` row here would be the same fact twice on one screen --
  // the exact complaint that emptied the banner's right-hand column.
  const facets =
    profile.languages.length > 0 ||
    profile.websites.length > 0 ||
    !!profile.address ||
    !!profile.email ||
    !!profile.birthDate ||
    !!profile.birthday ||
    !!profile.phone ||
    !!profile.fetchedAt

  const details: ProfileSectionPanel | null = facets
    ? {
        id: 'details',
        label: 'details',
        icon: 'Info',
        render: () => <DetailsPanel profile={profile} />,
      }
    : null

  const experience: ProfileSectionPanel | null =
    profile.experiences.length > 0
      ? {
          id: 'experience',
          label: 'experience',
          icon: 'Briefcase',
          count: profile.experiences.length,
          render: () => <ExperienceRows rows={profile.experiences.slice(0, PREVIEW_RECORDS)} />,
          // ONLY WHEN THERE IS MORE. A `view all (2)` over a card already
          // showing both is a control that opens a copy of what is on screen.
          renderAll:
            profile.experiences.length > PREVIEW_RECORDS
              ? () => <ExperienceRows rows={profile.experiences} />
              : undefined,
        }
      : null

  const education: ProfileSectionPanel | null =
    profile.education.length > 0
      ? {
          id: 'education',
          label: 'education',
          icon: 'Documents',
          count: profile.education.length,
          /* THE YEAR, AND THE DEGREE SAID ONCE (Gabe, 2026-09-19: "remove
             repeating information and add the graduation year per school").

             `period ?? graduationYear` because most sources give one or the
             other and never both -- a range where the export was read, a bare
             year where only the end date came through. A school with neither
             prints without a date rather than with a guess.

             THE DEGREE IS DROPPED WHEN IT IS THE SCHOOL AGAIN. The parsers
             already refuse to write the same words twice, and this is the
             second net under that: a row stored before those fixes landed is
             still in the database, and re-importing is the user's choice
             rather than a condition of reading their own profile. */
          render: () => <EducationRows rows={profile.education.slice(0, PREVIEW_RECORDS)} />,
          renderAll:
            profile.education.length > PREVIEW_RECORDS
              ? () => <EducationRows rows={profile.education} />
              : undefined,
        }
      : null

  const skills: ProfileSectionPanel | null =
    skillGroups.length > 0
      ? {
          id: 'skills',
          label: 'skills',
          icon: 'Tag',
          count: profile.skills.length,
          render: () => <SkillsPanel groups={skillGroups} rows={PREVIEW_SKILL_ROWS} />,
          renderAll: () => <SkillsPanel groups={skillGroups} />,
        }
      : null

  const projects: ProfileSectionPanel | null =
    profile.projects.length > 0
      ? {
          id: 'projects',
          label: 'projects',
          icon: 'Code',
          count: profile.projects.length,
          // NO CARD. The rail's own cards are the boxes; a second frame a few
          // pixels outside them made the projects look nested inside something
          // -- the same call the calendar's roles rail already made.
          bare: true,
          render: () => <ProfileProjects projects={profile.projects} />,
        }
      : null

  const credentials: ProfileSectionPanel | null =
    profile.certifications.length > 0
      ? {
          id: 'credentials',
          label: 'credentials',
          icon: 'ShieldCheck',
          count: profile.certifications.length,
          /* WHAT A CERTIFICATE ACTUALLY CARRIES (Gabe, 2026-09-19). The panel
             showed a name and an issuer, because that was all the extractor
             read -- the issue date, the expiry and the credential number were
             on the page and thrown away, and the credential link is the only
             part of a certificate a reader can check. */
          render: () => (
            <Bullets
              rows={profile.certifications.map((c) => ({
                lead: c.name,
                detail: c.authority,
                period: c.period,
                meta: c.credentialId ? `Credential ID ${c.credentialId}` : null,
                href: c.url,
              }))}
            />
          ),
        }
      : null

  return [details, experience, education, skills, projects, credentials].filter(
    (section): section is ProfileSectionPanel => section !== null
  )
}


/**
 * The experience rows, drawn identically in the card and in the dialog.
 *
 * ONE RENDERER FOR BOTH so a row cannot come out differently depending on
 * where it is read -- the card passes the first two, the dialog passes all of
 * them, and neither knows which it is.
 */
function ExperienceRows({ rows }: { rows: UserProfile['experiences'] }) {
  return (
    <Records
      icon="Briefcase"
      rows={rows.map((e) => ({
        lead: e.title,
        detail: e.company,
        org: e.company,
        period: e.period,
        meta: e.location,
        body: e.description,
      }))}
    />
  )
}

/**
 * The school rows, in the card and in the dialog.
 *
 * `period ?? graduationYear` because most sources give one or the other and
 * never both -- a range where the export was read, a bare year where only the
 * end date came through. A school with neither prints without a date rather
 * than with a guess.
 *
 * THE DEGREE IS DROPPED WHEN IT IS THE SCHOOL AGAIN. The parsers already
 * refuse to write the same words twice, and this is the second net under
 * that: a row stored before those fixes landed is still in the database, and
 * re-importing is the user's choice rather than a condition of reading their
 * own profile.
 */
function EducationRows({ rows }: { rows: UserProfile['education'] }) {
  return (
    <Records
      icon="Documents"
      rows={rows.map((e) => ({
        lead: e.school,
        detail:
          e.degree && e.degree.trim().toLowerCase() !== e.school.trim().toLowerCase()
            ? e.degree
            : null,
        org: e.school,
        period: e.period ?? e.graduationYear,
      }))}
    />
  )
}


/**
 * `7 March 1999` from `1999-03-07`.
 *
 * PARSED AS PARTS, NOT AS A DATE. `new Date('1999-03-07')` is UTC midnight,
 * which in any timezone behind UTC prints the day before -- the same defect
 * `localDayKey` exists to prevent on the calendar, and a birthday is exactly
 * the value nobody forgives being off by one.
 */
function formatBirthday(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * The short facts, in columns.
 *
 * IT CARRIES THE CONTACT FACTS (Gabe, 2026-09-19: "add more relevant
 * information for this section. I highly suggest to move the address in this
 * section"). They were in a column beside the name, which is where an employee
 * record puts a staff id and a desk number -- and this is not one. The address
 * in particular belongs here rather than beside a photo: it is the most
 * sensitive thing the import ever stores, and it reads as a stated fact among
 * stated facts instead of as a caption.
 */
function DetailsPanel({ profile }: { profile: UserProfile }) {
  return (
    <div className="grid gap-5 @lg/profile:grid-cols-2 @3xl/profile:grid-cols-3">
      {profile.email && (
        <Detail label="email">
          <a
            href={`mailto:${profile.email}`}
            className="break-all text-accent-default underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default"
          >
            {profile.email}
          </a>
        </Detail>
      )}
      {/* LABELLED FOR WHAT IT IS. A home address and a birth date are a
          different category of fact from a job title, and a source hands them
          over whether or not anyone wanted them. Shown plainly, so a reader who
          does not want them stored knows to clear the profile. */}
      {profile.address && <Detail label="address">{profile.address}</Detail>}
      {/* NO `industry` ROW. It is printed beside the location under the name,
          and a second copy here is the repetition this pass exists to remove --
          the same reason `location` is absent. */}
      {/* THE PERSON'S OWN TWO FACTS, and they are the only rows on this card
          that were typed rather than imported (Gabe, 2026-09-21). The pencil
          beside the heading edits exactly these.

          THE KIND IS PART OF THE NUMBER rather than a row of its own: `mobile`
          under a `phone type` label would be a fact nobody asked a question
          about, and it is meaningless without the number beside it. */}
      {profile.phone && (
        <Detail label="phone">
          <a
            href={`tel:${profile.phone.replace(/[^\d+]/g, '')}`}
            className="text-accent-default underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default"
          >
            {profile.phone}
          </a>
          {profile.phoneType && (
            <span className="text-text-muted"> · {profile.phoneType}</span>
          )}
        </Detail>
      )}
      {/* THE TYPED DATE WINS OVER THE IMPORTED ONE. `birthday` is a real date
          somebody entered; `birthDate` is whatever a source printed, usually
          "Mar 7" with no year because a year is not public. Showing both would
          be the same fact twice, one of them worse. */}
      {(profile.birthday || profile.birthDate) && (
        <Detail label="born">
          {profile.birthday ? formatBirthday(profile.birthday) : profile.birthDate}
        </Detail>
      )}
      {/* NO `profile` LINK ROW (Gabe, 2026-09-21: "remove the profile link").
          The addresses this profile was built from are already on the banner
          as source tags and are editable in the sources dialog, so a single
          one of them repeated here was the same fact in a worse place -- and
          it named only the first source, which on a merged profile is
          arbitrary. */}
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
      {/* WHEN THIS WAS READ, where the rest of the facts are. It was the
          banner's fourth column and it was also a loose line at the foot of the
          page -- the same date twice. */}
      {profile.fetchedAt && (
        <Detail label="last read">{new Date(profile.fetchedAt).toLocaleDateString()}</Detail>
      )}
    </div>
  )
}

/**
 * The skills, under the headings a reader scans for.
 *
 * GROUPED, NOT ONE WALL (Gabe, 2026-09-19: "auto-classify skills properly
 * based in categories"). Sixty-two tags across a 1200px card is four lines you
 * can scan and no way to find the two that matter; under thirteen headings it
 * is a list somebody can read the relevant third of.
 *
 * ONE GROUP DRAWS NO HEADING. A single label over the whole list adds a word
 * and no structure. See `skillGroups`, where the classification lives -- it
 * runs across careers, so a profile with no code in it gets clinical or
 * culinary headings from the same table.
 */
function SkillsPanel({ groups, rows }: { groups: SkillGroup[]; rows?: number }) {
  if (groups.length === 1) {
    /**
     * A CLAMP IN CSS, NOT A SLICE, and the difference matters here.
     *
     * A tag cloud has no fixed items-per-row: `React` and
     * `Test-Driven Development` are different widths, so how many fit depends
     * on the container, and the reader asked for four ROWS rather than N
     * skills. Slicing to a number would show three rows on a wide panel and
     * six on a narrow one. A max-height cuts exactly where the reader said,
     * whatever the widths turn out to be.
     *
     * The arithmetic is the row box plus the gap between rows -- `Tag` is
     * 24px tall and `gap-1.5` is 6px, so four rows is 4*24 + 3*6, and the
     * variable is set from `rows` rather than hardcoded so the number stays
     * in one place.
     */
    const clamped = rows !== undefined
    return (
      <div
        className={cn('flex flex-wrap gap-1.5', clamped && 'overflow-hidden')}
        data-profile-skill-rows={rows}
        style={clamped ? { maxHeight: `${rows * 24 + (rows - 1) * 6}px` } : undefined}
      >
        {groups[0].skills.map((skill) => (
          <Tag key={skill}>{skill}</Tag>
        ))}
      </div>
    )
  }
  // GROUPED, THE ROW IS A GROUP. Each label-and-cloud pair reads as one row of
  // the section, so the same number means the same thing to a reader whether
  // their skills arrived grouped or flat.
  const shown = rows === undefined ? groups : groups.slice(0, rows)
  return (
    <div className="flex flex-col gap-4" data-profile-skill-rows={rows}>
      {shown.map((group) => (
        <div
          key={group.label}
          className="flex flex-col gap-2"
          data-profile-skill-group={group.label}
        >
          <p className="text-label-caps uppercase text-text-secondary">{group.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {group.skills.map((skill) => (
              <Tag key={skill}>{skill}</Tag>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
