import { countWords } from './proofreadScore'

/**
 * What a cover letter is checked for, and what to do about each finding.
 *
 * THIS IS THE COVER LETTER'S REPLACEMENT FOR ATS SCORING (Gabe, 2026-09-14:
 * "same format for the document editor but ATS scoring and tailoring will not
 * be included. Implement a suggestion that can serve as a replacement for ATS
 * section"). It takes the tailor pane's slot in the rail, so it has to be
 * worth the same trip: open it and learn something about the letter in front
 * of you that you could not see by rereading it.
 *
 * WHY A GENERAL WRITING SCORE WOULD HAVE BEEN A DOWNGRADE, and why this file
 * exists at all. `writingMetrics` already answers "how does this read" --
 * register, sentence length, reading ease, padding -- and it answers it for
 * any document, which is exactly the problem. Dropping those four percentages
 * into this slot would have replaced a check that knew what a CV is for with
 * one that knows nothing about what a letter is for. Everything below is a
 * thing that distinguishes a good cover letter from a bad one SPECIFICALLY:
 * who it is addressed to, how it opens, whether it shows anything, whether it
 * ends with a next step. The register half is one tab over and stays there.
 *
 * COMPUTED, NOT FETCHED, for the reason `writingMetrics` sets out at length
 * and which applies here with more force: a model asked "is this a good cover
 * letter" answers differently every time, and a person edits a letter against
 * these findings across several sittings. A finding that appears, disappears
 * and reappears while the paragraph it names is untouched is not advice, it is
 * noise. Every rule below is a pure function of the letter's own text, so the
 * pane is complete with no provider configured and there is nothing to run --
 * see `LetterCheckPane`, which has no button for that reason.
 *
 * A MODEL WAS CONSIDERED FOR TWO OF THESE AND DROPPED. "Does this restate the
 * CV" and "is this evidence or an adjective" are the two rules that would
 * genuinely read better with language understanding, and `capabilitiesOf()`
 * would have gated them. They are not worth it: both have a cheap structural
 * proxy (date ranges and bullet glyphs for the first, digits for the second)
 * that is right often enough to be worth saying, and a pane whose best half
 * only works for configured accounts is a pane most people meet broken.
 *
 * EVERY FINDING SAYS WHAT IS WRONG AND WHAT TO DO. That is not a style
 * preference, it is the correction Gabe already made once: the ATS ring
 * shipped as a bare number and was sent back for it. A finding here carries
 * the letter's own numbers where it has them -- the greeting it actually used,
 * the words it actually ran to -- so it reads as a note about this letter
 * rather than a rule from a list.
 *
 * THE ORDER IS THE ORDER YOU READ THE LETTER IN: the greeting, the opening
 * line, the body, then the close, with the whole-letter checks folded in where
 * they first bite. Sorting by severity was tried on paper and reads worse --
 * it scatters findings about the same paragraph, so fixing one means hunting
 * for the others.
 */

export type LetterFindingId =
  | 'addressee'
  | 'opening'
  | 'placeholders'
  | 'length'
  | 'shape'
  | 'evidence'
  | 'claims'
  | 'balance'
  | 'restates'
  | 'closing'

export interface LetterFinding {
  id: LetterFindingId
  /** Chrome voice: lowercase, two or three words. Names the check. */
  label: string
  /** Sentence case. What is wrong with THIS letter, in its own terms. */
  problem: string
  /** Sentence case. What to do about it. Never "consider doing". */
  fix: string
}

export interface LetterReview {
  /** Same counter the editor score uses, so the two panes cannot disagree. */
  words: number
  findings: LetterFinding[]
}

/**
 * The length a cover letter stops being read at.
 *
 * 400 WORDS IS ONE PAGE. At 11pt with an address block and a signature, a
 * letter page holds roughly 400 words, and the reader is doing this for the
 * fortieth time today. Past the fold the argument is not weaker, it is simply
 * not read, which is a worse outcome than having cut it yourself.
 */
export const MAX_LETTER_WORDS = 400

/**
 * The length below which there is not a letter here yet.
 *
 * 150 WORDS is about what a greeting, one piece of evidence and a close take
 * up once they are written as prose. Under that, something has been left out
 * rather than kept short -- it reads as a note stapled to a CV. Deliberately
 * generous: plenty of good letters are 200 words, and this is not a target.
 */
export const MIN_LETTER_WORDS = 150

