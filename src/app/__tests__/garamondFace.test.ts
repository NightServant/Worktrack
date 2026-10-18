import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'

/**
 * The editor's "Garamond" is EB Garamond fitted to Word's metrics (see the
 * @font-face block in index.css). Without the files the browser falls back to
 * whatever it finds under that name -- Georgia, 13.5% wider -- and an imported
 * CV breaks its pages away from Word's again (Gabe, 2026-10-18).
 */
describe('the fitted Garamond face', () => {
  const css = readFileSync('src/index.css', 'utf8')
  const faces = css.match(/@font-face\s*{[^}]*font-family:\s*"Garamond"[^}]*}/g) ?? []

  it('declares all four faces, each with Word’s line box', () => {
    expect(faces).toHaveLength(4)
    for (const face of faces) {
      expect(face).toMatch(/ascent-override:/)
      expect(face).toMatch(/descent-override:/)
      expect(face).toMatch(/line-gap-override:\s*0%/)
    }
  })

  it('points at files that ship', () => {
    for (const face of faces) {
      const src = face.match(/url\("\/fonts\/([^"]+)"\)/)?.[1]
      expect(src, face).toBeTruthy()
      const path = `public/fonts/${src}`
      expect(existsSync(path), path).toBe(true)
      expect(statSync(path).size).toBeGreaterThan(100_000)
    }
  })
})
