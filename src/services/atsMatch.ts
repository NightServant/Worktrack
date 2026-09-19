export interface KeywordMatch {
  /** 0-100, share of the posting's terms the CV mentions. */
  score: number
  matched: string[]
  missing: string[]
}

/**
 * Words that carry no requirement, so counting them would inflate the score.
 *
 * WHY THIS GREW, on 2026-09-06. The old list was about 110 words and the
 * docblock argued for keeping it short. Measured against a real posting, that
 * produced SIXTY-THREE "requirements" from one paragraph -- among them
 * "provide", "manages", "necessary", "willing", "smoothly", "500" and "hours".
 * A CV cannot contain "smoothly", so every one of those counted as a miss and
 * dragged the score down. Gabe saw 30% on a CV that was not a 30% match.
 *
 * The old argument was the right one applied to the wrong list: the risk is
 * removing REAL terms, not having many entries. So everything below is prose
 * scaffolding -- verbs, adjectives, adverbs and generic nouns that describe how
 * a job is written rather than what it asks for.
 *
 * WHAT IS DELIBERATELY ABSENT, and must stay absent: `go`, `r`, `c`, `ai`,
 * `ml`, `ui`, `ux`, `qa`, `aws`, `sql`, `php`, `os`, `mac`. Each is a real
 * answer to "what does this job need" even though several read as ordinary
 * words. A posting that says "Go" means the language.
 */
