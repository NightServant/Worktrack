import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEventDefault from '@testing-library/user-event'

/**
 * `delay: null` removes user-event's artificial pause between keystrokes.
 *
 * The delay exists to simulate human typing speed. Nothing here asserts on
 * timing -- the rate limiter is driven by attempt COUNT, not by how fast the
 * attempts arrive -- so removing it changes how long the test takes and not
 * what it proves.
 *
 * IT WAS NOT ENOUGH ON ITS OWN. See `setField` below.
 */
const userEvent = userEventDefault.setup({ delay: null })
import { SignUpFlow } from '../SignUpFlow'

const STRONG = 'Str0ng!Passw0rd'

function setup(overrides: Partial<React.ComponentProps<typeof SignUpFlow>> = {}) {
  const props = {
    onSignUp: vi.fn().mockResolvedValue(undefined),
    onVerify: vi.fn().mockResolvedValue(undefined),
    onResend: vi.fn().mockResolvedValue(undefined),
    onDone: vi.fn(),
    doneDelayMs: 10,
    ...overrides,
  }
  render(<SignUpFlow {...props} />)
  return props
}

/**
 * Sets a field's value in ONE event instead of one per character.
 *
 * WHY THIS EXISTS, since `userEvent.type` is the house default and stays the
 * default everywhere typing is the subject. `fillDetails` is the hot path: the
 * rate-limit test runs it six times, and at a 15-character password plus a
 * confirm plus an email that is ~280 keystrokes, each one a state update that
 * re-renders the whole flow -- the brand panel, the progress bar and the
 * six-item requirements checklist included.
 *
 * MEASURED 2026-09-06: that test took ~1.2s alone and 5.2s under full-suite
 * load, against a 5s timeout. It was not slow because it waited for anything;
 * it was slow because it did ~1,700 renders, and a test with no headroom fails
 * whenever the machine is busy. It failed roughly twice in eight full runs.
 *
 * The submit path reads component STATE, not keystrokes, so a single change
 * event exercises exactly the same code. Tests whose subject IS typing -- the
 * requirements checklist updating as you type, the code field stripping
 * non-digits -- keep `userEvent.type`, because for those the keystrokes are
 * the thing being tested.
 *
 * It also replaces the value rather than appending, which removes the
 * accumulation hazard the rate-limit loop used to clear three fields to avoid:
 * six rounds of appending made a 90-character password that tripped the
 * bcrypt 72-byte check first, so the limiter was never reached and the test
 * passed or failed for a reason unrelated to its name.
 */
