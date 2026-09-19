'use client'

import * as React from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { icons, type IconName } from '@/components/icons'
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
  /** The tab the reader picked, or null for "whichever comes first". */
  chosen: string | null
  onChoose: (id: string) => void
  /** The banner's one control -- opening the sources form. */
  action?: React.ReactNode
}

/** One card inside a tab. */
interface ProfileSectionPanel {
  id: string
  label: string
  icon: IconName
  /** Omitted where a count means nothing -- `details` is not a list. */
  count?: number
  /** No card around it. See `Section`'s `bare`. */
  bare?: boolean
  render: () => React.ReactNode
}

/** One tab, and the sections it holds. */
interface ProfileSectionTab {
  id: string
  label: string
  icon: IconName
  sections: ProfileSectionPanel[]
}

export function ProfileSections({
  profile,
  skillGroups,
  chosen,
  onChoose,
  action,
}: ProfileSectionsProps) {
  const tabs = buildTabs(profile, skillGroups)

  // READ THROUGH TO THE FIRST SECTION rather than syncing state in an effect:
  // a re-fetch can drop the section the reader had open, and an effect would
  // render one frame pointing at a tab that no longer exists.
  const active = tabs.some((tab) => tab.id === chosen) ? (chosen as string) : tabs[0]?.id

  return (
    <div className="flex flex-col gap-6" data-profile-state="ready">
      <Tabs
        value={active}
        onValueChange={(next) => onChoose(String(next))}
        className="gap-6"
      >
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
          nav={tabs.length > 1 ? <SectionTabs tabs={tabs} /> : null}
        />

        {tabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id}>
            {/* ONLY THE OPEN PANEL RENDERS ITS CHILDREN, and that is not an
                optimisation. Base UI keeps a hidden panel mounted and merely
                marks it inert, so the projects rail would initialise inside a
                zero-width box and measure every card at 0 -- embla reads
                layout at mount and a hidden panel has none to read. Rendering
                on demand also keeps one copy of each control in the
                accessibility tree. */}
            {active === tab.id && (
              <div className="flex flex-col gap-6">
                {tab.sections.map((section) => (
                  <Section
                    key={section.id}
                    title={section.label}
                    icon={section.icon}
                    count={section.count}
                    bare={section.bare}
                    // THE HEADING COMES BACK WHEN A TAB HOLDS SEVERAL SECTIONS
                    // (Gabe, 2026-09-19, grouping them three ways). With
                    // `experience` and `education` in one panel there has to be
                    // something between them saying which is which -- and each
                    // heading carries its own count, which is where the numbers
                    // went when the tabs stopped being able to carry them.
                    //
                    // IT STAYS OFF WHERE THE TAB IS THE HEADING. `skills` is
                    // its own tab and its own section, so drawing both is the
                    // same word twice, four pixels apart.
                    heading={!namesItsOnlySection(tab)}
                  >
                    {section.render()}
                  </Section>
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {!hasProfileContent(profile) && (
        <p className="text-body-s text-text-muted">This import came back empty.</p>
      )}
    </div>
  )
}

/** Whether a tab is just one section wearing the same name. */
function namesItsOnlySection(tab: ProfileSectionTab): boolean {
  return tab.sections.length === 1 && tab.sections[0].label === tab.label
}

/**
 * The tab strip: a glyph, the group's name, and -- where it means one thing --
 * how many are in it.
 *
 * THE COUNT IS THE POINT, not decoration. It is what a reader loses by having
 * the sections behind tabs, handed back in the one place they can see all six
 * at once -- and it is the first thing somebody checking an import looks for.
 *
 * SCROLLS RATHER THAN WRAPS below `sm`. Six tabs do not fit on a phone, and a
 * wrapped strip pushes the panel down a row at a width where vertical space is
 * already the scarce thing. The overflow pair and the height override are
 * `StatusTabs`'s, for the reasons written out there -- a `visible` overflow
 * coerces to `auto` on the other axis and draws a scrollbar across the active
 * tab's rule.
 */
function SectionTabs({ tabs }: { tabs: ProfileSectionTab[] }) {
  return (
    <TabsList
      aria-label="Profile sections"
      variant="line"
      activateOnFocus
      className={cn(
        '-mx-4 w-[calc(100%+2rem)] justify-start gap-1 overflow-x-auto overflow-y-hidden',
        'rounded-none bg-transparent p-0 px-4',
        '@sm/profile:-mx-5 @sm/profile:w-[calc(100%+2.5rem)] @sm/profile:px-5',
        'group-data-[orientation=horizontal]/tabs:h-auto'
      )}
    >
      {tabs.map((tab) => {
        const Icon = icons[tab.icon]
        return (
          <TabsTrigger
            key={tab.id}
            id={`profile-tab-${tab.id}`}
            value={tab.id}
            className={cn(
              // `grow-0` UNDOES THE VARIANT'S `flex-1`. Left unset, six tabs
              // share a 1200px card equally and `credentials` ends up a foot
              // away from `details` -- which reads as a segmented control and
              // makes the strip slower to scan than the headings it replaced.
              'relative h-11 shrink-0 grow-0 items-center justify-start gap-2 whitespace-nowrap rounded-none border-0 px-3 py-0',
              // LOWERCASE BODY TEXT, NOT `label-caps`. The settings tabs eight
              // pixels above are uppercase; matching them would draw two rows
              // of the same thing. This is the voice each section's own
              // heading used -- `experience (1)` -- moved up to the bar.
              'text-body-s transition-colors duration-(--duration-fast)',
              'text-text-muted hover:text-text-primary',
              'data-active:bg-transparent data-active:text-text-primary data-active:shadow-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default',
              'after:hidden',
              // The active rule, on the card's own bottom hairline -- the same
              // 2px accent vocabulary the status marker and the nav item use.
              'data-active:after:absolute data-active:after:inset-x-0 data-active:after:-bottom-px',
              'data-active:after:block data-active:after:h-[2px] data-active:after:bg-accent-default'
            )}
          >
            <Icon size={14} aria-hidden className="shrink-0" />
            {tab.label}
            {/* ONLY WHERE ONE NUMBER IS HONEST. A tab over three sections has
                no single count -- see `buildTabs`, where the numbers moved
                into the section headings instead. */}
            {namesItsOnlySection(tab) && tab.sections[0].count !== undefined && (
              <span className="tabular text-caption text-text-muted">
                ({tab.sections[0].count})
              </span>
            )}
          </TabsTrigger>
        )
      })}
    </TabsList>
  )
}

/**
 * Which sections this profile has, and which tab each one lives in.
 *
 * THREE TABS, NOT SIX (Gabe, 2026-09-19): `background` is details, experience
 * and education; `skills` is its own; `projects & credentials` is the two
 * things somebody built or earned. Six tabs was one per section, which is the
 * arrangement that needs no decisions and reads like a filing cabinet -- four
 * of them held a single short card, and `details` and `education` were a click
 * apart for no reason a reader would give.
 *
 * WHAT THE GROUPING COSTS AND WHERE THE COUNTS WENT. A tab over three sections
 * cannot carry one honest number -- `background (3)` would be the roles and
 * the schools with the details silently uncounted -- so the counts moved back
 * into the section headings inside the panel, where each one means exactly one
 * thing. `skills` keeps its count on the tab, because there it is unambiguous.
 *
 * THE ORDER IS WHO, THEN FACTS, THEN THE LONG READ -- unchanged, because it was
 * right for the same reason: `details` is the handful of facts somebody came
 * for (Gabe, 2026-09-18: "details first before experience"), and everything
 * after it is a list you read one of.
 *
 * A SECTION WITH NOTHING IN IT IS NOT LISTED, and a tab whose sections are all
 * empty is not drawn. Nothing here renders an empty card, so nothing here
 * needs a tab that opens one.
 */
function buildTabs(profile: UserProfile, skillGroups: SkillGroup[]): ProfileSectionTab[] {
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
    !!profile.url ||
    !!profile.birthDate ||
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
          render: () => (
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
          ),
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
          render: () => (
            <Records
              icon="Documents"
              rows={profile.education.map((e) => ({
                lead: e.school,
                detail:
                  e.degree && e.degree.trim().toLowerCase() !== e.school.trim().toLowerCase()
                    ? e.degree
                    : null,
                org: e.school,
                period: e.period ?? e.graduationYear,
              }))}
            />
          ),
        }
      : null

  const skills: ProfileSectionPanel | null =
    skillGroups.length > 0
      ? {
          id: 'skills',
          label: 'skills',
          icon: 'Tag',
          count: profile.skills.length,
          render: () => <SkillsPanel groups={skillGroups} />,
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

  const groups: { id: string; label: string; icon: IconName; of: (ProfileSectionPanel | null)[] }[] =
    [
      { id: 'background', label: 'background', icon: 'UserRound', of: [details, experience, education] },
      { id: 'skills', label: 'skills', icon: 'Tag', of: [skills] },
      {
        id: 'work',
        label: 'projects & credentials',
        icon: 'Code',
        of: [projects, credentials],
      },
    ]

  return groups.flatMap((group) => {
    const sections = group.of.filter((section): section is ProfileSectionPanel => section !== null)
    if (sections.length === 0) return []
    return [{ id: group.id, label: group.label, icon: group.icon, sections }]
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
      {profile.birthDate && <Detail label="born">{profile.birthDate}</Detail>}
      {profile.url && (
        <Detail label="profile">
          <a
            href={profile.url}
            target="_blank"
            rel="noreferrer"
            className="break-all text-accent-default underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default"
          >
            {profile.url.replace(/^https?:\/\/(www\.)?/, '')}
          </a>
        </Detail>
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
function SkillsPanel({ groups }: { groups: SkillGroup[] }) {
  if (groups.length === 1) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {groups[0].skills.map((skill) => (
          <Tag key={skill}>{skill}</Tag>
        ))}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
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
