import type { Editor } from '@tiptap/core'

/**
 * Translating GrammarBot's plain-text offsets into ProseMirror positions.
 *
 * THE TWO COORDINATE SYSTEMS ARE NOT THE SAME, and this is the only file that
 * knows it. `editor.getText()` returns a flat string with blocks joined by a
 * separator; ProseMirror addresses the document by position, which counts node
 * boundaries as well as characters. In a CV with a heading and two paragraphs
 * those numbers have already diverged by the end of the first line.
 *
 * WHY THIS IS NOT A SEARCH-AND-REPLACE. The obvious shortcut is to take the
 * flagged word and `replace()` the first match. It is wrong on exactly the
 * documents people have: a CV that says "manged" twice fixes the wrong one,
 * and a fix for "and" would hit the first of forty. Offsets identify one
 * occurrence and the mapping has to preserve that.
 *
 * THE SEPARATOR MUST MATCH WHAT WAS SENT. The text handed to the checker and
 * the text measured here are the same string or every offset after the first
 * block boundary is wrong, which is why `BLOCK_SEPARATOR` lives here and both
 * callers take it from this file rather than each passing its own default.
 */

/** Tiptap's own default for `getText()`, named so both sides use one value. */
export const BLOCK_SEPARATOR = '\n\n'

interface Segment {
  /** Offset of this text node's first character in the flat string. */
  textFrom: number
  /** ProseMirror position of that same character. */
  posFrom: number
  length: number
}

export interface OffsetMap {
  text: string
  segments: Segment[]
}

/**
 * Walk the document once, recording where each text run lands in both systems.
 *
 * Block separators occupy space in the flat string and no position in the
 * document, so they advance `textCursor` without a segment. Any offset landing
 * inside one is un-addressable, which `toPosition` reports rather than guesses
 * at.
 */
export function buildOffsetMap(editor: Editor): OffsetMap {
  const segments: Segment[] = []
  let text = ''
  let first = true

  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      segments.push({ textFrom: text.length, posFrom: pos, length: node.text.length })
      text += node.text
      return false
    }
    // A right tab is a separator, as `getText()` renders it: without it the
    // checker reads "MIS OfficeJune" as one misspelt word. No segment, so an
    // offset on it is un-addressable like a block separator.
    if (node.type.name === 'rightTab') {
      text += '\t'
      return false
    }
    // A block that is about to contribute text gets a separator before it,
    // but not before the first one -- matching getText()'s own behaviour,
    // which does not lead with a blank line.
    if (node.isBlock && node.content.size > 0) {
      if (!first) text += BLOCK_SEPARATOR
      first = false
    }
    return true
  })

  return { text, segments }
}

/**
 * The ProseMirror position for a flat-text offset, or null if there is none.
 *
 * Null means the offset fell in a block separator -- whitespace that exists in
 * the string and not in the document. Callers must treat that as "cannot apply
 * this one" rather than clamping to a nearby position: clamping would edit
 * text the user never saw flagged.
 */
export function toPosition(map: OffsetMap, offset: number): number | null {
  for (const segment of map.segments) {
    if (offset >= segment.textFrom && offset <= segment.textFrom + segment.length) {
      return segment.posFrom + (offset - segment.textFrom)
    }
  }
  return null
}

/**
 * A ProseMirror range for a flat-text range, or null if either end is
 * un-addressable or the range spans a block boundary.
 *
 * SPANNING A BLOCK IS REFUSED ON PURPOSE. A replacement crossing from one
 * paragraph into the next would delete the boundary and merge them, which is a
 * structural edit to fix a typo. The checker rarely proposes one; when it
 * does, declining is the conservative answer.
 */
export function toRange(
  map: OffsetMap,
  start: number,
  end: number
): { from: number; to: number } | null {
  const from = toPosition(map, start)
  const to = toPosition(map, end)
  if (from === null || to === null || to < from) return null

  const sameSegment = map.segments.some(
    (segment) =>
      start >= segment.textFrom && end <= segment.textFrom + segment.length
  )
  if (!sameSegment) return null

  return { from, to }
}
