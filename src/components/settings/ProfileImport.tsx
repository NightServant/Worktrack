'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { CssSpinner } from '@/components/ui/css-spinner'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { readFileText } from '@/lib/readFileText'
import {
  RejectedUploadError,
  assertBatchWithinSizeLimit,
  assertContentMatchesExtension,
} from '@/lib/uploadSafety'
import {
  AlertCircleIcon,
  CheckIcon,
  DownloadIcon,
  UploadIcon,
  TrashIcon,
  type IconName,
} from '@/components/icons'
import { iconMotion } from '@/components/icons/motion'
import { cn } from '@/lib/utils'
import type { ProfileSource } from '@/services/profile'

/**
 * SUPERSEDED BY `ProfileSources` BELOW, and kept rather than deleted (Gabe,
 * Worktrack Revisions item 8: "Do not remove the unused variables in the
 * codebase"). It is still the only source that has ever carried the bullet
 * text under a role, which is the part a CV is written from, so it is worth
 * having when the fetch turns out not to be enough.
 *
 * How a profile gets in: LinkedIn's own data export.
 *
 * WHAT THIS REPLACES, and why none of it survived. The first version asked for
 * a Composio API key; the second asked for a profile URL and scraped the page.
 * The key was an org-wide credential for eight OIDC fields, and the scrape
 * could only ever recover what a rendered page showed -- titles and dates,
 * almost never the bullet text under a role, which is the part a CV is written
 * from. Both are gone. This asks for a file the user already owns.
 *
 * MULTIPLE FILES, because the export is an archive of them and the useful data
 * is spread across several. Dropping in Profile.csv alone works; adding
 * Positions.csv later merges rather than replaces, since each table writes
 * only its own fields.
 *
 * THE BUTTONS SIZE BY CONTAINER, NOT VIEWPORT. They live inside the profile
 * banner, which is a card whose width has nothing to do with the window's --
 * a viewport `sm:w-auto` turns them into two small buttons floating in a
 * narrow card on any screen wider than 640px, which is most of them. The
 * query is on `@container/profile`, declared by ProfileGroup, so it is the
 * panel's own width that decides.
 *
 * NO CREDENTIAL, NO NETWORK CALL. The parsing happens in the browser and only
 * the result is stored, so nothing here can be blocked, rate limited or
 * banned -- which is what the two previous attempts each ran into.
 */
export interface ProfileImportProps {
  onImport: (files: { name: string; text: string }[]) => void
  onClear?: () => void
  importing?: boolean
  clearing?: boolean
  /** Whether there is a stored profile, which is what makes clearing meaningful. */
  hasProfile?: boolean
  /** What went wrong, or what landed, from the last attempt. */
  note?: string | null
}

