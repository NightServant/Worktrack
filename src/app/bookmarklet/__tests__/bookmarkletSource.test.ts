import { describe, it, expect } from 'vitest'
import { bookmarkletSource, profileBookmarkletSource } from '../source'

/**
 * A bookmarklet is a STRING, and nothing else in this project checks it.
 *
 * It is written inside a TypeScript template literal, so every backslash in it
 * is escaped twice and a regex literal three times -- and the failure mode is
 * silent: the page renders, the link drags onto the bookmarks bar, and
 * clicking it does nothing at all because the browser could not parse it.
 * `new Function` is the cheapest thing that would have caught that.
 */
const body = (source: string) => {
  expect(source.startsWith('javascript:')).toBe(true)
  return source.slice('javascript:'.length)
}

describe('the bookmarklets a reader installs', () => {
  it('produce JavaScript a browser can parse', () => {
    expect(() => new Function(body(bookmarkletSource('https://worktrack.test')))).not.toThrow()
    expect(() =>
      new Function(body(profileBookmarkletSource('https://worktrack.test')))
    ).not.toThrow()
  })

  it('carry the origin they were served from, quoted', () => {
    // It is the `targetOrigin` of every postMessage, so a mis-quoted origin is
    // a bookmarklet that talks to nobody.
    expect(profileBookmarkletSource('https://worktrack.test')).toContain(
      '"https://worktrack.test"'
    )
  })

  it('fetches the detail pages the profile itself does not carry', () => {
    // Gabe, 2026-09-19: "why credentials is 2? I told you its eight". The rest
    // of a long section is on its own page; the bookmarklet reads them from
    // the session it is running in.
    const source = profileBookmarkletSource('https://worktrack.test')
    for (const section of ['certifications', 'education', 'experience', 'projects', 'skills']) {
      expect(source).toContain(section)
    }
    expect(source).toContain("credentials:'include'")
  })

  it('posts nothing until those fetches have finished', () => {
    // The receiver acks the first message it accepts and the sender stops
    // retrying on that ack, so posting early would deliver the profile alone
    // and throw the subpages away.
    const source = profileBookmarkletSource('https://worktrack.test')
    expect(source.indexOf('function go()')).toBeLessThan(source.indexOf('fetch('))
    expect(source).toContain('if(--left<=0)')
  })
})
