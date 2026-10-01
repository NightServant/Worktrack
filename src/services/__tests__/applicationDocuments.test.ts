import { describe, it, expect } from 'vitest'
import { describeLink, linksToUnpin } from '../applicationDocuments'

describe('describeLink', () => {
  it('names the snapshot version when one is pinned', () => {
    expect(
      describeLink({
        resume_id: 'resume-1',
        mode: 'word',
        title: 'software engineer cv',
        version: 3,
        sent_at: '2026-08-21',
      })
    ).toBe('software engineer cv · version 3 · sent 21 AUG 2026')
  })

  it('falls back to latest when no snapshot version is pinned', () => {
    expect(
      describeLink({
        resume_id: 'resume-1',
        mode: 'word',
        title: 'software engineer cv',
        version: null,
        sent_at: '2026-08-21',
      })
    ).toBe('software engineer cv · latest · sent 21 AUG 2026')
  })
})

describe('linksToUnpin', () => {
  const link = (resume_id: string) => ({ resume_id })

  it('names the CV being replaced, so picking a new one actually switches', () => {
    // The reported bug: `application_documents` is unique on the PAIR, so
    // pinning a different CV added a second row. The application was linked
    // to both and the dialog kept showing the first.
    expect(linksToUnpin([link('old-cv')], 'new-cv')).toEqual(['old-cv'])
  })

  it('names nothing when the same CV is picked again', () => {
    // A re-pin is the one case the upsert already handles: same pair, so it
    // changes which snapshot was sent rather than adding a row.
    expect(linksToUnpin([link('same-cv')], 'same-cv')).toEqual([])
  })

  it('clears every link for "none"', () => {
    expect(linksToUnpin([link('a'), link('b')], null)).toEqual(['a', 'b'])
  })

  it('repairs an application the bug already left with two', () => {
    // Every link that is not the chosen one is named, so a record stuck in
    // that state corrects itself the next time a CV is picked.
    expect(linksToUnpin([link('a'), link('b'), link('c')], 'b')).toEqual(['a', 'c'])
  })

  it('has nothing to remove from an application with no links', () => {
    expect(linksToUnpin([], 'new-cv')).toEqual([])
  })
})
