import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { LetterFitSection } from '../LetterFitPanel'
import { letterFit } from '../letterFit'

afterEach(() => cleanup())

/**
 * The redesigned readiness pane (Gabe, 2026-10-01: "Redesign the specific
 * section following UI/UX principles ... add visual indicators such as graphs
 * if needed"). What these pin is that the picture says the same thing as the
 * checks: one cell per check, filled exactly when it passes, in the group the
 * check belongs to.
 */

const POSTING = 'We need React, TypeScript, Laravel, PHP, Docker and Git experience. Write tests.'

const SHORT = 'Dear Hiring Manager, I would like the Junior Developer job at Initech. Thank you.'

function fitFor(text: string) {
  return letterFit({ text, company: 'Initech', role: 'Junior Developer', description: POSTING })
}

describe('the readiness meter', () => {
  it('draws one cell per check, filled exactly where the check passes', () => {
    const fit = fitFor(SHORT)
    render(<LetterFitSection fit={fit} />)

    const cells = [...document.querySelectorAll('[data-fit-cell]')]
    expect(cells).toHaveLength(fit.checks.length)
    expect(cells.filter((cell) => cell.getAttribute('data-fit-cell') === 'passed')).toHaveLength(
      fit.checks.filter((check) => check.passed).length
    )
  })

  it('clusters the cells by the question they answer, and says the count for each', () => {
    render(<LetterFitSection fit={fitFor(SHORT)} />)
    const job = document.querySelector('[data-fit-group="job"]')!
    const send = document.querySelector('[data-fit-group="send"]')!
    expect(job.querySelectorAll('[data-fit-cell]')).toHaveLength(3)
    expect(send.querySelectorAll('[data-fit-cell]')).toHaveLength(4)
    // Company and role are named; the posting is not answered.
    expect(within(job as HTMLElement).getByRole('img').getAttribute('aria-label')).toBe(
      'for this job: 2 of 3 passed'
    )
  })

  it('draws an empty meter, and says why, before an application is chosen', () => {
    render(<LetterFitSection fit={null} />)
    const cells = [...document.querySelectorAll('[data-fit-cell]')]
    expect(cells).toHaveLength(7)
    expect(cells.every((cell) => cell.getAttribute('data-fit-cell') === 'empty')).toBe(true)
    expect(screen.getByText(/pick an application above/i)).toBeInTheDocument()
  })
})

describe('the checks under it', () => {
  it('gives a failed check its sentence and keeps a passed one to its label', () => {
    render(<LetterFitSection fit={fitFor(SHORT)} />)
    const company = document.querySelector('[data-fit-check="company"]')!
    expect(company.getAttribute('data-passed')).toBe('true')
    expect(company.textContent).not.toMatch(/is named in the letter/)

    const evidence = document.querySelector('[data-fit-check="evidence"]')
    // A two-line letter is too short for the evidence rule to judge; the
    // length row is the one that fails, and it says which way.
    const length = document.querySelector('[data-fit-check="length"]')!
    expect(length.getAttribute('data-passed')).toBe('false')
    expect(length.textContent).toMatch(/Too short to make a case/)
    expect(evidence).toBeInTheDocument()
  })

  it('measures the posting with a gauge and names what the letter does not use', () => {
    render(<LetterFitSection fit={fitFor(SHORT)} />)
    const posting = document.querySelector('[data-fit-check="posting"]')!
    expect(posting.querySelector('[data-fit-gauge="posting"]')).toBeInTheDocument()
    expect(posting.textContent).toMatch(/0 of \d+ terms/)
    expect(posting.textContent).toMatch(/not yet in the letter: .*react/i)
  })

  it('places the length tick on the scale, inside the band for a one-page letter', () => {
    const words = Array.from({ length: 250 }, (_, i) => `word${i}`).join(' ')
    render(<LetterFitSection fit={fitFor(words)} />)
    const marker = document.querySelector<HTMLElement>('[data-fit-marker]')!
    // 250 of a 500-word scale.
    expect(marker.style.left).toBe('50%')
  })
})

describe('what is left under a ready letter', () => {
  it('calls it a second look rather than what to change, so the pane does not contradict itself', async () => {
    const { LetterAdvice } = await import('../LetterCheckPane')
    const { letterReview } = await import('../letterSuggestions')
    const review = letterReview(SHORT)
    const { rerender } = render(<LetterAdvice review={review} />)
    expect(screen.getByRole('heading', { name: 'what to change' })).toBeInTheDocument()
    rerender(<LetterAdvice review={review} ready />)
    expect(screen.getByRole('heading', { name: 'worth a second look' })).toBeInTheDocument()
  })

  it('numbers the advice on hairlines rather than boxing it', async () => {
    const { LetterAdvice } = await import('../LetterCheckPane')
    const { letterReview } = await import('../letterSuggestions')
    render(<LetterAdvice review={letterReview(SHORT)} />)
    const rows = [...document.querySelectorAll('[data-finding="letter"]')]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].textContent).toMatch(/^01/)
    expect(rows[0].className).not.toMatch(/rounded/)
  })
})
