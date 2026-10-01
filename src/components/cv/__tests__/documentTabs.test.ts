import { describe, it, expect } from 'vitest'
import {
  asDocumentTab,
  DEFAULT_DOCUMENT_TAB,
  DOCUMENT_TABS,
  tabById,
  type DocumentTabId,
} from '../documentTabs'

/**
 * Which panes each kind of document gets, and what happens to a remembered tab
 * that the open document does not have.
 *
 * THE SECOND HALF IS THE REAL BUG. The selected tab is stored under one key for
 * both editors (see `WordResumeEditor` for why), so somebody who leaves a CV on
 * `tailor` and then opens a cover letter restores a tab that is not in that
 * rail: a tablist selecting nothing, above a pane holding nothing, with no
 * error anywhere to explain it. It is the kind of defect that only appears on
 * the second visit, which is exactly the kind a unit test is for.
 */

const idsOf = (kind: 'word' | 'cover_letter'): DocumentTabId[] =>
  DOCUMENT_TABS[kind].map((tab) => tab.id)

describe('the document tab sets', () => {
  it('leaves a CV exactly as it was: grammar, then tailoring', () => {
    expect(idsOf('word')).toEqual(['grammar', 'tailor'])
  })

  it('gives a cover letter one tab for tailoring and its review together', () => {
    // Gabe, 2026-10-01: letters are tailored like CVs, then "combine the
    // tailor to a job and letter check section and rename it with concise
    // wording". One tab, under the CV tab's id so a remembered tab carries.
    expect(idsOf('cover_letter')).toEqual(['grammar', 'tailor'])
    expect(DOCUMENT_TABS.cover_letter[1].label).toBe('tailor & review')
    expect(DOCUMENT_TABS.cover_letter[1].hint).not.toMatch(/score this CV/)
  })

  it('shares one grammar tab rather than describing it twice', () => {
    // Not pedantry: two copies is two places for the label, the hint and the
    // icon to drift, and the rail, the pane switch and the compact fallback
    // all read them.
    expect(DOCUMENT_TABS.word[0]).toBe(DOCUMENT_TABS.cover_letter[0])
  })

  it('starts both kinds on a pane that works with nothing else set up', () => {
    for (const kind of ['word', 'cover_letter'] as const) {
      expect(idsOf(kind)[0]).toBe(DEFAULT_DOCUMENT_TAB)
      expect(DOCUMENT_TABS[kind].find((tab) => tab.id === DEFAULT_DOCUMENT_TAB)?.needsApplication)
        .toBe(false)
    }
  })

  it('says a tab needs an application only where it is useless without one', () => {
    // `needsApplication` drives the rail's "needs an application" hint. The
    // CV's tailor pane is empty without one; the letter's review half reads
    // the letter alone, so its combined tab carries no such warning.
    expect(DOCUMENT_TABS.word.filter((tab) => tab.needsApplication).map((tab) => tab.id)).toEqual([
      'tailor',
    ])
    expect(DOCUMENT_TABS.cover_letter.some((tab) => tab.needsApplication)).toBe(false)
  })

  it('resolves a tab by id', () => {
    expect(tabById('grammar').label).toBe('grammar check')
    expect(tabById('tailor').needsApplication).toBe(true)
  })
})

describe('restoring a remembered tab', () => {
  it('keeps a CV on the tab it was left on', () => {
    expect(asDocumentTab('tailor', 'word')).toBe('tailor')
    expect(asDocumentTab('grammar', 'word')).toBe('grammar')
  })

  it('keeps a cover letter on the tailor pane, which letters have now', () => {
    expect(asDocumentTab('tailor', 'cover_letter')).toBe('tailor')
  })

  it('drops the retired letter check tab, for either kind', () => {
    // `suggestions` was the letter check's own tab until 2026-10-01, and a
    // browser that remembered it must not open a rail with nothing selected.
    expect(asDocumentTab('suggestions', 'word')).toBe(DEFAULT_DOCUMENT_TAB)
    expect(asDocumentTab('suggestions', 'cover_letter')).toBe(DEFAULT_DOCUMENT_TAB)
  })

  it('falls back for anything a previous version of the app wrote', () => {
    for (const stored of ['spelling', '', null, undefined, 42, {}]) {
      expect(asDocumentTab(stored, 'word')).toBe(DEFAULT_DOCUMENT_TAB)
      expect(asDocumentTab(stored, 'cover_letter')).toBe(DEFAULT_DOCUMENT_TAB)
    }
  })
})
