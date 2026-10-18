import { normalizeGeometry, normalizeTypography } from '@/lib/pageGeometry'

/**
 * The Word editor's TipTap document, as a compilable .tex file.
 *
 * WHY THIS EXISTS AGAIN, AFTER THE LATEX EDITOR WAS DELETED. Those are two
 * different things and it is worth saying so up front, because the deletion is
 * recent and this file looks like it undoes it. The LaTeX EDITOR was a second
 * authoring surface -- a source pane, its own templates, its own compile
 * round trip -- and it went on 2026-09-13 because two editors for one document
 * kind is two things to keep in step. This is an EXPORT: one function over the
 * document somebody already typed, in the same shape as `docxExport`. Nothing
 * here can be edited, so there is no second surface to drift.
 *
 * WHAT IT IS FOR. Gabe, 2026-09-15: "make sure these word documents are able
 * to be exported as LaTeX files without breaking formats." Academic and
 * research applications routinely ask for a .tex source, and a CV that can
 * only leave this app as .docx or PDF is one a postdoc application cannot use.
 *
 * "WITHOUT BREAKING FORMATS" IS THE WHOLE SPECIFICATION, and it has two
 * halves that fail in completely different ways.
 *
 *   IT MUST COMPILE. LaTeX has ten characters that mean something other than
 *   themselves, and a CV is full of four of them -- `&` in "R&D", `%` in "20%
 *   growth", `#` in "C#", `_` in an email or a repo name. An unescaped one is
 *   not a formatting glitch, it is a document that does not build at all. See
 *   `escapeLatex`, which is the most load-bearing function in this file.
 *
 *   IT MUST LOOK LIKE THE SAME DOCUMENT. Every property the editor carries --
 *   the page geometry, the face, the body size, the leading, the paragraph
 *   spacing, the heading sizes and the space around them, the rule under a
 *   section, the alignment, bold and italic and per-run sizes -- has a LaTeX
 *   equivalent, and dropping any of them produces a file that compiles into
 *   something that is not the CV. `docxExport` had exactly this bug twice
 *   (page setup, then the heading rules) and both times the file a recruiter
 *   opened was not the file that was uploaded.
 *
 * IT READS THE SAME THREE SOURCES `docxExport` READS, deliberately: the doc
 * node's `pageGeometry` and `documentTypography`, and the per-block
 * `spaceBefore` / `spaceAfter` / `ruled` / `textAlign`. Those are the
 * contract, not docx's. A property added for one exporter and not the other is
 * how the two outputs start disagreeing about what the document is.
 *
 * IT TARGETS pdfLaTeX AND XeLaTeX/LuaLaTeX BOTH, from one file. The preamble
 * branches on the engine exactly once, for the font, because that is the only
 * thing pdfLaTeX genuinely cannot do -- see `fontPreamble`.
 *
 * NO `\\usepackage{hyperref}`, NO COLOUR, NO CUSTOM COMMANDS. Every package
 * below is in a default TeX Live install and does one job the document
 * actually asks for. A .tex that needs something from CTAN before it builds is
 * a .tex that does not build on the machine it was sent to.
 */

interface TipTapNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: TipTapNode[]
}

/**
 * The ten characters TeX reserves, and the three that need more than a
 * backslash.
 *
 * `\\ { }` CANNOT SIMPLY BE BACKSLASHED. `\{` and `\}` are right, but `\\` is
 * a line break rather than a literal backslash -- it has to be
 * `\textbackslash{}`. The same for `~` and `^`, which are accents: a bare
 * `\~` expects a letter to put a tilde over and swallows the next character.
 * The `{}` after each command is what stops it eating the following space.
 *
 * ORDER MATTERS AND THE BACKSLASH GOES FIRST. Replacing `&` with `\&` and THEN
 * escaping backslashes would turn it into `\textbackslash{}&` -- every escape
 * re-escaped. Doing the backslash first means the ones this function
 * introduces are never seen again, which is why this is a single pass over a
 * character class rather than a chain of `.replace()` calls.
 */
const LATEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '^': '\\textasciicircum{}',
  _: '\\_',
  '%': '\\%',
  '~': '\\textasciitilde{}',
}

