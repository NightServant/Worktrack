import { describe, it, expect } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { personalizeTemplate } from '../templatePersonalization'
import { EMPTY_PROFILE, type UserProfile } from '../profile'
import { WORD_TEMPLATES, COVER_LETTER_TEMPLATES } from '../resumeTemplateService'

/**
 * The two promises `personalizeTemplate` makes, and the one it must never
 * break.
 *
 *   1. A connected profile puts the user's own details in the document.
 *   2. NO profile still produces a readable document -- every token falls back
 *      to the template's own wording.
 *
 * The one it must never break is that no `{{` reaches a person. That is the
 * same failure `noPlaceholderCopy.test.ts` was written for, in different
 * punctuation, and it is asserted against every shipped template rather than
 * against a fixture -- a template added later with a token nobody implemented
 * is exactly the way this regresses, and a hand-written fixture would not
 * notice.
 */

const FULL: UserProfile = {
  ...EMPTY_PROFILE,
  name: 'Gabriel Santos',
  headline: 'Frontend Engineer',
  location: 'Manila, Philippines',
  email: 'gabriel@example.com',
  summary: 'Builds web applications, mostly React and Postgres.',
  url: 'linkedin.com/in/gabrielsantos',
  industry: 'Software Development',
  websites: ['gabrielsantos.dev'],
  experiences: [
    {
      title: 'Frontend Engineer',
      company: 'Northwind',
      period: 'Jan 2024 - Present',
      location: 'Remote',
      description: 'Rebuilt the checkout flow.\n- Cut load time by 40 percent.',
    },
    {
      title: 'Junior Developer',
      company: 'Harbour Labs',
      period: 'Jun 2022 - Dec 2023',
      location: 'Manila',
      description: null,
    },
  ],
  education: [
    {
      school: 'University of the Philippines',
      degree: 'BS Computer Science',
      period: '2018 - 2022',
      graduationYear: '2022',
    },
  ],
  skills: ['TypeScript', 'React', 'PostgreSQL', 'Patient Care', 'Leadership'],
  certifications: [
    {
      name: 'AWS Certified Developer',
      authority: 'Amazon Web Services',
      period: 'Issued Mar 2024 · Expires Mar 2027',
      issued: 'Mar 2024',
      expires: 'Mar 2027',
      credentialId: 'AWS-1234',
      url: 'https://example.org/verify/AWS-1234',
    },
  ],
  projects: [
    {
      title: 'Worktrack',
      description: 'A job search tracker.',
      url: 'worktrack.app',
      highlights: [
        'Tracks every application from first contact through to an offer.',
        'Renders a tailored CV as PDF, DOCX and LaTeX from one document.',
      ],
      tech: ['TypeScript', 'Next.js'],
      language: 'TypeScript',
      stars: 12,
      homepage: null,
      updatedAt: null,
    },
  ],
}

/** Every string in the tree, joined -- what a reader would actually see. */
function allText(node: JSONContent): string {
  if (typeof node.text === 'string') return node.text
  return (node.content ?? []).map(allText).join('\n')
}

function doc(...content: JSONContent[]): JSONContent {
  return { type: 'doc', content }
}

function heading(level: number, label: string): JSONContent {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text: label }] }
}

function para(label: string): JSONContent {
  return { type: 'paragraph', content: [{ type: 'text', text: label }] }
}

describe('scalar tokens', () => {
  it('substitutes the profile value when there is one', () => {
    const out = personalizeTemplate(doc(para('{{name|Your Name}} - {{headline|Your Title}}')), FULL)
    expect(allText(out)).toBe('Gabriel Santos - Frontend Engineer')
  })

  it('falls back to the template wording when the field is null', () => {
    // The whole reason the fallback is inline rather than a lookup table: a
    // user who has connected nothing must still get a readable document, not
    // a document with holes in it.
    const out = personalizeTemplate(doc(para('{{name|Your Name}} - {{headline|Your Title}}')), EMPTY_PROFILE)
    expect(allText(out)).toBe('Your Name - Your Title')
  })

  it('splits on the first pipe, so a fallback may contain more pipes', () => {
    const out = personalizeTemplate(doc(para('{{summary|Languages: | Frameworks: | Tools:}}')), EMPTY_PROFILE)
    expect(allText(out)).toBe('Languages: | Frameworks: | Tools:')
  })

  it('deletes a token nobody implemented rather than showing it', () => {
    // No fallback AND no value is the only case that can produce a visible
    // `{{`, so it is the case that has to be proven gone.
    const out = personalizeTemplate(doc(para('Contact {{nosuchtoken}}here')), FULL)
    expect(allText(out)).toBe('Contact here')
    expect(allText(out)).not.toContain('{{')
  })

  it('drops a text node that substitutes down to nothing', () => {
    // ProseMirror rejects an empty text node outright, so the editor would
    // throw on a document this function had just handed it.
    const out = personalizeTemplate(doc(para('{{nosuchtoken}}')), FULL)
    expect(out.content?.[0].content ?? []).toEqual([])
  })

  it('dates the document, with or without a profile', () => {
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    expect(allText(personalizeTemplate(doc(para('{{today}}')), EMPTY_PROFILE))).toBe(today)
  })
})