const STOPWORDS = new Set([
  // Function words.
  'a', 'an', 'and', 'or', 'the', 'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by',
  'from', 'as', 'is', 'are', 'be', 'been', 'being', 'was', 'were', 'will', 'would',
  'you', 'your', 'we', 'our', 'us', 'they', 'their', 'them', 'it', 'its', 'this',
  'that', 'these', 'those', 'have', 'has', 'had', 'do', 'does', 'did', 'can',
  'could', 'should', 'may', 'might', 'must', 'shall', 'not', 'but', 'if', 'then',
  'than', 'so', 'such', 'who', 'whom', 'which', 'what', 'when', 'where', 'how',
  'why', 'all', 'any', 'both', 'each', 'more', 'most', 'other', 'others', 'some',
  'only', 'own', 'same', 'very', 'just', 'also', 'about', 'into', 'over', 'under',
  'up', 'out', 'per', 'via', 'etc', 'within', 'across', 'through', 'while',
  'during', 'before', 'after', 'between', 'upon', 'there', 'here', 'been',

  // Verbs that describe doing a job rather than a skill.
  'provide', 'provides', 'provided', 'providing', 'manage', 'manages', 'managed',
  'managing', 'assist', 'assists', 'assisted', 'assisting', 'ensure', 'ensures',
  'ensuring', 'coordinate', 'coordinates', 'coordinating', 'communicate',
  'communicates', 'communicating', 'resolve', 'resolves', 'resolving', 'attend',
  'attends', 'attending', 'perform', 'performs', 'performing', 'handle',
  'handles', 'handling', 'maintain', 'maintains', 'maintaining', 'create',
  'creates', 'creating', 'identify', 'identifies', 'identifying', 'render',
  'renders', 'arise', 'arises', 'runs', 'run', 'help', 'helps', 'helping',
  'include', 'includes', 'including', 'included', 'use', 'uses', 'used',
  'using', 'ability', 'able', 'willing', 'seeking', 'looking', 'join', 'apply',
  'welcome', 'stay', 'updated', 'expand', 'expanding', 'continue', 'continuing',

  // Adjectives and adverbs.
  'best', 'better', 'good', 'great', 'strong', 'excellent', 'proven', 'relevant',
  'related', 'necessary', 'required', 'preferred', 'desired', 'ideal', 'basic',
  'advanced', 'latest', 'fresh', 'new', 'current', 'familiar', 'knowledgeable',
  'limited', 'following', 'various', 'multiple', 'several', 'smoothly', 'quickly',
  'effectively', 'efficiently', 'successfully', 'highly', 'well', 'first',
  'second', 'third', 'daily', 'weekly', 'monthly', 'detail', 'oriented',
  'motivated', 'curious', 'similar', 'plus', 'minimum', 'maximum', 'least',

  // Generic nouns: the vocabulary of a job advert, not of a job.
  'team', 'teams', 'work', 'works', 'working', 'role', 'roles', 'job', 'jobs',
  'position', 'positions', 'experience', 'year', 'years', 'day', 'days', 'hour',
  'hours', 'week', 'weeks', 'month', 'months', 'time', 'times', 'staff',
  'process', 'processes', 'issue', 'issues', 'task', 'tasks', 'duty', 'duties',
  'responsibility', 'responsibilities', 'requirement', 'requirements',
  'qualification', 'qualifications', 'candidate', 'candidates', 'applicant',
  'applicants', 'company', 'companies', 'opportunity', 'opportunities',
  'career', 'careers', 'line', 'lines', 'level', 'levels', 'area', 'areas',
  'improvement', 'improvements', 'practice', 'practices', 'version', 'versions',
  'trend', 'trends', 'graduate', 'graduates', 'student', 'students', 'course',
  'courses', 'shifter', 'shifters', 'business', 'businesses',

  // ADDED 2026-09-15, from a real posting Gabe was scored against. Out of 100
  // terms it counted `responsible`, `key`, `enhance`, `sit`, `someone`,
  // `paced` and `inc` as things a CV had to say -- `inc` because the employer
  // is "IT Managers, Inc." and the company name is in the text like any other
  // word. None can be answered, so each one is a guaranteed miss dragging the
  // denominator down. Same defect as the 2026-09-06 pass above, found again
  // because the list was tuned against one advert and postings do not share a
  // vocabulary.
  //
  // WHAT WAS LEFT IN ON PURPOSE, having looked at each: `governance`, `uat`,
  // `context`, `generation`, `rules`, `files`, `retrieval`, `prompt`,
  // `compliance`, `pipelines`, `stakeholders`, `support`, `delivery`,
  // `features`, `build` and `write`. They read as ordinary words in a list
  // like this, and every one of them is a real answer to "what does this job
  // need" in an AI or platform role. Under-removing is the safe direction:
  // a junk term costs a few points, a removed REAL term hides a gap the CV
  // actually has.

  // Verbs for doing a job, not for having a skill.
  'collaborate', 'collaborates', 'collaborated', 'collaborating',
  'contribute', 'contributes', 'contributed', 'contributing',
  'participate', 'participates', 'participated', 'participating',
  'deliver', 'delivers', 'delivered', 'delivering',
  'enhance', 'enhances', 'enhanced', 'enhancing',
  'enable', 'enables', 'enabled', 'enabling',
  'leverage', 'leverages', 'leveraged', 'leveraging',
  'utilize', 'utilizes', 'utilized', 'utilizing',
  'utilise', 'utilises', 'utilised', 'utilising',
  'execute', 'executes', 'executed', 'executing',
  'oversee', 'oversees', 'overseeing', 'oversaw',
  'prepare', 'prepares', 'prepared', 'preparing',
  'drive', 'drives', 'driving', 'drove',
  'own', 'owns', 'owned', 'owning',
  'sit', 'sits', 'sitting', 'take', 'takes', 'taking', 'took',
  'need', 'needs', 'needed',

  // Adjectives a posting uses about a person.
  'responsible', 'accountable', 'comfortable', 'confident', 'dynamic',
  'passionate', 'enthusiastic', 'proactive', 'reliable', 'flexible', 'eager',
  'existing', 'internal', 'fast', 'paced', 'key', 'overall', 'successful',
  'based', 'aware', 'closely',

  // The vocabulary of an advert: how it asks, and what it offers.
  'knowledge', 'understanding', 'familiarity', 'awareness', 'expertise',
  'proficiency', 'ownership', 'passion', 'attitude', 'mindset', 'culture',
  'mission', 'vision', 'values', 'benefits', 'salary', 'compensation',
  'bonus', 'pension', 'holiday', 'perks', 'someone', 'anyone',
  'environment', 'environments',

  // Company-name scaffolding. The employer's legal suffix is in the posting
  // text like any other word, and no CV answers "inc".
  'inc', 'ltd', 'llc', 'plc', 'gmbh',
])

