import { describe, it, expect } from 'vitest'
import { buildLatex, escapeLatex } from '../latexExport'

/**
 * The .tex the CV editor hands over.
 *
 * "WITHOUT BREAKING FORMATS" (Gabe, 2026-09-15) IS TWO DIFFERENT FAILURES and
 * these tests are split along that line.
 *
 * The first is that it must COMPILE. LaTeX reserves ten characters, and a CV
 * is full of four of them -- `&` in "R&D", `%` in "20% growth", `#` in "C#",
 * `_` in an email. One unescaped character is not a formatting glitch; it is a
 * file that does not build, on somebody else's machine, after they have been
 * sent it.
 *
 * The second is that it must be the SAME DOCUMENT. Every property the editor
 * carries has a LaTeX equivalent, and silently dropping one produces a file
 * that compiles into something that is not the CV. `docxExport` shipped
 * exactly that bug twice -- page setup, then heading rules -- so the
 * carry-through is asserted property by property here rather than trusted.
 */

const doc = (content: unknown[], attrs?: Record<string, unknown>) => ({
  type: 'doc',
  ...(attrs ? { attrs } : {}),
  content,
})
const para = (text: string, attrs?: Record<string, unknown>) => ({
  type: 'paragraph',
  ...(attrs ? { attrs } : {}),
  content: [{ type: 'text', text }],
})

describe('escaping, which decides whether the file builds at all', () => {
  it('escapes every character TeX reserves', () => {
    // The four that actually turn up on a CV, plus the rest for completeness.
    expect(escapeLatex('R&D')).toBe('R\\&D')
    expect(escapeLatex('20% growth')).toBe('20\\% growth')
    expect(escapeLatex('C#')).toBe('C\\#')
    expect(escapeLatex('first_last@example.com')).toBe('first\\_last@example.com')
    expect(escapeLatex('$40k')).toBe('\\$40k')
    expect(escapeLatex('{braces}')).toBe('\\{braces\\}')
  })

  it('does not re-escape what it has just escaped', () => {
    /*
      THE BUG A CHAIN OF `.replace()` CALLS WOULD HAVE. Escaping `&` to `\\&`
      and THEN escaping backslashes turns it into `\\textbackslash{}&` -- every
      escape mangled by the next rule. A single pass over a character class is
      what makes the order irrelevant, and this is the assertion that pins it.
    */
    expect(escapeLatex('a & b')).toBe('a \\& b')
    expect(escapeLatex('C:\\path & more')).toBe('C:\\textbackslash{}path \\& more')
  })

  it('uses the commands, not a backslash, for the three that need them', () => {
    // `\~` and `\^` are ACCENTS -- they expect a letter to sit over and eat the
    // next character. `\\` is a line break, not a literal backslash. All three
    // need a named command and a `{}` to stop it swallowing the space after.
    expect(escapeLatex('~')).toBe('\\textasciitilde{}')
    expect(escapeLatex('^')).toBe('\\textasciicircum{}')
    expect(escapeLatex('\\')).toBe('\\textbackslash{}')
  })

  it('converts the typography a word processor leaves in the text', () => {
    // Not escaping -- the second half of "does not break". A CV pasted from
    // Word is full of these, and pdfLaTeX's default encoding renders them as
    // garbage or drops them silently.
    expect(escapeLatex('Gabe\u2019s')).toBe("Gabe's")
    expect(escapeLatex('2024\u20132026')).toBe('2024--2026')
    expect(escapeLatex('one \u2014 two')).toBe('one --- two')
    expect(escapeLatex('\u201cquoted\u201d')).toBe("``quoted''")
  })

  it('escapes text that reaches the document body, not just the helper', () => {
    // The helper being correct is worth nothing if a node type forgets to call
    // it. This is the end-to-end version of the first test.
    const out = buildLatex(doc([para('Led R&D on 20% of C# services')]), 'CV')
    expect(out).toContain('Led R\\&D on 20\\% of C\\# services')
    expect(out).not.toMatch(/[^\\]&/)
  })
})

