import { describe, it, expect } from 'vitest'
import { letterFit } from '../letterFit'

/**
 * Gabe, 2026-10-01: "Letter tailoring should not implement the ATS scoring.
 * Implement appropriate scoring." These pin what the letter is scored on --
 * written to this company, for this role, finished, answering the posting,
 * backed by evidence, one page, asking for a next step -- and that the score
 * is the share of those, not a keyword proportion.
 */

const POSTING =
  'We are hiring a Frontend Engineer to build React and TypeScript interfaces, write tests, and work with designers in Figma.'

const READY = [
  'Dear Hiring Manager,',
  'I am applying for the Frontend Engineer role at Initech, which I found on LinkedIn. The work you describe, building React and TypeScript interfaces with designers, is the work I already do every week and would like to keep doing with a team like yours.',
  'In my most recent role, as Frontend Engineer at Northwind, I rebuilt the checkout flow in React and TypeScript with our designers in Figma. The clearest result of that was a 40 percent cut in load time across 12 pages, measured over three months. Before that I worked as Junior Developer at Harbour Labs, where I learned to write tests before shipping anything.',
  'Initech interests me because your product is one I use myself, and the problems your team has written about publicly are ones I have already solved once and would like to solve properly a second time.',
  'I would welcome the chance to talk about the role in an interview, and I can make myself available at short notice. Thank you for your time.',
  'Yours sincerely,',
  'Gabriel Santos',
].join('\n\n')

describe('letterFit', () => {
  it('scores a finished letter for this posting at 100, with every check passed', () => {
    const fit = letterFit({ text: READY, company: 'Initech', role: 'Frontend Engineer', description: POSTING })
    expect(fit.checks.filter((check) => !check.passed).map((check) => check.label)).toEqual([])
    expect(fit.score).toBe(100)
  })

  it('fails the letter that was written to somebody else', () => {
    const fit = letterFit({ text: READY, company: 'Globex', role: 'Data Analyst', description: POSTING })
    const failed = fit.checks.filter((check) => !check.passed).map((check) => check.id)
    expect(failed).toEqual(['company', 'role'])
    expect(fit.score).toBe(71)
  })

  it('counts the brackets still to fill, and names the first', () => {
    const fit = letterFit({
      text: READY.replace('Initech interests me', '[Company] interests me').replace('40 percent', '[the outcome]'),
      company: 'Initech',
      role: 'Frontend Engineer',
      description: POSTING,
    })
    const placeholders = fit.checks.find((check) => check.id === 'placeholders')!
    expect(placeholders.passed).toBe(false)
    expect(placeholders.detail).toBe('2 prompts are still in brackets, starting with [the outcome].')
  })

  it('reads the role as a person writes it, without the board’s parenthetical', () => {
    const fit = letterFit({
      text: READY,
      company: 'Initech',
      role: 'Frontend Engineer (Open for Fresh Graduates)',
      description: POSTING,
    })
    expect(fit.checks.find((check) => check.id === 'role')!.passed).toBe(true)
  })

  it('says what the posting asks for when the letter does not answer it', () => {
    const fit = letterFit({
      text: 'Dear Hiring Manager, I would like the Frontend Engineer job at Initech. Thank you.',
      company: 'Initech',
      role: 'Frontend Engineer',
      description: POSTING,
    })
    const posting = fit.checks.find((check) => check.id === 'posting')!
    expect(posting.passed).toBe(false)
    expect(posting.detail).toMatch(/It asks for /)
  })

  it('shares the letter check’s rules rather than restating them', () => {
    // A two-line letter is too short for one page: the letter check says so,
    // and this score agrees.
    const fit = letterFit({ text: 'Dear Initech, hire me.', company: 'Initech', role: 'Engineer', description: POSTING })
    expect(fit.checks.find((check) => check.id === 'length')!.passed).toBe(false)
  })
})
