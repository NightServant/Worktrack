import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import * as React from 'react'
import { useCvTailoring, TailoringAnalysisRail } from '../CvTailoring'
import { letterReview } from '../letterSuggestions'
import { makeJob } from '@/test/fixtures'

afterEach(() => cleanup())

/**
 * Tailoring a cover letter (Gabe, 2026-10-01):
 *
 *   "Fetch the information from the application overview dialog to tailor
 *    the cover letter properly."
 *   "combine the tailor to a job and letter check section and rename it with
 *    concise wording."
 *
 * These pin both: what the request carries, and what the one combined pane
 * shows.
 */

const JOB = makeJob({
  id: 'w1',
  status: 'wishlist',
  company: 'Initech',
  role: 'Frontend Engineer',
  description: 'We need React and TypeScript experience, and tests.',
  location: 'Taguig City',
  source: 'JobStreet',
  work_mode: 'hybrid',
  tech_stack: ['React', 'TypeScript'],
  is_referral: true,
})

const LETTER =
  'Dear Hiring Manager, I am writing to apply for the role at [Company]. ' +
  'In my most recent role I [the thing you were responsible for end to end].'

function Harness({
  fetchImpl,
  cvTextFor,
}: {
  fetchImpl: typeof fetch
  cvTextFor?: (jobId: string) => Promise<string | null>
}) {
  const [jobId, setJobId] = React.useState('w1')
  const state = useCvTailoring({
    kind: 'cover_letter',
    cvText: LETTER,
    jobs: [JOB],
    jobId,
    onJobId: setJobId,
    fetchImpl,
    cvTextFor,
  })
  return <TailoringAnalysisRail state={state} review={letterReview(LETTER)} />
}

const okReply = () =>
  vi.fn().mockResolvedValue({
    json: async () => ({ ok: true, summary: null, suggestions: [] }),
  }) as unknown as typeof fetch

async function tailor() {
  fireEvent.click(screen.getByRole('button', { name: /tailor this cover letter/i }))
  await act(async () => {})
}

function bodyOf(fetchImpl: typeof fetch) {
  const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
  return JSON.parse(call[1].body as string)
}

describe('what a letter is tailored from', () => {
  it('sends the application record and the CV linked to it', async () => {
    const fetchImpl = okReply()
    const cvTextFor = vi.fn().mockResolvedValue('Frontend Engineer at Northwind. Cut load time by 40 percent.')
    render(<Harness fetchImpl={fetchImpl} cvTextFor={cvTextFor} />)
    await tailor()

    expect(cvTextFor).toHaveBeenCalledWith('w1')
    expect(bodyOf(fetchImpl)).toMatchObject({
      kind: 'cover_letter',
      company: 'Initech',
      role: 'Frontend Engineer',
      location: 'Taguig City',
      source: 'JobStreet',
      workMode: 'hybrid',
      techStack: ['React', 'TypeScript'],
      referral: true,
      writerCv: 'Frontend Engineer at Northwind. Cut load time by 40 percent.',
    })
  })

  it('still tailors when the linked CV cannot be read', async () => {
    const fetchImpl = okReply()
    render(<Harness fetchImpl={fetchImpl} cvTextFor={vi.fn().mockRejectedValue(new Error('offline'))} />)
    await tailor()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchImpl).writerCv).toBeUndefined()
  })
})

describe('the letter’s one pane', () => {
  it('is titled tailor & review, scores fit rather than ATS, and lists what is left to change', () => {
    render(<Harness fetchImpl={okReply()} />)

    // NO HEADING OF ITS OWN (2026-10-01): the tab above already reads
    // `tailor & review`, and on a 768px laptop the repeat kept the score below
    // the fold.
    expect(screen.queryByRole('heading', { name: 'tailor & review' })).toBeNull()
    expect(document.querySelector('[data-tailor-frame="letter"]')).toBeInTheDocument()
    expect(document.querySelector('[data-letter-fit]')).toBeInTheDocument()
    expect(document.querySelector('[data-donut]')).toBeNull()
    expect(document.querySelector('[data-pane="letter-advice"]')).toBeInTheDocument()
  })

  it('does not repeat in the advice what the fit checklist already says', () => {
    // The letter has a bracketed prompt left, which is both a fit check and a
    // letter check finding. It is said once, in the checklist.
    render(<Harness fetchImpl={okReply()} />)

    expect(document.querySelector('[data-fit-check="placeholders"]')).toBeInTheDocument()
    const advice = document.querySelector('[data-pane="letter-advice"]')!
    // `template left in` is the letter check's own label for the same thing.
    expect(advice.textContent).not.toMatch(/template left in/i)
    // Nor `runs short`, which is the checklist's `fits one page`.
    expect(advice.textContent).not.toMatch(/runs short/i)
    // And what the checklist does NOT cover is still here.
    expect(advice.textContent).toMatch(/paragraph shape/i)
  })
})
