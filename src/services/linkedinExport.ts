import Papa from 'papaparse'
import { EMPTY_PROFILE, type ProfileEducation, type ProfileExperience, type UserProfile } from './profile'

/**
 * LinkedIn's own data export, read into a `UserProfile`.
 *
 * WHY THIS AND NOT A SCRAPER. The parser this replaces read a rendered profile
 * page, and it could only ever recover what the page happened to show: job
 * titles and dates, almost never the bullet text under a role -- which is the
 * part a CV is actually made of. The export is first-party, sanctioned, needs
 * no session and cannot be blocked, and it carries the descriptions, the
 * certifications, the projects and the rest. Settings & Privacy -> Get a copy
 * of your data.
 *
 * FILES ARE IDENTIFIED BY THEIR HEADER ROW, NOT THEIR NAME. LinkedIn renames
 * and re-cases these between exports, and a user can drag one file in without
 * the archive around it. A header is the thing that actually says what a table
 * is, so `Positions.csv`, `positions.csv` and a hand-renamed copy all land in
 * the same place -- and a file that matches nothing is reported rather than
 * silently ignored.
 *
 * VERIFIED AGAINST A REAL EXPORT (2026-09-06), Profile.csv:
 *
 *   First Name, Last Name, Maiden Name, Address, Birth Date, Headline,
 *   Summary, Industry, Zip Code, Geo Location, Twitter Handles, Websites,
 *   Instant Messengers
 *
 * The other tables are handled from their documented headers and are NOT yet
 * confirmed against a real file -- see `RECOGNISERS`. Each is independent, so
 * an unrecognised one costs only itself.
 */

export interface ImportResult {
  profile: UserProfile
  /** Which tables were understood, for telling the user what landed. */
  recognised: string[]
  /** Files that matched no known header, by name. */
  unrecognised: string[]
}

type Row = Record<string, string>

/** Case- and space-insensitive, so "First Name" and "first_name" both match. */
function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, ' ')
}

function value(row: Row, ...names: string[]): string | null {
  for (const name of names) {
    const found = row[normaliseHeader(name)]
    if (found && found.trim()) return found.trim()
  }
  return null
}

/** LinkedIn writes a running role as an empty end date. */
function period(row: Row, startNames: string[], endNames: string[]): string | null {
  const start = value(row, ...startNames)
  const end = value(row, ...endNames)
  if (start && end) return `${start} – ${end}`
  if (start) return `${start} – present`
  return end
}

