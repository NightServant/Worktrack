import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApplicationRecordDialog } from '../record/ApplicationRecordDialog'
import { makeJob } from '@/test/fixtures'
import { resolveDefaultCurrency } from '@/services/userPreferences'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

afterEach(() => cleanup())

const CURRENCY = resolveDefaultCurrency(null)

/**
 * The control that opens the posting's own view.
 *
 * BY ITS HOOK, NOT BY ITS LABEL. It reads `read more…` only when the preview is
 * actually cutting something off, and since 2026-09-13 that is a MEASUREMENT --
 * the preview fills its frame and reports whether it overflowed. jsdom has no
 * layout, so every height is 0 and the honest answer there is `open the
 * posting`. `data-posting-read-more` is the stable handle the record already
 * uses to put focus back on this control; a test that pinned one of its three
 * labels would be asserting the environment rather than the behaviour.
 */
function openPosting(): HTMLElement {
  const button = document.querySelector<HTMLElement>('[data-posting-read-more]')
  if (!button) throw new Error('no control to open the posting')
  return button
}

/**
 * Six blocks: a heading, its list, a paragraph, a second heading, its list, a
 * closing paragraph. The preview shows four, so the last two are what proves
 * the cut -- and they are a list item and a paragraph rather than two
 * paragraphs, because the cut counts BLOCKS and a list is one of them however
 * many bullets it holds.
 */
const POSTING = [
  'About the role:',
  '- Ship the editor',
  '- Keep the tests green',
  '',
  'We are hiring a frontend engineer in Manila.',
  '',
  'Benefits:',
  '- Free coffee',
  '',
  'Apply before the end of the month.',
].join('\n')

const JOB = makeJob({ id: 'j1', status: 'applied', company: 'Initech', description: POSTING })

function renderDialog(onOpenChange = vi.fn()) {
  render(
    <ApplicationRecordDialog
      open
      onOpenChange={onOpenChange}
      job={JOB}
      defaultCurrency={CURRENCY}
      onSubmit={vi.fn()}
    />
  )
  return onOpenChange
}

/**
 * THE POSTING IS A PANEL OF THE RECORD'S OWN DIALOG, not a second one, and
 * these two tests are the reason that shape was chosen rather than the
 * shorter one. Base UI unmounts a closed dialog's children; a sibling
 * `AppDialog` would therefore throw the draft away every time somebody pressed
 * `read more…`, which is the same silent loss the discard confirmation exists
 * to prevent -- on a control that only promised more text.
 */
