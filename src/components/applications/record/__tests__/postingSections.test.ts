import { describe, it, expect } from 'vitest'
import {
  addSection,
  parsePosting,
  removeSection,
  replaceSectionBody,
  sectionTitle,
  serializePosting,
} from '../postingSections'

const POSTING = [
  'We are hiring a frontend engineer in Manila.',
  '',
  'About the role:',
  'You will ship the editor.',
  '- Build things',
  '- Keep the tests green',
  '',
  'Benefits:',
  '- Free coffee',
].join('\n')

describe('parsePosting', () => {
  it('keeps the text before the first heading as its own section', () => {
    // A posting that opens with a paragraph is the common shape, and it has to
    // be editable too -- otherwise the one part with no heading is the one
    // part with no edit control.
    const sections = parsePosting(POSTING)
    expect(sections).toHaveLength(3)
    expect(sections[0].heading).toBeNull()
    expect(sections[0].body).toBe('We are hiring a frontend engineer in Manila.')
    expect(sections[1].heading).toBe('About the role:')
    expect(sections[2].heading).toBe('Benefits:')
  })

  it('holds the body verbatim, glyphs and all', () => {
    // The editor writes one section back and re-serialises the rest. Anything
    // this tidied on the way in would be a silent edit to sections nobody
    // touched.
    expect(parsePosting(POSTING)[1].body).toBe(
      'You will ship the editor.\n- Build things\n- Keep the tests green'
    )
  })

  it('keeps a heading with nothing under it', () => {
    // That is where somebody is about to type. Dropping the empty section
    // would delete the heading out from under them mid-edit.
    const sections = parsePosting('Benefits:\n')
    expect(sections).toHaveLength(1)
    expect(sections[0]).toEqual({ heading: 'Benefits:', body: '' })
  })

  it('does not read a long line ending in a colon as a heading', () => {
    // Same mechanical rule the renderer uses: short, and ends in a colon.
    // Sentences that happen to introduce something are paragraphs.
    const long = `${'x'.repeat(90)}:`
    expect(parsePosting(long)[0].heading).toBeNull()
  })

  it('is empty for an empty posting rather than one blank section', () => {
    expect(parsePosting('   \n  ')).toEqual([])
  })
})

describe('serializePosting', () => {
  it('round-trips, which is what makes editing one section safe for the rest', () => {
    // THE PROPERTY THE WHOLE FEATURE RESTS ON. Every section edit re-writes
    // the entire description; if a round trip were lossy, editing `Benefits`
    // would quietly rewrite `About the role`.
    const once = parsePosting(POSTING)
    expect(parsePosting(serializePosting(once))).toEqual(once)
  })
})

describe('replaceSectionBody', () => {
  it('changes one section and leaves its neighbours byte-identical', () => {
    const sections = parsePosting(POSTING)
    const next = parsePosting(replaceSectionBody(sections, 2, '- Free tea'))

    expect(next[2].body).toBe('- Free tea')
    expect(next[0]).toEqual(sections[0])
    expect(next[1]).toEqual(sections[1])
  })
})

describe('sectionTitle', () => {
  it('drops the colon for display but never from the stored text', () => {
    expect(sectionTitle('About the role:')).toBe('About the role')
  })
})

describe('removeSection', () => {
  it('takes one section out and leaves the rest byte-identical', () => {
    const sections = parsePosting(POSTING)
    const next = parsePosting(removeSection(sections, 1))

    expect(next).toHaveLength(2)
    expect(next[0]).toEqual(sections[0])
    expect(next[1]).toEqual(sections[2])
  })

  it('empties the posting when the last section goes', () => {
    // Which puts the surface back into its paste state rather than leaving an
    // editor with nothing to edit.
    expect(removeSection(parsePosting('Benefits:\n- Coffee'), 0)).toBe('')
  })
})

describe('addSection', () => {
  it('adds a named, empty section and leaves the rest byte-identical', () => {
    const sections = parsePosting(POSTING)
    const next = parsePosting(addSection(sections, 'Benefits'))

    expect(next).toHaveLength(sections.length + 1)
    expect(next.slice(0, sections.length)).toEqual(sections)
    expect(next[sections.length]).toEqual({ heading: 'Benefits:', body: '' })
  })

  it('takes the name as typed, colon or no colon', () => {
    expect(parsePosting(addSection([], 'How to apply:'))[0].heading).toBe('How to apply:')
    expect(parsePosting(addSection([], '  how to   apply  '))[0].heading).toBe('how to apply:')
  })

  it('keeps a long name short enough to still parse as a heading', () => {
    // A heading is only a heading below 80 characters, so a name typed past
    // the cap would come back as a paragraph and the section would vanish
    // into the one above it.
    const sections = parsePosting(addSection([], 'x'.repeat(200)))
    expect(sections).toHaveLength(1)
    expect(sections[0].heading).toBe(`${'x'.repeat(79)}:`)
  })
})