/**
 * What separates a body paragraph from a greeting or a sign-off.
 *
 * 25 WORDS, and it is a structural trick rather than a judgement about
 * paragraphs. "Dear Ms Okafor," and "Kind regards, Gabe" are blocks in the
 * same tree as the argument, and parsing the grammar of letters to tell them
 * apart is far more machinery than this needs. Nothing anybody writes as a
 * salutation runs to 25 words, and nothing anybody writes as a paragraph comes
 * in under it.
 */
const BODY_PARAGRAPH_WORDS = 25

/**
 * The shape of the body.
 *
 * THREE PARAGRAPHS IS THE MINIMUM SHAPE: why this job, what you have actually
 * done, what happens next. Two means one of the three was skipped, and it is
 * almost always the middle one.
 *
 * 150 WORDS IS WHERE A PARAGRAPH STOPS BEING READ -- roughly twelve lines at
 * this width, which is the block a skimming eye jumps over rather than enters.
 * Splitting it costs nothing and is almost always possible, because a
 * paragraph that long is carrying two points.
 */
const MIN_BODY_PARAGRAPHS = 3
const MAX_PARAGRAPH_WORDS = 150

/**
 * The length below which the whole-letter rules stay quiet.
 *
 * 80 WORDS. Evidence, balance and the close are all statements about a
 * finished letter; firing them at a half-written draft means the pane spends
 * its first two minutes being wrong, and a pane that is wrong early gets
 * closed. The structural rules -- the greeting, the opening line, leftover
 * placeholders -- have no such floor, because they are already wrong at
 * twenty words and fixing them early is free.
 */
const DRAFT_FLOOR_WORDS = 80

/**
 * How lopsided the pronouns can get before the letter is talking to itself.
 *
 * THREE TO ONE. Some imbalance is correct -- the letter is about what you did
 * -- so an even split is not the goal and would not be good writing. Three
 * mentions of yourself for every mention of them is where it stops being a
 * letter to somebody and becomes a statement read aloud in their direction.
 */
const SELF_TO_READER_RATIO = 3

/**
 * How many hollow claims it takes before they are the letter's substance.
 *
 * TWO. One "passionate" is a turn of phrase and flagging it would be pedantry.
 * Two or more means the letter is being built out of adjectives, and every one
 * of them is an assertion the reader has no way to check -- which is the exact
 * failure the evidence rule below catches from the other side.
 */
const MAX_EMPTY_CLAIMS = 2

/**
 * How much CV furniture it takes before the letter is repeating the CV.
 *
 * THREE DATE RANGES, or three bulleted lines. A letter naturally names one or
 * two years -- when you shipped the thing you are describing. Three is a
 * history, and a history is what the document attached to this one is for. The
 * bullet count is the same finding from the other direction: a letter with a
 * bulleted list in it has a CV page pasted into it.
 */
const CV_ECHO_LIMIT = 3

/**
 * The greetings that survive a copy-paste unchanged.
 *
 * THESE ARE THE CHECKABLE HALF OF "does it name the company". The letter's own
 * text cannot tell us which employer it is for -- there is no posting in this
 * pane, by design -- but it can tell us that nobody was addressed, and these
 * are the openings that prove it. Matched as prefixes on the first block, so
 * "Dear Hiring Manager at Initech" still trips: the company appearing later in
 * the line does not make the salutation less generic.
 */
const GENERIC_GREETINGS = [
  'to whom it may concern',
  'dear sir or madam',
  'dear sir/madam',
  'dear sir',
  'dear madam',
  'dear hiring manager',
  'dear hiring team',
  'dear hiring committee',
  'dear recruiter',
  'dear recruitment team',
  'dear hr',
  'dear human resources',
]

/** Anything that opens a letter at all. Used to tell "generic" from "none". */
const GREETING_START = /^(dear|hello|hi|greetings|good (morning|afternoon|evening))\b/

/**
 * The openings that carry no information.
 *
 * THE FIRST SENTENCE IS THE ONLY ONE GUARANTEED TO BE READ, which is why this
 * checks that sentence and nothing else -- "I am writing" in the third
 * paragraph is fine and flagging it would be noise. Every phrase here restates
 * the fact that a cover letter has arrived, which the reader established by
 * opening it.
 */
const TIRED_OPENINGS = [
  'i am writing',
  "i'm writing",
  'i would like to apply',
  'i wish to apply',
  'i am applying',
  'i am interested in applying',
  'i am writing to express',
  'please accept my',
  'please accept this',
  'this letter is',
  'i am excited to apply',
  'i am pleased to apply',
]

