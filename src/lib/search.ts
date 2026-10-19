/**
 * What "matches" means, for every search box in this app.
 *
 * IT IS A SHARED FUNCTION BECAUSE THERE ARE NOW TWO BOXES ON ONE PAGE. The
 * documents list has had a search since 2026-09-10, and its comment already
 * made the rule explicit: two search boxes in one app must not disagree about
 * what a match is. That was a warning when the second box lived on another
 * screen; with the template gallery's own search sitting six inches above the
 * list's, a disagreement would be visible in a single glance -- the same typed
 * word narrowing one control and not the other, for no reason a reader could
 * see.
 *
 * IT MOVED OUT OF `components/documents/` ON 2026-09-15, when the remote-roles
 * rail on the calendar got a search box of its own and became the third
 * consumer. A rule the whole app follows cannot live inside one feature's
 * folder: `components/calendar` importing from `components/documents` to find
 * out what a match is would make the documents screen a dependency of the
 * calendar for no reason anybody reading either file could guess.
 *
 * THE RULE: every term must appear somewhere in the searched text, in any
 * order, as a substring. `engineer north` finds "Software Engineer —
 * Northwind Pay", and `letter change` finds the career-change cover letter.
 * Substring rather than prefix because a document is named after a company as
 * often as after a role, and nobody remembers which word came first.
 *
 * SEVERAL FIELDS, JOINED, rather than one. A template's description is the
 * only place "for a career change" is written down -- its name is just
 * "Career change" -- so a gallery search that read names alone would miss the
 * words somebody actually types. Joining with a space rather than testing each
 * field separately is deliberate: a term matching the name and another
 * matching the description should still count as a match, which per-field
 * testing would reject.
 */

/** The typed query, split into the terms every match must contain. */
/** Lower case with accents removed, so "telefonica" finds "Telefónica". */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function searchTerms(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean)
}

/** True when every term appears in the given fields. No terms matches everything. */
export function matchesTerms(terms: string[], ...fields: (string | null | undefined)[]): boolean {
  if (terms.length === 0) return true
  const haystack = fold(fields.filter(Boolean).join(' '))
  return terms.every((term) => haystack.includes(term))
}
