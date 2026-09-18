import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { useBookmarkletImport } from '../useBookmarkletImport'

/**
 * The bookmarklet's receiving end.
 *
 * WHAT IS ACTUALLY AT RISK HERE. A posting can live on any site, so this
 * listener cannot use an origin allowlist without defeating the feature it
 * exists for. What keeps that honest is the gate: it listens only when the
 * reader navigated in on `?import=bookmarklet`. Every test below is about that
 * gate and the shape check behind it, because "accepts a message from anywhere"
 * is only safe while "and only when asked" holds.
 */

function Harness({ enabled }: { enabled: boolean }) {
  const html = useBookmarkletImport(enabled)
  return <div data-testid="out">{html ?? 'nothing'}</div>
}

const send = (data: unknown) =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: 'https://www.indeed.com' }))
  })

const received = () => screen.getByTestId('out').textContent

afterEach(() => cleanup())

describe('receiving a posting from the bookmarklet', () => {
  it('takes the page source when the reader arrived from one', () => {
    render(<Harness enabled />)
    send({ type: 'worktrack:posting', html: '<html><body>a posting</body></html>' })
    expect(received()).toBe('<html><body>a posting</body></html>')
  })

  it('ignores it entirely when nobody asked for an import', () => {
    // THE WHOLE SECURITY ARGUMENT. Any page may post to a window it opened; a
    // session that did not arrive on `?import=bookmarklet` must not be a place
    // to put one.
    render(<Harness enabled={false} />)
    send({ type: 'worktrack:posting', html: '<html>unsolicited</html>' })
    expect(received()).toBe('nothing')
  })

  it('ignores messages that are not a posting', () => {
    // The window receives traffic from extensions, dev tools and embedded
    // frames. Reading `data.html` off anything that happens to have one is how
    // a listener picks up somebody else's protocol.
    render(<Harness enabled />)
    send({ type: 'something-else', html: '<html>not ours</html>' })
    send('a bare string')
    send(null)
    send({ type: 'worktrack:posting' })
    send({ type: 'worktrack:posting', html: 42 })
    expect(received()).toBe('nothing')
  })

  it('refuses a page too large to be a posting', () => {
    // The server refuses at the same number and would answer 413. Spending it
    // here too keeps a hostile or broken sender from parking megabytes in this
    // tab to find that out.
    render(<Harness enabled />)
    send({ type: 'worktrack:posting', html: 'x'.repeat(3_000_001) })
    expect(received()).toBe('nothing')
  })

  it('stops listening once it is unmounted', () => {
    const { unmount } = render(<Harness enabled />)
    unmount()
    // No assertion on output -- the point is that dispatching after unmount
    // does not throw a React state-update warning into the next test.
    expect(() => send({ type: 'worktrack:posting', html: '<html>late</html>' })).not.toThrow()
  })
})

/**
 * THE SECOND SENDER (2026-09-18). The profile bookmarklet hands over a
 * logged-in LinkedIn page -- the only client that can see the About, the
 * skills and the bullet text under each role. One hook serves both, and the
 * kind is the only difference between them, so these two tests are about
 * exactly that: a listener asked for one must not take the other.
 */
function ProfileHarness({ enabled }: { enabled: boolean }) {
  const html = useBookmarkletImport(enabled, 'profile')
  return <div data-testid="out">{html ?? 'nothing'}</div>
}

describe('receiving a profile from the bookmarklet', () => {
  it('takes a captured profile page', () => {
    render(<ProfileHarness enabled />)
    send({ type: 'worktrack:profile', html: '<html><body>a profile</body></html>' })
    expect(received()).toBe('<html><body>a profile</body></html>')
  })

  it('does not take a posting, and a posting listener does not take a profile', () => {
    // Two buttons, two destinations: a page captured on LinkedIn must not seed
    // the add-an-application wizard, and a job advert must not become somebody's
    // profile.
    render(<ProfileHarness enabled />)
    send({ type: 'worktrack:posting', html: '<html>a posting</html>' })
    expect(received()).toBe('nothing')

    cleanup()
    render(<Harness enabled />)
    send({ type: 'worktrack:profile', html: '<html>a profile</html>' })
    expect(received()).toBe('nothing')
  })
})