/**
 * Template scaffolding left in the document.
 *
 * BRACKETS ARE UNAMBIGUOUS: nothing anybody writes on purpose in a cover
 * letter is wrapped in square braces or double curlies, so a match is a
 * placeholder that survived the edit -- which is the single most expensive
 * mistake this pane can catch, because the reader sees it before anything else.
 * Angle brackets are NOT matched: this text comes out of a Tiptap tree with no
 * markup in it, but "<24h response" and "<£40k" are things people write.
 */
const PLACEHOLDER_BRACKETS = /\[[^\]\n]{1,60}\]|\{\{[^}\n]{1,60}\}\}/g

/**
 * The hedge that stands in for the employer's name.
 *
 * "your company" IS THE SOFT VERSION OF A PLACEHOLDER. It is grammatical, it
 * reads fine, and it is what a letter says when it has not been written for
 * anybody in particular -- the name was never there to be replaced.
 */
const VAGUE_EMPLOYER = /\byour (?:company|organisation|organization|firm|team at)\b/gi

/**
 * Claims with nothing behind them.
 *
 * KEPT SHORT ON PURPOSE, the same call `writingMetrics` makes about its
 * informal list: a long list becomes a style guide and starts flagging
 * perfectly good sentences. These are the phrases that appear in a letter
 * INSTEAD of the thing that would prove them, which is what makes them worth
 * naming rather than merely weak.
 */
const EMPTY_CLAIMS = [
  'passionate',
  'hardworking',
  'hard-working',
  'team player',
  'detail-oriented',
  'detail oriented',
  'results-driven',
  'results driven',
  'self-starter',
  'go-getter',
  'think outside the box',
  'wealth of experience',
  'proven track record',
  'perfect fit',
  'excellent communication skills',
  'fast learner',
]

/**
 * What a close does.
 *
 * THE CLOSE IS THE ONLY SENTENCE WITH A JOB. Everything above it is an
 * argument; the last paragraph is where the letter says what should happen
 * next, and a letter that ends on "thank you for your time" has handed the
 * decision back with no suggestion in it. Matched loosely -- any of these
 * means somebody thought about the next step.
 */
const NEXT_STEP_PHRASES = [
  'look forward',
  'looking forward',
  'would welcome',
  'would love to',
  'happy to discuss',
  'glad to discuss',
  'available',
  'get in touch',
  'contact me',
  'reach me',
  'hear from you',
  'arrange',
  'interview',
  'speak with',
  'discuss',
  // THE PLAIN-ENGLISH HALF, and leaving it out made this rule wrong on three
  // of the five letters this app ships. The list started as the formal
  // register -- "would welcome", "look forward", "happy to discuss" -- and
  // missed every ordinary way a person offers the same thing: "glad to talk it
  // through", "happy to have a short conversation", "happy to walk through how
  // it worked". Those are BETTER closings than the ones it recognised, so the
  // rule was penalising the letters it should have left alone.
  'talk',
  'conversation',
  'walk through',
  'chat',
  'connect',
  'meet with',
  'set up a time',
]

/** First and second person, counted separately -- see `SELF_TO_READER_RATIO`. */
const SELF_PRONOUNS = new Set(['i', 'me', 'my', 'mine', 'myself'])
const READER_PRONOUNS = new Set(['you', 'your', 'yours', 'yourself', 'yourselves'])

/** Years, as a proxy for a date range. See `CV_ECHO_LIMIT`. */
const YEAR = /\b(?:19|20)\d{2}\b/g

/** A line that has been set as a list item rather than written as prose. */
const BULLET_LINE = /^\s*[-*•‣⁃·]\s+\S/

/**
 * Blocks, as the editor separates them.
 *
 * Tiptap's `getText()` joins block nodes with blank lines, so this is the
 * paragraph structure the writer actually sees rather than a guess at it.
 */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
}

/** The first sentence of a block, for the rules that only judge an opening. */
function firstSentence(block: string): string {
  const [sentence] = block.split(/(?<=[.!?])\s/)
  return (sentence ?? block).trim()
}

function tokensOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z'’]+/g) ?? []
}

/** Straight and typographic apostrophes both; imported .docx text uses the latter. */
const normalise = (text: string) => text.toLowerCase().replace(/’/g, "'")

const listOf = (items: string[]) =>
  items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/**
 * Read a cover letter and say what is wrong with it.
 *
 * AN EMPTY DOCUMENT HAS NOTHING WRONG WITH IT, the same call `proofreadScore`
 * and `writingMetrics` both make: an unwritten letter is not a bad one, and
 * every rule below divides by or indexes into something that is not there yet.
 */
