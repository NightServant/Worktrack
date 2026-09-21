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

  it('writes each skill group as a sentence, not a comma list', () => {
    // Gabe, 2026-09-19: "just list skills as categories". `Frontend & UI:
    // React, Next.js` names things; a sentence says what is done with them.
    const out = allText(personalizeTemplate(template, FULL))
    // `allText` puts a newline between nodes, so the bold label and the
    // sentence after it are asserted apart.
    expect(out).toContain('Programming Languages: ')
    expect(out).toContain('Writes TypeScript, used in Worktrack.')
    expect(out).toContain('Builds interfaces with React.')
    // THE VERBS CLAIM USE, NEVER PROFICIENCY.
    expect(out).not.toMatch(/Expert|Solid command|Proficient/)
  })

  it('names the projects a group of skills was actually used in', () => {
    // "does not apply skills to notable projects" -- the join the reader was
    // being left to make. Matched on the repository's own declared stack.
    const out = allText(personalizeTemplate(template, FULL))
    expect(out).toContain('used in Worktrack')
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
  })

  it('opens a project with a sentence that names what it was built with', () => {
    // Gabe, 2026-09-19: "does not generate proper sentences ... does not apply
    // skills to notable projects". A README's bullets are noun phrases, so the
    // verb has to live in a lead the app composes -- and that lead is where
    // the stack stops being a bare `TypeScript |` line beside the title.
    const out = allText(personalizeTemplate(doc(heading(2, 'Projects'), para('specimen')), FULL))
    expect(out).toContain('A job search tracker, built with TypeScript and Next.js.')
  })

  it('leaves the author’s own bullet wording alone, and only punctuates it', () => {
    // Prefixing a verb is the obvious way to make a fragment a sentence, and
    // it changes the meaning: "Applications with company, role" becomes "Built
    // applications with company, role", which the author never said. Tested
    // against real repositories before it was ruled out.
    const out = allText(
      personalizeTemplate(doc(heading(2, 'Projects'), para('specimen')), {
        ...FULL,
        projects: [
          {
            ...FULL.projects[0],
            highlights: ['Applications with company, role and salary range'],
          },
        ],
      })
    )
    expect(out).toContain('Applications with company, role and salary range.')
    expect(out).not.toContain('Built applications with')
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

/**
 * The contact line, which is the part of a CV that is entirely facts the app
 * already holds -- and which was printing somebody else's specimen values
 * (Gabe, 2026-09-21, with a screenshot: "profile links for various sources
 * such as linkedin and github, contact number, birth date, and email are not
 * rendered in the CV itself").
 *
 * FOUR SEPARATE CAUSES WEARING ONE SYMPTOM, which is why this block exists
 * rather than one more assertion above:
 *
 *   `phone` was hardcoded to null, from when no source could supply one.
 *   `email` was only ever written by a parser, and no public profile
 *     publishes an address -- settled in `userProfileService`, tested there.
 *   `github` had no token at all, so the address the person typed at
 *     registration could not reach a document.
 *   `birthday` had no token either.
 */
const CONNECTED: UserProfile = {
  ...EMPTY_PROFILE,
  name: 'Elijah Gabe Cervantes',
  location: 'Bamban, Central Luzon, Philippines',
  email: 'gabe@example.com',
  phone: '+63 928 284 4172',
  phoneType: 'mobile',
  birthday: '1999-03-07',
  url: 'linkedin.com/in/parsed-by-a-scraper',
  sources: [
    {
      url: 'https://www.linkedin.com/in/elijah-gabe-cervantes-0252b4340/',
      site: 'LinkedIn',
      ok: true,
      note: null,
      warnings: [],
      via: 'apify',
    },
    {
      url: 'https://github.com/TeckyGabby',
      site: 'GitHub',
      ok: true,
      note: null,
      warnings: [],
      via: 'github',
    },
  ],
}

/** The screenshot's own template line, verbatim. */
const CONTACT_LINE =
  '{{location|Location}} | {{phone|+1 (555) 123-4567}} | {{email|email@example.com}} | {{linkedin|linkedin.com/in/profile}} | {{website|github.com/profile}} | {{birthday}}'

describe('the contact line', () => {
  it('prints every detail the app holds instead of the specimen values', () => {
    const out = allText(personalizeTemplate(doc(para(CONTACT_LINE)), CONNECTED))
    expect(out).toBe(
      'Bamban, Central Luzon, Philippines | +63 928 284 4172 | gabe@example.com | ' +
        'linkedin.com/in/elijah-gabe-cervantes-0252b4340 | ' +
        'github.com/TeckyGabby | March 7, 1999'
    )
    // The three that were on the screenshot, named so a regression says which.
    expect(out).not.toContain('(555) 123-4567')
    expect(out).not.toContain('email@example.com')
    expect(out).not.toContain('github.com/profile')
  })

  it('prefers the address the person typed over the one a parser wrote', () => {
    // `profile.url` is whatever a scraper put there; `sources` is what was
    // entered at registration, and it is the one a reader can vouch for.
    const out = allText(personalizeTemplate(doc(para('{{linkedin|none}}')), CONNECTED))
    expect(out).toBe('linkedin.com/in/elijah-gabe-cervantes-0252b4340')
  })

  it('still falls back to a parsed LinkedIn URL when no source was entered', () => {
    const parsedOnly = { ...CONNECTED, sources: [] }
    expect(allText(personalizeTemplate(doc(para('{{linkedin|none}}')), parsedOnly))).toBe(
      'linkedin.com/in/parsed-by-a-scraper'
    )
  })

  it('does not print an address that could not be read', () => {
    // A failed link stays in `sources` because the settings panel has to say
    // which one failed. Printing it on a CV would publish an address nobody
    // has checked leads anywhere.
    const failed: UserProfile = {
      ...CONNECTED,
      sources: [{ ...CONNECTED.sources[1], ok: false, note: 'that page refused' }],
    }
    expect(allText(personalizeTemplate(doc(para('{{github}}')), failed))).toBe('')
  })

  it('uses a real personal site over GitHub, and GitHub when there is none', () => {
    const withSite = { ...CONNECTED, websites: ['cervantes.dev'] }
    expect(allText(personalizeTemplate(doc(para('{{website|x}}')), withSite))).toBe('cervantes.dev')
    expect(allText(personalizeTemplate(doc(para('{{website|x}}')), CONNECTED))).toBe(
      'github.com/TeckyGabby'
    )
  })

  it('takes the stranded separator with an empty birthday', () => {
    /*
      THE REASON `{{birthday}}` CARRIES NO FALLBACK. A date of birth belongs on
      a CV in some markets and on no CV at all in others, so a bracketed prompt
      would be this app suggesting one. Empty it has to leave no trace -- a
      line ending in a bare `|` looks like the document broke.
    */
    const out = allText(personalizeTemplate(doc(para(CONTACT_LINE)), EMPTY_PROFILE))
    expect(out).toBe(
      'Location | +1 (555) 123-4567 | email@example.com | linkedin.com/in/profile | github.com/profile'
    )
    expect(out).not.toContain('||')
    expect(out.trim().endsWith('|')).toBe(false)
  })

  it('reads a birthday as a local date, not a UTC instant', () => {
    // `new Date('1999-03-07')` is UTC midnight and prints the 6th west of
    // Greenwich -- a wrong fact on a document somebody sends to an employer.
    expect(allText(personalizeTemplate(doc(para('{{birthday}}')), CONNECTED))).toBe('March 7, 1999')
  })

  it('prints what LinkedIn published when there is no entered date', () => {
    const noYear = { ...CONNECTED, birthday: null, birthDate: 'Mar 7' }
    expect(allText(personalizeTemplate(doc(para('{{birthday}}')), noYear))).toBe('Mar 7')
  })

  it('leaves a pipe inside somebody’s own prose alone', () => {
    // `tidySeparators` re-spaces what it touches, so it must only touch a line
    // the TEMPLATE built out of separators -- not a summary that has one in it.
    const prose = { ...EMPTY_PROFILE, summary: 'Ships fast | writes tests' }
    // The full stop is `professionalSummary` ending a sentence, which is its
    // job. What matters here is that the pipe and the spaces around it are
    // exactly where the person put them.
    expect(allText(personalizeTemplate(doc(para('{{summary|x}}')), prose))).toBe(
      'Ships fast | writes tests.'
    )
  })
})

describe('every shipped template carries the details the app holds', () => {
  it('puts the phone, the links and the birthday on every CV and letter', () => {
    /*
      ASSERTED ACROSS THE SHIPPED SET rather than a fixture, for the same
      reason the `{{` check above is: a template added later with a sender
      block that forgets these is exactly how this regresses, and a fixture
      would not notice.
    */
    for (const template of [...WORD_TEMPLATES, ...COVER_LETTER_TEMPLATES]) {
      const text = allText(personalizeTemplate(template.content, CONNECTED))
      expect.soft(text, `${template.name}: phone`).toContain('+63 928 284 4172')
      expect.soft(text, `${template.name}: email`).toContain('gabe@example.com')
      expect.soft(text, `${template.name}: birthday`).toContain('March 7, 1999')
      expect
        .soft(text, `${template.name}: a profile link`)
        .toMatch(/linkedin\.com\/in\/elijah-gabe|github\.com\/TeckyGabby/)
    }
  })
})
