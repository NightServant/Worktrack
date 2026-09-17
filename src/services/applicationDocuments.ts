export interface DocumentLinkSummary {
  /** The resume this link points at, needed to read its content for ATS matching. */
  resume_id: string
  title: string
  version: number | null
  sent_at: string
}

/**
 * The other direction: one application a CV was submitted to.
 *
 * A separate type rather than a widened `DocumentLinkSummary`, because the two
 * answer different questions and carry different fields -- this one has no
 * snapshot version (the editor is showing the CV as it is now, not as it was)
 * and does carry the company and role, which is the whole point of it.
 */
export interface ResumeLinkSummary {
  job_id: string
  company: string
  role: string
  /** The application's pipeline status, or null if the row went missing. */
  status: string | null
  sent_at: string
}

/**
 * Formats a DATE column for display.
 *
 * Read entirely in UTC. `sent_at` is a bare DATE, which parses as UTC midnight,
 * so reading any part of it in local time would shift the day backwards west of
 * UTC and could name the wrong month across a boundary.
 */
function formatSentDate(iso: string): string {
  const d = new Date(iso)
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()
  return `${String(d.getUTCDate()).padStart(2, '0')} ${month} ${d.getUTCFullYear()}`
}

/**
 * One-line summary of which CV went to an application.
 *
 * A null version means no snapshot was pinned, so the link tracks whatever the
 * CV looks like now — "latest" rather than a fixed point in its history.
 */
export function describeLink(link: DocumentLinkSummary): string {
  const version = link.version === null ? 'latest' : `version ${link.version}`
  return `${link.title} · ${version} · sent ${formatSentDate(link.sent_at)}`
}

/**
 * One-line summary of an application a CV went to, for the editor's dropdown.
 *
 * Role first, then company: a person with four CVs open is scanning for the
 * ROLE they tailored one against, and the company is the disambiguator.
 */
export function describeResumeLink(link: ResumeLinkSummary): string {
  return `${link.role} · ${link.company} · sent ${formatSentDate(link.sent_at)}`
}

/**
 * Which of an application's existing CV links have to go, given the one the
 * "cv used" field now names.
 *
 * THE BUG THIS FIXES (Gabe, 2026-09-11): "CV dropdown from the application
 * overview dialog is not functioning when I select the new CV". Picking a
 * different CV and saving appeared to do nothing -- reopening the record
 * showed the OLD one still selected.
 *
 * Nothing failed. `application_documents` is `UNIQUE (job_id, resume_id)` --
 * on the PAIR -- so pinning a DIFFERENT CV to the same application is a brand
 * new row, not a replacement. The application ended up linked to both, and the
 * dialog reads `openLinks[0]`, which was still the first one pinned. The
 * upsert in `documentLinkService.pin` only replaces a re-pin of the SAME CV,
 * which is a different thing from what the field does.
 *
 * THE FIELD IS A SINGLE SELECT, so one application carries one CV and picking
 * another means the previous one is no longer what was sent. The table stays
 * many-to-many -- that is right for the data, and the reverse lookup depends
 * on it -- and it is this one UI seam that narrows it.
 *
 * `null` is "none", and it clears every link. That is what the empty option in
 * the dropdown means, and it is the case that used to have its own function.
 *
 * A SAVE ALSO REPAIRS AN APPLICATION THAT ALREADY HAS TWO, since every link
 * that is not the chosen one is named here -- so a record left in that state
 * by the bug corrects itself the next time a CV is picked.
 */
export function linksToUnpin(
  links: readonly { resume_id: string }[],
  chosen: string | null
): string[] {
  return links.filter((link) => link.resume_id !== chosen).map((link) => link.resume_id)
}
