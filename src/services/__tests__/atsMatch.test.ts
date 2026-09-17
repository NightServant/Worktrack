import { describe, it, expect } from 'vitest'
import { matchKeywords } from '../atsMatch'

describe('matchKeywords', () => {
  it('scores a full match at 100 with nothing missing', () => {
    const result = matchKeywords('React TypeScript Postgres', 'React, TypeScript and Postgres')
    expect(result.score).toBe(100)
    expect(result.missing).toEqual([])
  })

  it('reports the terms the CV does not mention', () => {
    const result = matchKeywords('React only', 'React TypeScript Postgres')
    expect(result.missing).toContain('typescript')
    expect(result.missing).toContain('postgres')
    expect(result.score).toBeLessThan(100)
  })

  it('matches regardless of case', () => {
    expect(matchKeywords('react', 'REACT').score).toBe(100)
  })

  it('ignores filler words so the score reflects real requirements', () => {
    const result = matchKeywords('React', 'You will be working with the React and a team')
    expect(result.matched).toEqual(['react'])
    expect(result.missing).toEqual([])
  })

  it('counts a repeated requirement once', () => {
    const result = matchKeywords('React', 'React React React')
    expect(result.matched).toEqual(['react'])
    expect(result.score).toBe(100)
  })

  it('does not count a term as present because it is inside a longer word', () => {
    const result = matchKeywords('I write JavaScript', 'Java')
    expect(result.missing).toEqual(['java'])
    expect(result.score).toBe(0)
  })

  it('scores zero when there is no job description to match against', () => {
    const result = matchKeywords('React TypeScript', '')
    expect(result.score).toBe(0)
    expect(result.matched).toEqual([])
  })
})

describe('what counts as a requirement at all', () => {
  /**
   * THE DEFECT, measured 2026-09-06. The matcher treated every non-stopword
   * token in the posting as something the CV had to contain, and a posting is
   * mostly prose -- one paragraph produced SIXTY-THREE "requirements"
   * including "provide", "manages", "smoothly", "500" and "hours". A CV cannot
   * contain "smoothly", so each was a guaranteed miss and the score read far
   * below the truth: 30% on a CV that was a good match.
   */
  const POSTING = `Provide first line phone, email and chat support. Manages the
    service desk tickets and assists onsite. Physical troubleshooting, repair of
    hardware and connectivity. Coordinate the process as necessary. Resolving
    issues as they arise, communicating with staff to ensure setup runs
    smoothly. Qualifications: render a minimum of 500 hours, willing to work
    hybrid days. Knowledgeable in network, familiar but limited with the
    following: Windows, Mac, Microsoft server, Zoom and Adobe.`

  const CV = `IT support specialist. Troubleshooting hardware and network
    connectivity. Windows and Mac administration, Microsoft server, Zoom and
    Adobe. Service desk ticket handling, onsite and remote.`

  it('does not treat a number as a skill', () => {
    // "render a minimum of 500 hours" -- no CV contains 500.
    const { missing, matched } = matchKeywords(CV, POSTING)
    expect([...missing, ...matched]).not.toContain('500')
  })

  it('does not treat a spelled-out quantity as a skill either', () => {
    // The same sentence as "500 hours", written out. Measured 2026-09-17
    // across four adverts: `one`, `two`, `three` and `thousands` were all
    // being counted as things a CV had to say.
    const { missing, matched } = matchKeywords(
      'React developer',
      'We need React, two years of experience, and one of the three of you will lead.'
    )
    const counted = new Set([...missing, ...matched])
    for (const quantity of ['one', 'two', 'three']) {
      expect(counted, `"${quantity}" is a quantity, not a skill`).not.toContain(quantity)
    }
    // The guard on the guard: the real requirement still survives.
    expect(matched).toContain('react')
  })

  it('does not treat prose verbs and adverbs as requirements', () => {
    const { missing, matched } = matchKeywords(CV, POSTING)
    const counted = new Set([...missing, ...matched])
    for (const noise of ['provide', 'manages', 'smoothly', 'necessary', 'willing', 'hours']) {
      expect(counted, `"${noise}" is not something a CV can satisfy`).not.toContain(noise)
    }
  })

  it('still counts the things the job actually asks for', () => {
    // The guard on the guard: a list that removed everything would pass the
    // two tests above and be useless.
    const { matched } = matchKeywords(CV, POSTING)
    for (const real of ['hardware', 'network', 'windows', 'microsoft', 'server', 'adobe']) {
      expect(matched).toContain(real)
    }
  })

  it('scores a good CV as a good match', () => {
    const { score } = matchKeywords(CV, POSTING)
    expect(score).toBeGreaterThan(45)
  })

  it('keeps short technology names that read as ordinary words', () => {
    // `go` means the language. Adding it to the stopword list would be the
    // exact failure the original short list was guarding against.
    const { matched } = matchKeywords('Go and SQL and AWS developer', 'We need Go, SQL and AWS.')
    expect(matched).toEqual(expect.arrayContaining(['go', 'sql', 'aws']))
  })

  it('matches across a plural on either side', () => {
    expect(matchKeywords('Built REST APIs.', 'Experience with a REST API.').matched)
      .toContain('api')
    expect(matchKeywords('Deep API knowledge.', 'You will build APIs.').matched)
      .toContain('apis')
  })

  it('does not let a plural rule collapse a technology onto another word', () => {
    // `css` must not be satisfied by a CV that merely said `cs`.
    const { missing } = matchKeywords('BS CS graduate.', 'Strong CSS required.')
    expect(missing).toContain('css')
  })

  it('does not corrupt a term to make a plural match', () => {
    // A transform-then-compare stemmer turns `kubernetes` into `kubernete`
    // and `aws` into `aw`. This only ever ADDS candidates.
    const { missing } = matchKeywords('Docker only.', 'Kubernetes required.')
    expect(missing).toContain('kubernetes')
  })

  it('caps a long posting at a hundred terms, keeping the ones it repeats', () => {
    // Gabe, 2026-09-13: "reduce the number of terms in posting. I prefer 100
    // terms." A real advert read 130, and the tail was words used once in a
    // sentence about the office -- they moved the score and told the reader
    // nothing. Frequency decides what survives, because how often a posting
    // says a word is the cheapest honest signal of how much it means it.
    const filler = Array.from({ length: 150 }, (_, i) => `skillterm${i}`).join(' ')
    const posting = `${filler} kubernetes kubernetes kubernetes kubernetes`
    const result = matchKeywords('kubernetes', posting)

    expect(result.matched.length + result.missing.length).toBe(100)
    // The four-times word is first, not the one that opened the advert.
    expect(result.matched).toEqual(['kubernetes'])
    expect(result.missing).not.toContain('skillterm149')
  })

  it('is stable for the same posting, so a score does not move on its own', () => {
    // Frequency ties break on first appearance. Without that the cap would
    // fall wherever Map iteration happened to land and the same CV would score
    // differently on a refresh.
    const posting = 'alpha beta gamma delta epsilon zeta eta theta'
    const once = matchKeywords('alpha', posting)
    const twice = matchKeywords('alpha', posting)
    expect(once.missing).toEqual(twice.missing)
  })
})

