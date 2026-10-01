import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ResumeDraft } from '@/services/resumeService'

/**
 * The editor opened as a cover letter.
 *
 * ONE EDITOR WITH A BRANCH, which is the thing worth proving. A second
 * component would have been the easy way to give a letter a different rail and
 * it is how the two document chromes drifted before they were merged; what
 * these tests pin is that the SAME component behaves differently, and in the
 * three ways that actually matter.
 *
 * THE FIRST ONE IS NOT VISIBLE ON SCREEN AT ALL. "A cover letter is not scored
 * against a posting" is only true if `useCvTailoring` is never called -- a
 * hidden pane still mounts its state, still filters the wishlist and still
 * holds a selection nothing can show. Hooks cannot be called conditionally, so
 * the only proof is a spy on the hook itself: `TailoringRailPane` exists
 * precisely so that this assertion can hold.
 */

const tailoringCalls = vi.hoisted(() => vi.fn())

vi.mock('../CvTailoring', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../CvTailoring')>()
  return {
    ...actual,
    useCvTailoring: (options: Parameters<typeof actual.useCvTailoring>[0]) => {
      tailoringCalls()
      return actual.useCvTailoring(options)
    },
  }
})

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false }),
}))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

// Version history reads snapshots on mount; the shared Supabase client refuses
// to construct without real credentials. Same stubs the /cv route test uses.
vi.mock('@/services/resumeSnapshotService', () => ({
  createSnapshot: vi.fn(),
  maybeCreateSnapshot: vi.fn(),
  getSnapshots: vi.fn().mockResolvedValue([]),
  getSnapshot: vi.fn(),
  deleteSnapshot: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  hasValidSupabaseConfig: false,
}))

import { WordResumeEditor } from '../WordResumeEditor'
import { makeJob } from '@/test/fixtures'

const JOBS = [
  makeJob({
    id: 'w1',
    status: 'wishlist',
    company: 'Initech',
    role: 'Frontend Engineer',
    description: 'We need React and TypeScript experience.',
  }),
]

const LETTER_TEXT =
  'To whom it may concern, I am writing to apply for the role at your company. I am a passionate team player.'

function draft(overrides: Partial<ResumeDraft> = {}): ResumeDraft {
  return {
    id: 'doc-1',
    title: 'Meridian letter',
    mode: 'word',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: LETTER_TEXT }] }],
    },
    updated_at: '2026-09-14T09:00:00.000Z',
    ...overrides,
  }
}

function renderEditor(kind?: 'word' | 'cover_letter') {
  return render(
    <WordResumeEditor
      kind={kind}
      draft={draft()}
      backHref="/documents"
      jobs={JOBS}
      onDelete={() => {}}
      onPersistDraft={async () => draft()}
    />
  )
}

const tabNames = () =>
  screen.getAllByRole('tab').map((tab) => tab.textContent?.trim().toLowerCase() ?? '')

beforeEach(() => {
  tailoringCalls.mockClear()
  window.localStorage.clear()
})
afterEach(() => cleanup())

describe('the editor opened as a cover letter', () => {
  it('tailors a cover letter too, scored by fit rather than by ATS', () => {
    // REVERSED 2026-10-01 (Gabe: "Implement the same logic of CV tailoring to
    // enhance cover letters", then "Letter tailoring should not implement the
    // ATS scoring"). The hook runs; the pane offers the rewrite under the
    // letter's own name and shows the fit checklist in place of the ring.
    window.localStorage.setItem('worktrack:document-tab', 'tailor')
    renderEditor('cover_letter')
    expect(tailoringCalls).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /tailor this cover letter/i })).toBeInTheDocument()
    expect(document.querySelector('[data-letter-fit]')).toBeInTheDocument()
    expect(screen.queryByText(/score this CV/i)).toBeNull()
  })

  it('still runs it for a CV, which is the control for the test above', () => {
    renderEditor('word')
    expect(tailoringCalls).toHaveBeenCalled()
  })

  it('combines tailoring and the letter check into one tab', () => {
    renderEditor('cover_letter')
    // A column tab reads as label + hint in one node, so these are substring
    // checks rather than equality.
    expect(tabNames()).toHaveLength(2)
    expect(tabNames().some((name) => name.startsWith('grammar check'))).toBe(true)
    expect(tabNames().some((name) => name.startsWith('tailor & review'))).toBe(true)
  })

  it('leaves the CV rail exactly as it was, with no kind passed', () => {
    renderEditor()
    expect(tabNames().some((name) => name.includes('tailor'))).toBe(true)
    expect(tabNames().some((name) => name.includes('letter check'))).toBe(false)
  })

  it('says cover letter in the breadcrumb and under the page', () => {
    renderEditor('cover_letter')
    expect(screen.getAllByText(/cover letter/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/print-ready cover letter/i)).toBeInTheDocument()
  })

  it('does not strand itself on the retired letter check tab', () => {
    // `suggestions` was the letter check's own tab until 2026-10-01; a
    // browser that remembered it opens on grammar rather than on nothing.
    window.localStorage.setItem('worktrack:document-tab', 'suggestions')
    renderEditor('cover_letter')
    expect(document.querySelector('[data-document-pane]')).toHaveAttribute(
      'data-document-pane',
      'grammar'
    )
  })

  it('shows the letter check under the fit score, drawn from the open document', () => {
    window.localStorage.setItem('worktrack:document-tab', 'tailor')
    renderEditor('cover_letter')
    const advice = document.querySelector('[data-pane="letter-advice"]')!
    expect(advice).toBeInTheDocument()
    // After the fit section, in the same pane.
    expect(
      document.querySelector('[data-letter-fit]')!.compareDocumentPosition(advice) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    // The fixture opens "To whom it may concern" and "I am writing to apply",
    // so at minimum those two rules have fired -- no button pressed, because
    // there is nothing to fetch.
    expect(advice.querySelectorAll('[data-finding="letter"]').length).toBeGreaterThan(1)
  })
})
