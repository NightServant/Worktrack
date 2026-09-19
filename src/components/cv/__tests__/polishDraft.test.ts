import { describe, it, expect } from 'vitest'
import { templateContentFor } from '../usePolishDraft'
import { WORD_TEMPLATES, COVER_LETTER_TEMPLATES } from '@/services/resumeTemplateService'

/**
 * The half of the AI polish pass that is a pure function.
 *
 * WHY IT MATTERS THAT THIS CANNOT RETURN THE WRONG THING: the template it
 * resolves is re-personalised and SAVED OVER the document that was just
 * created. A wrong template here does not degrade the polish, it replaces
 * somebody's CV with a different one -- so an id this build does not have must
 * resolve to null, and null is what keeps the skeleton from ever being shown.
 */
describe('resolving the template a draft came from', () => {
  it('finds every shipped CV template by its own id', () => {
    for (const template of WORD_TEMPLATES) {
      expect(templateContentFor(template.id, 'word')).toEqual(template.content)
    }
  })

  it('finds every shipped cover letter template too', () => {
    for (const template of COVER_LETTER_TEMPLATES) {
      expect(templateContentFor(template.id, 'cover_letter')).toEqual(template.content)
    }
  })

  it('resolves the from-scratch starters by kind', () => {
    // `blank` is one id for two documents, and the mode is what tells them
    // apart -- a letter polished against the CV skeleton would come back as a
    // CV.
    const cv = templateContentFor('blank', 'word')
    const letter = templateContentFor('blank', 'cover_letter')
    expect(cv).toBeTruthy()
    expect(letter).toBeTruthy()
    expect(cv).not.toEqual(letter)
  })

  it('returns null for an id this build does not have', () => {
    // A `?polish=` naming a template that has been renamed or removed is not a
    // reason to hold a skeleton over somebody's document, and it is certainly
    // not a reason to overwrite it with whatever happened to be first.
    expect(templateContentFor('word-from-a-later-release', 'word')).toBeNull()
    expect(templateContentFor('', 'word')).toBeNull()
  })
})

