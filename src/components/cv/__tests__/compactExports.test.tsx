import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ResumeDraft } from '@/services/resumeService'

/**
 * EVERY EXPORT THE DESKTOP OFFERS IS REACHABLE BELOW `lg`.
 *
 * WHY THIS IS A TEST AND NOT A CODE REVIEW. The editor writes its file
 * commands twice -- once as `ActionRow`s in the desktop popover, once as
 * `Button`s in the compact row that the overflow sheet lays out -- and the two
 * lists share nothing but the handlers they call. On 2026-09-15 `.tex` was
 * added to the first list and marked the format worth sending; the second list
 * was not touched, so for two days the one export the app recommended was the
 * one a phone could not reach. Nothing failed: both surfaces rendered, both
 * looked finished.
 *
 * SO THE ASSERTION IS PARITY, NOT A LIST. Hard-coding "three exports" here
 * would pin today's menu and catch nothing the next time one surface grows a
 * format the other does not -- which is the actual failure mode, twice now.
 */

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

const JOBS = [makeJob({ id: 'w1', status: 'wishlist', company: 'Initech', role: 'Frontend Engineer' })]

const DRAFT: ResumeDraft = {
  id: 'doc-1',
  title: 'Meridian CV',
  mode: 'word',
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
  updated_at: '2026-09-17T09:00:00.000Z',
}

/** jsdom is 1024 wide, which `useBelowDesktop` reads as desktop. */
function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { value: px, writable: true, configurable: true })
}

const renderEditor = () =>
  render(
    <WordResumeEditor
      draft={DRAFT}
      backHref="/documents"
      jobs={JOBS}
      onDelete={() => {}}
      onPersistDraft={async () => DRAFT}
    />
  )

/**
 * The export formats currently on screen, read off the controls themselves.
 *
 * BY EXACT TEXT RATHER THAN BY BUTTON. Both surfaces label an export
 * `export <format>`, but the desktop row also carries its hint and its
 * `recommended` mark inside the same <button> -- so reading button text gives
 * you `.docxopens in Word...`. An exact matcher lands on the label node in the
 * menu and on the button itself in the sheet, which is the same string either
 * way and needs no list of formats to parse.
 */
function exportsOnScreen(): string[] {
  return screen
    .getAllByText(/^export (\.[a-z]+|PDF)$/)
    .map((node) => (node.textContent ?? '').replace('export ', ''))
    .sort()
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  setWidth(1024)
})

describe('the export formats on offer', () => {
  it('are the same three below lg as on a desktop', async () => {
    const user = userEvent.setup()

    setWidth(1024)
    renderEditor()
    await user.click(screen.getByRole('button', { name: /document actions/i }))
    const desktop = exportsOnScreen()
    // The control: two empty lists agree with each other, and `.tex` is the
    // format this test exists for. Neither line pins how many formats there
    // are, which is the part that must stay free to change.
    expect(desktop).toContain('.tex')
    expect(desktop.length).toBeGreaterThan(1)

    cleanup()

    setWidth(390)
    renderEditor()
    await user.click(screen.getByRole('button', { name: /more actions/i }))
    expect(exportsOnScreen()).toEqual(desktop)
  })

  it('keeps reset and delete reachable below lg too', async () => {
    // The row `.tex` joined is the same one that carries these, and the sheet
    // grid was re-cut to fit a fourth cell. Nothing may fall out of it.
    const user = userEvent.setup()
    setWidth(390)
    renderEditor()
    await user.click(screen.getByRole('button', { name: /more actions/i }))
    expect(screen.getByRole('button', { name: /^reset$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete meridian cv/i })).toBeInTheDocument()
  })
})
