import type { JSONContent } from '@tiptap/core'
import {
  ending,
  listed,
  professionalSummary,
  type ProfileCertification,
  type ProfileEducation,
  type ProfileExperience,
  type ProfileProject,
  type UserProfile,
} from './profile'
import { groupSkills, type SkillGroup } from './skillGroups'
import type { CvProse } from './integrations/cvWriter'

/**
 * Prose a model wrote for this profile, if one did.
 *
 * MERGED FIELD BY FIELD OVER THE DETERMINISTIC VERSION, never swapped for it
 * (Gabe, 2026-09-19: "wire all three"). A model that writes good project
 * sentences and forgets the summary should contribute the projects; a
 * deployment with no key, a rate-limited free tier and a model that answers
 * nonsense all produce exactly the CV they produced before this existed.
 *
 * MATCHED BY LABEL AND TITLE, which is why the prompt insists on echoing them
 * verbatim: a sentence that cannot be matched to a group is one this file
 * cannot place, and it is dropped rather than guessed at.
 */
export type CvWriting = CvProse | null

/**
 * Filling a template in with the user's own details before they ever see it.
 *
 * THE PROBLEM THIS SOLVES. A template is a document somebody else wrote, and
 * the first ten minutes with one are spent deleting "Your Name" and typing the
 * same four contact fields Worktrack already stores. The profile import
 * (`user_profiles`, from the LinkedIn export) knows all of it. Doing the
 * substitution at CREATE time means the first thing on screen is already the
 * user's document rather than a form to fill in.
 *
 * TWO MECHANISMS, BECAUSE ONE IS NOT ENOUGH. A name is a value and goes in a
 * slot; a work history is a LIST and there is no slot shape that fits "between
 * two and nine entries, each with a variable number of bullets". So:
 *
 *   TOKENS       `{{name|Your Name}}` in a text node, replaced in place.
 *   SECTIONS     everything under an `Experience` heading is thrown away and
 *                regenerated from the profile's entries.
 *
 * EVERY TOKEN CARRIES ITS OWN FALLBACK, and that is the whole reason the
 * `{{token|text}}` form exists rather than a bare `{{token}}`. Most people
 * open this app before they have connected anything, and a template that
 * renders `{{name}}` to an empty line -- or worse, renders it literally -- is
 * the placeholder-copy failure `noPlaceholderCopy.test.ts` exists to catch,
 * wearing different punctuation. The fallback is the template's own original
 * wording, so a profile-less user gets exactly the document they got before
 * this file existed. NO `{{` EVER SURVIVES: an unknown token with no fallback
 * is deleted rather than left visible.
 *
 * AN EMPTY SECTION IS LEFT ALONE, deliberately. If the profile has no
 * education, the template's own specimen entry stays -- it shows the shape the
 * section wants and it is what the user is going to overwrite anyway. Emptying
 * the section instead would leave a heading over nothing, which reads as a
 * bug rather than as an invitation.
 *
 * IT NEVER MUTATES ITS INPUT. `WORD_TEMPLATES` and `COVER_LETTER_TEMPLATES`
 * are module-level constants shared by every caller in the process; writing
 * through one of them would personalise the template itself and hand the next
 * user the previous user's name. `structuredClone` up front, then the rest of
 * this file is free to work in place on the copy -- which is a lot less code
 * than a persistent-rebuild walk, and it is native, so there is no clone
 * helper to maintain.
 */

/**
 * `{{token}}` or `{{token|fallback text}}`.
 *
 * The fallback runs to the closing brace and may itself contain `|`, so the
 * contact lines in the CV templates (`{{email|a@b.c}} | {{phone|...}}`) split
 * on the FIRST pipe only. Whitespace around the token name is tolerated
 * because a template is hand-written and `{{ name }}` is the obvious typo.
 */
const TOKEN = /\{\{\s*([a-zA-Z]+)\s*(?:\|([^}]*))?\}\}/g

