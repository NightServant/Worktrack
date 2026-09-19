/**
 * A flat skills list, sorted into the groups a CV prints it under.
 *
 * WHY THIS EXISTS (Gabe, 2026-09-19: "Auto-classify skills properly based in
 * categories ... make sure do not tailor the classification in a specific use
 * case, apply more general use cases since each career has different
 * classifications"). Forty-eight skills arrive from four sources in whatever
 * order each one listed them, and both places they are shown had the same
 * problem: the panel drew one wall of tags, and the CV printed one
 * comma-separated paragraph that no recruiter reads to the end of.
 *
 * THE CATEGORIES ARE DELIBERATELY NOT A DEVELOPER'S. This app writes CVs for
 * whoever uses it, and a nurse's skills list, a paralegal's and a chef's are
 * each as specific as an engineer's. So the table below runs across careers --
 * clinical, legal, financial, culinary, trades, teaching, sales -- and a
 * category appears on screen only when something landed in it. A profile with
 * no clinical skills never sees a clinical heading.
 *
 * FINE-GRAINED RATHER THAN FOUR BIG BUCKETS, which is the choice that makes it
 * useful in both directions. One `Technical Skills` heading over forty entries
 * is the wall again with a title on it; `Programming Languages`, `Frontend &
 * UI` and `Databases` are three headings a reader can skip between. The same
 * grain is what separates `Clinical Care` from `Medical Software` for somebody
 * who is not an engineer at all.
 *
 * FIRST RULE WINS, SO ORDER IS MEANING. `JavaScript` has to be tested before
 * `Java`, `SQL Server` before `SQL`, and anything spelled like two categories
 * belongs under the one it is actually used for. The table reads top to bottom
 * and stops.
 *
 * NOTHING IS INVENTED AND NOTHING IS DROPPED. A skill that matches no rule is
 * still the person's skill: it goes in the last group rather than disappearing,
 * because a classifier that silently eats what it does not recognise is worse
 * than one that admits it.
 */

export interface SkillGroup {
  /** The heading, as the panel and the CV print it. */
  label: string
  skills: string[]
}

/**
 * The classification table, in priority order.
 *
 * EACH PATTERN IS ANCHORED ON WORDS, never on substrings: `\bgo\b` is the
 * language and `going` is not, and an unanchored `r` would match every skill
 * ever written. That is also why a one- or two-letter name (`R`, `C`, `Go`)
 * has to be listed explicitly rather than left to a general rule.
 *
 * THE LAST GROUP HAS NO PATTERN. See `groupSkills`.
 */