describe('the document survives the trip', () => {
  it('always produces something compilable', () => {
    const out = buildLatex(doc([para('Hello')]), 'CV')
    expect(out).toContain('\\documentclass{article}')
    expect(out).toContain('\\begin{document}')
    expect(out).toContain('\\end{document}')
    // Every package it names must be one a default TeX Live has. A .tex that
    // needs something from CTAN first is a .tex that does not build on the
    // machine it was sent to.
    const packages = [...out.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g)].map((m) => m[1])
    for (const name of packages) {
      expect(
        ['iftex', 'fontenc', 'lmodern', 'fontspec', 'inputenc', 'geometry', 'enumitem', 'ragged2e', 'setspace'],
        `${name} is not in the known-safe set`
      ).toContain(name)
    }
  })

  it('carries the page geometry, which is the property docx lost twice', () => {
    const out = buildLatex(
      doc([para('x')], {
        pageGeometry: { width: 8.27, height: 11.69, margin: { top: 0.6, right: 0.5, bottom: 0.6, left: 0.5 } },
      }),
      'CV'
    )
    expect(out).toContain('paperwidth=8.27in')
    expect(out).toContain('paperheight=11.69in')
    expect(out).toContain('top=0.6in')
    expect(out).toContain('left=0.5in')
  })

  it('carries the face, the body size, the leading and the paragraph spacing', () => {
    const out = buildLatex(
      doc([para('x')], {
        documentTypography: {
          fontFamily: '"Georgia", serif',
          fontSize: 10.5,
          lineHeight: 1.15,
          paragraphSpacing: 4,
          titleSize: null,
          sectionSize: null,
          headingSpaceBefore: null,
          headingSpaceAfter: null,
        },
      }),
      'CV'
    )
    // The real face, under the engines that can load one.
    expect(out).toContain('\\setmainfont{Georgia}')
    // 10.5pt is not a `documentclass` option, which is why the size is set in
    // the body instead of as `[10.5pt]{article}`.
    expect(out).toContain('10.5pt')
    expect(out).toContain('\\setstretch{1.15}')
    expect(out).toContain('\\setlength{\\parskip}{4pt}')
  })

  it('compiles under pdflatex as well as the unicode engines', () => {
    // A .tex that only builds under XeLaTeX, sent to somebody whose editor
    // defaults to pdfLaTeX, is exactly the "breaks" being avoided. The branch
    // is the one thing in the preamble that is engine-dependent.
    const out = buildLatex(doc([para('x')], { documentTypography: { fontFamily: 'Arial, sans-serif' } }), 'CV')
    expect(out).toContain('\\usepackage{iftex}')
    expect(out).toContain('\\ifPDFTeX')
    expect(out).toContain('\\else')
    expect(out).toContain('\\fi')
    // pdfLaTeX cannot load "Arial"; the best it can do is the right CATEGORY.
    expect(out).toContain('\\renewcommand{\\familydefault}{\\sfdefault}')
  })

  it('draws the rule under a ruled heading and nothing under a plain one', () => {
    const ruled = buildLatex(
      doc([{ type: 'heading', attrs: { level: 2, ruled: true }, content: [{ type: 'text', text: 'Experience' }] }]),
      'CV'
    )
    const plain = buildLatex(
      doc([{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Experience' }] }]),
      'CV'
    )
    expect(ruled).toContain('\\hrule')
    expect(plain).not.toContain('\\hrule')
  })

  it('carries alignment, which the docx export was silently dropping too', () => {
    const out = buildLatex(doc([para('Gabe Cervantes', { textAlign: 'center' })]), 'CV')
    expect(out).toContain('\\centering')
  })

  it('keeps bold and italic, and groups a sized run so it does not leak', () => {
    const out = buildLatex(
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Engineer', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' at ' },
            { type: 'text', text: 'Acme', marks: [{ type: 'italic' }] },
            {
              type: 'text',
              text: 'small',
              marks: [{ type: 'textStyle', attrs: { fontSize: '8pt' } }],
            },
          ],
        },
      ]),
      'CV'
    )
    expect(out).toContain('\\textbf{Engineer}')
    expect(out).toContain('\\textit{Acme}')
    // THE BRACES ARE THE TEST. `\selectfont` holds until the end of the
    // enclosing group, so an ungrouped sized run resizes the whole rest of the
    // document from that point on.
    expect(out).toContain('{\\fontsize{8pt}{9.6pt}\\selectfont small}')
  })

  it('writes a real list rather than hyphens', () => {
    // The same reasoning the docx export gives: a typed "- " is part of the
    // sentence to anything reading the file, where a list is structure.
    const out = buildLatex(
      doc([
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [para('Shipped the thing')] },
            { type: 'listItem', content: [para('Shipped another')] },
          ],
        },
      ]),
      'CV'
    )
    expect(out).toContain('\\begin{itemize}')
    expect(out).toContain('\\item Shipped the thing')
    expect(out).toContain('\\end{itemize}')
  })

  it('survives an empty document without emitting a broken preamble', () => {
    const out = buildLatex(doc([]), '')
    expect(out).toContain('\\begin{document}')
    expect(out).toContain('\\end{document}')
    expect(out).not.toContain('undefined')
    expect(out).not.toContain('NaN')
  })
})

describe('a right-tabbed date in LaTeX (2026-10-18)', () => {
  it('pushes the date to the margin with \\hfill', () => {
    const tex = buildLatex(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Clover' }, { type: 'rightTab' }, { type: 'text', text: 'Aug 2026' }],
          },
        ],
      },
      'CV'
    )
    expect(tex).toContain('Clover\\hfill Aug 2026')
  })
})
