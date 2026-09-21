import { groupSkills } from './skillGroups'

/**
 * The profile Worktrack shows on Settings -> Profile.
 *
 * SOURCE-AGNOSTIC ON PURPOSE. The first version of this screen was bound to
 * Composio's LinkedIn connector and could only ever show the eight fields
 * self-serve OIDC returns -- name, email, picture, locale. That shape leaked
 * into the component, so changing where the data came from meant rewriting the
 * screen. This type is what a CV-writing app wants to know about a person;
 * whatever fills it in is a detail behind it.
 *
 * Everything is optional because every source is partial. A profile with only
 * a name is still a profile, and the panel renders whichever fields arrived
 * rather than blanking on the ones that did not.
 */
export interface ProfileExperience {
  title: string
  company: string | null
  /** Free text, e.g. "Jan 2024 – Present". Sources disagree too much to parse. */
  period: string | null
  location: string | null
  /**
   * The bullet text under a role.
   *
   * THE FIELD THE WHOLE IMPORT EXISTS FOR. A rendered profile page gives up
   * titles and dates; this is the part a CV is actually written from, and only
   * the export carries it.
   */
  description: string | null
}

export interface ProfileCertification {
  name: string
  authority: string | null
  period: string | null
  /**
   * When it was issued and when it lapses, as the source writes them.
   *
   * SEPARATE FROM `period`, which is the display string a source hands over
   * whole ("Issued Jan 2024 · Expires Jan 2027"). These two are the parts, and
   * they are worth having apart because a CV prints them apart -- "Issued
   * 2024" under a certificate, an expiry only when there is one.
   */
  issued: string | null
  expires: string | null
  /** The registry number under the certificate. Printed, never parsed. */
  credentialId: string | null
  /** `Show credential` -- where a reader can verify it. */
  url: string | null
}

export interface ProfileProject {
  title: string
  description: string | null
  url: string | null
  /**
   * What the project's own README says it does, as sentences.
   *
   * THE FIELD THE PROJECT DIALOG AND THE CV BULLETS ARE BUILT FROM (Gabe,
   * 2026-09-19). A repository description is one line -- "a job tracker" --
   * and a CV entry needs the three things it actually did. The README is the
   * only place a person has already written those down, so they are read from
   * it rather than invented, and nothing that is not in the file gets here.
   */
  highlights: string[]
  /** Languages, frameworks and topics the repository declares. */
  tech: string[]
  /** GitHub's primary language, when this came from a repository. */
  language: string | null
  /** Stars. A number, because a CV reader treats 400 and 4 differently. */
  stars: number | null
  /** The deployed thing, if the repository names one. */
  homepage: string | null
  /** ISO, when the source has it. Shown so a dead project reads as one. */
  updatedAt: string | null
}

export interface ProfileEducation {
  school: string
  degree: string | null
  period: string | null
  /**
   * The year the course ended, on its own.
   *
   * `period` IS FREE TEXT and often absent; this is the one number a CV prints
   * beside a school. Derived from whatever dates a source carried rather than
   * asked for separately, so it is present exactly when a year was.
   */
  graduationYear: string | null
}

/**
 * One address the profile was built from, and how that reading went.
 *
 * STORED WITH THE PROFILE, not held in the panel's state, and that is what
 * makes the screen usable a second time: the four addresses a person typed are
 * the expensive part of this import, and a panel that forgot them on reload
 * would ask for them again every visit. It is also the only honest way to
 * answer "where did this come from" about a merged profile.
 *
 * `ok: false` IS KEPT TOO. A source that could not be read is a fact about
 * that link -- a Glassdoor page shows nothing to a signed-out visitor -- and
 * dropping the row would leave the reader typing it in again to find out.
 */
export interface ProfileSource {
  url: string
  /** What to call it: `LinkedIn`, `GitHub`, `JobStreet`, or the host. */
  site: string
  ok: boolean
  /** Why it did not read, when it did not. */
  note: string | null
  /**
   * What this source could not give, in its own words.
   *
   * ON THE ROW RATHER THAN IN ONE PARAGRAPH (Gabe, 2026-09-18, pasting the
   * result back: seven sentences from five sources run together, with nothing
   * saying which link each was about). Every one of them is an instruction --
   * "import a LinkedIn data export", "add them by hand" -- and an instruction
   * you cannot attach to a source is one you cannot act on.
   */
  warnings: string[]
  /**
   * WHICH ROUTE READ IT -- `bookmarklet`, `apify`, `github`, `jobstreet`, …
   *
   * IT IS ON SCREEN BECAUSE THE DIFFERENCE IS THE WHOLE POINT (2026-09-18).
   * A public-page read and a captured-page read produce the same green tick
   * and wildly different profiles, so a reader who pressed the bookmarklet had
   * no way to tell whether it had worked -- and the one who pressed `fetch
   * again` by mistake saw four warnings about a signed-out page with nothing
   * saying that is what he had just asked for.
   */
  via: string | null
}