describe('section expansion', () => {
  const template = doc(
    heading(2, 'Professional Experience'),
    para('Job Title | Company Name'),
    { type: 'bulletList', content: [{ type: 'listItem', content: [para('Achievement')] }] },
    heading(2, 'Skills'),
    para('Languages: | Frameworks:')
  )

  it('produces one block per profile entry', () => {
    const out = personalizeTemplate(template, FULL)
    const text = allText(out)
    expect(text).toContain('Frontend Engineer | Northwind')
    expect(text).toContain('Jan 2024 - Present | Remote')
    expect(text).toContain('Junior Developer | Harbour Labs')
    expect(text).not.toContain('Job Title | Company Name')
  })

  it('turns the description into bullets and strips the glyph the user typed', () => {
    // The export carries whatever marker the person put in LinkedIn, and the
    // text goes into a bulletList that draws its own -- so "• - Cut load time".
    const out = personalizeTemplate(template, FULL)
    expect(allText(out)).toContain('Cut load time by 40 percent.')
    expect(allText(out)).not.toContain('- Cut load time')
  })

  it('stops at the next heading of the same level', () => {
    // The bug this guards: an expansion that runs to the end of the document
    // eats every following section, and the CV comes out with one heading.
    const out = personalizeTemplate(template, FULL)
    const headings = (out.content ?? []).filter((node) => node.type === 'heading').map(allText)
    expect(headings).toEqual(['Professional Experience', 'Skills'])
    // GROUPED, NOT ONE PARAGRAPH (Gabe, 2026-09-19). The heading is bold and
    // inline so it cannot outrank the section headings around it.
    expect(allText(out)).toContain('Programming Languages')
    expect(allText(out)).toContain('TypeScript')
  })

  it('files each skill under a heading, across careers rather than one stack', () => {
    // The classification is not a developer's: the same table has to put
    // `Patient Care` and `Leadership` somewhere sensible for somebody who
    // writes no code at all.
    const out = allText(personalizeTemplate(template, FULL))
    expect(out).toContain('Clinical & Healthcare: ')
    expect(out).toContain('Communication & Leadership: ')
    expect(out).not.toContain('TypeScript, React, PostgreSQL, Patient Care')
  })

  it('writes the certificate dates and its credential number', () => {
    // Gabe, 2026-09-19: a certificate is a name, an issuer, a date and the
    // number that proves it, and only the first two ever reached a CV.
    const out = allText(
      personalizeTemplate(doc(heading(2, 'Licenses & Certifications'), para('specimen')), FULL)
    )
    expect(out).toContain('AWS Certified Developer | Amazon Web Services')
    expect(out).toContain('Issued Mar 2024')
    expect(out).toContain('Credential ID AWS-1234')
  })

  it('builds project bullets from the README rather than one line', () => {
    const out = allText(personalizeTemplate(doc(heading(2, 'Projects'), para('specimen')), FULL))
    expect(out).toContain('Tracks every application from first contact through to an offer.')
    expect(out).toContain('TypeScript, Next.js')
  })

  it('leaves the specimen block alone when the profile has no entries', () => {
    // An empty section is a heading over nothing, which reads as a bug. The
    // example the template shipped with is the better answer.
    const out = personalizeTemplate(template, { ...FULL, experiences: [] })
    expect(allText(out)).toContain('Job Title | Company Name')
    expect(allText(out)).toContain('Achievement')
  })

  it('matches the wording variants the six CV templates actually use', () => {
    const variants = doc(heading(2, 'Work Experience'), para('specimen'), heading(2, 'Tech Skills'), para('specimen'))
    const out = personalizeTemplate(variants, FULL)
    expect(allText(out)).toContain('Frontend Engineer | Northwind')
    expect(allText(out)).toContain('Programming Languages')
  })
})

describe('the input tree', () => {
  it('is never mutated', () => {
    // WORD_TEMPLATES is a module-level constant shared by every caller in the
    // process. Writing through it would personalise the template itself and
    // hand the next user the previous user's name.
    const template = doc(para('{{name|Your Name}}'), heading(2, 'Education'), para('Degree, School'))
    const before = JSON.stringify(template)
    personalizeTemplate(template, FULL)
    expect(JSON.stringify(template)).toBe(before)
  })
})

describe('every shipped template', () => {
  const templates = [...WORD_TEMPLATES, ...COVER_LETTER_TEMPLATES]

  it.each(templates.map((t) => [t.id, t] as const))('%s leaves no token behind, full profile', (_id, template) => {
    expect(allText(personalizeTemplate(template.content, FULL))).not.toContain('{{')
  })

  it.each(templates.map((t) => [t.id, t] as const))('%s leaves no token behind, no profile', (_id, template) => {
    expect(allText(personalizeTemplate(template.content, EMPTY_PROFILE))).not.toContain('{{')
  })

  it('puts the user in every one of them', () => {
    // Cheap proof that the tokens are actually wired rather than merely absent:
    // a template with no tokens at all would pass the two checks above.
    for (const template of templates) {
      expect(allText(personalizeTemplate(template.content, FULL)), template.id).toContain('Gabriel Santos')
    }
  })

  it('offers five cover letters, and they are letters rather than CVs', () => {
    expect(COVER_LETTER_TEMPLATES).toHaveLength(5)
    for (const letter of COVER_LETTER_TEMPLATES) {
      expect(letter.mode).toBe('cover_letter')
      const text = allText(personalizeTemplate(letter.content, FULL))
      // A letter has a salutation and a sign-off; a CV has neither.
      expect(text, letter.id).toMatch(/Dear /)
      expect(text, letter.id).toMatch(/sincerely|regards/i)
      expect(letter.content.content?.some((node) => node.type === 'heading'), letter.id).toBeFalsy()
    }
  })
})
