import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path)
    return path.endsWith('.tsx') ? [path] : []
  })
}

describe('recharts tooltips', () => {
  // A row's colour is the series colour or black, so a tooltip without the
  // shared itemStyle is unreadable on the dark popover. See chartTooltip.ts.
  it('every recharts <Tooltip> spreads CHART_TOOLTIP', () => {
    const charts = sources(join(process.cwd(), 'src')).filter((path) =>
      /import \{[^}]*\bTooltip\b[^}]*\} from 'recharts'/.test(readFileSync(path, 'utf8'))
    )
    expect(charts.length).toBeGreaterThanOrEqual(3)
    for (const path of charts) {
      const tooltips = readFileSync(path, 'utf8').match(/<Tooltip\b[^>]*/g) ?? []
      for (const tag of tooltips) expect(tag, path).toContain('{...CHART_TOOLTIP}')
    }
  })
})