/**
 * One source's own About, kept with the name of who wrote it.
 *
 * `summary` IS STILL A SINGLE STRING, because the CV tools read it as one --
 * `templatePersonalization` puts it in a document. This is the display half:
 * every source that HAD an About, so a profile can say where its opening
 * paragraph came from instead of quietly printing whichever won.
 */
export interface ProfileAbout {
  site: string
  text: string
}

/**
 * What kind of number a phone number is.
 *
 * FOUR, AND `other` IS ONE OF THEM. A dropdown of three that does not contain
 * somebody's actual situation is a dropdown that makes them lie; `other` is
 * what keeps this a fact rather than a guess.
 */
export const PHONE_TYPES = ['mobile', 'home', 'work', 'other'] as const

export type PhoneType = (typeof PHONE_TYPES)[number]

export interface UserProfile {
  name: string | null
  /** The one-line professional headline. */
  headline: string | null
  location: string | null
  pictureUrl: string | null
  email: string | null
  /** The "about" paragraph -- the first source that had one. */
  summary: string | null
  /** Every source's About, attributed. See `ProfileAbout`. */
  about: ProfileAbout[]
  url: string | null
  /** LinkedIn's `Industry`, e.g. "Software Development". */
  industry: string | null
  /**
   * The postal address from the export.
   *
   * SENSITIVE, AND OPTIONAL BY NATURE. LinkedIn's Profile.csv carries a full
   * street address and a birth date. They belong to a CV in some markets and
   * to no CV at all in others, so they are stored when the export has them and
   * shown plainly rather than quietly -- and `/privacy` names them, because a
   * home address is not the same category of fact as a job title.
   */
  address: string | null
  /** As LinkedIn writes it -- "Mar 7". Usually no year, so it is not a date. */
  birthDate: string | null
  /**
   * A phone number, as the person typed it.
   *
   * KEPT VERBATIM RATHER THAN REFORMATTED. A number is written differently in
   * every market -- `+63 917 123 4567`, `0917 123 4567`, `(02) 8123 4567` --
   * and the only thing this app does with it is show it back and put it on a
   * CV. Normalising to E.164 would need a country the user never gave, and
   * getting that wrong prints a wrong number on a document somebody sends to
   * an employer.
   *
   * IT IS NOT IMPORTED. No public profile publishes a phone number, and no
   * parser writes this field -- it comes from the person, at registration or
   * from the details dialog. That is also why it survives a re-import: the
   * merge never overwrites a filled field with an empty one.
   */
  phone: string | null
  /** What kind of number it is. See `PHONE_TYPES`. */
  phoneType: PhoneType | null
  /**
   * The date of birth the person entered, as `YYYY-MM-DD`.
   *
   * SEPARATE FROM `birthDate`, which is a different fact wearing a similar
   * name. That one is whatever a source printed -- LinkedIn writes "Mar 7",
   * with no year, because a year is not public. This one is a real date the
   * person typed, and only a real date can be stored as one. Mixing them in a
   * field would mean nothing downstream could tell which it had.
   */
  birthday: string | null
  websites: string[]
  experiences: ProfileExperience[]
  education: ProfileEducation[]
  skills: string[]
  certifications: ProfileCertification[]
  languages: string[]
  projects: ProfileProject[]
  /** Where this profile came from. See `ProfileSource`. */
  sources: ProfileSource[]
  /** When this snapshot was taken, ISO. Profiles go stale silently otherwise. */
  fetchedAt: string | null
}

export const EMPTY_PROFILE: UserProfile = {
  name: null,
  headline: null,
  location: null,
  pictureUrl: null,
  email: null,
  summary: null,
  about: [],
  url: null,
  industry: null,
  address: null,
  birthDate: null,
  phone: null,
  phoneType: null,
  birthday: null,
  websites: [],
  experiences: [],
  education: [],
  skills: [],
  certifications: [],
  languages: [],
  projects: [],
  sources: [],
  fetchedAt: null,
}

/** Whether there is anything worth rendering. */
export function hasProfileContent(profile: UserProfile): boolean {
  return Boolean(
    profile.name ||
      profile.headline ||
      profile.summary ||
      profile.experiences.length ||
      profile.education.length ||
      profile.skills.length ||
      profile.certifications.length ||
      profile.languages.length ||
      profile.projects.length
  )
}

