'use client'

import * as React from 'react'

/**
 * The prefix every in-app link is built from.
 *
 * `''` in the real app, `'/demo'` inside /demo/*.
 *
 * It exists because the demo renders the REAL screens, and those screens link
 * to each other with absolute paths -- `/applications/<id>`, `/planner`,
 * `/cv?draft=<id>`. Left alone, a demo visitor clicking any application row
 * leaves the demo, hits the (app) auth guard, and is bounced to /login. The
 * nav was fixed for exactly this reason; these seven links are the same bug
 * one layer down, and they are the ones a visitor is far more likely to click.
 *
 * A context rather than a prop threaded through seven components: the value is
 * set once by a layout and read at the leaves, and prop-drilling it through
 * Dashboard -> RecentApplicationsTable -> Link would put a demo concern in the
 * signature of every screen in the app.
 *
 * Default `''` means every existing caller keeps its current behaviour without
 * a provider, so the real app is unchanged by this.
 */
const RouteBaseContext = React.createContext<string>('')

export function RouteBaseProvider({
  base,
  children,
}: {
  base: string
  children: React.ReactNode
}) {
  return <RouteBaseContext.Provider value={base}>{children}</RouteBaseContext.Provider>
}

/** The current prefix. `''` in the app, `'/demo'` in the demo. */
export function useRouteBase(): string {
  return React.useContext(RouteBaseContext)
}

/**
 * Builds an in-app href under the current base.
 *
 * `appHref('/applications/1')` is `/applications/1` in the app and
 * `/demo/applications/1` in the demo.
 */
export function useAppHref(): (path: string) => string {
  const base = useRouteBase()
  return React.useCallback((path: string) => `${base}${path}`, [base])
}