/**
 * A CV that MEETS a requirement must not be told it is missing it.
 *
 * Measured on 2026-09-15, before this existed: a posting asking to "drive the
 * testing strategy" scored 67 against a CV saying "Drove the testing
 * strategy", and "REST API integration" scored 67 against "Integrated REST
 * APIs". Five such pairs sat between 0 and 67 where a human reads a full
 * match. That is a counting bug, not a rewriting one -- and the fix for it is
 * here rather than in the tailoring prompt, because asking a model to close it
 * means pasting the posting's exact word into a sentence that already said the
 * same thing.
 */
describe('matchKeywords across word forms', () => {
  it.each([
    ['drive the testing strategy', 'Drove the testing strategy'],
    ['REST API integration', 'Integrated REST APIs'],
    ['mentoring junior engineers', 'Mentored junior engineers'],
    ['performance optimisation', 'Optimised performance'],
    ['accessibility standards', 'Accessible interfaces meeting standards'],
    ['lead a team', 'Led a team'],
    ['automated testing', 'Automate tests'],
  ])('counts "%s" as answered by "%s"', (posting, cv) => {
    expect(matchKeywords(cv, posting).score).toBe(100)
  })
})

/**
 * The other half of the same change, and the more important half.
 *
 * Widening what counts as the same word is exactly how a matcher starts
 * claiming a CV said something it did not. These are the pairs the file has
 * always refused to merge, and they must keep failing however many suffix
 * rules get added above -- `java` is not answered by `javascript`, and no
 * amount of stemming may make `css` reachable from `cs`.
 */
describe('matchKeywords still refuses near-misses', () => {
  it.each([
    ['Java', 'JavaScript and TypeScript'],
    ['CSS', 'I know cs'],
    ['AWS', 'full of awe'],
    ['React', 'reactive programming'],
  ])('does not let "%s" be satisfied by "%s"', (posting, cv) => {
    expect(matchKeywords(cv, posting).score).toBe(0)
  })
})