/** Trimmed, or null. An empty string is an absent value, not a present one. */
function clean(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * The address the profile was read from, for one site. See `ProfileSource`.
 *
 * MATCHED ON THE LABEL THE EXTRACTOR SET -- `LinkedIn`, `GitHub`, `JobStreet`,
 * `Glassdoor`, `Indeed` -- which is a fixed vocabulary from `_profile_site`,
 * not a host parsed twice.
 *
 * ONLY A SOURCE THAT READ. A link that answered with a challenge is still in
 * the list, because the panel has to say which one failed; putting it on a CV
 * would print an address nobody has checked leads anywhere.
 */
function sourceUrl(profile: UserProfile, site: string): string | null {
  const found = profile.sources.find(
    (source) => source.ok && source.site.toLowerCase() === site.toLowerCase()
  )
  return displayUrl(clean(found?.url))
}

/**
 * `https://www.linkedin.com/in/gabe-0252b4340/` -> `linkedin.com/in/gabe-0252b4340`.
 *
 * THE TEMPLATES THEMSELVES SAY THIS IS THE FORM. Every fallback beside these
 * tokens is written bare -- `linkedin.com/in/yourprofile`, `github.com/profile`,
 * `yoursite.dev` -- so a real address printed with its scheme did not look
 * like the thing it replaced. It is also what a CV prints: nobody writes
 * `https://` on paper, and two full URLs on one contact line is most of the
 * line.
 *
 * THE ADDRESS IS NOT CHANGED, ONLY HOW IT READS. This is a document for a
 * human; the stored source keeps the scheme, and the settings panel still
 * links the real thing.
 */
function displayUrl(value: string | null): string | null {
  if (!value) return null
  return (
    clean(
      value
        .replace(/^[a-z]+:\/\//i, '')
        .replace(/^www\./i, '')
        .replace(/\/+$/, '')
    ) ?? value
  )
}

/**
 * A date of birth as a CV would print it, or null.
 *
 * SPLIT BY HAND RATHER THAN PARSED. `new Date('1999-03-07')` is UTC midnight,
 * so west of Greenwich it prints the 6th -- the same defect `todayValue` in
 * the details dialog exists to avoid, on a field where being a day out is a
 * wrong fact on a document somebody sends to an employer.
 *
 * `birthDate` IS THE FALLBACK AND IS NOT THE SAME FACT. LinkedIn publishes
 * "Mar 7" with no year because a year identifies you; it is printed as written
 * rather than padded with a guess.
 */
function birthdayValue(profile: UserProfile): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(profile.birthday) ?? '')
  if (!match) return clean(profile.birthDate)
  const [, year, month, day] = match.map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * The scalar values a template can ask for.
 *
 * `phone` WAS HARDCODED TO NULL AND IS NOT ANY MORE (Gabe, 2026-09-21:
 * "contact number ... not rendered in the CV itself"). The old note here said
 * `UserProfile` has no phone field, which was true while the only way in was
 * LinkedIn's export -- no public profile publishes a number. Registration now
 * asks for one and the details dialog edits it, so the field the token was
 * waiting for exists, and this is the one line that had to change, exactly as
 * that note said it would.
 *
 * `email` IS THE ACCOUNT'S, NOT A SOURCE'S (Gabe, 2026-09-21: "email used from
 * the account registration must be used"). That is settled one layer down, in
 * `userProfileService.get`, so the profile CARD and the CV agree -- see the
 * note there for why it belongs at the read rather than here.
 *
 * EVERY SOURCE THE PERSON GAVE IS A TOKEN. `linkedin` used to be `profile.url`
 * alone, which is whatever a parser happened to write; the address the reader
 * actually typed is in `sources`, and the rest of them -- GitHub above all --
 * had nowhere to go at all. `website` still prefers a real personal site and
 * falls back to GitHub, because that is what the templates' own fallback text
 * (`github.com/profile`) has always been standing in for.
 *
 * `today` is the exception that is never absent: a letter needs a date, the
 * clock always has one, and 'en-US' is pinned for the same reason `date.ts`
 * pins it -- the alternative is the same template rendering a different date
 * format per machine, including in tests.
 */
function tokenValues(profile: UserProfile, prose: CvWriting): Record<string, string | null> {
  const github = sourceUrl(profile, 'GitHub')
  return {
    name: clean(profile.name),
    headline: clean(profile.headline),
    email: clean(profile.email),
    phone: clean(profile.phone),
    birthday: birthdayValue(profile),
    location: clean(profile.location),
    website: displayUrl(clean(profile.websites[0])) ?? github,
    linkedin: sourceUrl(profile, 'LinkedIn') ?? displayUrl(clean(profile.url)),
    github,
    jobstreet: sourceUrl(profile, 'JobStreet'),
    indeed: sourceUrl(profile, 'Indeed'),
    glassdoor: sourceUrl(profile, 'Glassdoor'),
    industry: clean(profile.industry),
    /*
     * THE COMPOSED SUMMARY, NOT THE RAW FIELD (Gabe, 2026-09-19). `summary` is
     * whichever source had an About first, and on a profile where LinkedIn
     * published none that is a GitHub bio -- so a CV opened with a three-word
     * joke while a full professional headline sat unused. See
     * `professionalSummary`, which leads with the longest thing the person
     * actually wrote and adds the role and the tools under it.
     */
    summary: clean(prose?.summary ?? null) ?? clean(professionalSummary(profile)),
    today: new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
  }
}

/**
 * A token with a separator on one side of it, which is a CONTACT LINE.
 *
 * The test is deliberately narrow, because `tidySeparators` below re-spaces
 * what it touches and somebody's About paragraph is allowed to contain a pipe.
 * A separator immediately beside `{{` or `}}` is a template author building a
 * row of fields; a pipe in the middle of a sentence is a sentence.
 */
const SEPARATED_TOKEN = /[|·]\s*\{\{|\}\}\s*[|·]/

/**
 * `a |  | b` -> `a | b`, and `| a` -> `a`.
 *
 * WHY A TOKEN IS ALLOWED TO RESOLVE TO NOTHING AT ALL. Every token in the
 * shipped templates carries a fallback, which is what stops a blank line where
 * a name should be -- but a fallback is the wrong answer for a field most
 * people do not have. `{{birthday}}` with no fallback prints the date for
 * somebody who gave one and nothing at all for everybody else; without this it
 * would print a stranded ` | ` instead, which looks like the document broke.
 *
 * It is the same rule `joined` already applies when this file BUILDS a line --
 * the missing halves are dropped rather than leaving a bare pipe. This is that
 * rule applied to a line somebody else wrote.
 */
function tidySeparators(value: string): string {
  const separator = value.includes('·') ? '·' : '|'
  const parts = value
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  return parts.join(` ${separator} `)
}

/**
 * Replaces every token in every text node, in place, on an already-cloned tree.
 *
 * A text node whose text substitutes down to nothing is REMOVED, not left
 * empty: ProseMirror rejects an empty text node outright ("Empty text nodes
 * are not allowed") and the editor would throw on the document it was just
 * handed. Nothing in the shipped templates can produce one -- every token
 * there has a fallback -- but a template written later without one would
 * otherwise crash the editor rather than render a gap.
 */
function substituteTokens(node: JSONContent, values: Record<string, string | null>): void {
  if (!Array.isArray(node.content)) return

  const kept: JSONContent[] = []
  for (const child of node.content) {
    if (child.type === 'text' && typeof child.text === 'string') {
      const separated = SEPARATED_TOKEN.test(child.text)
      const substituted = child.text.replace(TOKEN, (_match, name: string, fallback?: string) => {
        return values[name.toLowerCase()] ?? fallback ?? ''
      })
      const text = separated ? tidySeparators(substituted) : substituted
      if (text.length === 0) continue
      child.text = text
      kept.push(child)
      continue
    }
    substituteTokens(child, values)
    kept.push(child)
  }
  node.content = kept
}

/** The visible text of a node, its descendants included. */
function textOf(node: JSONContent): string {
  if (typeof node.text === 'string') return node.text
  if (!Array.isArray(node.content)) return ''
  return node.content.map(textOf).join('')
}

function text(value: string): JSONContent {
  return { type: 'text', text: value }
}

function bold(value: string): JSONContent {
  return { type: 'text', text: value, marks: [{ type: 'bold' }] }
}

/**
 * A paragraph of lines separated by hard breaks, skipping the absent ones.
 *
 * `null` AND the empty string are both absent. A profile field can be present
 * and blank (an export writes `""` as readily as it omits the column), and an
 * empty text node is the one thing ProseMirror refuses outright -- so the
 * filter lives here, once, rather than at each of the four call sites.
 */
function lines(...parts: (string | null)[]): JSONContent {
  // The first surviving line is the entry's title and is bold; the rest is the
  // detail under it. That is the shape every template's own specimen block
  // already uses, so a regenerated section looks like the one it replaced.
  const values = parts.map(clean).filter((value): value is string => value !== null)
  const content: JSONContent[] = []
  values.forEach((value, index) => {
    if (index > 0) content.push({ type: 'hardBreak' })
    content.push(index === 0 ? bold(value) : text(value))
  })
  return { type: 'paragraph', content }
}

/** `a | b`, with the missing halves dropped rather than leaving a bare pipe. */
function joined(...parts: (string | null)[]): string | null {
  const present = parts.filter((part): part is string => clean(part) !== null)
  return present.length > 0 ? present.join(' | ') : null
}

/**
 * The `description` field as bullets.
 *
 * The export gives one blob per role with newlines in it, and the leading
 * glyph is whatever the person typed into LinkedIn -- a bullet, a dash, an
 * asterisk. Stripping it matters because the text goes into a `bulletList`,
 * which draws its own marker: without this the CV shows "• - Built the thing".
 */
function bulletsFrom(description: string | null): JSONContent | null {
  const items = (description ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-•*·‣◦]\s*/, '').trim())
    .filter((line) => line.length > 0)
  if (items.length === 0) return null
  return {
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [text(item)] }],
    })),
  }
}