/**
 * Quantities with the number spelled out.
 *
 * THE SAME RULE AS THE DIGITS BELOW, and it is here because "render a minimum
 * of 500 hours" and "at least one server-side language" are the same sentence
 * written two ways. The digit rule caught the first and the second walked
 * straight through: measured against four real-shaped adverts, `one`, `two`,
 * `three` and `thousands` were all counted as things a CV had to say.
 *
 * A RULE, NOT ANOTHER BATCH OF STOPWORDS, and the difference is that this list
 * is CLOSED. The cardinals and the round magnitudes can be written out in full
 * and then they are done; advert prose cannot, which is why STOPWORDS has been
 * hand-extended twice and will be again. `first`, `second` and `third` are
 * already up there with the adjectives, so only the cardinals are new.
 *
 * Nothing here collides with a technology. The one to watch is that a real
 * name must never be swallowed -- `go`, `ai` and `aws` are not quantities, and
 * `3d` and `2fa` lead with a digit and are handled by the rule below.
 */
const NUMBER_WORDS = new Set([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'hundred',
  'hundreds', 'thousand', 'thousands', 'million', 'millions', 'dozen',
  'fourth', 'fifth',
])

/**
 * Whether a token can be a requirement at all.
 *
 * NUMBERS NEVER CAN. "500", "2025" and "10" are quantities in a sentence --
 * "render a minimum of 500 hours" -- and no CV contains them as a skill, so
 * every one was a guaranteed miss. Ordinals go with them, and so do the
 * spelled-out quantities in `NUMBER_WORDS`.
 *
 * Anything that merely STARTS with a digit survives, because `3d` and `2fa`
 * are real answers.
 *
 * WHAT WAS MEASURED AND REJECTED HERE (2026-09-17). The obvious next step is a
 * morphological rule: the list holds `perform` while a posting says
 * `performance`, so stem both sides and be done with the hand-tuning. It was
 * built and measured against four adverts, and it is WORSE than the list it
 * would replace. Expanding every stopword through `variantsOf` removed six
 * terms across the corpus: zero were prose and all six were real -- among them
 * `communication` and `collaboration`, which are headings on the CV being
 * scored, and `rendering`, which for a Next.js role means server-side
 * rendering. The naive stem rule additionally swallowed `performance` and
 * `management`. See `atsMatch.test.ts`, "a derived form of a stopword can
 * still be a requirement", which fails if anyone tries it again.
 *
 * The reason is not that the rule was built badly. `ortigas` and `docker` are
 * both said once, neither derives from a stopword, and only one is a skill --
 * so the thing that separates them is meaning, not shape. Sorting that out
 * needs a skills taxonomy (`integrations/esco.ts` is exactly one, unused), not
 * another suffix.
 */
function isRequirementCandidate(token: string): boolean {
  if (token.length < 2) return false
  if (STOPWORDS.has(token)) return false
  if (NUMBER_WORDS.has(token)) return false
  // A TOKEN WITH NO LETTER IN IT IS A QUANTITY, NEVER A REQUIREMENT. This was
  // `/^\d+$/`, which caught `500` and `2024` and missed everything the
  // tokenizer deliberately keeps punctuation for: `500+`, `1.5`, `3.5`. Those
  // three came back as things a CV was "missing" from one posting (Gabe,
  // 2026-09-19: "Bare numbers do not count"), and no CV can contain them --
  // the number in "500+ hours" is an amount of the noun beside it, and the
  // noun is the term worth matching.
  //
  // `[a-z]` rather than `\D`, because `+`, `#` and `.` are not letters and are
  // exactly what dresses a bare number up. `c++`, `c#`, `node.js`, `es6` and
  // `3d` all carry a letter and are unaffected.
  if (!/[a-z]/.test(token)) return false
  if (/^\d+(st|nd|rd|th)$/.test(token)) return false
  return true
}

/**
 * Splits text into comparable terms.
 *
 * Keeps `+` and `#` so c++ and c# survive, and dots so node.js does. Anything
 * one character long is dropped except a lone language name is rare enough not
 * to justify the false positives.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 1)
}

/**
 * The handful of irregular verbs a CV and a posting actually disagree over.
 *
 * Suffix rules cannot reach these: "drove" is not "drive" plus anything. Kept
 * deliberately short -- these are the forms that turn up in bullet points
 * ("Drove the migration", "Led the rewrite", "Built the pipeline") against
 * postings written in the infinitive ("drive the strategy", "lead a team").
 * An exhaustive English irregular list would be a dictionary, and every entry
 * past these earns nothing.
 */