/**
 * Text, made safe to put in a .tex file.
 *
 * Exported because it is the function this whole file rests on and it deserves
 * to be tested directly: an unescaped `&` in a company name is a CV that does
 * not compile, and that failure surfaces on somebody else's machine.
 *
 * THE SMART QUOTES AND DASHES ARE NOT ESCAPES, they are the second half of
 * "does not break". A CV written in a word processor is full of U+2019
 * apostrophes and en dashes; pdfLaTeX's default encoding renders those as
 * garbage or drops them. Converting to TeX's own ligatures is what makes the
 * output look like the input rather than merely build.
 */
export function escapeLatex(text: string): string {
  return (
    text
      // One pass, so an escape this introduces is never re-escaped. See the
      // table's docblock for why the order inside it is not enough on its own.
      .replace(/[\\{}$&#^_%~]/g, (char) => LATEX_ESCAPES[char] ?? char)
      .replace(/\u2019/g, "'")
      .replace(/\u2018/g, '`')
      .replace(/\u201c/g, '``')
      .replace(/\u201d/g, "''")
      .replace(/\u2014/g, '---')
      .replace(/\u2013/g, '--')
      .replace(/\u2026/g, '\\ldots{}')
      // A non-breaking space is a real character in pasted contact lines and
      // is invisible in the source; `~` is TeX's own and does the same job.
      .replace(/\u00a0/g, '~')
  )
}

/** Points, rounded to a tenth -- LaTeX accepts decimals and Word writes them. */
const pt = (value: number) => `${Math.round(value * 10) / 10}pt`

/**
 * One text node with its marks applied, innermost first.
 *
 * THE SIZE MARK WRAPS IN A GROUP, `{\fontsize{}{}\selectfont ...}`, and the
 * braces are not optional: `\selectfont` changes the size until the end of the
 * enclosing group, so without them one sized run would resize the whole rest
 * of the document.
 *
 * `\linespread` IS NOT USED for the per-run size. The second argument to
 * `\fontsize` is the baseline skip, and 1.2x the size is TeX's own default
 * ratio -- a run that sets a size without one inherits the surrounding
 * baseline and overlaps when it is larger.
 */
function runFrom(node: TipTapNode): string {
  if (typeof node.text !== 'string') {
    return (node.content ?? []).map(runFrom).join('')
  }

  let out = escapeLatex(node.text)
  const marks = node.marks ?? []

  const size = marks.find((m) => m.type === 'textStyle')?.attrs?.fontSize
  const points = Number.parseFloat(String(size ?? '').replace('pt', ''))
  if (Number.isFinite(points) && points > 0) {
    out = `{\\fontsize{${pt(points)}}{${pt(points * 1.2)}}\\selectfont ${out}}`
  }

  // Innermost last: italic inside bold reads the same either way, but keeping
  // a fixed order means the output is stable and diffable.
  if (marks.some((m) => m.type === 'italic')) out = `\\textit{${out}}`
  if (marks.some((m) => m.type === 'bold')) out = `\\textbf{${out}}`
  if (marks.some((m) => m.type === 'underline')) out = `\\underline{${out}}`
  return out
}

/**
 * The inline content of a block, with `hardBreak` as a real line break and a
 * `rightTab` as `\hfill`, which pushes what follows to the right margin.
 */
function inlineFrom(node: TipTapNode): string {
  return (node.content ?? [])
    .map((child) =>
      child.type === 'hardBreak' ? '\\\\\n' : child.type === 'rightTab' ? '\\hfill ' : runFrom(child)
    )
    .join('')
    .trim()
}

/**
 * The vertical space a block asks for, as `\vspace`.
 *
 * `\vspace*` RATHER THAN `\vspace`, and it matters at exactly one place: the
 * top of a page. Plain `\vspace` is discarded at a page break, so a heading
 * that happens to land first on page two would lose the space above it and sit
 * flush against the margin -- which is the kind of difference that only shows
 * up on the two-page CV somebody actually sends.
 */
function spaceBefore(node: TipTapNode): string {
  const value = node.attrs?.spaceBefore
  return typeof value === 'number' && value > 0 ? `\\vspace*{${pt(value)}}\n` : ''
}

function spaceAfter(node: TipTapNode): string {
  const value = node.attrs?.spaceAfter
  return typeof value === 'number' && value > 0 ? `\n\\vspace*{${pt(value)}}` : ''
}

/**
 * Alignment, as an environment rather than a declaration.
 *
 * `\begin{center}` ADDS ITS OWN VERTICAL SPACE and `\centering` does not,
 * which is why this uses the second inside a group. A centred name followed by
 * a centred contact line would otherwise gain two invisible paragraph gaps
 * that no other exporter puts there, and the LaTeX file would be visibly
 * looser than the .docx of the same document.
 */
function aligned(node: TipTapNode, body: string): string {
  switch (node.attrs?.textAlign) {
    case 'center':
      return `{\\centering ${body}\\par}`
    case 'right':
      return `{\\raggedleft ${body}\\par}`
    case 'justify':
      // The document is `\raggedright` by default (see the preamble), so
      // justification has to be asked for explicitly where it is wanted.
      return `{\\justifying ${body}\\par}`
    default:
      return body
  }
}

/**
 * A section heading.
 *
 * NOT `\section`, AND THAT IS DELIBERATE. `\section` brings a number, a
 * fixed size from the document class, and its own spacing -- three things the
 * document has already stated and that would be silently overridden. The
 * headings here are typeset directly, which means every size and gap in the
 * output is one the editor actually carries.
 *
 * THE RULE IS AN `\hrule` IN A GROUP, not `\rule{\linewidth}`. The second
 * draws a box on the current line and needs its own spacing arithmetic around
 * it; `\hrule` is a vertical-mode primitive that spans the text column by
 * definition, which is exactly what Word's paragraph border does.
 */
function headingFrom(node: TipTapNode, sizes: { title: number | null; section: number | null }): string {
  const level = Number(node.attrs?.level ?? 1)
  const size = level === 1 ? sizes.title : sizes.section
  const body = inlineFrom(node)
  if (!body) return ''

  const sized = size
    ? `{\\fontsize{${pt(size)}}{${pt(size * 1.2)}}\\selectfont\\bfseries ${body}}`
    : `{\\bfseries ${body}}`

  const rule = node.attrs?.ruled
    ? '\n\\vspace{1pt}\\hrule height 0.4pt\\vspace{2pt}'
    : ''

  return `${spaceBefore(node)}${aligned(node, sized)}${rule}${spaceAfter(node)}\n\n`
}

function blockFrom(node: TipTapNode, sizes: { title: number | null; section: number | null }): string {
  switch (node.type) {
    case 'heading':
      return headingFrom(node, sizes)

    case 'paragraph': {
      const body = inlineFrom(node)
      // An empty paragraph is spacing somebody put there on purpose -- the
      // same reading `docxExport` takes. `\null` gives TeX something to set,
      // because a paragraph with no content produces no vertical space at all.
      if (!body) return '\\null\n\n'
      return `${spaceBefore(node)}${aligned(node, body)}${spaceAfter(node)}\n\n`
    }

    case 'bulletList':
    case 'orderedList': {
      const env = node.type === 'bulletList' ? 'itemize' : 'enumerate'
      const items = (node.content ?? [])
        .map((item) =>
          (item.content ?? [])
            .map((block) => inlineFrom(block))
            .filter(Boolean)
            .join('\\\\\n')
        )
        .filter(Boolean)
        .map((text) => `  \\item ${text}`)
      if (items.length === 0) return ''
      // `nosep` comes from enumitem and removes the list's own vertical
      // padding, which LaTeX sets generously for prose and which would make
      // every bullet block on a CV taller than the editor shows it.
      return `\\begin{${env}}[nosep,leftmargin=*]\n${items.join('\n')}\n\\end{${env}}\n\n`
    }

    case 'hardBreak':
      return '\\\\\n'

    default:
      if (node.content) return node.content.map((child) => blockFrom(child, sizes)).join('')
      return node.text ? `${escapeLatex(node.text)}\n\n` : ''
  }
}

/**
 * The font, which is the one place the engine matters.
 *
 * pdfLaTeX CANNOT LOAD A SYSTEM FONT. It resolves faces through TeX's own font
 * packages, so "Georgia" is simply not available to it -- the best it can do
 * is the right CATEGORY, a serif or a sans, which is most of what the reader
 * sees anyway. XeLaTeX and LuaLaTeX can load the real face through fontspec.
 *
 * SO THE PREAMBLE BRANCHES ONCE, on `iftex`, and the file compiles under
 * either engine. Sending a .tex that only builds under XeLaTeX to somebody
 * whose editor defaults to pdfLaTeX is the "breaks" this is avoiding, and so
 * is silently dropping a serif CV into Computer Modern sans.
 *
 * `\usepackage{lmodern}` under pdfLaTeX rather than leaving the default:
 * Computer Modern has no bold small-caps and renders poorly at the sizes a CV
 * uses. Latin Modern is the same design, scalable, and ships with TeX Live.
 */
function fontPreamble(fontFamily: string | null): string[] {
  const family = (fontFamily ?? '').split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') ?? ''
  const isSans = /sans|helvetica|arial|verdana|tahoma|calibri|segoe/i.test(fontFamily ?? '')
  const isMono = /mono|courier|consolas|menlo/i.test(fontFamily ?? '')

  const lines = ['\\usepackage{iftex}', '\\ifPDFTeX']
  lines.push('  \\usepackage[T1]{fontenc}')
  lines.push('  \\usepackage{lmodern}')
  if (isSans) lines.push('  \\renewcommand{\\familydefault}{\\sfdefault}')
  if (isMono) lines.push('  \\renewcommand{\\familydefault}{\\ttdefault}')
  lines.push('\\else')
  lines.push('  \\usepackage{fontspec}')
  if (family) {
    // `Ligatures=TeX` keeps `---` and `` `` `` working the way escapeLatex
    // assumes they will under the Unicode engines too.
    lines.push(`  \\setmainfont{${family}}[Ligatures=TeX]`)
  }
  lines.push('\\fi')
  return lines
}

/**
 * The whole file.
 *
 * `article` AND NOT `moderncv` OR ANY CV CLASS. Those classes impose a layout
 * -- their own headings, their own contact block, their own colour -- which is
 * the opposite of what this function is for: the document already HAS a
 * layout, typed by its author, and the job is to reproduce it. A CV class
 * would produce a handsome document that is not the one on screen.
 *
 * `parindent=0` AND `\raggedright` ARE CV CONVENTIONS, not neutral defaults,
 * and both match what the editor shows: the browser does not indent
 * paragraphs, and the editor's text column is ragged-right. Leaving LaTeX's
 * defaults would produce indented, justified prose -- correct for a thesis,
 * wrong for the document being exported, and different from the .docx of the
 * same content.
 */
export function buildLatex(doc: unknown, title: string): string {
  const root = (doc ?? {}) as TipTapNode
  const geometry = normalizeGeometry(root.attrs?.pageGeometry)
  const type = normalizeTypography(root.attrs?.documentTypography)

  const preamble: string[] = [
    '% Generated by Worktrack. Compiles with pdflatex, xelatex or lualatex.',
    `% ${escapeLatex(title.trim() || 'CV')}`,
    '\\documentclass{article}',
    '\\usepackage[utf8]{inputenc}',
    ...fontPreamble(type.fontFamily),
    `\\usepackage[paperwidth=${geometry.width}in,paperheight=${geometry.height}in,` +
      `top=${geometry.margin.top}in,right=${geometry.margin.right}in,` +
      `bottom=${geometry.margin.bottom}in,left=${geometry.margin.left}in]{geometry}`,
    '\\usepackage{enumitem}',
    '\\usepackage{ragged2e}',
    '\\usepackage{setspace}',
    '\\pagestyle{empty}',
    '\\setlength{\\parindent}{0pt}',
    '\\raggedright',
  ]

  // The body size has to be set in the body rather than as a class option:
  // `article` only offers 10, 11 and 12pt, and the templates use halves.
  if (type.fontSize !== null) {
    const leading = type.fontSize * (type.lineHeight ?? 1.2)
    preamble.push(`\\renewcommand{\\normalsize}{\\fontsize{${pt(type.fontSize)}}{${pt(leading)}}\\selectfont}`)
  }
  if (type.lineHeight !== null) preamble.push(`\\setstretch{${type.lineHeight}}`)
  if (type.paragraphSpacing !== null) {
    preamble.push(`\\setlength{\\parskip}{${pt(type.paragraphSpacing)}}`)
  }

  const body = (root.content ?? [])
    .map((node) => blockFrom(node, { title: type.titleSize, section: type.sectionSize }))
    .join('')
    // Three or more blank lines is a `\par` LaTeX ignores and a diff nobody
    // wants to read. Two is a paragraph break.
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return [
    preamble.join('\n'),
    '',
    '\\begin{document}',
    type.fontSize !== null ? '\\normalsize' : '',
    '',
    body,
    '',
    '\\end{document}',
    '',
  ]
    .filter((part, index, all) => !(part === '' && all[index - 1] === ''))
    .join('\n')
}