function experienceNodes(entries: ProfileExperience[]): JSONContent[] {
  return entries.flatMap((entry) => {
    const heading = lines(joined(entry.title, entry.company), joined(entry.period, entry.location))
    const bullets = bulletsFrom(entry.description)
    return bullets ? [heading, bullets] : [heading]
  })
}

function educationNodes(entries: ProfileEducation[]): JSONContent[] {
  return entries.map((entry) => {
    // The degree leads when there is one, because that is what a reader scans
    // for; with no degree recorded the school takes the top line instead of
    // leaving a bold blank above it.
    const degree = clean(entry.degree)
    // THE YEAR, WHEN THERE IS NO RANGE (Gabe, 2026-09-19: "add the graduation
    // year per school"). Most sources give one or the other, never both, and a
    // school with neither prints without a date rather than with a guess.
    const when = clean(entry.period) ?? clean(entry.graduationYear)
    return degree === null
      ? lines(entry.school, when)
      : lines(degree, joined(entry.school, when))
  })
}

/**
 * The opening line of a project entry: what it is, and what it was built with.
 *
 * THIS IS WHERE THE VERB LIVES (Gabe, 2026-09-19: "does not generate proper
 * sentences ... does not apply skills to notable projects"). A README's
 * bullets are noun phrases -- "Applications with company, role, salary range",
 * "Status pipeline — wishlist → applied → interviewing" -- because a README is
 * a feature list. Under a lead sentence that says who built what with which
 * tools, a feature list reads correctly; on its own it reads as fragments,
 * which is what the generated CV was doing.
 *
 * AND IT IS WHERE THE SKILLS MEET THE PROJECT. The stack was printed as a bare
 * `TypeScript | https://github.com/...` line beside the title, which names the
 * tools without claiming anything with them. `built with TypeScript, Next.js
 * and PostGIS` is the same facts as a sentence.
 */
