import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { PROOFREAD_CACHE_KEY } from '@/services/grammar'
import { GrammarCheckPane } from '../ProofreadPanes'
import { useProofread } from '../useProofread'

/**
 * The check that runs itself, and the cache that makes that affordable (Gabe,
 * 2026-09-17: run the spelling and grammar check automatically instead of
 * waiting for a press, and cache the result so the API is not called again).
 *
 * WHY THESE TWO ARE ONE FILE. They are one feature: LanguageTool's free
 * endpoint is keyless and rate limited PER IP, so an automatic run WITHOUT a
 * cache is not a smaller version of this change, it is a worse product -- the
 * reader's own allowance spent on every open, every remount and every trip
 * back to the tab, and when it runs out the pane just says the checker could
 * not be reached. Testing the auto-run without the "and only once" half would
 * pass on exactly the implementation nobody wants.
 *
 * THE FAKE EDITOR IS A `getText`, WHICH IS ALL `run` TOUCHES. Standing up a
 * real tiptap instance would test tiptap; the seam that matters here is the
 * request and the storage either side of it.
 */

const FINDING = {
  offset: 4,
  length: 3,
  shortMessage: 'Agreement error',
  replacements: [{ value: 'goes' }],
  rule: { id: 'HE_VERB_AGR', issueType: 'grammar', category: { id: 'GRAMMAR' } },
}

const DOCUMENT = 'He go to work early every single morning of the week.'

function fetchReturning(matches: unknown[]) {
  const mock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ matches }),
  })
  global.fetch = mock as unknown as typeof fetch
  return mock
}

/** The pane as the rail mounts it: state from the hook, no button pressed. */
function Pane({ text }: { text: string }) {
  // Memoised so the editor's identity is stable across renders, as tiptap's
  // is -- `run` is keyed on it, and a new object each render would re-run the
  // effect forever rather than once.
  const editor = React.useMemo(
    () => ({ getText: () => text }) as unknown as Editor,
    [text]
  )
  return <GrammarCheckPane state={useProofread(editor)} />
}

const realFetch = global.fetch

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  global.fetch = realFetch
  vi.restoreAllMocks()
})

describe('the grammar pane', () => {
  it('checks the document on its own, with nobody pressing anything', async () => {
    const fetchMock = fetchReturning([FINDING])
    render(<Pane text={DOCUMENT} />)

    // The finding on screen is the assertion, not just the call: a request
    // that fires and whose result never lands is the same as no check.
    expect(await screen.findByText('Agreement error')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // The button stays, and renames itself -- an edited document is a cache
    // miss and a real request, so the way to ask again has to survive.
    expect(screen.getByRole('button', { name: 're-check' })).toBeInTheDocument()
  })

  it('does not call the API again for a document it has already checked', async () => {
    // THE WHOLE POINT. The rail remounts this pane on every tab switch and
    // every drawer toggle; without the cache each of those is a request
    // against a per-IP limit that belongs to the reader.
    const fetchMock = fetchReturning([FINDING])
    const first = render(<Pane text={DOCUMENT} />)
    expect(await screen.findByText('Agreement error')).toBeInTheDocument()
    first.unmount()

    render(<Pane text={DOCUMENT} />)
    // Still on screen, so the cache is answering rather than the pane merely
    // declining to ask.
    expect(await screen.findByText('Agreement error')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('checks again once the text has changed', async () => {
    // The key is the text itself, so an edit misses by definition. Without
    // that the cache would be a bug rather than a saving: findings whose
    // offsets index a document that no longer exists.
    const fetchMock = fetchReturning([FINDING])
    const first = render(<Pane text={DOCUMENT} />)
    await screen.findByText('Agreement error')
    first.unmount()

    render(<Pane text={`${DOCUMENT} And then one more sentence.`} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('still checks when storage refuses to answer', async () => {
    // A private window and blocked site data THROW on access rather than
    // returning null, so an unwrapped read would take the pane down with it.
    // Losing the cache costs a request; losing the pane costs the feature.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    const fetchMock = fetchReturning([FINDING])
    render(<Pane text={DOCUMENT} />)
    expect(await screen.findByText('Agreement error')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('remembers a clean document, rather than re-checking every good CV', async () => {
    // `cachedIssues` answers `null` for a miss and `[]` for a real empty
    // result. Conflating the two would exempt exactly the documents that never
    // need checking again.
    const fetchMock = fetchReturning([])
    const first = render(<Pane text={DOCUMENT} />)
    expect(await screen.findByText('no grammar problems found.')).toBeInTheDocument()
    first.unmount()

    render(<Pane text={DOCUMENT} />)
    expect(await screen.findByText('no grammar problems found.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never stores a failed check as an answer', async () => {
    // One failed chunk fails the whole check -- see `useProofread`. Caching
    // that would make a transient rate-limit refusal permanent for this text.
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch
    render(<Pane text={DOCUMENT} />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(window.localStorage.getItem(PROOFREAD_CACHE_KEY)).toBeNull()
  })

  it('costs no request at all for an empty document', async () => {
    const fetchMock = fetchReturning([FINDING])
    render(<Pane text="" />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 're-check' })).toBeInTheDocument()
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