/**
 * Prose is not a requirement, and a company's legal suffix is not a skill.
 *
 * MEASURED ON A REAL POSTING (Gabe, 2026-09-15). Out of 100 terms the matcher
 * asked a CV to contain `responsible`, `key`, `enhance`, `sit`, `someone`,
 * `paced` and `inc` -- the last one because the employer is "IT Managers,
 * Inc." and the company name sits in the text like any other word. None can be
 * answered, so each was a guaranteed miss pulling the score down.
 */
describe('matchKeywords ignores the vocabulary of an advert', () => {
  it.each([
    'responsible', 'key', 'enhance', 'sit', 'someone', 'paced', 'closely',
    'knowledge', 'ownership', 'environment', 'dynamic', 'inc',
  ])('does not make "%s" a requirement', (word) => {
    const { matched, missing } = matchKeywords('React and TypeScript', `We need ${word} and React.`)
    expect([...matched, ...missing]).not.toContain(word)
  })

  it('drops the prose without dropping the job', () => {
    // The whole point: the real requirements survive the cull.
    const { matched, missing } = matchKeywords(
      '',
      'You will be responsible for key AI governance, UAT and code generation at Acme, Inc.'
    )
    const terms = [...matched, ...missing]
    expect(terms).toEqual(expect.arrayContaining(['ai', 'governance', 'uat', 'code', 'generation']))
    expect(terms).not.toEqual(expect.arrayContaining(['responsible', 'key', 'inc']))
  })
})

/**
 * A DERIVED FORM OF A STOPWORD CAN STILL BE A REQUIREMENT.
 *
 * This guards a change that was measured and NOT made, which is why it is
 * written down rather than left to be rediscovered.
 *
 * The list holds `perform`, `render` and `related` while real postings say
 * `performance`, `rendering` and `relational`, so the obvious tidy-up is to
 * stop hand-extending STOPWORDS and match morphologically instead -- stem both
 * sides, or run each stopword through this file's own `variantsOf`. Measured
 * against four adverts on 2026-09-17, that rule removed six terms: NONE were
 * prose and all six were real, including `communication` and `collaboration`,
 * which are literally headings on the CV being scored. The naive stem variant
 * also took `performance` and `management`. Both scored the corpus LOWER than
 * the hand list they replaced.
 *
 * Every term below is a genuine requirement of a real front-end or data role.
 * If a future rule makes one of them stop counting, that rule is the same
 * mistake wearing a tidier shape, and this goes red.
 */
describe('a derived form of a stopword can still be a requirement', () => {
  it.each([
    ['performance', 'You will improve front-end performance and Core Web Vitals.'],
    ['rendering', 'Experience with Next.js server-side rendering.'],
    ['relational', 'Design and query relational databases.'],
    ['communication', 'Clear written communication is essential.'],
    ['collaboration', 'Close collaboration with designers.'],
    ['management', 'Familiarity with state management libraries.'],
    ['maintainable', 'Write modular, maintainable code.'],
  ])('still counts "%s"', (term, posting) => {
    const { matched, missing } = matchKeywords('', posting)
    expect([...matched, ...missing]).toContain(term)
  })
})

/**
 * The list the file names as "deliberately absent, and must stay absent".
 *
 * Every pass over STOPWORDS is a chance to sweep one of these in by accident:
 * they all read as ordinary English. A posting that says "Go" means the
 * language, and `r`, `c`, `ai` and `qa` are real answers to what a job needs.
 * The existing test covered three of them; this covers the list.
 */
describe('matchKeywords keeps short technology names', () => {
  it.each([
    ['go', 'Go developer wanted', 'Go and Kubernetes'],
    ['ai', 'AI engineer wanted', 'AI and Python'],
    ['ml', 'ML engineer wanted', 'ML pipelines'],
    ['ui', 'UI engineer wanted', 'UI work'],
    ['ux', 'UX designer wanted', 'UX research'],
    ['qa', 'QA engineer wanted', 'QA automation'],
    ['aws', 'AWS experience', 'AWS and Docker'],
    ['sql', 'SQL experience', 'SQL and Python'],
    ['php', 'PHP experience', 'PHP and MySQL'],
  ])('treats "%s" as a requirement', (term, posting, cv) => {
    expect(matchKeywords(cv, posting).matched).toContain(term)
  })
})
