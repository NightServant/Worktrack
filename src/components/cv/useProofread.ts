'use client'

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import {
  LANGUAGETOOL_ENDPOINT,
  cacheIssues,
  cachedIssues,
  chunkText,
  splitByCategory,
  toIssues,
  type GrammarIssue,
} from '@/services/grammar'
import { BLOCK_SEPARATOR, buildOffsetMap, toRange } from './editorOffsets'
import { proofreadScore, type ProofreadScore } from './proofreadScore'

/**
 * Running the checker over the open document, and applying what it finds.
 *
 * ONE REQUEST FEEDS ALL THREE CATEGORIES, held here rather than in any pane,
 * because LanguageTool returns spelling, grammar and style together. Panes
 * owning their own fetch would check the same CV three times per pass.
 *
 * CALLED STRAIGHT FROM THE BROWSER, with no route in between. LanguageTool's
 * public endpoint is keyless and sends `access-control-allow-origin: *`
 * (verified 2026-09-11), so there is no secret to hide and nothing for a proxy
 * to do. Routing it through the server would actively hurt: the free tier is
 * rate limited PER IP, and every user sharing one server address is a far
 * lower ceiling than each using their own.
 *
 * AND SINCE 2026-09-17 IT IS NOT CALLED AT ALL FOR A DOCUMENT ALREADY
 * CHECKED. The pane runs this on mount rather than on a press, so the request
 * boundary needed a cache before the automatic run was safe: `services/grammar`
 * keeps a completed pass against the exact text it ran on, and `run` answers
 * from it when the document has not been edited. The failure it prevents is
 * silent -- the free endpoint just stops answering, and the pane reports that
 * the checker could not be reached.
 *
 * THE ISSUE LIST IS CLEARED THE MOMENT ONE IS APPLIED, and that is the
 * important rule in this file rather than a tidiness preference. Every offset
 * after an accepted edit has moved by the length difference, so the remaining
 * issues are stale immediately -- applying a second one from the same list
 * would cut at the wrong index and corrupt the document. `services/grammar`
 * guards the clamp; this guarantees the situation does not arise.
 *
 * IGNORED WORDS ARE PER-SESSION AND NOT PERSISTED. "Ignore all" and "add to
 * dictionary" are the same operation here, which is honest: a real custom
 * dictionary belongs on the user row so it survives a reload, and pretending a
 * `useState` Set is one would lose somebody's dictionary silently. The pane
 * labels the button for what it does.
 */

export interface ProofreadState {
  running: boolean
  ran: boolean
  error: string | null
  grammar: GrammarIssue[]
  style: GrammarIssue[]
  score: ProofreadScore
  /** Words the user has dismissed this session. */
  ignored: ReadonlySet<string>
  run: () => Promise<void>
  apply: (issue: GrammarIssue, replacement: string) => void
  ignore: (issue: GrammarIssue) => void
  ignoreAll: (issue: GrammarIssue) => void
  /** The document text the current issues were computed against. */
  text: string
}

const EMPTY_SCORE: ProofreadScore = { value: 100, grammar: 0, style: 0, words: 0 }

export function useProofread(editor: Editor | null): ProofreadState {
  const [running, setRunning] = React.useState(false)
  const [ran, setRan] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [issues, setIssues] = React.useState<GrammarIssue[]>([])
  const [text, setText] = React.useState('')
  const [ignored, setIgnored] = React.useState<Set<string>>(new Set())

  const wordFor = React.useCallback(
    (issue: GrammarIssue, source: string) =>
      source.slice(issue.start, issue.end).trim().toLowerCase(),
    []
  )

  const run = React.useCallback(async () => {
    if (!editor) return
    const current = editor.getText({ blockSeparator: BLOCK_SEPARATOR })

    /**
     * THE CACHE IS CONSULTED BEFORE THE REQUEST, WHICH IS WHAT MAKES THE
     * AUTOMATIC RUN AFFORDABLE. `GrammarCheckPane` calls this on mount now
     * rather than waiting for a press, and the pane mounts again on every
     * remount and every trip back to the grammar tab; without this line each
     * of those would be a fresh request against a per-IP limit that is the
     * reader's own. `services/grammar` documents the key, the eviction and
     * what happens when storage refuses the write.
     *
     * NO SPINNER ON THE WAY THROUGH: this returns before `setRunning(true)`,
     * so a hit shows the findings rather than flashing "checking" at somebody
     * for a synchronous read.
     */
    const cached = cachedIssues(current)
    if (cached) {
      setIssues(cached)
      setText(current)
      setRan(true)
      setError(null)
      return
    }

    setRunning(true)
    setError(null)
    try {
      const chunks = chunkText(current)
      // Sent in parallel; document order is restored by sorting on position.
      // A CV is a handful of requests at most, and serialising them would
      // multiply one round trip by the page count for no benefit.
      const responses = await Promise.all(
        chunks.map(async (chunk) => {
          const body = new URLSearchParams({ language: 'en-US', text: chunk.text })
          const response = await fetch(LANGUAGETOOL_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
          })
          if (!response.ok) throw new Error(String(response.status))
          return toIssues(await response.json(), chunk.offset)
        })
      )

      const fresh = responses.flat()
      // CACHED ONLY ON A COMPLETE PASS. The catch below treats one failed
      // chunk as a failed check; storing a partial result here would make that
      // decision permanent for this text, and "3 problems" over a document
      // with more reads as a clean bill of health.
      cacheIssues(current, fresh)
      setIssues(fresh)
      setText(current)
      setRan(true)
    } catch {
      // ONE FAILED CHUNK FAILS THE CHECK. Showing the issues from four chunks
      // out of five presents a partial result as a complete one, and "3
      // problems" over a document with more reads as a clean bill of health.
      setError(
        'Could not reach the language checker. It is rate limited, so a long ' +
          'document checked repeatedly may need a moment.'
      )
      setIssues([])
    } finally {
      setRunning(false)
    }
  }, [editor])

  const apply = React.useCallback(
    (issue: GrammarIssue, replacement: string) => {
      if (!editor) return
      const map = buildOffsetMap(editor)
      const range = toRange(map, issue.start, issue.end)
      // Null means the range crosses a block boundary or landed in a
      // separator. Declining is correct; guessing at a nearby position would
      // edit text the user never saw flagged.
      if (!range) {
        setError('That correction spans a paragraph break and was not applied.')
        return
      }

      editor
        .chain()
        .focus()
        .insertContentAt({ from: range.from, to: range.to }, replacement)
        .run()

      // Every remaining offset is now wrong. See the docblock.
      setIssues([])
      setRan(false)
    },
    [editor]
  )

  const ignore = React.useCallback((issue: GrammarIssue) => {
    setIssues((current) => current.filter((candidate) => candidate !== issue))
  }, [])

  const ignoreAll = React.useCallback(
    (issue: GrammarIssue) => {
      const word = wordFor(issue, text)
      if (!word) return
      setIgnored((current) => new Set(current).add(word))
    },
    [text, wordFor]
  )

  const visible = React.useMemo(
    () => issues.filter((issue) => !ignored.has(wordFor(issue, text))),
    [issues, ignored, text, wordFor]
  )

  const { grammar, style } = React.useMemo(() => splitByCategory(visible), [visible])

  const score = React.useMemo(
    () => (ran ? proofreadScore(text, visible) : EMPTY_SCORE),
    [ran, text, visible]
  )

  return {
    running,
    ran,
    error,
    grammar,
    style,
    score,
    ignored,
    run,
    apply,
    ignore,
    ignoreAll,
    text,
  }
}