function projectLead(entry: ProfileProject): string | null {
  const description = clean(entry.description)
  const stack = entry.tech.length > 0 ? listed(entry.tech) : clean(entry.language)
  if (description && stack) {
    return ending(`${description.replace(/[.\s]+$/, '')}, built with ${stack}`)
  }
  if (description) return ending(description)
  if (stack) return ending(`Built with ${stack}`)
  return null
}

/**
 * A project as a CV entry: a title, a sentence about it, then its own bullets.
 *
 * THE BULLETS ARE NOT REWRITTEN, and that is a decision rather than an
 * omission. The obvious way to turn "Applications with company, role, salary
 * range" into a sentence is to prefix a verb -- and doing so produces "Built
 * applications with company, role, salary range", which says something the
 * author did not. Tested against Gabe's own repositories before it was ruled
 * out (2026-09-19). A rule cannot tell a feature description from an action
 * description, so the verb goes in the lead where it is always true, and the
 * author's own words are left as the author's own words.
 *
 * What they DO get is punctuation and a capital: a bullet list where some
 * entries end in a full stop and others do not is the other half of looking
 * unfinished.
 */
function projectNodes(entries: ProfileProject[], prose: CvWriting): JSONContent[] {
  const written = new Map((prose?.projects ?? []).map((item) => [item.title, item]))
  return entries.flatMap((entry) => {
    const byModel = written.get(entry.title)
    const lead = clean(byModel?.lead ?? null) ?? projectLead(entry)
    const where = clean(entry.url) ?? clean(entry.homepage)
    const heading = lines(entry.title, lead, where)
    // THE MODEL'S BULLETS WHERE IT WROTE ANY, the README's own lines where it
    // did not. Never a mixture: half-rewritten and half-raw in one list reads
    // worse than either.
    const source =
      byModel && byModel.bullets.length > 0 ? byModel.bullets : entry.highlights
    const bullets = bulletsFrom(source.map((line) => sentence(line)).join('\n') || null)
    return bullets ? [heading, bullets] : [heading]
  })
}

