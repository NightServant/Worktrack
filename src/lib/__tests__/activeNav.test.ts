import { describe, it, expect } from 'vitest'
import { activeNavHref } from '../activeNav'

describe('activeNavHref', () => {
  it('treats a detail route as a child of its section', () => {
    expect(activeNavHref('/applications/abc', ['/overview', '/applications'])).toBe(
      '/applications'
    )
  })

  it('highlights nothing on settings, even if a caller includes it in hrefs', () => {
    // Without the settings clause, '/settings' would be a valid match here
    // (isUnder('/settings', '/settings') is true) and the sort would pick it.
    // The clause exists precisely to override that: settings is chrome, not
    // a nav destination, no matter what the caller passes.
    expect(activeNavHref('/settings', ['/overview', '/applications', '/settings'])).toBeNull()
  })

  it('does not match a prefix that is not a path segment', () => {
    expect(activeNavHref('/applications-archive', ['/applications'])).toBeNull()
  })
})
