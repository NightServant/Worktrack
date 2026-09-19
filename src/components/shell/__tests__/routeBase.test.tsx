import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { RouteBaseProvider, useAppHref, useRouteBase } from '../routeBase'

describe('the route base', () => {
  it('is empty in the real app, so nothing changes without a provider', () => {
    const { result } = renderHook(() => useAppHref())
    expect(result.current('/applications/abc')).toBe('/applications/abc')
    expect(renderHook(() => useRouteBase()).result.current).toBe('')
  })

  it('prefixes every in-app link inside the demo', () => {
    // The bug: the demo renders the REAL screens, whose rows link to
    // /applications/<id>. Unprefixed, clicking one leaves the demo, hits the
    // (app) auth guard and lands on /login -- which reads as the demo being
    // broken rather than as a boundary working.
    const { result } = renderHook(() => useAppHref(), {
      wrapper: ({ children }) => <RouteBaseProvider base="/demo">{children}</RouteBaseProvider>,
    })
    expect(result.current('/applications/abc')).toBe('/demo/applications/abc')
    expect(result.current('/planner')).toBe('/demo/planner')
  })
})