/** One line, capitalised and ended. See `projectNodes` for what it does NOT do. */
function sentence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  return ending(trimmed.charAt(0).toUpperCase() + trimmed.slice(1))
}

/**
 * A certificate as one line, with what proves it underneath.
 *
 * ONE LINE, NOT A BLOCK. A certificate is a name, an issuer and a date -- and
 * eight of them set as eight dated records makes a short list look like a long
 * one, which is the same call the panel's bulleted list already makes.
 *
 * THE CREDENTIAL NUMBER IS PRINTED WHERE THERE IS ONE, because it is the only
 * part of a certificate a reader can check.
 */
function certificationNodes(entries: ProfileCertification[]): JSONContent[] {
  return entries.map((entry) =>
    lines(
      joined(entry.name, entry.authority),
      joined(
        clean(entry.issued) ? `Issued ${entry.issued}` : clean(entry.period),
        clean(entry.expires) ? `Expires ${entry.expires}` : null,
        clean(entry.credentialId) ? `Credential ID ${entry.credentialId}` : null
      )
    )
  )
}

/**
 * What each group of skills is FOR, as the verb that starts its sentence.
 *
 * A LABEL AND A COMMA LIST IS NOT A SENTENCE, which is the whole complaint
 * (Gabe, 2026-09-19: "just list skills as categories"). `Frontend & UI:
 * Livewire, React.js, Next.js` names things; `Builds interfaces with Livewire,
 * React.js and Next.js` says what the person does with them, which is what a
 * reader is there to find out.
 *
 * THE VERBS CLAIM USE, NEVER PROFICIENCY. `Builds with` is what a skills list
 * actually asserts; `Solid command of` or `Expert in` would be this app
 * putting a claim in somebody's mouth that no source ever made. Anything not
 * named here gets `Works with`, which is true of every category by
 * construction.
 */