const IRREGULAR: Record<string, string[]> = {
  // `drive`, `run` and `take` were here and are gone: all three are STOPWORDS,
  // so they never become required terms and the entries could never fire. An
  // irregular form for a word that is not a requirement is dead configuration
  // that reads like coverage.

  lead: ['led', 'leading', 'leads'],
  build: ['built', 'building', 'builds'],
  write: ['wrote', 'written', 'writing', 'writes'],
  grow: ['grew', 'grown', 'growing', 'grows'],
  make: ['made', 'making', 'makes'],
  give: ['gave', 'given', 'giving', 'gives'],
  hold: ['held', 'holding', 'holds'],
  teach: ['taught', 'teaching', 'teaches'],
  bring: ['brought', 'bringing', 'brings'],
  win: ['won', 'winning', 'wins'],
  speak: ['spoke', 'spoken', 'speaking', 'speaks'],
  rise: ['rose', 'risen', 'rising', 'rises'],
}

/** The shortest stem allowed to grow variants. Below this the guesses stop
 *  being about the same word: `aws` must never reach `awe`, `css` never `cse`. */
const MIN_STEM = 4

/**
 * Every way the same requirement might be spelled, derived FROM the term.
 *
 * STILL ADDITIVE, which is the rule this file already lived by and the reason
 * it is written this way round. The CV's own tokens are never transformed, so
 * `kubernetes` is still `kubernetes` and `aws` is still `aws`; the worst a bad
 * guess does is invent a spelling no CV contains, which simply fails to match.
 * A transform-then-compare stemmer is the version that corrupts those.
 *
 * WHY IT GREW BEYOND PLURALS (2026-09-15). A posting asks for "REST API
 * integration" and the CV says "Integrated REST APIs"; it asks for "mentoring"
 * and the CV says "Mentored"; it asks for "performance optimisation" and the
 * CV says "Optimised performance". Every one of those is a CV that MEETS the
 * requirement being counted as missing it -- measured at 50-67% on pairs that
 * a human reads as a full match. That is not a rewriting problem the model can
 * fix, and asking it to would mean pasting the posting's exact word into a
 * sentence that already said the same thing.
 */
function variantsOf(term: string): string[] {
  const out = new Set<string>([term])
  const add = (value: string) => {
    if (value.length >= 3) out.add(value)
  }

  if (IRREGULAR[term]) IRREGULAR[term].forEach(add)

  // The plural pair this function started as.
  if (term.length >= 3) add(`${term}s`)
  if (term.length >= 4 && !term.endsWith('ss') && term.endsWith('s')) add(term.slice(0, -1))

  // Stems: strip one known ending, longest first so `-ation` wins over `-ion`.
  const stems = new Set<string>()
  const strip = (suffix: string, replacement = '') => {
    if (!term.endsWith(suffix)) return
    const stem = term.slice(0, -suffix.length) + replacement
    if (stem.length >= MIN_STEM) stems.add(stem)
  }
  strip('ation')
  strip('ility', 'le') // accessibility -> accessible
  strip('ment')
  strip('ing')
  strip('ion')
  strip('ity')
  strip('ed')
  strip('es')
  strip('e')
  if (term.length >= MIN_STEM) stems.add(term)

  // Surface forms each stem can take. `-e` handling is why both `integrat` and
  // `integrate` are grown: the stem may or may not have kept its silent e.
  for (const stem of stems) {
    if (stem.length < MIN_STEM) continue
    const bases = [stem, stem.endsWith('e') ? stem.slice(0, -1) : `${stem}e`]
    for (const base of bases) {
      if (base.length < MIN_STEM - 1) continue
      for (const suffix of ['', 's', 'd', 'ed', 'ing', 'ion', 'ation', 'ity', 'ment', 'es']) {
        add(`${base}${suffix}`)
      }
    }
  }

  return [...out]
}

