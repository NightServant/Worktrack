import { Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Document from '@tiptap/extension-document'
import Heading from '@tiptap/extension-heading'
import Paragraph from '@tiptap/extension-paragraph'
import TextAlign from '@tiptap/extension-text-align'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import Highlight from '@tiptap/extension-highlight'
import {
  BackgroundColor,
  Color,
  FontFamily,
  FontSize,
  LineHeight,
  TextStyle,
} from '@tiptap/extension-text-style'

/**
 * What the Word editor can do, in one list.
 *
 * ONE DEFINITION, SHARED WITH THE TESTS, and that is the whole reason this is
 * a module rather than an inline array. The ribbon calls `setFontFamily`,
 * `setTextAlign`, `toggleHighlight` and friends; if the editor under test is
 * built from a different extension set than the real one, those commands are
 * simply absent and the test fails with "not a function" -- which is exactly
 * what happened on 2026-09-11 when the toolbar test still built a StarterKit
 * editor. A shared list makes that impossible: the ribbon is tested against
 * the same capabilities it ships with.
 *
 * STARTERKIT COVERS bold, italic, underline, strike, lists, headings, code,
 * blockquote, horizontal rule and history. EVERYTHING ELSE HERE HAD TO BE
 * ADDED for Word's Home tab -- alignment, font family, font size, colour,
 * highlight, line spacing, sub/superscript. Half the ribbon had nothing to
 * call before them.
 *
 * PINNED TO 3.22.5 to match `@tiptap/core`. The current releases want core
 * 3.31 and npm refuses the graph; upgrading core under a working editor to
 * gain a toolbar is the wrong trade.
 */
/**
 * The `doc` node, taught to carry the page it was imported at.
 *
 * AN ATTRIBUTE ON THE DOCUMENT IS THE ONLY PLACE THIS SURVIVES. The page
 * geometry read out of a .docx has to outlive being typed in and saved, and
 * tiptap re-serialises from the schema -- so a key sitting beside `type:
 * 'doc'` in the JSON is dropped the first time the editor writes it back, and
 * the imported margins would silently revert to the default on the first
 * autosave. Declared here, `getJSON()` returns it intact.
 *
 * `renderHTML` returns nothing for it, because this is geometry for the
 * editor's sheet and not something that belongs in exported markup.
 */
const DocumentWithPage = Document.extend({
  addAttributes() {
    return {
      pageGeometry: {
        default: null,
        // Not rendered to the DOM and not parsed back from it: the value is
        // carried in the JSON, which is what gets stored.
        renderHTML: () => ({}),
        parseHTML: () => null,
      },
      /** The face, size and spacing the document was set in. Same reasoning. */
      documentTypography: {
        default: null,
        renderHTML: () => ({}),
        parseHTML: () => null,
      },
    }
  },
})

/**
 * The space Word puts above and below a paragraph, carried per block.
 *
 * ONE NUMBER FOR THE WHOLE DOCUMENT WAS NOT ENOUGH, which is the bug these
 * attributes exist for. The imported CV writes eight different `w:after`
 * values -- 0.5pt under a bullet, 4pt between skills lines, 8pt under the
 * contact line -- and rendering the median of them made the skills section
 * half an inch shorter than Word draws it. See lib/pageGeometry.
 *
 * `padding-top` RATHER THAN `margin-top`, AND THAT IS THE POINT. CSS collapses
 * adjacent vertical margins and takes the larger; Word ADDS space-after to the
 * next paragraph's space-before. A bullet closing a section at 0.5pt after,
 * followed by a heading at 6.5pt before, is a 7pt gap in Word and would be a
 * 6.5pt gap in CSS. Padding does not collapse, so the sum survives.
 *
 * `margin-top: 0` GOES WITH IT because the editor's own stylesheet sets a
 * heading margin from the document's heading spacing; without this the two
 * would stack and every section heading would sit at double its gap.
 */
const SPACING_ATTRIBUTES = {
  spaceBefore: {
    default: null as number | null,
    renderHTML: (attributes: Record<string, unknown>) =>
      typeof attributes.spaceBefore === 'number'
        ? { style: `margin-top: 0; padding-top: ${attributes.spaceBefore}pt` }
        : {},
    parseHTML: (element: HTMLElement) => sizeFromStyle(element.style.paddingTop),
  },
  spaceAfter: {
    default: null as number | null,
    renderHTML: (attributes: Record<string, unknown>) =>
      typeof attributes.spaceAfter === 'number'
        ? { style: `margin-bottom: ${attributes.spaceAfter}pt` }
        : {},
    parseHTML: (element: HTMLElement) => sizeFromStyle(element.style.marginBottom),
  },
}

/** Points back out of a rendered style, so a copied paragraph keeps its gaps. */
function sizeFromStyle(value: string | undefined): number | null {
  const points = Number.parseFloat(value?.replace('pt', '') ?? '')
  return value?.endsWith('pt') && Number.isFinite(points) ? points : null
}

/**
 * The rule Word draws as a bottom border on a paragraph. Headings carry it
 * for their section lines; paragraphs carry it too since 2026-10-18, for the
 * line under the summary on Gabe's new CV.
 */
const RULED_ATTRIBUTE = {
  ruled: {
    default: false,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.ruled ? { 'data-ruled': 'true' } : {},
    parseHTML: (element: HTMLElement) => element.getAttribute('data-ruled') === 'true',
  },
}

/** Paragraphs, taught the same. */
const ParagraphWithSpacing = Paragraph.extend({
  addAttributes() {
    return { ...this.parent?.(), ...SPACING_ATTRIBUTES, ...RULED_ATTRIBUTE }
  },
})

/**
 * A tab to a RIGHT tab stop: what follows it sits at the right margin.
 *
 * ADDED 2026-10-18 for Gabe's new CV, which sets every entry as
 * "Title<tab>Date" with a right tab stop at the margin. The editor had no tab
 * stops, so the date followed its title a tab's width along. One kind of stop
 * is all a CV uses, so this is not a tab-stop model: the paragraph becomes a
 * row and this spacer takes the free width (see the editor's stylesheet), the
 * .docx export writes a real right stop at the text column's edge, and the
 * PDF lays the two halves out as a row.
 *
 * `renderText` is a tab, so `getText()` -- the ATS score, tailoring, word
 * counts -- reads "Title<tab>Date" rather than two words fused together.
 */
const RightTab = Node.create({
  name: 'rightTab',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  parseHTML: () => [{ tag: 'span[data-right-tab]' }],
  renderHTML: () => ['span', { 'data-right-tab': '' }],
  renderText: () => '\t',
})

/**
 * Headings, taught to carry the rule Word draws under a section.
 *
 * `w:pBdr` is a border on the PARAGRAPH, not a horizontal rule between them,
 * and it is most of what makes a CV look like a CV. mammoth cannot carry it --
 * its paragraph object exposes no borders at all -- so the import matches
 * those headings by text and sets this. Rendered as a real attribute so it
 * survives a round trip through the editor and reaches the export.
 */
const HeadingWithRule = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...SPACING_ATTRIBUTES,
      ...RULED_ATTRIBUTE,
    }
  },
})

export const WORD_EDITOR_EXTENSIONS = [
  // StarterKit's own Document, Heading and Paragraph are replaced by the three
  // above.
  StarterKit.configure({ document: false, heading: false, paragraph: false }),
  DocumentWithPage,
  HeadingWithRule,
  ParagraphWithSpacing,
  RightTab,
  TextStyle,
  FontFamily,
  FontSize,
  Color,
  BackgroundColor,
  LineHeight,
  Highlight.configure({ multicolor: true }),
  Subscript,
  Superscript,
  // Headings included: Word aligns them like any other paragraph.
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
]
