import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import type { JSONContent } from '@tiptap/core'
import * as React from 'react'
import { useCvTailoring, TailoringAnalysisRail } from '../CvTailoring'
import { makeJob } from '@/test/fixtures'
import type { ResumeContent } from '@/services/resumeService'

afterEach(() => cleanup())

/**
 * The tailoring section: pick a posting, read the match, get a new document.
 *
 * THESE TESTS USED TO DRIVE TWO RAILS AND A `<Select>`. The picker was a
 * `TailoringTargetRail` mounted opposite the analysis, and the result of
 * tailoring was a list of suggestions with an `apply` button each. Both are
 * gone: one section owns all three blocks, and the button produces a document
 * rather than a to-do list. What is left is the three facts that actually
 * matter -- which applications are offered, that the score is real, and that
 * the rewrite lands somewhere other than the open editor.
 */
const JOBS = [
  makeJob({
    id: 'w1',
    status: 'wishlist',
    company: 'Initech',
    role: 'Frontend Engineer',
    description: 'We need React, TypeScript and Postgres experience.',
  }),
  makeJob({ id: 'w2', status: 'wishlist', company: 'Globex', role: 'Backend Engineer', description: null }),
  makeJob({
    id: 'a1',
    status: 'applied',
    company: 'Hooli',
    role: 'Platform Engineer',
    description: 'We need React and Kubernetes experience.',
  }),
  makeJob({
    id: 'r1',
    status: 'rejected',
    company: 'Vandelay',
    role: 'Latex Engineer',
    description: 'We need TeX.',
  }),
]

const DOC: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shipped the rewrite' }] }],
}

function Harness({
  cvText,
  fetchImpl,
  content,
  title,
  linkedJobIds,
  tailoredForJobId,
  onTailored,
}: {
  cvText: string
  fetchImpl?: typeof fetch
  content?: ResumeContent
  title?: string
  linkedJobIds?: string[]
  tailoredForJobId?: string
  onTailored?: (input: {
    title: string
    content: ResumeContent
    jobId: string
  }) => Promise<'created' | 'updated' | void>
}) {
  // THE SELECTION LIVES OUTSIDE THE HOOK SINCE 2026-09-14, so the harness
  // holds it -- which is exactly what `WordResumeEditor` does. It moved out
  // because a cover letter must never call `useCvTailoring` at all, so the
  // call had to drop below a component branch while the tab strip, in another
  // workspace slot, still needs to know whether a posting is picked. Nothing
  // about what these tests assert changed; see CvTailoringOptions.
  const [jobId, setJobId] = React.useState('')
  const state = useCvTailoring({
    cvText,
    jobs: JOBS,
    linkedJobIds,
    tailoredForJobId,
    jobId,
    onJobId: setJobId,
    fetchImpl,
    title,
    getContent: content ? () => content : undefined,
    onTailored,
  })
  return <TailoringAnalysisRail state={state} />
}

/** The picker is a combobox, not a select: click it open, then take an option. */
async function pickApplication(user: UserEvent, name: RegExp) {
  await user.click(screen.getByRole('combobox', { name: /application/i }))
  const listbox = await screen.findByRole('listbox')
  await user.click(await within(listbox).findByRole('option', { name }))
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}

function okWith(suggestions: { before: string; after: string }[]): typeof fetch {
  return vi.fn().mockResolvedValue({
    json: async () => ({
      ok: true,
      summary: null,
      suggestions: suggestions.map((s) => ({ section: 'summary', rationale: 'closer', ...s })),
    }),
  }) as unknown as typeof fetch
}