const SKILL_VERBS: Record<string, string> = {
  'Programming Languages': 'Writes',
  'Markup & Styling': 'Styles with',
  'Frontend & UI': 'Builds interfaces with',
  'Backend & APIs': 'Builds services and APIs with',
  'Databases & Storage': 'Stores and queries data with',
  'Cloud & Infrastructure': 'Deploys and runs systems with',
  'Data & Analytics': 'Analyses data with',
  'Mobile & Devices': 'Builds for mobile with',
  'Design & Creative': 'Designs with',
  'Software & Tools': 'Works day to day in',
  'Communication & Leadership': 'Brings',
}

/**
 * Which of the profile's projects a group of skills was actually used in.
 *
 * THE EVIDENCE CLAUSE IS THE POINT (Gabe, 2026-09-19: "does not apply skills
 * to notable projects"). A CV that lists React and separately lists a React
 * project leaves the reader to join them up; `used in Worktrack and
 * aero_weather` is the same two facts with the join already made, and it is
 * the shape Gabe's own CV uses -- "used across nearly every project below".
 *
 * MATCHED ON THE PROJECT'S DECLARED STACK, so it is a fact rather than an
 * inference: `tech` is the repository's own topics and language, not a guess
 * from the description.
 */
function projectsUsing(group: SkillGroup, projects: ProfileProject[]): string[] {
  const wanted = new Set(group.skills.map(techKey))
  return projects
    .filter((project) =>
      [...project.tech, project.language ?? ''].some((item) => wanted.has(techKey(item)))
    )
    .map((project) => project.title)
    .filter((title) => title.length > 0)
}

/**
 * What makes a repository topic and a skill name the same technology.
 *
 * GITHUB TOPICS ARE SLUGS. A repository declares `nextjs` and `tailwindcss`
 * where a skills list says `Next.js` and `Tailwind CSS`, so a literal
 * comparison found neither and the evidence clause under-reported -- it said
 * `used in Worktrack` for a group that two projects use.
 *
 * `+` AND `#` SURVIVE, because `C++` and `C#` are different languages from `C`
 * and from each other, and stripping every non-letter collapses all three.
 */
function techKey(value: string): string {
  return value.trim().toLowerCase().replace(/[.\s_-]/g, '')
}

/**
 * The skills, as sentences, under the headings a reader scans for.
 *
 * ONE PARAGRAPH PER GROUP, the heading bold and inline. Bold-inline rather
 * than a real heading node: these sit UNDER the template's own `Skills`
 * heading, and a second level of headings inside a section would outrank the
 * sections around it in every template's outline.
 *
 * THE GROUPING IS CAREER-GENERAL. See `skillGroups` -- a category appears only
 * when something landed in it, so a CV written by a nurse gets clinical
 * headings and one written by an engineer gets technical ones, from the same
 * table.
 */
function skillNodes(profile: UserProfile, prose: CvWriting): JSONContent[] {
  const groups = groupSkills(profile.skills)
  if (groups.length === 0) return []

  const written = new Map((prose?.skills ?? []).map((item) => [item.label, item.sentence]))

  const claim = (group: SkillGroup): string => {
    const byModel = written.get(group.label)
    if (byModel) return ending(byModel)
    const verb = SKILL_VERBS[group.label] ?? 'Works with'
    const used = projectsUsing(group, profile.projects)
    const evidence = used.length > 0 ? `, used in ${listed(used)}` : ''
    return ending(`${verb} ${listed(group.skills)}${evidence}`)
  }

  // ONE GROUP IS NOT A CLASSIFICATION. A single heading over the whole list
  // adds a label and no structure, so the sentence stands on its own.
  if (groups.length === 1) {
    return [{ type: 'paragraph', content: [text(claim(groups[0]))] }]
  }

  return groups.map((group) => ({
    type: 'paragraph',
    content: [bold(`${group.label}: `), text(claim(group))],
  }))
}