/**
 * The opening paragraph a CV is introduced by.
 *
 * WHY IT IS COMPOSED RATHER THAN COPIED (Gabe, 2026-09-19: "professional
 * summary display the one sentence from GitHub. Headline from LinkedIn or
 * Jobstreet should be the professional summary (profile) but longer than the
 * original in CV"). `summary` is whichever source had an About first, and on a
 * profile where LinkedIn published none that was a GitHub bio -- so a CV
 * opened with "All will be well." while a full professional headline sat
 * unused one field away.
 *
 * THE LONGEST TRUE THING LEADS. Every candidate here was written by the person
 * about themselves for an employer to read -- an About, a headline, a bio --
 * and length is the honest proxy for which of them is the paragraph: a
 * headline that runs to a sentence about what somebody is looking for beats a
 * three-word bio, and an About beats both when there is one.
 *
 * THEN FACTS, AND ONLY FACTS ALREADY IN THE PROFILE. The two sentences that
 * may follow name the current role and the tools -- both read straight off
 * `experiences` and `skills`, never generated. A summary is the one part of a
 * CV a reader assumes the candidate wrote, so nothing here may be a claim they
 * would not recognise.
 *
 * NOTHING IS SAID TWICE. A sentence is skipped when the lead already contains
 * its subject, which is why a headline that names the employer does not get
 * "Currently ... at" underneath it.
 */