describe('the tailoring section', () => {
  it('offers the wishlist and nothing else', async () => {
    // Tailoring is work you do BEFORE applying, so an application already sent
    // cannot be tailored to. Filtered in `useCvTailoring`, which is also what
    // resolves the selection -- one list, so the hook cannot end up holding a
    // job the picker refuses to show.
    const user = userEvent.setup({ delay: null })
    render(<Harness cvText="React and TypeScript developer." />)

    await user.click(screen.getByRole('combobox', { name: /application/i }))
    const options = (await screen.findByRole('listbox')).textContent ?? ''

    expect(options).toContain('Frontend Engineer')
    expect(options).toContain('Backend Engineer')
    expect(options).not.toContain('Platform Engineer')
    expect(options).not.toContain('Latex Engineer')
  })

  it('does not offer a role whose CV has already been written', async () => {
    // Gabe, 2026-09-19: "wishlisted jobs with tailored CVs must not appear in
    // the component itself." Tailoring pins the CV it writes to the
    // application it wrote it for, so a job with a document attached has been
    // through here already and the picker was listing finished work.
    const user = userEvent.setup({ delay: null })
    render(<Harness cvText="React and TypeScript developer." linkedJobIds={['w1']} />)

    await user.click(screen.getByRole('combobox', { name: /application/i }))
    const options = (await screen.findByRole('listbox')).textContent ?? ''

    expect(options).not.toContain('Frontend Engineer')
    expect(options).toContain('Backend Engineer')
  })

  it('still shows the role THIS document was tailored for, though it is linked', () => {
    // The filter hides jobs that have a CV -- and the open document's own
    // target is linked PRECISELY BECAUSE this document exists. It resolves out
    // of every application rather than the filtered list, so a tailored CV
    // reopened still names and scores the posting it was written for. Without
    // that, the filter would blank the target on exactly the documents that
    // have one.
    render(
      <Harness
        cvText="React and TypeScript developer."
        linkedJobIds={['w1', 'w2']}
        tailoredForJobId="w1"
      />
    )
    expect(screen.getByText(/Frontend Engineer/)).toBeTruthy()
  })

  it('says so when the wishlist is empty, rather than claiming there are no applications', () => {
    // The account in this fixture is full of applications; none of them are
    // wishlisted. "no applications yet" would be a lie about the account when
    // the truth is about the filter.
    function Empty() {
      const [jobId, setJobId] = React.useState('')
      const state = useCvTailoring({ cvText: 'anything', jobs: [], jobId, onJobId: setJobId })
      return <TailoringAnalysisRail state={state} />
    }
    render(<Empty />)
    expect(
      screen.getByRole('combobox', { name: /application/i }).getAttribute('placeholder')
    ).toMatch(/wishlist/i)
  })

  it('scores the CV against the selected application', async () => {
    const user = userEvent.setup({ delay: null })
    render(<Harness cvText="React and TypeScript developer." />)

    await pickApplication(user, /Frontend Engineer/)

    // A real percentage from the deterministic scorer, not a model's opinion.
    // The number itself is an SVG tspan the ring draws; this is the panel's
    // TEXT summary, which exists so a screen reader -- and a test -- can read
    // the score at all.
    expect(await screen.findByText(/\d+% match\./)).toBeTruthy()
    // The verdict in words and both inventories, the same pieces the
    // application record's third column draws.
    expect(document.querySelector('[data-ats-verdict]')).toBeTruthy()
    expect(document.querySelector('[data-ats-terms="matched"]')).toBeTruthy()
    expect(document.querySelector('[data-ats-terms="missing"]')).toBeTruthy()
    expect(screen.getByText('react')).toBeTruthy()
  })

  it('says when the chosen application has no description stored', async () => {
    // Otherwise the block sits blank and reads as broken, when the real answer
    // is that there is nothing on that application to score against.
    const user = userEvent.setup({ delay: null })
    render(<Harness cvText="anything" />)
    await pickApplication(user, /Backend Engineer/)
    expect(await screen.findByText(/no job description saved/i)).toBeTruthy()
  })

  it('cannot be run without a posting', () => {
    render(<Harness cvText="React developer" />)
    expect(screen.getByRole('button', { name: /tailor this cv/i })).toBeDisabled()
  })

  it('hands a new title and a rewritten copy to onTailored, and leaves the open document alone', async () => {
    // THE POINT OF THE WHOLE CHANGE (Gabe, 2026-09-13: "AI tailor button must
    // create a new version of the document"). Nothing is applied to the editor
    // on screen -- the rewrite goes to the route, which creates the CV and
    // navigates to it.
    const onTailored = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = okWith([{ before: 'Shipped the rewrite', after: 'Shipped the React rewrite' }])
    const user = userEvent.setup({ delay: null })
    render(
      <Harness
        cvText="Shipped the rewrite"
        fetchImpl={fetchImpl}
        content={DOC}
        title="Backend CV"
        onTailored={onTailored}
      />
    )

    await pickApplication(user, /Frontend Engineer/)
    await user.click(screen.getByRole('button', { name: /tailor this cv/i }))

    await waitFor(() => expect(onTailored).toHaveBeenCalledTimes(1))
    const handed = onTailored.mock.calls[0][0] as { title: string; content: JSONContent }

    // `<original> — <company>`, which is what tells nine tailored copies of
    // one CV apart in /documents.
    expect(handed.title).toBe('Backend CV — Initech')
    expect(handed.content.content![0].content![0].text).toBe('Shipped the React rewrite')
    // A copy: the document the editor is holding still says what it said.
    expect(handed.content).not.toBe(DOC)
    expect(DOC.content![0].content![0].text).toBe('Shipped the rewrite')

    // Through the app's own route, never straight at the provider -- the API
    // key lives on the server and must not reach the browser.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('/api/tailor')
    // And the model is told what is missing rather than guessing it.
    const body = JSON.parse(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    )
    expect(Array.isArray(body.missingKeywords)).toBe(true)
    expect(body.company).toBe('Initech')
  })

  it('creates nothing when the model returns no change this CV can take', async () => {
    // A second byte-identical CV is worse than a sentence: it is a document
    // the user has to notice, open, compare and delete.
    const onTailored = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = okWith([{ before: 'a line that is not in this CV', after: 'anything' }])
    const user = userEvent.setup({ delay: null })
    render(
      <Harness
        cvText="Shipped the rewrite"
        fetchImpl={fetchImpl}
        content={DOC}
        title="Backend CV"
        onTailored={onTailored}
      />
    )

    await pickApplication(user, /Frontend Engineer/)
    await user.click(screen.getByRole('button', { name: /tailor this cv/i }))

    expect(await screen.findByText(/no changes this CV could take/i)).toBeTruthy()
    expect(onTailored).not.toHaveBeenCalled()
  })

  it('reports an unconfigured integration quietly, not as an error', async () => {
    // Nothing is broken -- the capability was never set up. Shouting about it
    // in the error colour would say the app failed.
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: false,
        reason: 'unconfigured',
        message: 'AI tailoring is not configured.',
      }),
    }) as unknown as typeof fetch
    const user = userEvent.setup({ delay: null })
    render(<Harness cvText="React developer" fetchImpl={fetchImpl} />)

    await pickApplication(user, /Frontend Engineer/)
    await user.click(screen.getByRole('button', { name: /tailor this cv/i }))

    const notice = await screen.findByRole('alert')
    expect(notice.textContent).toMatch(/not configured/i)
    expect(notice.className).toContain('text-text-muted')
    expect(notice.className).not.toContain('rejected')
  })

  it('still runs, and says what came back, when nothing is wired to receive the document', async () => {
    // The editors are rendered in tests with no `onTailored`. The button has
    // to report rather than throw.
    const fetchImpl = okWith([{ before: 'Shipped the rewrite', after: 'Shipped the React rewrite' }])
    const user = userEvent.setup({ delay: null })
    render(<Harness cvText="Shipped the rewrite" fetchImpl={fetchImpl} />)

    await pickApplication(user, /Frontend Engineer/)
    await user.click(screen.getByRole('button', { name: /tailor this cv/i }))

    expect(await screen.findByText(/nowhere to save a new document/i)).toBeTruthy()
  })
})