export function ProfileImport({
  onImport,
  onClear,
  importing = false,
  clearing = false,
  hasProfile = false,
  note = null,
}: ProfileImportProps) {
  const input = React.useRef<HTMLInputElement>(null)
  const busy = importing || clearing

  const [rejected, setRejected] = React.useState<string | null>(null)

  const choose = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = [...(event.target.files ?? [])]
    // Reset first, so picking the SAME file twice still fires a change event --
    // otherwise a retry after a failed parse is a click that does nothing.
    event.target.value = ''
    if (!chosen.length) return

    setRejected(null)
    /*
      CHECKED BEFORE A SINGLE BYTE IS READ, and until 2026-09-15 nothing here
      was checked at all. `accept=".csv,text/csv"` on the input below looks
      like a control and is not -- it filters the picker's default view, and
      every picker has an "All files" option.

      THIS ONE IS `multiple`, which is why the batch form is used. A LinkedIn
      export is a folder of CSVs and the picker takes them all at once, so a
      per-file cap alone bounds nothing: fifty files at the limit is fifty
      times the limit, and `readFileText` holds every one of them in memory at
      the same time because of the Promise.all below.

      The content check catches the common real mistake here, which is picking
      the .zip LinkedIn actually emails you rather than the CSVs inside it.
    */
    try {
      assertBatchWithinSizeLimit(chosen, 'csv')
      for (const file of chosen) await assertContentMatchesExtension(file, '.csv')
    } catch (error) {
      setRejected(
        error instanceof RejectedUploadError ? error.message : 'Those files could not be read.'
      )
      return
    }

    onImport(
      await Promise.all(
        chosen.map(async (file) => ({ name: file.name, text: await readFileText(file) }))
      )
    )
  }

  return (
    <div className="flex flex-col gap-3" data-profile-import>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        multiple
        className="sr-only"
        onChange={(event) => void choose(event)}
      />

      {/* A refusal is the reader's own mistake to fix -- the wrong file, or too
          many of them -- so it says which, in the failure colour, where the
          ordinary note already sits. It clears on the next pick. */}
      {rejected && (
        <p role="alert" className="text-body-s text-status-rejected-mark" data-profile-rejected>
          {rejected}
        </p>
      )}

      {note && !rejected && (
        <p className="text-body-s text-text-muted" data-profile-note>
          {note}
        </p>
      )}

      {/* Full width on a phone, natural from `sm` -- the standing rule for
          primary actions on this screen. */}
      <div className="flex flex-col gap-2 @sm/profile:flex-row @sm/profile:items-center">
        <Button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="w-full @sm/profile:w-auto"
        >
          <UploadIcon size={16} aria-hidden className={iconMotion('lift')} />
          {importing ? 'Reading' : hasProfile ? 'Import again' : 'Import LinkedIn export'}
        </Button>
        {hasProfile && onClear && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => onClear()}
            disabled={busy}
            className="w-full @sm/profile:w-auto"
          >
            <TrashIcon size={16} aria-hidden className={iconMotion('drop')} />
            {clearing ? 'Removing' : 'Remove profile'}
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * The three steps, shown only when there is nothing yet.
 *
 * Separated from the button so the button can sit alone under a profile that
 * already imported -- instructions somebody has already followed are noise.
 */
export function ProfileImportSteps() {
  return (
    <ol
      className="flex list-decimal flex-col gap-1 pl-5 text-body-s text-text-muted"
      data-profile-steps
    >
      <li>
        On LinkedIn, open <span className="text-text-secondary">Settings &amp; Privacy</span> →{' '}
        <span className="text-text-secondary">Get a copy of your data</span>.
      </li>
      <li>
        Ask for the larger archive, not just connections. LinkedIn emails it — usually
        within minutes, sometimes up to a day.
      </li>
      <li>Unzip it and pick the CSVs here. Profile.csv alone is enough to start.</li>
    </ol>
  )
}

/**
 * How a profile gets in NOW: a list of public addresses, read and merged.
 *
 * WHY A LIST AND NOT A LINK (Gabe, 2026-09-18: "I need the profile section to
 * fetch more information from other websites such as glassdoor, linkedin, and
 * jobstreet -- kindly also consider github ... aggregate data sources and
 * combine them into one large single profile"). One source is one half of a
 * person: a signed-out LinkedIn page carries roles and dates and NO skills at
 * all, while GitHub carries what somebody actually built and in which
 * languages and has no concept of employment. Merged, they are a CV; alone,
 * neither is.
 *
 * WHY A LINK AND NOT A FILE, which is the older decision and still holds. The
 * LinkedIn export is a better source and a worse ask -- open settings, request
 * an archive, wait for an email that can take a day, unzip it, pick the right
 * CSVs. `ProfileImport` above is still there for the day that trade is worth
 * making.
 *
 * EVERY ROW IS OPTIONAL AND THE ORDER IS AUTHORITY. The addresses are sent in
 * the order they are drawn here, and the extractor takes the first non-empty
 * value for every single field -- so LinkedIn leads because a CV is written
 * from it, and GitHub fills the gaps it leaves rather than overwriting them.
 *
 * WHAT EACH SOURCE CANNOT GIVE IS SAID PER ROW, after the read. Two of these
 * four sites do not publish a candidate profile to a signed-out visitor at all
 * -- JobStreet is a SEEK account behind a login and Glassdoor is a reviews
 * account -- so the honest thing is to let somebody try their own link and
 * then say, on that row, what came back. A panel that silently added nothing
 * for half its fields would look broken instead.
 */

/** One row: what to call it, what it looks like, and how to recognise its address. */
interface ProfileSourceField {
  id: string
  label: string
  icon: IconName
  placeholder: string
  hint: string
  /** Which stored address belongs in this row. */
  host: RegExp
}

const PROFILE_SOURCES: ProfileSourceField[] = [
  {
    id: 'linkedin',
    label: 'LinkedIn profile',
    icon: 'Briefcase',
    placeholder: 'https://www.linkedin.com/in/your-name',
    hint: 'roles, dates, education. the public address — the one you would send to someone.',
    host: /(^|\.)linkedin\.com$/i,
  },
  {
    id: 'github',
    label: 'GitHub',
    icon: 'Code',
    placeholder: 'https://github.com/your-username',
    hint: 'what you have built, and the languages you built it in. free and always available.',
    host: /(^|\.)github\.com$/i,
  },
  {
    id: 'jobstreet',
    label: 'JobStreet',
    icon: 'Globe',
    placeholder: 'https://ph.jobstreet.com/profiles/your-name-abc123',
    hint: 'the public profile page. shows a signed-out visitor the current role and location.',
    host: /jobstreet/i,
  },
  {
    id: 'indeed',
    label: 'Indeed',
    icon: 'Search',
    placeholder: 'https://profile.indeed.com/p/yourname-abc123',
    hint: 'the shareable profile link, if your Indeed profile is public.',
    host: /indeed/i,
  },
  {
    id: 'glassdoor',
    label: 'Glassdoor',
    icon: 'Building',
    placeholder: 'https://www.glassdoor.com/member/profile/...',
    hint: 'only a page that is public to a signed-out visitor can be read.',
    host: /glassdoor/i,
  },
]

export interface ProfileSourcesProps {
  onFetch: (urls: string[]) => void
  onClear?: () => void
  fetching?: boolean
  clearing?: boolean
  hasProfile?: boolean
  /** What went wrong, or what landed, from the last attempt. */
  note?: string | null
  /** The addresses already stored, so a re-fetch does not need retyping. */
  sources?: ProfileSource[]
  /**
   * The LinkedIn data export, when the caller can take one.
   *
   * Absent hides that half of the card entirely -- a control with no handler
   * is a button that lies.
   */
  onImport?: (files: { name: string; text: string }[]) => void
  importing?: boolean
  importNote?: string | null
}

/** The host of an address, or '' -- used to put a stored source in its row. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function ProfileSources({
  onFetch,
  onClear,
  fetching = false,
  clearing = false,
  hasProfile = false,
  note = null,
  sources = [],
  onImport,
  importing = false,
  importNote = null,
}: ProfileSourcesProps) {
  const busy = fetching || clearing

  /** One address per row, keyed by row id. */
  const [urls, setUrls] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)

  // Stored addresses arriving after first render fill their own rows. Typing
  // wins from then on -- this only runs when the stored list changes.
  //
  // MATCHED BY HOST rather than by position, because the list that comes back
  // holds only the addresses that were sent: with LinkedIn left blank, its
  // first entry is GitHub's, and filling rows in order would put a GitHub
  // address in the LinkedIn field.
  React.useEffect(() => {
    if (sources.length === 0) return
    setUrls((current) => {
      const next = { ...current }
      for (const source of sources) {
        const host = hostOf(source.url)
        const row =
          PROFILE_SOURCES.find((candidate) => candidate.host.test(host)) ?? PROFILE_SOURCES[0]
        if (!next[row.id]) next[row.id] = source.url
      }
      return next
    })
  }, [sources])

  /** The last reading of each row's address, for the line under it. */
  const outcome = (id: string): ProfileSource | null => {
    const typed = urls[id]?.trim()
    if (!typed) return null
    return sources.find((source) => source.url === typed) ?? null
  }

  const submit = () => {
    const chosen = PROFILE_SOURCES.map((source) => ({
      source,
      url: (urls[source.id] ?? '').trim(),
    })).filter((row) => row.url)

    if (chosen.length === 0) {
      setError('Add at least one address.')
      return
    }
    const malformed = chosen.find((row) => !/^https?:\/\/.+/i.test(row.url))
    if (malformed) {
      setError(`The ${malformed.source.label} address must start with https://.`)
      return
    }
    setError(null)
    onFetch(chosen.map((row) => row.url))
  }

  return (
    <div className="flex flex-col gap-4" data-profile-fetch>
      {/* ONE PER ROW, AND NARROW. A profile address is about 50 characters and
          these sit in a card that can run to 1400px; unconstrained, each field
          looked like it wanted an essay (Gabe, 2026-09-10). Two columns once
          the CARD has the width for them -- the query is `@container/profile`,
          declared by ProfileGroup, because this panel's width has nothing to do
          with the window's. */}
      <div className="grid gap-4 @2xl/profile:grid-cols-2">
        {PROFILE_SOURCES.map((source) => {
          const read = outcome(source.id)
          return (
            <div key={source.id} className="flex max-w-md flex-col gap-1.5">
              <Field id={`profile-url-${source.id}`} label={source.label} hint={source.hint}>
                <Input
                  id={`profile-url-${source.id}`}
                  type="url"
                  icon={source.icon}
                  value={urls[source.id] ?? ''}
                  onChange={(event) => {
                    setUrls((current) => ({ ...current, [source.id]: event.target.value }))
                    setError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      submit()
                    }
                  }}
                  placeholder={source.placeholder}
                  disabled={busy}
                />
              </Field>
              {/* WHAT THIS ROW'S LAST READ DID, on the row itself. With four
                  addresses in one request, a single sentence under the button
                  cannot say which link failed -- and the fix is always to a
                  particular link. */}
              {read && (
                // A DIV, NOT A `<p>`. These glyphs render a wrapping element of
                // their own, and a block inside a paragraph is invalid markup
                // that React reports and browsers silently restructure.
                <div
                  data-profile-source-state={read.ok ? 'read' : 'failed'}
                  className={cn(
                    'flex items-start gap-1.5 text-body-s',
                    read.ok ? 'text-text-muted' : 'text-status-rejected-mark'
                  )}
                >
                  {read.ok ? (
                    <CheckIcon size={14} aria-hidden className="mt-0.5 shrink-0" />
                  ) : (
                    <AlertCircleIcon size={14} aria-hidden className="mt-0.5 shrink-0" />
                  )}
                  {read.ok ? 'read' : read.note || 'could not be read'}
                </div>
              )}
              {/* WHAT THIS SOURCE COULD NOT GIVE, ON THIS SOURCE'S ROW (Gabe,
                  2026-09-18). All of them used to be joined into one paragraph
                  under the button -- seven sentences from five sites, each an
                  instruction about a different link, in a wall nobody reads to
                  the end of. Here each one sits under the address it is about,
                  which is also the address you would change. */}
              {read?.warnings?.length ? (
                <ul
                  data-profile-source-warnings
                  className="flex list-disc flex-col gap-0.5 pl-4 text-caption text-text-muted"
                >
                  {read.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )
        })}
      </div>

      {error && (
        <p role="alert" className="text-body-s text-status-rejected-mark" data-profile-rejected>
          {error}
        </p>
      )}

      {/* THE EXPORT, AS THE ANSWER TO EVERY WARNING ABOVE IT (Gabe,
          2026-09-18: the wall of "add them by hand, or import a LinkedIn data
          export" -- and his own suggestion of "a stronger scraper or a
          bookmarklet").

          IT IS NEITHER OF THOSE, DELIBERATELY. A stronger scraper is an
          arms race against a site that has already said no to signed-out
          visitors, and a bookmarklet for a LOGGED-IN LinkedIn page would need
          a parser for markup LinkedIn rewrites at will -- the posting
          bookmarklet works because a job advert is one document, while a
          profile is a dozen lazy-loaded sections. The export is a file the
          person already owns, it parses in the browser with no network, no
          key and nothing to be blocked by, and it is the ONLY source that has
          ever carried the bullet text under a role. See `ProfileImport`.

          UNDER THE ADDRESSES, NOT INSTEAD OF THEM. The links are one paste and
          arrive in seconds; the export is an email that can take a day. It is
          the second half of the same card because that is when somebody wants
          it: after reading what the links could not give. */}
      {onImport && (
        <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
          <div className="flex flex-col gap-1">
            <p className="text-label-caps uppercase text-text-secondary">
              have the LinkedIn data export?
            </p>
            <p className="max-w-prose text-body-s text-text-muted">
              It is the only source that carries your About, your skills and the bullet text
              under each role — none of which a public profile page shows. Import it and those
              fill in.
            </p>
          </div>
          <ProfileImport
            onImport={onImport}
            importing={importing}
            note={importNote}
          />
          {!hasProfile && <ProfileImportSteps />}
        </div>
      )}

      {note && (
        <p className="max-w-prose text-body-s text-text-muted" data-profile-note>
          {note}
        </p>
      )}

      {/* Full width on a narrow panel, natural once the card has room. */}
      <div className="flex flex-col gap-2 @sm/profile:flex-row @sm/profile:items-center">
        <Button
          type="button"
          onClick={submit}
          disabled={busy}
          className="w-full @sm/profile:w-auto"
        >
          {fetching ? (
            <CssSpinner size={14} />
          ) : (
            <DownloadIcon size={16} aria-hidden className={iconMotion('drop')} />
          )}
          {fetching ? 'Reading' : hasProfile ? 'Fetch again' : 'Build my profile'}
        </Button>
        {hasProfile && onClear && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => onClear()}
            disabled={busy}
            className="w-full @sm/profile:w-auto"
          >
            <TrashIcon size={16} aria-hidden className={iconMotion('lid')} />
            {clearing ? 'Removing' : 'Remove profile'}
          </Button>
        )}
      </div>
    </div>
  )
}

/** What the fetch does, in three lines, for the empty state. */
export function ProfileSourceSteps() {
  return (
    <ol
      className="flex list-decimal flex-col gap-1 pl-5 text-body-s text-text-muted"
      data-profile-steps
    >
      <li>
        Paste the address of any profile you already have — LinkedIn, GitHub, a job board.
        One is enough; more makes a fuller profile.
      </li>
      <li>
        Worktrack reads each public page and combines them into one profile, with LinkedIn
        leading where two sources disagree.
      </li>
      <li>
        Anything no public page shows — the detail under each role, usually — you can write
        in yourself afterwards.
      </li>
    </ol>
  )
}