/**
 * How a heading is recognised as a section, and what replaces the block under
 * it.
 *
 * MATCHED BY SUBSTRING, case-insensitively, because the six CV templates do
 * not agree on wording and neither does anything a user pastes in:
 * "Professional Experience", "Work Experience" and "Experience" are one
 * section, and so are "Skills", "Tech Skills" and "Core Competencies". A
 * strict equality check matched two of the six templates and silently did
 * nothing to the rest, which looked exactly like the feature working.
 *
 * ORDER MATTERS: the first entry whose pattern hits wins, so anything that
 * could read as two sections has to be listed under the one it belongs to.
 */
const SECTIONS: {
  pattern: RegExp
  build: (profile: UserProfile, prose: CvWriting) => JSONContent[]
}[] = [
  { pattern: /experience|employment/i, build: (p) => experienceNodes(p.experiences) },
  { pattern: /education|academic/i, build: (p) => educationNodes(p.education) },
  {
    pattern: /skills?|competenc|^\s*stack\s*$/i,
    build: (p, prose) => skillNodes(p, prose),
  },
  { pattern: /projects?/i, build: (p, prose) => projectNodes(p.projects, prose) },
  // AFTER PROJECTS, because `certifications?` would otherwise never be reached
  // through a heading that reads "Projects & Certifications" -- the first
  // pattern that hits wins, and that is a projects section.
  {
    pattern: /certificat|licen[cs]e|credential|accreditation/i,
    build: (p) => certificationNodes(p.certifications),
  },
]

function headingLevel(node: JSONContent): number | null {
  if (node.type !== 'heading') return null
  const level = node.attrs?.level
  return typeof level === 'number' ? level : 1
}

/**
 * Replaces each recognised section's body with nodes built from the profile.
 *
 * A SECTION IS "THE HEADING, THEN EVERYTHING UNTIL THE NEXT HEADING OF THE
 * SAME OR HIGHER LEVEL". That rule rather than "until the next heading of any
 * level" so a template that puts an h3 per employer under an h2 Experience
 * heading has one section, not one per job.
 *
 * TOP LEVEL ONLY. Every template here is a flat list of blocks, which is what
 * the Word editor produces, and a heading nested inside a blockquote or a
 * table cell is not a CV section -- walking into containers to find one would
 * be answering a question nobody has asked.
 */
function expandSections(
  blocks: JSONContent[],
  profile: UserProfile,
  prose: CvWriting
): JSONContent[] {
  const out: JSONContent[] = []
  let i = 0
  while (i < blocks.length) {
    const block = blocks[i]
    const level = headingLevel(block)
    const section = level === null ? undefined : SECTIONS.find((s) => s.pattern.test(textOf(block)))
    out.push(block)
    i += 1
    if (!section || level === null) continue

    let end = i
    while (end < blocks.length) {
      const next = headingLevel(blocks[end])
      if (next !== null && next <= level) break
      end += 1
    }

    const replacement = section.build(profile, prose)
    // Nothing in the profile for this section: the template's own specimen
    // block is better than a heading over empty space, so it is carried
    // through untouched.
    out.push(...(replacement.length > 0 ? replacement : blocks.slice(i, end)))
    i = end
  }
  return out
}

/**
 * A template with the user's own details in it.
 *
 * Tokens are substituted BEFORE sections are expanded, so the generated nodes
 * are never themselves scanned for `{{`. That ordering is deliberate: profile
 * text is arbitrary user content and a description that happens to contain
 * braces is a description, not a template token, and must survive verbatim.
 *
 * The returned tree is always a new object. Call it on the way into
 * `resumeService.create`, never after -- a draft in the database is the user's
 * document, and running it over saved content would rewrite work they did.
 */
export function personalizeTemplate(
  content: JSONContent,
  profile: UserProfile,
  prose: CvWriting = null
): JSONContent {
  const doc = structuredClone(content)
  substituteTokens(doc, tokenValues(profile, prose))
  if (Array.isArray(doc.content)) doc.content = expandSections(doc.content, profile, prose)
  return doc
}