/**
 * The action sits under the picker, not under the score.
 *
 * ORDER IS THE WHOLE POINT OF THIS ONE (Gabe, 2026-09-15). The button used to
 * come after the verdict, the ring and two chip lists that fold at twelve
 * terms each, which in a 320px rail put it off the bottom of the panel -- the
 * reason to scroll was invisible from where you picked the application.
 * Asserted on DOM ORDER rather than by eye, because a reorder is exactly the
 * kind of change a later edit undoes without noticing.
 */
describe('the tailoring rail puts the action under the picker', () => {
  it('renders the rewrite copy and button before the score', async () => {
    const user = userEvent.setup()
    render(<Harness cvText="Shipped the rewrite" />)
    await pickApplication(user, /initech/i)

    const button = await screen.findByRole('button', { name: /tailor this cv/i })
    const blurb = screen.getByText(/rewrites this CV against the posting/i)
    // The score section: "matched" labels both the chip heading and the donut
    // legend, so take the first occurrence -- any of them is after the button.
    const matched = (await screen.findAllByText(/matched/i))[0]

    // `compareDocumentPosition` reads DOM order: FOLLOWING means the score
    // comes after, which is the arrangement being pinned.
    expect(blurb.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(button.compareDocumentPosition(matched) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not promise a new document, since re-tailoring rewrites this one', () => {
    render(<Harness cvText="Shipped the rewrite" />)
    // The old copy said the open document "is left exactly as it is", which
    // stopped being true for a re-tailor of the same application.
    expect(screen.queryByText(/left exactly as it is/i)).toBeNull()
    expect(screen.getByText(/running it again for the same application updates that one/i)).toBeTruthy()
  })
})
