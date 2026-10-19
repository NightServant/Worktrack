import { describe, it, expect } from 'vitest'
import { fillLetter, fillLetterText } from '../fillLetter'
import { makeJob } from '@/test/fixtures'

/**
 * Gabe, 2026-10-19: "Once the letter is tailored to a specific job and
 * company, update the date, replace the prompt brackets with real information
 * immediately because I keep hitting the free tier limit." Everything the
 * application already knows is filled locally, before any model call, so a
 * run the model cannot answer still leaves no [Company] behind.
 */
const job = makeJob({
  id: 'j1',
  status: 'wishlist',
  company: 'Acme Corp',
  role: 'Frontend Engineer',
  source: 'LinkedIn',
  contact_name: null,
  is_referral: false,
})
const today = new Date(2026, 9, 19)

describe('fillLetterText', () => {
  it('fills the company, the role and where the posting was found', () => {
    expect(
      fillLetterText('The [role] advertised on [where you found it] at [Company] fits me.', { job, today })
    ).toBe('The Frontend Engineer advertised on LinkedIn at Acme Corp fits me.')
    expect(fillLetterText('I would like to join [Company Name].', { job, today })).toBe(
      'I would like to join Acme Corp.'
    )
  })

  it('greets the contact by name, or the hiring manager when there is none', () => {
    expect(fillLetterText('Dear [hiring manager name],', { job, today })).toBe('Dear Hiring Manager,')
    const withContact = { ...job, contact_name: 'Maria Santos' }
    expect(fillLetterText('Dear [name, if you have it, otherwise Hiring Manager],', { job: withContact, today })).toBe(
      'Dear Maria Santos,'
    )
  })

  it('names a referrer only when the application is a referral', () => {
    const referred = { ...job, is_referral: true, contact_name: 'Jose Cruz' }
    expect(fillLetterText('[Referrer full name] suggested I write.', { job: referred, today })).toBe(
      'Jose Cruz suggested I write.'
    )
    expect(fillLetterText('[Referrer full name] suggested I write.', { job: { ...job, contact_name: 'Jose Cruz' }, today })).toBe(
      '[Referrer full name] suggested I write.'
    )
  })

  it("leaves the writer's own placeholders alone: they are not the application's", () => {
    // "[employer]" and "[your job title]" are the WRITER's, not the company
    // being applied to, and "[the result, with a number]" is only theirs to say.
    const text = 'At [employer] as [your job title] I delivered [the result, with a number].'
    expect(fillLetterText(text, { job, today })).toBe(text)
  })

  it('leaves a placeholder the application cannot answer', () => {
    const noSource = { ...job, source: null }
    expect(fillLetterText('advertised on [where you found it]', { job: noSource, today })).toBe(
      'advertised on [where you found it]'
    )
  })

  it('moves a date line to today, in the format it was written in', () => {
    expect(fillLetterText('Gabe\n\nSeptember 2, 2026\n\nDear Hiring Manager,', { job, today })).toBe(
      'Gabe\n\nOctober 19, 2026\n\nDear Hiring Manager,'
    )
    expect(fillLetterText('2 September 2026', { job, today })).toBe('19 October 2026')
  })

  it('does not touch a date inside a sentence', () => {
    const text = 'I graduated on July 30, 2026 with honours.'
    expect(fillLetterText(text, { job, today })).toBe(text)
  })

  it('matches placeholders whatever their case and inner spacing', () => {
    expect(fillLetterText('[ company ] and [ROLE]', { job, today })).toBe('Acme Corp and Frontend Engineer')
  })
})

describe('fillLetter (the document)', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'September 2, 2026' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Dear ' },
          { type: 'text', text: '[hiring manager name]', marks: [{ type: 'bold' }] },
          { type: 'text', text: ',' },
        ],
      },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Why [Company]' }] }] }] },
    ],
  }

  it('fills every text node, marks kept, lists included', () => {
    const filled = fillLetter(doc, { job, today }) as typeof doc
    expect(filled.content[0].content![0]).toEqual({ type: 'text', text: 'October 19, 2026' })
    expect(filled.content[1].content![1]).toEqual({ type: 'text', text: 'Hiring Manager', marks: [{ type: 'bold' }] })
    expect(JSON.stringify(filled.content[2])).toContain('Why Acme Corp')
  })

  it('returns the SAME object when there was nothing to fill', () => {
    // How the caller tells a fill that changed nothing from one that did.
    const plain = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello.' }] }] }
    expect(fillLetter(plain, { job, today })).toBe(plain)
  })
})