function setField(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

async function fillDetails(email = 'Gabe@Example.com', password = STRONG, confirm = password) {
  setField(/^Email/, email)
  setField(/^Password/, password)
  setField(/^Confirm password/, confirm)
  // `findByRole`, NOT `getByRole`: the submit carries a spinner while busy, so
  // between a rejected attempt and the next one there is a frame where this
  // query does not match. Locally the gap closes before the next line runs; on
  // a slower CI runner it does not, and the rate-limit test below -- which
  // submits six times in a row -- was the one place that showed it.
  await userEvent.click(await screen.findByRole('button', { name: 'Create account' }))
}

beforeEach(() => window.localStorage.clear())
afterEach(() => window.localStorage.clear())

describe('the registration progress bar', () => {
  it('names the four steps and marks the first as current', () => {
    setup()
    const bar = document.querySelector('[data-registration-progress]')!
    expect(bar).toBeInTheDocument()
    const steps = [...bar.querySelectorAll('[data-step]')].map((s) => s.getAttribute('data-step'))
    // `personalise` joined on 2026-09-21: the sources form sits after the
    // code, because reading a profile writes one and writing needs a session.
    expect(steps).toEqual(['your details', 'verify', 'personalise', 'done'])
    expect(
      bar.querySelector('[data-step][data-state="current"]')?.getAttribute('data-step')
    ).toBe('your details')
  })

  it('carries an icon and a description per step', () => {
    // THE ICON IS INSIDE THE NODE NOW (2026-09-11), not floating in a row
    // above a separate track. Two of the tests this replaces existed only to
    // police that two-row arrangement -- "icons above the track" and "each
    // icon in the same state as its own label" -- and neither can fail any
    // more: there is one row, built from one list, so the icon and the label
    // are the same element's children.
    setup()
    const bar = document.querySelector('[data-registration-progress]')!
    const steps = [...bar.querySelectorAll('[data-step]')]
    expect(steps).toHaveLength(4)
    expect(steps.every((step) => step.querySelector('svg') !== null)).toBe(true)
    // The descriptions are the reason this moved to the shared tracker: the
    // way IN was the only progress bar in the app without them.
    expect(bar.textContent).toContain('a six-digit code')
  })

  it('fills the connector behind every step that is done', async () => {
    // Replaces the old width-percentage assertion on a single track element.
    // The fill is per-segment now, so "how far" is a COUNT of filled
    // connectors rather than a number parsed out of an inline style.
    setup()
    const bar = () => document.querySelector('[data-registration-progress]')!
    const filled = () => bar().querySelectorAll('[data-progress-fill]').length

    const atStart = filled()
    await fillDetails()
    await waitFor(() => expect(filled()).toBeGreaterThan(atStart))
  })

  it('advances the current step as the person moves through the flow', async () => {
    setup()
    const currentStep = () =>
      document
        .querySelector('[data-registration-progress] [data-step][data-state="current"]')
        ?.getAttribute('data-step')

    expect(currentStep()).toBe('your details')
    await fillDetails()
    await waitFor(() => expect(currentStep()).toBe('verify'))
  })
})

describe('the password requirements checklist', () => {
  it('is on the form before anything is typed, not revealed by touching the field', () => {
    // This asserted the OPPOSITE until 2026-09-02 -- the list hid until the
    // field was touched. Gabe overruled it: the rules are worth most while
    // someone is still deciding what to type, which is before they reach the
    // field at all.
    setup()
    const list = document.querySelector('[data-password-requirements]')
    expect(list).not.toBeNull()
    expect(list!.querySelectorAll('[data-requirement]')).toHaveLength(6)
  })

  it('shows every rule at once, unmet, rather than revealing them as they break', () => {
    // Revealing rules one at a time turns one decision into a guessing game.
    setup()
    const list = document.querySelector('[data-password-requirements]')!
    expect(list.querySelectorAll('[data-requirement]')).toHaveLength(6)
    expect(list.querySelectorAll('[data-met="true"]')).toHaveLength(0)
  })

  it('opens neutral, then marks unmet rules with a red cross once typing starts', async () => {
    // Gabe asked for red crosses on unmet rules on 2026-09-03. The pristine
    // exception is deliberate and is the whole reason this test has two
    // halves: the list is permanently on the form now, so without it the
    // screen would OPEN as six red failures against somebody who has done
    // nothing. Red means "you got this wrong", and nobody can be wrong before
    // they have typed.
    setup()
    const states = () =>
      [...document.querySelectorAll('[data-requirement]')].map((e) =>
        e.getAttribute('data-state')
      )
    const crosses = () =>
      document.querySelectorAll('[data-requirement][data-state="unmet"] svg').length

    expect(states().every((s) => s === 'pristine')).toBe(true)
    expect(crosses()).toBe(0)

    await userEvent.type(screen.getByLabelText(/^Password/), 'worktrackpass')

    // Long, lowercase and space-free are satisfied; upper, digit and symbol
    // are not -- so exactly three should be red, each with a glyph.
    expect(states().filter((s) => s === 'unmet')).toHaveLength(3)
    expect(states().filter((s) => s === 'met')).toHaveLength(3)
    expect(states()).not.toContain('pristine')
    expect(crosses()).toBe(3)
  })

  it('ticks each rule as it is met, live', async () => {
    setup()
    await userEvent.type(screen.getByLabelText(/^Password/), 'abc')
    const met = () => document.querySelectorAll('[data-requirement][data-met="true"]').length
    expect(met()).toBeGreaterThan(0)

    await userEvent.type(screen.getByLabelText(/^Password/), 'DEF123!x')
    await waitFor(() => expect(met()).toBe(6))
  })
})

describe('registration validation, before anything leaves the browser', () => {
  it('refuses an unreachable address without calling the server', async () => {
    const props = setup()
    await fillDetails('not-an-email')
    expect(await screen.findByText(/does not look like an email/i)).toBeInTheDocument()
    expect(props.onSignUp).not.toHaveBeenCalled()
  })

  it('refuses a weak password without calling the server', async () => {
    // Every request not sent is a row the auth server does not have to reject.
    const props = setup()
    await fillDetails('a@b.co', 'weakpass')
    expect(await screen.findByText(/does not meet every requirement/i)).toBeInTheDocument()
    expect(props.onSignUp).not.toHaveBeenCalled()
  })

  it('refuses mismatched passwords without calling the server', async () => {
    const props = setup()
    await fillDetails('a@b.co', STRONG, `${STRONG}x`)
    expect(await screen.findByText('Those passwords do not match.')).toBeInTheDocument()
    expect(props.onSignUp).not.toHaveBeenCalled()
  })

  it('normalises the email before submitting it', async () => {
    // The duplicate-account fix: Gabe@Example.com and gabe@example.com must
    // reach the auth server as one identity, or case permutations of a single
    // address become many rows for one person.
    const props = setup()
    await fillDetails('  Gabe@Example.COM  ')
    await waitFor(() => expect(props.onSignUp).toHaveBeenCalledWith('gabe@example.com', STRONG))
  })
})

describe('registration rate limiting', () => {
  it('stops submitting once the attempt budget is spent', async () => {
    // An affordance rather than a boundary -- the server-side limits are the
    // real control -- but it does stop a stuck retry loop and rage-clicks.
    const props = setup({ onSignUp: vi.fn().mockRejectedValue(new Error('nope')) })
    // No clearing round to round: `setField` REPLACES each value, so the
    // accumulation that used to need three clears cannot happen. See its note
    // for what that accumulation broke.
    // SIX SUBMITS, AND EACH ONE WAITS FOR THE LAST TO SETTLE -- see
    // `fillDetails`. The budget is spent by the fifth; the sixth is the one
    // that has to be refused before it leaves the browser, so skipping it
    // would be skipping the assertion.
    for (let i = 0; i < 6; i += 1) {
      await fillDetails('a@b.co')
    }
    expect(await screen.findByText(/Too many attempts/i)).toBeInTheDocument()
    // Five got through, the sixth was refused locally.
    expect((props.onSignUp as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(5)
  })
})

describe('the verification step', () => {
  it('shows the address the code went to', async () => {
    setup()
    await fillDetails()
    expect(await screen.findByText('gabe@example.com')).toBeInTheDocument()
  })

  it('verifies the code and then thanks the person', async () => {
    const props = setup()
    await fillDetails()
    // NO CLICK. The sixth digit submits: somebody reading a code off a phone
    // has both hands busy, and the form has exactly one thing it could do
    // next, so making them find a button is a step carrying no decision.
    await userEvent.type(await screen.findByLabelText(/^Verification code/), '123456')

    await waitFor(() =>
      expect(props.onVerify).toHaveBeenCalledWith('gabe@example.com', '123456')
    )
    expect(await screen.findByText('you are all set')).toBeInTheDocument()
    // Exactly once, however many renders the completion caused.
    expect(props.onVerify).toHaveBeenCalledTimes(1)
  })

  it('keeps digits only, so a pasted code with stray characters still works', async () => {
    // Still asserted after the switch to segmented boxes, because it is the
    // behaviour that matters rather than the widget: a code copied out of an
    // email arrives with spaces, and one read aloud arrives with letters
    // around it. Both must land as six digits instead of failing against the
    // auth server for a reason nobody can see.
    const props = setup()
    await fillDetails()
    const field = (await screen.findByLabelText(/^Verification code/)) as HTMLInputElement
    await userEvent.type(field, 'a1b2c3d4e5f6g7')
    expect(field.value).toBe('123456')
    await waitFor(() => expect(props.onVerify).toHaveBeenCalledWith('gabe@example.com', '123456'))
  })

  it('surfaces a rejected code without losing the step', async () => {
    setup({ onVerify: vi.fn().mockRejectedValue(new Error('Token has expired or is invalid')) })
    await fillDetails()
    await userEvent.type(await screen.findByLabelText(/^Verification code/), '000000')
    expect(await screen.findByText(/Token has expired/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Verification code/)).toBeInTheDocument()
  })
})

describe('the thank-you step', () => {
  it('leaves for the dashboard on its own, and offers a link in case it does not', async () => {
    const props = setup()
    await fillDetails()
    await userEvent.type(await screen.findByLabelText(/^Verification code/), '123456')

    expect(await screen.findByText('you are all set')).toBeInTheDocument()
    // The manual way out: an automatic navigation that fails silently would
    // otherwise strand someone on a thank-you page.
    expect(screen.getByRole('link', { name: /go to the overview now/i })).toHaveAttribute(
      'href',
      '/overview'
    )
    await waitFor(() => expect(props.onDone).toHaveBeenCalled())
  })
})