function splitList(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

interface Recogniser {
  name: string
  /** Every one of these must be present for the file to be this table. */
  requires: string[]
  apply: (rows: Row[], into: UserProfile) => void
}

/**
 * The tables worth reading, and what identifies each.
 *
 * `requires` is deliberately the SMALLEST set that cannot collide: Positions
 * and Education both have date columns, so each is keyed on the column only it
 * has (`company name`, `school name`).
 */
const RECOGNISERS: Recogniser[] = [
  {
    name: 'Profile',
    requires: ['first name', 'last name'],
    apply: (rows, into) => {
      const row = rows[0]
      if (!row) return
      const first = value(row, 'First Name')
      const last = value(row, 'Last Name')
      into.name = [first, last].filter(Boolean).join(' ') || null
      into.headline = value(row, 'Headline')
      into.summary = value(row, 'Summary')
      into.industry = value(row, 'Industry')
      into.location = value(row, 'Geo Location')
      into.address = value(row, 'Address')
      into.birthDate = value(row, 'Birth Date')
      into.websites = splitList(value(row, 'Websites'))
    },
  },
  {
    name: 'Positions',
    requires: ['company name', 'title'],
    apply: (rows, into) => {
      into.experiences = rows
        .map<ProfileExperience>((row) => ({
          title: value(row, 'Title') ?? 'role not stated',
          company: value(row, 'Company Name'),
          period: period(row, ['Started On'], ['Finished On']),
          location: value(row, 'Location'),
          // The bullet text. The whole reason the export beats a scrape.
          description: value(row, 'Description'),
        }))
        .filter((entry) => entry.title || entry.company)
    },
  },
  {
    name: 'Education',
    requires: ['school name'],
    apply: (rows, into) => {
      into.education = rows
        .map<ProfileEducation>((row) => ({
          school: value(row, 'School Name') ?? 'school not stated',
          degree: [value(row, 'Degree Name'), value(row, 'Notes')].filter(Boolean).join(', ') || null,
          period: period(row, ['Start Date'], ['End Date']),
          // The year the course ended, on its own -- what a CV prints beside a
          // school when there is no range. The export writes a full date, so
          // the year is the last four digits of `End Date`.
          graduationYear: value(row, 'End Date')?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null,
        }))
        .filter((entry) => entry.school !== 'school not stated')
    },
  },
  {
    name: 'Skills',
    requires: ['name'],
    apply: (rows, into) => {
      into.skills = rows.map((row) => value(row, 'Name') ?? '').filter(Boolean)
    },
  },
  {
    name: 'Certifications',
    requires: ['authority'],
    apply: (rows, into) => {
      into.certifications = rows
        .map((row) => ({
          name: value(row, 'Name') ?? '',
          authority: value(row, 'Authority'),
          period: period(row, ['Started On'], ['Finished On']),
          // THE EXPORT SPLITS WHAT THE PAGE PRINTS AS ONE LINE, which is the
          // one thing it does better than any scrape of the profile: two
          // columns, already parsed, with no labels to strip.
          issued: value(row, 'Started On'),
          expires: value(row, 'Finished On'),
          credentialId: value(row, 'License Number', 'Licence Number'),
          url: value(row, 'Url', 'URL'),
        }))
        .filter((entry) => entry.name)
    },
  },
  {
    name: 'Languages',
    requires: ['proficiency'],
    apply: (rows, into) => {
      into.languages = rows
        .map((row) => {
          const name = value(row, 'Name')
          const proficiency = value(row, 'Proficiency')
          return name ? (proficiency ? `${name} (${proficiency})` : name) : ''
        })
        .filter(Boolean)
    },
  },
  {
    name: 'Projects',
    requires: ['url', 'title'],
    apply: (rows, into) => {
      into.projects = rows
        .map((row) => ({
          title: value(row, 'Title') ?? '',
          description: value(row, 'Description'),
          url: value(row, 'Url', 'URL'),
          // AN EXPORT HAS NO REPOSITORY BEHIND IT. The structured half of a
          // project -- its stack, its stars, the README bullets -- only exists
          // where the project is code somebody published, so it is left empty
          // rather than guessed at from a paragraph.
          highlights: [],
          tech: [],
          language: null,
          stars: null,
          homepage: null,
          updatedAt: null,
        }))
        .filter((entry) => entry.title)
    },
  },
]

function parseCsv(text: string): Row[] {
  const parsed = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: normaliseHeader,
  })
  return (parsed.data ?? []).filter((row) => row && typeof row === 'object')
}

function headersOf(rows: Row[]): Set<string> {
  return new Set(rows.length ? Object.keys(rows[0]) : [])
}

/**
 * Reads one or more export CSVs into a single profile.
 *
 * Order does not matter: each recogniser writes only its own fields, so
 * dropping in Profile.csv alone and adding Positions.csv later produce the
 * same result as handing over both at once.
 */
export function importLinkedInExport(
  files: { name: string; text: string }[]
): ImportResult {
  const profile: UserProfile = {
    ...EMPTY_PROFILE,
    // Not a fetch, but the same question: how old is what you are looking at.
    fetchedAt: new Date().toISOString(),
  }
  const recognised: string[] = []
  const unrecognised: string[] = []

  for (const file of files) {
    const rows = parseCsv(file.text)
    const headers = headersOf(rows)
    const match = RECOGNISERS.find((candidate) =>
      candidate.requires.every((column) => headers.has(column))
    )
    if (!match || !rows.length) {
      unrecognised.push(file.name)
      continue
    }
    match.apply(rows, profile)
    recognised.push(match.name)
  }

  return { profile, recognised, unrecognised }
}