describe('reading the whole posting', () => {
  it('keeps the CV pick and the revealed fields, and hands focus back', async () => {
    // THE TWO THINGS THE COMMENT PROMISES AND THE FIRST PASS DID NOT COVER
    // (found in review, 2026-09-13). The typed-field case was tested; the CV
    // pick lives in `ApplicationRecordView` state and the `add more details`
    // disclosure in `RecordBasics` state, and BOTH sit inside the subtree that
    // is hidden rather than unmounted. If that ever becomes a conditional
    // render, these are what fail.
    //
    // Focus is the third: `back to application` unmounts on the way out, and
    // the control it returns to was only un-hidden -- so nothing remounts and
    // no `autoFocus` fires. Without the restore, focus fell to <body> inside a
    // focus-trapped dialog.
    const user = userEvent.setup()
    render(
      <ApplicationRecordDialog
        open
        onOpenChange={vi.fn()}
        job={JOB}
        defaultCurrency={CURRENCY}
        onSubmit={vi.fn()}
        resumes={[{ id: 'r1', title: 'Frontend CV' }]}
      />
    )

    await user.click(screen.getByRole('button', { name: /add more details/i }))
    await user.type(screen.getByLabelText('location'), 'Manila')

    const readMore = openPosting()
    await user.click(readMore)
    // BY ROLE, not by label. `getByLabelText` walks the DOM and would find the
    // input whether or not it is hidden; the accessibility tree is the thing
    // the `hidden` attribute actually changes, and it is what a screen reader
    // sees. (jsdom loads no stylesheet, so preflight's `display:none` is not
    // what is being tested here -- the attribute is.)
    expect(screen.queryByRole('textbox', { name: 'location' })).toBeNull()

    await user.click(screen.getByRole('button', { name: /back to application/i }))

    // The disclosure is still open and still carries what was typed into it.
    expect(screen.getByLabelText('location')).toHaveValue('Manila')
    // And the record is where the keyboard left it.
    expect(openPosting()).toHaveFocus()
  })


  it('replaces the record with the full posting, and keeps the record mounted', async () => {
    const user = userEvent.setup()
    renderDialog()

    // THE CUT IS NOW THE FRAME'S HEIGHT, not a block count, so it cannot be
    // asserted here: jsdom lays nothing out, every height is 0, and the
    // preview reports that it clipped nothing. What still holds either way is
    // the SHAPE -- the preview is a run of blocks with a control under it, the
    // full view is addressable sections with their own edit and delete. That
    // is the difference this test is actually about.
    expect(screen.getByText('About the role')).toBeVisible()
    expect(document.querySelector('[data-posting-section]')).toBeNull()

    await user.click(openPosting())

    // SCOPED TO THE SECTIONS, because the preview is still in the DOM behind
    // the `hidden` attribute -- that is the whole point of the panel swap, and
    // an unscoped text query would find the same line twice.
    const sections = [...document.querySelectorAll('[data-posting-section]')]
    expect(sections.length).toBeGreaterThan(1)
    const full = sections.map((section) => section.textContent).join(' ')
    expect(full).toContain('Free coffee')
    expect(full).toContain('Apply before the end of the month.')
    // The dialog says which of its two views this is.
    expect(screen.getByRole('heading', { name: 'job description' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'application overview' })).toBeNull()

    // Still THERE, and still out of the way: `hidden` keeps the fields in the
    // DOM (the draft with them) while taking them out of the accessibility
    // tree, so there is never a second `company` for a screen reader to find.
    expect(screen.getByLabelText(/^company/i)).not.toBeVisible()
    expect(screen.queryByRole('textbox', { name: /^company/i })).toBeNull()
    expect(document.querySelector('[data-application-record]')).toBeTruthy()
  })

  it('comes back to the record with a typed-but-unsaved field still in it', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.clear(screen.getByLabelText(/^company/i))
    await user.type(screen.getByLabelText(/^company/i), 'Umbrella')

    await user.click(openPosting())
    await user.click(screen.getByRole('button', { name: /back to application/i }))

    expect(screen.getByRole('heading', { name: 'application overview' })).toBeTruthy()
    expect(screen.getByLabelText(/^company/i)).toHaveValue('Umbrella')
    // And it is still UNSAVED, which is the half that matters: a record that
    // came back with the text but a fresh baseline would have nothing to save.
    expect(screen.getByRole('button', { name: /save application/i })).toBeEnabled()
    expect(document.querySelector('[data-record-save-state]')).toHaveTextContent(/unsaved/i)
  })

  it('makes Escape mean "back" while the posting is open, and "close" on the record', async () => {
    const user = userEvent.setup()
    const onOpenChange = renderDialog()

    await user.click(openPosting())
    await user.keyboard('{Escape}')

    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'application overview' })).toBeTruthy()

    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

/**
 * NAMING A SECTION BEFORE IT EXISTS.
 *
 * The control used to append a section called `New section` and open its body
 * field -- and nothing on this screen can rename a heading, so the placeholder
 * was permanent. These cover the two halves that matter: the posting is
 * untouched until the name is given, and the name given is the heading stored.
 */
describe('adding a section', () => {
  async function openSectionDialog(user: ReturnType<typeof userEvent.setup>) {
    renderDialog()
    await user.click(openPosting())
    await user.click(screen.getByRole('button', { name: /add a new section/i }))
  }

  it('asks for a name and writes it as the heading', async () => {
    const user = userEvent.setup()
    await openSectionDialog(user)

    expect(screen.getByRole('dialog', { name: /name the section/i })).toBeTruthy()
    // NOTHING HAS BEEN ADDED YET, which is the point of the step: an abandoned
    // dialog must leave the posting exactly as it was.
    expect(document.querySelectorAll('[data-posting-section]')).toHaveLength(2)

    await user.type(screen.getByLabelText(/section name/i), 'How to apply')
    await user.click(screen.getByRole('button', { name: /^add section$/i }))

    const sections = [...document.querySelectorAll('[data-posting-section]')]
    expect(sections).toHaveLength(3)
    expect(sections[2].getAttribute('aria-label')).toBe('How to apply')
    // And it opens as a field, because the heading is settled and the body is
    // the only thing left to write.
    expect(screen.getByRole('textbox', { name: 'How to apply text' })).toBeTruthy()
  })

  it('will not add a section with no name, and adds nothing when cancelled', async () => {
    const user = userEvent.setup()
    await openSectionDialog(user)

    await user.click(screen.getByRole('button', { name: /^add section$/i }))
    expect(screen.getByText(/give the section a name/i)).toBeTruthy()
    expect(document.querySelectorAll('[data-posting-section]')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('dialog', { name: /name the section/i })).toBeNull()
    expect(document.querySelectorAll('[data-posting-section]')).toHaveLength(2)
  })
})