const RULES: { label: string; pattern: RegExp }[] = [
  {
    // Before every other technical rule: these names collide with frameworks
    // and with ordinary English more than anything else here.
    label: 'Programming Languages',
    pattern:
      /^(javascript|typescript|python|java|kotlin|swift|objective-?c|c\+\+|c#|c|go|golang|rust|ruby|php|perl|scala|r|matlab|julia|dart|elixir|erlang|haskell|clojure|lua|groovy|visual basic|vb\.net|vba|assembly|cobol|fortran|pascal|delphi|solidity|shell|bash|powershell|zsh|sql|plsql|pl\/sql|t-sql)$|\b(programming language)\b/i,
  },
  {
    label: 'Markup & Styling',
    pattern: /\b(html5?|css3?|sass|scss|less|stylus|xml|xslt|markdown|latex|jsx|tsx)\b/i,
  },
  {
    label: 'Frontend & UI',
    pattern:
      /\b(react(\.js)?|next\.?js|vue(\.js)?|nuxt|angular|svelte(kit)?|solid\.?js|ember|jquery|redux|zustand|tailwind|bootstrap|material ?ui|mui|chakra|shadcn|radix|ant design|mary ?ui|storybook|webpack|vite|rollup|parcel|babel|astro|remix|htmx|alpine\.?js|livewire|inertia(\.js)?|three\.?js|d3(\.js)?|recharts|framer motion|java ?swing|javafx|\bawt\b|winforms|\bwpf\b|\bqt\b|gtk|tkinter|swing)\b/i,
  },
  {
    label: 'Backend & APIs',
    pattern:
      /\b(node(\.js)?|deno|bun|express(\.js)?|nest(\.js)?|fastify|django|flask|fastapi|rails|ruby on rails|laravel|symfony|codeigniter|spring( boot)?|\.net( core)?|asp\.net|phoenix|gin|echo|graphql|rest(ful)?|representational state transfer|grpc|soap|websockets?|micro-?services?|open ?api|swagger|api design|serverless)\b/i,
  },
  {
    label: 'Databases & Storage',
    pattern:
      /\b(mysql|postgres(ql)?|sqlite|mariadb|oracle( database)?|sql server|mongodb|redis|cassandra|dynamodb|firestore|firebase|supabase|elasticsearch|neo4j|snowflake|bigquery|redshift|prisma|sequelize|typeorm|hibernate|drizzle|database design|data modell?ing|etl|microsoft access)\b/i,
  },
  {
    label: 'Cloud & Infrastructure',
    pattern:
      /\b(aws|amazon web services|azure|gcp|google cloud|vercel|netlify|heroku|digital ?ocean|cloudflare|docker|kubernetes|k8s|terraform|ansible|jenkins|circleci|github actions|gitlab ci|ci\/cd|nginx|apache|linux|unix|ubuntu|debian|centos|windows server|system administration|networking|tcp\/ip|dns|vpn|load balanc|web hosting|devops|site reliability)\b/i,
  },
  {
    label: 'Data & Analytics',
    pattern:
      /\b(data analysis|data analytics|data science|data visuali[sz]ation|machine learning|deep learning|artificial intelligence|\bai\b|\bnlp\b|computer vision|tensorflow|pytorch|keras|scikit-?learn|pandas|numpy|jupyter|tableau|power ?bi|looker|google analytics|statistics|statistical|regression|forecasting|\bspss\b|\bsas\b|stata|business intelligence|dashboards?|reporting|\betl\b|big data|hadoop|spark|kafka|airflow)\b/i,
  },
  {
    label: 'Security & Compliance',
    pattern:
      /\b(cyber ?security|information security|infosec|penetration testing|pen ?testing|ethical hacking|hack(ing)?|vulnerability|encryption|cryptography|\boauth\b|\bsso\b|iso ?27001|\bgdpr\b|\bhipaa\b|\bsoc ?2\b|\bpci\b|risk assessment|incident response|firewall|access control|auditing|compliance)\b/i,
  },
  {
    label: 'Mobile & Devices',
    pattern:
      /\b(android|ios|react native|flutter|xamarin|ionic|swift ?ui|jetpack compose|mobile development|mobile app|embedded|arduino|raspberry pi|iot|firmware|microcontroller)\b/i,
  },
  {
    label: 'Design & Creative',
    pattern:
      /\b(figma|sketch|adobe|photoshop|illustrator|indesign|after effects|premiere|xd|canva|blender|cinema ?4d|maya|3ds max|autodesk|procreate|ui design|ux design|user interface|user experience|\bux\b|\bui\b|graphic(al)? user interface|\bgui\b|wireframing|prototyping|typography|branding|visual design|illustration|animation|motion graphics|video editing|photography|colou?r theory|design system|\bdtp\b|desktop publishing)\b/i,
  },
  {
    label: 'Engineering & Manufacturing',
    pattern:
      /\b(autocad|solidworks|catia|revit|\bcad\b|\bcam\b|\bcnc\b|\bplc\b|scada|\bbim\b|ansys|simulink|matlab|welding|machining|fabrication|soldering|electrical|mechanical|hydraulic|pneumatic|hvac|blueprint|tolerance|lean manufacturing|quality control|\bqa\/qc\b|calibration|maintenance|computer systems servicing|hardware)\b/i,
  },
  {
    label: 'Science & Laboratory',
    pattern:
      /\b(laboratory|lab techniques?|microscopy|chromatograph|spectroscop|hplc|gc-?ms|pcr|elisa|titration|assay|cell culture|microbiolog|biochemistr|molecular biolog|genetics?|histolog|toxicolog|specimen|sample preparation|good laboratory practice|\bglp\b|good manufacturing practice|\bgmp\b|clinical trials?|research methodolog|literature review|peer review|grant writing|experimental design|field research|soil (testing|science)|environmental (science|monitoring)|geospatial|\bgis\b|arcgis|remote sensing|surveying|meteorolog)\b/i,
  },
  {
    label: 'Clinical & Healthcare',
    pattern:
      /\b(patient care|clinical|nursing|midwifer|phlebotomy|venipuncture|triage|vital signs|medication administration|iv therapy|wound care|\bcpr\b|\bbls\b|\bacls\b|\bpals\b|first aid|infection control|\behr\b|\bemr\b|epic systems|cerner|medical terminology|anatomy|physiology|pharmacology|pharmacy|dispensing|diagnosis|radiolog|sonograph|ultrasound|phlebotomist|surgical|perioperative|dental|optometr|audiolog|physiotherapy|rehabilitation|telehealth|case management|\bicd-?10\b|\bcpt\b|medical coding|medical billing|public health|epidemiolog)\b/i,
  },
  {
    label: 'Care & Social Work',
    pattern:
      /\b(counsel(l)?ing|psychotherapy|mental health|social work|safeguarding|child (care|protection)|elder care|caregiving|disability support|behaviou?ral (therapy|support)|crisis intervention|substance abuse|community outreach|advocacy|welfare|\bcbt\b|applied behaviou?r analysis|\baba\b|occupational therapy|speech therapy|nutrition|dietetics|personal training|fitness|veterinary|animal care)\b/i,
  },
  {
    label: 'Legal & Regulatory',
    pattern:
      /\b(legal research|legal writing|litigation|contract (law|drafting|review|negotiation)|due diligence|corporate law|intellectual property|paralegal|westlaw|lexis ?nexis|\bnda\b|regulatory affairs|policy analysis|case law|deposition|arbitration|mediation|conveyancing|notar)\b/i,
  },
  {
    label: 'Finance & Accounting',
    pattern:
      /\b(accounting|bookkeeping|accounts (payable|receivable)|payroll|financial (analysis|modell?ing|reporting|planning)|budgeting|forecast(ing)?|taxation|\btax\b|audit(ing)?|\bgaap\b|\bifrs\b|quickbooks|xero|sage|\bsap\b|oracle financials|reconciliation|cost accounting|valuation|treasury|investment|portfolio|underwriting|actuarial|\bcpa\b|\bcfa\b|invoicing|banking|credit analysis|loan processing|insurance (claims|broking)|claims (handling|processing)|economics|econometric)\b/i,
  },
  {
    label: 'Sales & Marketing',
    pattern:
      /\b(marketing|\bseo\b|\bsem\b|\bsmm\b|social media|content (marketing|strategy|creation)|copywriting|email marketing|google ads|facebook ads|hubspot|salesforce|\bcrm\b|mailchimp|lead generation|cold call|prospecting|negotiation|account management|business development|market research|brand strategy|public relations|\bpr\b|campaign|conversion|e-?commerce|merchandising|customer service|customer success|retail)\b/i,
  },
  {
    label: 'Teaching & Training',
    pattern:
      /\b(teaching|lesson planning|curriculum(?! ?vitae)|instructional design|pedagog|classroom management|tutoring|e-?learning|\blms\b|moodle|blackboard|canvas lms|assessment|student engagement|training delivery|coaching|mentoring|facilitation|special education|early childhood|\btesol\b|\btefl\b|academic advising|library science|cataloguing|archival|museum|curation)\b/i,
  },
  {
    label: 'Construction & Trades',
    pattern:
      /\b(carpentry|masonry|plumbing|electrician|electrical wiring|roofing|drywall|painting and decorating|tiling|glazing|scaffolding|rigging|concrete|surveying|site management|site safety|\bosha\b|construction management|quantity surveying|estimating|heavy equipment|forklift|excavator|crane|landscaping|horticulture|agriculture|farming|irrigation|automotive repair|diesel|engine (repair|diagnostics)|bodywork|locksmith|\bhvacr?\b)\b/i,
  },
  {
    label: 'Media & Writing',
    pattern:
      /\b(journalism|reporting|news ?writing|feature writing|technical writing|copy ?editing|sub-?editing|scriptwriting|screenwriting|storyboard|broadcast|radio|podcast|audio (editing|production)|sound design|videograph|cinematograph|camera operation|lighting|live streaming|subtitling|translation|interpret(ing|ation)|transcription|localis?z?ation|publishing|proof ?reading|fact-?checking|social media management|community management)\b/i,
  },
  {
    label: 'Public Service & Safety',
    pattern:
      /\b(law enforcement|policing|security operations|surveillance|emergency (response|management)|firefight|paramedic|search and rescue|disaster (response|preparedness)|military|defen[cs]e|aviation|piloting|air traffic|maritime|seafaring|navigation|customs|immigration|public administration|civil service|urban planning|public policy|governance|non-?profit|\bngo\b|fundrais(ing|er)|volunteer (management|coordination)|grant management)\b/i,
  },
  {
    label: 'Hospitality & Service',
    pattern:
      /\b(food (safety|preparation|service)|culinary|cooking|baking|pastry|butcher|\bhaccp\b|servsafe|bartending|mixolog|barista|sommelier|waiting tables|front desk|housekeeping|concierge|reservations|event (planning|management)|catering|menu planning|\bpos\b|point of sale|guest relations|hospitality|tourism|travel booking|cosmetolog|hairdress|barber|beauty therapy|massage|spa|tailoring|dressmaking|garment|fashion (design|styling)|styling|retail merchandis)\b/i,
  },
  {
    label: 'Operations & Logistics',
    pattern:
      /\b(supply chain|logistics|inventory|warehouse|procurement|vendor management|shipping|freight|fleet|courier|scheduling|dispatch|operations management|process improvement|capacity planning|forecast demand|\berp\b|\bwms\b|\bmrp\b|purchasing|distribution|customs clearance|import|export|facilities management|janitorial|sanitation|driving licen[cs]e|commercial driving|\bcdl\b)\b/i,
  },
  {
    label: 'Ways of Working',
    pattern:
      /\b(agile|scrum|kanban|waterfall|lean|six sigma|kaizen|\bpmp\b|prince2|project management|product management|sprint|backlog|stakeholder|roadmap|requirements gathering|business analysis|change management|risk management|\bsdlc\b|test[- ]driven|\btdd\b|pair programming|code review|version control|\bgit\b|github|gitlab|bitbucket|jira|confluence|trello|asana|notion|monday\.com|linear|software (development|testing|engineering)|web development|web design|debugging|algorithms?|data structures?|object-?oriented|functional programming|design patterns|refactoring|documentation|unit testing|integration testing|automation testing|selenium|cypress|playwright|jest|vitest|pytest|junit|\bqa\b|quality assurance|computer programming|coding|scripting|problem decomposition|systems analysis|technical support|troubleshooting)\b/i,
  },
  {
    label: 'Software & Tools',
    pattern:
      /\b(microsoft (office|word|excel|powerpoint|outlook|teams|access|project|visio)|\bexcel\b|\bword\b|powerpoint|google (workspace|docs|sheets|slides|drive)|slack|zoom|visual studio( code)?|vs ?code|intellij|pycharm|webstorm|eclipse|netbeans|xcode|android studio|postman|insomnia|wordpress|shopify|webflow|squarespace|drupal|joomla|contentful|sanity|strapi|salesforce admin|sharepoint|claude|chatgpt|copilot|cursor|\bide\b|terminal|command line|operating systems?|file management|typing|data entry|notepad|sublime text|vim|emacs|xampp|wamp|mamp|docker desktop|codex|jupyter ?lab|anaconda|obsidian|airtable|zapier|servicenow|zendesk|freshdesk|jira service)\b/i,
  },
  {
    label: 'Communication & Leadership',
    pattern:
      /\b(communication|leadership|teamwork|collaboration|problem[- ]solving|critical thinking|time management|adaptability|creativity|attention to detail|organi[sz]ation(al)?|interpersonal|presentation|public speaking|writing|curriculum ?vitae|\\bcv\\b|editing|proofreading|active listening|conflict resolution|decision[- ]making|emotional intelligence|multitasking|work ethic|initiative|analytical|delegation|team (building|management)|people management|performance review|recruit(ing|ment)|onboarding|human resources|\bhr\b)\b/i,
  },
]

/** The bucket for everything the table did not recognise. See the docblock. */
const FALLBACK = 'Other Skills'

/**
 * `Python (Programming Language)` -> `python programming language`.
 *
 * LinkedIn parenthesises a disambiguation onto half its skill names and the
 * parentheses would otherwise break a word boundary in the middle of a match.
 * The DISPLAY string is never touched -- only what the patterns are tested
 * against -- because the person's own spelling is what goes on the CV.
 */
function normalise(skill: string): string {
  return skill
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * What makes two spellings of a skill the same skill.
 *
 * THE PARENTHETICAL IS A DISAMBIGUATION, NOT PART OF THE NAME. LinkedIn
 * publishes `Python (Programming Language)` and `Figma (Software)`; GitHub's
 * badges publish `Python` and `Figma`. Compared literally those are four
 * skills, and Gabe's CV printed `TypeScript, Python (Programming Language),
 * PHP, JavaScript, Java, Python, C++` -- the same language twice in one line
 * (2026-09-19).
 */
function fingerprint(skill: string): string {
  return skill
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Every skill under a heading, in the table's order, empties dropped.
 *
 * THE ORDER OF THE GROUPS IS THE TABLE'S, not the profile's, so the same
 * person's skills read the same way in the panel and in every CV template.
 * WITHIN a group the profile's own order survives -- on LinkedIn that is
 * most-endorsed first, which is the person's own ranking and not ours to
 * re-sort.
 *
 * DUPLICATES ARE COLLAPSED case-insensitively. Four sources supply this list
 * and `Next.js` from a badge and `Next.js` from a repository language are one
 * skill.
 */
export function groupSkills(skills: string[]): SkillGroup[] {
  const buckets = new Map<string, string[]>()
  /** fingerprint -> the spelling currently kept for it. */
  const seen = new Map<string, string>()
  /** fingerprint -> the group it landed in, so a better spelling can replace it. */
  const placed = new Map<string, string>()

  for (const raw of skills) {
    const skill = raw.trim()
    if (!skill) continue
    const key = fingerprint(skill)
    if (!key) continue
    const already = seen.get(key)
    if (already !== undefined) {
      // THE PLAINER SPELLING WINS. `Python` reads better on a CV than
      // `Python (Programming Language)`, and whichever arrived first is an
      // accident of which source was asked first.
      if (skill.length < already.length) {
        const bucket = buckets.get(placed.get(key)!)!
        bucket[bucket.indexOf(already)] = skill
        seen.set(key, skill)
      }
      continue
    }

    const text = normalise(skill)
    const rule = RULES.find((candidate) => candidate.pattern.test(text))
    const label = rule?.label ?? FALLBACK
    seen.set(key, skill)
    placed.set(key, label)
    const bucket = buckets.get(label)
    if (bucket) bucket.push(skill)
    else buckets.set(label, [skill])
  }

  const ordered = RULES.map((rule) => rule.label).concat(FALLBACK)
  const out: SkillGroup[] = []
  for (const label of ordered) {
    const bucket = buckets.get(label)
    // A label can appear twice in the table only by mistake; guard anyway, so
    // a duplicated row cannot print a group twice.
    if (bucket && bucket.length > 0 && !out.some((group) => group.label === label)) {
      out.push({ label, skills: bucket })
    }
  }
  return out
}
