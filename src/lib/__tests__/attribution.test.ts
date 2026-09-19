import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { SKIPER_ATTRIBUTION } from '../attribution'

describe('third-party attribution', () => {
  it('lists every Skiper component whose source ships in this repo', () => {
    // Free-tier Skiper components require attribution. skiper51 lands in M6
    // Task 1 and skiper106 in Task 4; both are copied into src/components/v1/.
    // skiper4 and skiper26 are NOT here: their source was never installed --
    // ui/theme-toggle.tsx was written against skiper4's technique and its
    // docblock records why skiper26 was declined. They are credited as
    // inspiration in the README prose, which is a courtesy, not this
    // obligation.
    expect(SKIPER_ATTRIBUTION.map((e) => e.id)).toEqual(['skiper51', 'skiper106'])
  })

  it('gives every entry a credit sentence, a name and a link', () => {
    expect(SKIPER_ATTRIBUTION.length).toBeGreaterThan(0)
    for (const entry of SKIPER_ATTRIBUTION) {
      expect(entry.name.length).toBeGreaterThan(0)
      expect(entry.credit.length).toBeGreaterThan(0)
      expect(entry.href).toMatch(/^https:\/\//)
    }
  })

  it('reproduces every credit sentence verbatim in the README', () => {
    // The licence obligation is on what ships. The landing footer renders
    // these same strings (Task 2), so one edit keeps both honest.
    const readme = readFileSync('README.md', 'utf8')
    expect(readme).toContain('## Attribution')
    for (const entry of SKIPER_ATTRIBUTION) {
      expect(readme, `README is missing the credit for ${entry.id}`).toContain(entry.credit)
    }
  })

  it('names the upstreams the roadmap requires', () => {
    const readme = readFileSync('README.md', 'utf8')
    expect(readme).toContain('Skiper UI')
    expect(readme).toContain('Swiper.js')
    expect(readme).toContain('AarzooAly')
    expect(readme).toContain('toggles.dev')
    expect(readme).toContain('rudrodip/theme-toggle-effect')
  })
})

/**
 * The README, as a tested artefact.
 *
 * It shipped claiming "304 unit tests across 28 files" -- wrong within a day
 * and still wrong a milestone later, by which point the real figure was over a
 * thousand. A README that lies is worse than a short one, and the only kind of
 * claim that stays true without maintenance is one nothing has to maintain.
 * These assertions either read the repository for the answer or ban the class
 * of statement that decays.
 */
describe('the README describes this repository', () => {
  const readme = () => readFileSync('README.md', 'utf8')

  it('names the React major the repo actually depends on', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    const major = pkg.dependencies.react.replace(/^[^\d]*/, '').split('.')[0]
    expect(readme()).toContain(`React ${major}`)
    expect(readme()).not.toContain(`React ${Number(major) - 1}`)
  })

  it('does not quote a test count, which decays on every commit', () => {
    // The banned sentence, and the two ways it tends to be written.
    const text = readme()
    expect(text).not.toMatch(/\b\d{2,5}\s+unit tests\b/)
    expect(text).not.toMatch(/\b\d{2,5}\s+tests\s+across\b/)
  })

  it('quotes no other figure that goes stale on its own', () => {
    // Same rule as the landing page's proof section: a number nothing
    // recomputes is a claim that rots. Route counts and file counts are the
    // two that were in here.
    const text = readme()
    expect(text).not.toMatch(/\b\d+\s+(?:authenticated\s+)?routes\b/)
    expect(text).not.toMatch(/\b\d+\s+files\b/)
  })

  it('links the demo and the auth routes', () => {
    const text = readme()
    expect(text).toContain('](/login')
    expect(text).toContain('](/signup')
    expect(text).toContain('/demo/overview')
    // Tolerant of the section NUMBER, not of the section being absent. The
    // README follows the numbered-heading structure used across these repos,
    // so a literal '## Demo' would fail on '## 4. Demo' and force the
    // numbering to be dropped to satisfy a test about content.
    expect(text).toMatch(/^##\s+(?:\d+\.\s+)?Demo\s*$/m)
  })

  it('shows the screens it claims to have, and only screens that exist', () => {
    // Both directions. An embedded image that 404s is the most visible
    // possible way for a README to be wrong.
    const text = readme()
    // `overview`, not `dashboard`: the captures are named for the screen the
    // app's own nav shows, and the route file is still /overview.
    for (const shot of ['overview', 'applications', 'analytics']) {
      expect(text, `README does not embed the ${shot} screenshot`).toMatch(
        new RegExp(`/screens/[a-z]+/[a-z]+/${shot}\\.(?:jpg|png)`)
      )
    }
    // Paths are theme AND TIER scoped now -- public/screens/<theme>/<tier>/<name>.jpg
    // -- so the check walks two levels rather than one. This test has now
    // caught both moves: the flat-to-theme one, and the theme-to-tier one when
    // the carousel started art-directing by viewport. Either would have
    // shipped five broken images in the README.
    const embedded = [...text.matchAll(/\/screens\/([a-z]+\/[a-z]+\/[a-z-]+\.(?:jpg|png))/g)].map(
      (m) => m[1]
    )
    expect(embedded.length).toBeGreaterThan(0)
    for (const rel of new Set(embedded)) {
      expect(
        existsSync(join('public/screens', rel)),
        `README embeds ${rel}, which is not in public/screens`
      ).toBe(true)
    }
  })

  it('names every route the app really serves under Features', () => {
    // The old README described screens M5 had already replaced. Read from the
    // filesystem so a deleted route fails the claim rather than outliving it.
    const text = readme()
    const routes = readdirSync('src/app/(app)', { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_') && d.name !== '__tests__')
      .map((d) => d.name)
    expect(routes.length).toBeGreaterThan(4)
    for (const route of routes) {
      expect(text, `the app serves /${route} and the README never mentions it`).toContain(
        `/${route}`
      )
    }
  })

  it('ships a licence, and the README points at it', () => {
    // The repository had no LICENSE at all until 2026-09-11 while the landing
    // page said "Open source" -- a claim with nothing behind it. Both halves
    // are checked: the file exists, and the README names it, because a licence
    // nobody can find from the front page is a licence nobody will rely on.
    const licence = readFileSync('LICENSE', 'utf8')
    expect(licence).toContain('MIT License')
    expect(licence).toContain('Permission is hereby granted')
    const text = readme()
    expect(text).toMatch(/^##\s+Licence\s*$/m)
    expect(text).toContain('](LICENSE)')
  })

  it('names every copyright holder the licence does', () => {
    // TWO AUTHORS, and this is the assertion that keeps them in step. A
    // one-name copyright line over another author's commits grants rights
    // nobody had to give; if a holder is ever added or removed, the README has
    // to say so too rather than quietly disagreeing with the LICENSE file.
    const licence = readFileSync('LICENSE', 'utf8')
    const holders = [...licence.matchAll(/^Copyright \(c\) \d{4} (.+)$/gm)].map((m) => m[1])
    expect(holders.length).toBeGreaterThanOrEqual(2)
    for (const holder of holders) {
      // Surnames, so a GitHub handle or a bracketed alias in the README does
      // not have to match the licence line character for character.
      const surname = holder.trim().split(/\s+/).pop()!
      expect(readme(), `README does not name ${holder}`).toContain(surname)
    }
  })
})