export function letterReview(text: string): LetterReview {
  const words = countWords(text)
  const findings: LetterFinding[] = []
  if (words === 0) return { words, findings }

  const push = (
    id: LetterFindingId,
    label: string,
    problem: string,
    fix: string
  ) => findings.push({ id, label, problem, fix })

  const lower = normalise(text)
  const paragraphs = paragraphsOf(text)
  const body = paragraphs.filter((block) => countWords(block) >= BODY_PARAGRAPH_WORDS)
  const settled = words >= DRAFT_FLOOR_WORDS

  // THE GREETING. Who is this for -- and if the answer is "anyone", the reader
  // knows before reading a word of the argument.
  //
  // IT IS NOT `paragraphs[0]`, AND ASSUMING IT WAS BROKE ON THE FIRST REAL
  // LETTER. A business letter in block layout opens with the SENDER: name,
  // address, contact line, then the date, then the recipient, and only then
  // "Dear ...". Four of the five templates this app ships are laid out that
  // way, and against `paragraphs[0]` every one of them was told it had
  // addressed nobody -- while the greeting sat six lines further down.
  //
  // Searching the blocks ABOVE the first real paragraph is what makes the
  // check layout-agnostic: a modern letter that opens straight on "Dear Ana,"
  // finds it at index 0, and a formal one finds it after its letterhead. The
  // search stops at the body because a paragraph mentioning "dear" in prose is
  // not a salutation.
  const firstBodyAt = paragraphs.findIndex(
    (block) => countWords(block) >= BODY_PARAGRAPH_WORDS
  )
  const preamble = paragraphs
    .slice(0, firstBodyAt === -1 ? paragraphs.length : firstBodyAt)
    .map((block) => normalise(block).replace(/[,:.!]+$/, ''))
  //
  // BOTH TESTS, NOT JUST `GREETING_START`. "To whom it may concern" is a
  // salutation that opens with none of the words that regex knows, so a search
  // for `GREETING_START` alone walks straight past the single most generic
  // greeting in the language and reports that the letter addressed nobody --
  // right that it is bad, wrong about why, and wrong in the fix it offers.
  const isSalutation = (block: string) =>
    GREETING_START.test(block) || GENERIC_GREETINGS.some((phrase) => block.startsWith(phrase))
  const greeting = preamble.find(isSalutation) ?? ''
  const generic = GENERIC_GREETINGS.find((phrase) => greeting.startsWith(phrase))
  if (generic) {
    push(
      'addressee',
      'generic addressee',
      `The letter opens "${generic}", which is the greeting every other applicant sent too.`,
      'Find the hiring manager on the posting or the company page and use their name. Failing that, name the team you would be joining.'
    )
  } else if (!GREETING_START.test(greeting)) {
    push(
      'addressee',
      'no addressee',
      'The letter starts straight into prose, with nobody addressed at the top.',
      'Open with a greeting that names a person, or the team if the posting does not name one.'
    )
  }

  // THE OPENING LINE, which is the one sentence you can be sure is read.
  const opener = normalise(firstSentence(body[0] ?? ''))
  const tired = TIRED_OPENINGS.find((phrase) => opener.startsWith(phrase))
  if (tired) {
    push(
      'opening',
      'boilerplate opening',
      `The first sentence begins "${tired}", which tells the reader only that a cover letter has arrived.`,
      'Open on the reason you want this job in particular, or on the single thing you have done that the posting is asking for.'
    )
  }

  // SCAFFOLDING LEFT IN. Cheap to catch, expensive to send.
  const brackets = text.match(PLACEHOLDER_BRACKETS) ?? []
  const vague = text.match(VAGUE_EMPLOYER) ?? []
  if (brackets.length > 0 || vague.length > 0) {
    const shown = [...brackets, ...vague].slice(0, 3).map((match) => `"${match.trim()}"`)
    push(
      'placeholders',
      'template left in',
      `${listOf(shown)} ${brackets.length + vague.length === 1 ? 'is' : 'are'} still in the letter where the employer's own name should be.`,
      'Replace each one with the company, the role or the person by name. A letter that names nobody reads as one sent to everybody.'
    )
  }

  // LENGTH. See MAX_LETTER_WORDS and MIN_LETTER_WORDS for the two numbers.
  if (words > MAX_LETTER_WORDS) {
    push(
      'length',
      'runs long',
      `${words} words, against the ${MAX_LETTER_WORDS} or so that fit on the page a reader actually finishes.`,
      `Cut roughly ${words - MAX_LETTER_WORDS} words. The paragraph that repeats what the CV already says is usually the one to lose.`
    )
  } else if (words < MIN_LETTER_WORDS) {
    push(
      'length',
      'runs short',
      `${words} words. That is not long enough to say why this job, what you have done and what happens next.`,
      'Add the middle of the three: one thing you built or fixed, and what changed because you did.'
    )
  }

  // THE SHAPE OF THE BODY, which is the same question as "is there an argument
  // in here" asked in a way a computer can answer.
  const longest = body.reduce((worst, block) => Math.max(worst, countWords(block)), 0)
  if (body.length < MIN_BODY_PARAGRAPHS) {
    push(
      'shape',
      'paragraph shape',
      `${body.length === 0 ? 'No' : body.length} real paragraph${body.length === 1 ? '' : 's'}, where a letter wants ${MIN_BODY_PARAGRAPHS}.`,
      'Give it three: why this role, the evidence that you can do it, and the next step you are proposing.'
    )
  } else if (longest > MAX_PARAGRAPH_WORDS) {
    push(
      'shape',
      'paragraph shape',
      `The longest paragraph runs ${longest} words, which is a block a skimming reader jumps over.`,
      `Split it where it changes subject. Nothing here needs to run past about ${MAX_PARAGRAPH_WORDS} words.`
    )
  }

  // EVIDENCE. A digit is the cheapest reliable sign that something specific is
  // being claimed -- a team size, a percentage, a version, a year.
  // SCANNED OVER THE BODY, NOT THE WHOLE LETTER, and the difference is the
  // difference between a rule that works and one that can never fire. A letter
  // in block layout carries a date, a phone number and a postcode above the
  // greeting -- so `/\d/.test(text)` is satisfied by the letterhead on every
  // formal letter ever written, and the check silently passed documents that
  // made no measurable claim at all. The evidence has to be in the argument.
  if (settled && !/\d/.test(body.join(' '))) {
    push(
      'evidence',
      'nothing concrete',
      'There is not a single number in this letter, so every claim in it is one the reader has to take on trust.',
      'Put one measurable thing in: how many people, how much faster, how long it took, how many users.'
    )
  }

  // CLAIMS WITH NOTHING BEHIND THEM -- the same failure as above, seen from the
  // adjective end rather than the number end.
  const claims = EMPTY_CLAIMS.filter((phrase) => lower.includes(phrase))
  if (claims.length >= MAX_EMPTY_CLAIMS) {
    push(
      'claims',
      'adjectives, not evidence',
      `${listOf(claims.slice(0, 3).map((claim) => `"${claim}"`))} describe you without showing anything.`,
      'Replace each one with the thing that would make a reader say it about you unprompted.'
    )
  }

  // WHO THE LETTER IS ABOUT. Some imbalance is correct; see the ratio.
  const tokens = tokensOf(text)
  const self = tokens.filter((word) => SELF_PRONOUNS.has(word)).length
  const reader = tokens.filter((word) => READER_PRONOUNS.has(word)).length
  if (settled && self > 0 && self >= SELF_TO_READER_RATIO * Math.max(1, reader)) {
    push(
      'balance',
      'all about you',
      `${self} mentions of yourself against ${reader} of them. At that ratio the letter reads as a statement rather than as something addressed to anybody.`,
      'Turn a few of them round: say what your experience means for the team you would be joining, not just that you have it.'
    )
  }

  // IS THIS THE CV AGAIN. Both proxies are structural; see CV_ECHO_LIMIT.
  const years = (text.match(YEAR) ?? []).length
  const bullets = text.split('\n').filter((line) => BULLET_LINE.test(line)).length
  if (years >= CV_ECHO_LIMIT || bullets >= CV_ECHO_LIMIT) {
    push(
      'restates',
      'repeats the CV',
      bullets >= CV_ECHO_LIMIT
        ? `${bullets} bulleted lines. A letter with a list in it is a CV page pasted into a letter.`
        : `${years} dates. That is a work history, and the reader already has one attached.`,
      'Pick the one role that makes the case and write it as prose. The CV is where the rest of it belongs.'
    )
  }

  // THE CLOSE, read off the last real paragraph rather than the sign-off.
  const close = normalise(body[body.length - 1] ?? '')
  if (settled && body.length > 0 && !NEXT_STEP_PHRASES.some((phrase) => close.includes(phrase))) {
    push(
      'closing',
      'no next step',
      'The last paragraph does not ask for anything, so the letter ends with the decision entirely in their hands.',
      'Close on what you want to happen: that you would welcome a conversation, and when you are free for one.'
    )
  }

  return { words, findings }
}