export function professionalSummary(profile: UserProfile): string | null {
  const mentions = (haystack: string, needle: string | null): boolean =>
    !!needle && haystack.toLowerCase().includes(needle.trim().toLowerCase())

  // A CODE HOST'S BIO IS NEVER THE LEAD. It is a 160-character field under an
  // avatar, and ranking by length alone would still let a long joke win over a
  // short headline written for a recruiter.
  const written = profile.about
    .filter((entry) => !/github/i.test(entry.site))
    .map((entry) => entry.text)
  const candidates = [...written, profile.headline, profile.summary]
    .map((value) => (value ?? '').trim())
    .filter((value) => value.length > 0)
  if (candidates.length === 0) return null

  const lead = candidates
    .reduce((best, value) => (value.length > best.length ? value : best))
    .replace(/\s+/g, ' ')

  /*
   * THE PERSON HAS TO MATCH THE LEAD (Gabe, 2026-09-19: "make sure that
   * professional summary generates sentences with complete thoughts").
   *
   * A LinkedIn headline is routinely written in the first person -- "seeking
   * to start my career as a Front-End Developer" -- and the sentences added
   * under it were in the third: "Works with TypeScript". One paragraph, two
   * voices, which is the first thing a reader notices and the last thing they
   * can explain. So the lead is read for `my`/`I` and everything after it
   * follows.
   */
  const firstPerson = /\b(i|my|me|i'm|i am)\b/i.test(lead)
  const sentences = [ending(lead)]

  const role = profile.experiences[0]
  if (role && role.title && !mentions(lead, role.title)) {
    // `Present` in the period is the only test that works across every
    // source's date formatting -- the same one the timeline's node uses.
    const current = /present|now/i.test(role.period ?? '')
    const where = role.company && !mentions(lead, role.company) ? ` at ${role.company}` : ''
    // A COMPLETE CLAUSE, WITH A VERB. This was "Most recently Frontend
    // Developer and UI/UX Designer at Dominican College of Tarlac." -- a
    // label, not a sentence, and the exact thing the complaint was about.
    const verb = current
      ? firstPerson
        ? 'I am currently working as'
        : 'Currently works as'
      : firstPerson
        ? 'I most recently worked as'
        : 'Most recently worked as'
    sentences.push(ending(`${verb} ${article(role.title)}${role.title}${where}`))
  }

  // ONE SKILL PER GROUP, so the line reads as a RANGE rather than as the first
  // five entries of whatever order the sources happened to merge in. Measured
  // on Gabe's own profile (2026-09-19), taking the list in order gave
  // "Livewire, GitHub, Claude Code, IntelliJ IDEA and TypeScript" -- three
  // editors and a code host, which says less about him than the role sentence
  // above it. By group it is a language, a styling system, a framework and a
  // tool, which is what a reader is trying to learn from the line.
  const spread: string[] = []
  for (const group of groupSkills(profile.skills)) {
    if (spread.length >= 5) break
    const first = group.skills.find((skill) => !mentions(lead, skill))
    if (first) spread.push(first)
  }
  if (spread.length >= 3) {
    sentences.push(
      ending(`${firstPerson ? 'I work with' : 'Works with'} ${listed(spread)}`)
    )
  }

  return sentences.join(' ')
}

/** `a` or `an`, with a trailing space. Crude on purpose: it reads the letter. */
function article(noun: string): string {
  return /^[aeiou]/i.test(noun.trim()) ? 'an ' : 'a '
}

/**
 * `a, b and c` -- the serial list a sentence needs.
 *
 * A JOIN ON `", "` IS NOT A SENTENCE, and that is most of what was wrong with
 * the generated CV: every list in it was punctuation where a conjunction
 * belonged.
 */
export function listed(parts: string[]): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** A string that ends like a sentence. Adds the full stop, never a second one. */
export function ending(text: string): string {
  const trimmed = text.trim()
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/**
 * A stored profile brought up to the current record shape.
 *
 * WHY IT IS NEEDED AT ALL. `user_profiles.profile` is a JSON column, so a row
 * written last week is exactly the shape the parser had last week -- and every
 * field added since is simply absent from it. The top-level fields were
 * already covered by spreading over `EMPTY_PROFILE`; the RECORDS inside were
 * not, so `project.tech.length` threw on a profile imported before projects
 * had a `tech` field (2026-09-19).
 *
 * AT THE READ BOUNDARY, ONCE. The alternative is a defensive `?? []` at every
 * call site, which is the same fix written eleven times and forgotten on the
 * twelfth -- and the panel, the CV templates and three exporters all read
 * these records directly.
 *
 * IT FILLS, IT NEVER REPLACES. Anything the stored row has survives; only the
 * keys it has never heard of are added, at their empty value.
 */
/** Whether a stored photo is a code host's avatar. See `normalizeProfile`. */
function isCodeHostAvatar(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.endsWith('githubusercontent.com') || host.endsWith('gitlab.com')
  } catch {
    return false
  }
}

export function normalizeProfile(stored: Partial<UserProfile> | null): UserProfile | null {
  if (!stored) return null
  const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])
  const strings = (value: unknown): string[] =>
    list<unknown>(value).filter((item): item is string => typeof item === 'string')

  return {
    ...EMPTY_PROFILE,
    ...stored,
    /*
     * A CODE HOST'S AVATAR IS NOT A PROFILE PHOTO (Gabe, 2026-09-19: "Profile
     * Pic must not come from GitHub. It should come from LinkedIn, Jobstreet,
     * Glassdoor, and Indeed").
     *
     * THE PARSER STOPPED WRITING IT AND THAT IS NOT ENOUGH. The merge never
     * overwrites a filled field with an empty one -- deliberately, it is what
     * makes adding a source safe -- so a GitHub avatar already in the database
     * would have survived every future import and stayed the face on the CV.
     * Dropped on the way out instead, which is the same repair as the missing
     * keys below: stored data written under a rule that no longer holds.
     */
    pictureUrl: isCodeHostAvatar(stored.pictureUrl) ? null : (stored.pictureUrl ?? null),
    /*
     * A STORED PHONE TYPE IS STILL CHECKED. It is JSONB written by this app,
     * but the column has no constraint and a value removed from `PHONE_TYPES`
     * would otherwise keep rendering forever -- the same repair `pictureUrl`
     * above makes for data written under a rule that no longer holds.
     */
    phoneType: PHONE_TYPES.includes(stored.phoneType as PhoneType)
      ? (stored.phoneType as PhoneType)
      : null,
    about: list<ProfileAbout>(stored.about),
    websites: strings(stored.websites),
    skills: strings(stored.skills),
    languages: strings(stored.languages),
    sources: list<ProfileSource>(stored.sources),
    experiences: list<Partial<ProfileExperience>>(stored.experiences).map((entry) => ({
      title: entry.title ?? '',
      company: entry.company ?? null,
      period: entry.period ?? null,
      location: entry.location ?? null,
      description: entry.description ?? null,
    })),
    education: list<Partial<ProfileEducation>>(stored.education).map((entry) => ({
      school: entry.school ?? '',
      degree: entry.degree ?? null,
      period: entry.period ?? null,
      graduationYear: entry.graduationYear ?? null,
    })),
    certifications: list<Partial<ProfileCertification>>(stored.certifications).map((entry) => ({
      name: entry.name ?? '',
      authority: entry.authority ?? null,
      period: entry.period ?? null,
      issued: entry.issued ?? null,
      expires: entry.expires ?? null,
      credentialId: entry.credentialId ?? null,
      url: entry.url ?? null,
    })),
    projects: list<Partial<ProfileProject>>(stored.projects).map((entry) => ({
      title: entry.title ?? '',
      description: entry.description ?? null,
      url: entry.url ?? null,
      highlights: strings(entry.highlights),
      tech: strings(entry.tech),
      language: entry.language ?? null,
      stars: typeof entry.stars === 'number' ? entry.stars : null,
      homepage: entry.homepage ?? null,
      updatedAt: entry.updatedAt ?? null,
    })),
  }
}