/**
 * Whether the CV mentions a term, in any spelling of the same word.
 *
 * The floors that were here are now inside `variantsOf`: nothing shorter than
 * `MIN_STEM` grows a variant, so `css` is still not satisfied by `cs` and
 * `java` is still not satisfied by `javascript` -- no suffix rule turns one
 * into the other, which is the false positive this is most often accused of.
 */
function mentions(cvTokens: Set<string>, term: string): boolean {
  if (cvTokens.has(term)) return true
  if (term.length < 3) return false
  return variantsOf(term).some((variant) => cvTokens.has(variant))
}

/**
 * The most a posting is allowed to ask for.
 *
 * A HUNDRED, AND IT IS GABE'S NUMBER (2026-09-13: "reduce the number of terms
 * in posting. I prefer 100 terms"). An uncapped read of a real advert returned
 * 130, and the tail of that list is where the value runs out: by the hundredth
 * term a posting is down to words it used once, in passing, in a sentence
 * about the office. Counting them as requirements moves the score without
 * telling the reader anything they can act on.
 *
 * EXPORTED (2026-09-17) so `/api/tailor` can bound the keyword list it
 * forwards by the number that actually produces it. The route had its own
 * `40`, which silently dropped the tail of `missing` on a long posting.
 *
 * MEASURED, AND IT IS NOT A TAIL OF JUNK. The cap looks like it should be
 * lower: strike sixteen prose words from a posting and the cap refills the
 * denominator from further down the frequency order, which reads like the fix
 * giving the points straight back. Counted across four adverts, the terms a
 * posting says ONCE are 85-89% real requirements -- 95 of 107 on one of them.
 * The refill is mostly `redux`, `jest`, `accessibility` and `scrum`: things
 * genuinely asked for and genuinely not on the CV. A frequency floor was
 * measured too and it hides 113 real gaps across the corpus while flattering
 * the score by up to 29 points, which is the one direction this file's
 * docblocks have always refused to move in.
 */
export const MAX_TERMS = 100

/**
 * The terms a posting actually leans on, most-used first.
 *
 * BY FREQUENCY, NOT BY POSITION, and that is the whole reason this is a
 * function rather than a `.slice(0, 100)`. Document order would hand the cap
 * to whichever paragraph happens to come first -- usually the one about the
 * company -- and drop the requirements at the bottom of the advert. How often
 * a posting says a word is the best cheap signal of how much it means it.
 *
 * FIRST APPEARANCE BREAKS THE TIE, so the order is stable for the same input
 * and a reader sees the terms in the order the posting introduced them.
 *
 * THE RESULT STAYS IN FREQUENCY ORDER for display too. The record's chip lists
 * fold at 32; showing the most-repeated terms first means what survives the
 * fold is the part worth reading.
 */
function requiredTerms(jobDescription: string): string[] {
  const counts = new Map<string, { count: number; first: number }>()
  tokenize(jobDescription)
    .filter(isRequirementCandidate)
    .forEach((token, index) => {
      const seen = counts.get(token)
      if (seen) seen.count += 1
      else counts.set(token, { count: 1, first: index })
    })

  return [...counts.entries()]
    .sort(([, a], [, b]) => b.count - a.count || a.first - b.first)
    .slice(0, MAX_TERMS)
    .map(([term]) => term)
}

/**
 * Scores a CV against a job posting.
 *
 * Terms come from the posting, not the CV: the question is what the employer
 * asked for and whether the CV answers it, not how much the CV happens to say.
 * At most `MAX_TERMS` of them, the ones it repeats most -- see `requiredTerms`.
 *
 * Matching is whole-token, so "Java" in a posting is not satisfied by
 * "JavaScript" in the CV — the substring match that would allow is exactly the
 * kind of false confidence this is meant to catch.
 *
 * An empty posting scores 0 rather than 100. Nothing to match against means the
 * CV is unscored, and reporting a perfect match would be a lie the user acts on.
 */
export function matchKeywords(cvText: string, jobDescription: string): KeywordMatch {
  const required = requiredTerms(jobDescription)
  if (required.length === 0) {
    return { score: 0, matched: [], missing: [] }
  }

  const present = new Set(tokenize(cvText))
  const matched = required.filter((t) => mentions(present, t))
  const missing = required.filter((t) => !mentions(present, t))

  return {
    score: Math.round((matched.length / required.length) * 100),
    matched,
    missing,
  }
}
