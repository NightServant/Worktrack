# Getting a posting into the app, for nothing

Zero budget is the constraint, not the preference. This ranks every free route
into a job posting's content and says what each costs in *friction*, since none
of them costs money.

**Checked 2026-09-17.** Every status code, byte count and field below was
measured from this machine or from Gabe's own browser on that date. Every price
was read off the vendor's own pricing page the same day. Nothing here is from
memory, no account was created, no key was used, and no application code was
changed. Read each number as of its date — this is the rule
`docs/INTEGRATIONS.md` is kept by and vendor lineups move within a quarter.

**Verdict, up front.** Two free routes are worth building and they are not
competing — they cover different halves of the problem:

1. **Point the wizard at the ATS posting instead of the Indeed mirror.** Free,
   *zero* new code, and measured to produce a **better** extraction than any
   paid unlocker would: 0.90–0.95 confidence on every field, from a plain
   anonymous `curl`. This is a sentence in a failure message, not a feature.
2. **Let the user's own browser be the fetcher**, for everything route 1 cannot
   reach. Measured to work where every machine route fails. Costs the user one
   click on a bookmark. Costs us about 40 lines, because the server half is
   already built.

Everything else — Jina Reader, the public CORS proxies, ScrapingAnt, ZenRows,
ScraperAPI, self-hosted Crawl4AI — is either **measured to fail on Indeed**, or
unmeasurable without an account, or dominated by the Firecrawl allowance we
already have. None of them earns a dependency.

---

## 1. What is already true, and not re-litigated here

`docs/BRIGHTDATA-EVALUATION.md` established the 401 and its cause. **That fix
is already in the working tree** — `scraper/extractor/challenge.py` now treats
401 as a challenge, carries an `indeed.com` row in `_CHALLENGED_HOSTS` and
matches Cloudflare's `__CF$cv$params` bootstrap, with 62 new lines of assertions
in `scraper/tests/test_extract.py`. This document does not duplicate it and
assumes it lands.

What that fix buys, precisely: Indeed now *reaches* `_fetch_rendered`, so
Firecrawl gets asked on `proxy=auto` (which escalates on exactly 401/403/429 at
no extra credit), and if that fails the user gets a 200 from
`autofill_from_url_alone` naming the site instead of `Could not fetch page
(status 401)`.

What it does **not** buy: any evidence that Firecrawl's enhanced proxies open
Indeed. That is still unknown and still costs 1 credit to answer. Everything
below is what to do in the branch where it does not.

---

## 2. The measurement the whole ranking falls out of

Three fetches of the same live posting, `indeed.com/viewjob?jk=db6a5c966dee6fc2`.

| Client | Result |
|---|---|
| `curl`, full browser headers | **401**, 1,675 bytes, `<title>Authenticating...</title>` |
| **Jina Reader** (`r.jina.ai`, keyless) | **200**, 1,511 bytes — and the body is `Title: Just a moment...` |
| **A real browser, anonymous** (fresh profile, JS enabled, challenge allowed to run) | redirected to `secure.indeed.com/auth?...&from=bot-detection-anonymous` — **a sign-in wall** |
| **Gabe's own Chrome, signed in** | **200**, 381,640 bytes, the whole posting |

The third row is the one that decides everything. **Running JavaScript is not
what gets you in.** An honest headless browser executes the Cloudflare challenge
and is still bounced to a login, because `from=bot-detection-anonymous` says
what Indeed actually wants: a session. That is why a better fetcher — hosted,
self-hosted, stealthy or paid — is not obviously the answer, and why the only
client measured to succeed is one that is already logged in.

### Indeed publishes no structured data on any surface (question 4: answered, no)

Every anonymous Indeed surface, same job ID, 2026-09-17:

| Surface | Status | What came back |
|---|---|---|
| `/viewjob?jk=...` | 401 | 1,675 B Cloudflare redirect |
| `/viewjob?jk=...&vjs=3` (their own XHR partial) | 401 | identical |
| `/m/viewjob?jk=...` (mobile, iPhone UA) | 403 | 27,811 B `Security Check - Indeed.com` |
| `/jobs?q=...` (search) | 403 | 27,784 B |
| `/applystart?jk=...` | 403 | 27,772 B |
| `/job/<jk>` | 404 | real Indeed 404 page |
| `/rss?q=...` | **404** | real Indeed 404 — **the RSS feed is gone** |
| `/viewjob` as Googlebot | 403 | `Blocked - Indeed.com` |
| `ph.indeed.com/viewjob` | 401 | byte-identical to `www` |

**Zero JSON-LD on any of them**, including the 401 body. And on the page Gabe's
signed-in browser *did* get, `document.querySelectorAll('script[type="application/ld+json"]')`
returns **empty** — Indeed publishes no JobPosting graph even to a logged-in
reader. So there is no cheap structured-data shortcut at any layer, and the
Googlebot row also disposes of user-agent spoofing: it is explicitly blocked,
and it would be a lie this service has already decided not to tell
(`app.py`: *"a site that refuses an honest browser has said no"*).

Indeed's own API was settled in `BRIGHTDATA-EVALUATION.md` §5c: the Publisher
API shut down in 2023, the affiliate programme closed to new publishers in
2022, and everything still alive is employer-side. Not re-opened here.

---

## 3. The options, ranked

### 1. Send the user to the ATS posting, not the Indeed mirror — **free, zero code, best quality**

The premise holds, and the measurement is unambiguous. A real Greenhouse board
URL, fetched with a **plain anonymous `curl`**, through the **existing,
unchanged** `extract()`:

```
https://job-boards.greenhouse.io/stripe/jobs/8172510   ->  200, 176,305 bytes, 1 JSON-LD block

role              Abuse Investigator          0.95
company           Stripe                      0.95
location          Atlanta, US                 0.90
salary_min/max    188400 / 282600 USD         0.90
description       (full posting body)         0.95
work_mode         remote                      0.90
tags              full-time                   0.85
source            Greenhouse                  1.00
```

Compare that with the best the Indeed route can ever do (§3.2, below): role
0.70, description 0.60, salary 0.45. **The ATS posting is not a workaround for
Indeed being closed. It is a strictly better reading of the same job**, because
the employer published JSON-LD there and Indeed did not.

`registry.py` already routes Greenhouse, Lever, Workday and LinkedIn. And every
one of these boards also exposes a **keyless, free public JSON API**, verified
working 2026-09-17:

| Board | Endpoint | Result |
|---|---|---|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{token}/jobs` | 200, 406 KB JSON |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{name}` | 200, 2.4 MB JSON |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/{name}/postings` | 200 |
| Workable | `apply.workable.com/api/v1/widget/accounts/{name}?details=true` | 200 |
| Arbeitnow (aggregator over ATSs) | `arbeitnow.com/api/job-board-api` | 200, 2.4 MB JSON |

**The honest limit, and it is the whole reliability question.** *We cannot
detect the ATS posting from an Indeed URL.* The jk is an opaque 16-hex token; the
page that would name the employer's apply destination is the page we cannot
fetch. On the one live posting measured through Gabe's browser, the rendered
DOM contained **no outbound ATS link at all** — Indeed hosted the application
itself.

Working the other way is more encouraging but still not a detector: on
`indeed.com/jobs?q=software+engineer&l=Remote`, **32 of 32** result cards were
employer-site applications with **zero "Easily apply"** — General Motors,
Lenovo, Cisco, all of which run Workday or Greenhouse. So the *mirrors exist*;
they are simply not addressable from the URL we are handed.

**Therefore this is a sentence, not a subsystem.** `autofill_from_url_alone`
already returns a 200 with a warning naming the site. One clause added to the
Indeed branch of that warning — *"Indeed copies most postings from the
employer's own careers page; pasting that link instead reads the posting in
full"* — is the entire implementation, and it converts a dead end into the best
outcome available. It also costs nothing if the user ignores it.

**Friction:** the user finds and pastes a second URL. Real, but it is one they
can get by clicking "Apply on company site" in the tab they already have open,
and they are rewarded with a *better* fill than the happy path.

### 2. The user's browser as the fetcher — **free, and the only thing measured to work on Indeed**

`ExtractRequest.html` already exists in `scraper/app.py` and already
short-circuits the entire fetch, the timeout and the redirect re-check. The
server half is built. What is missing is a way to get HTML into it.

**How well would it parse?** Measured, not predicted. I built a fixture from
Indeed's *real* markup as read off the live signed-in page — no JSON-LD, no
`og:site_name`, `og:description` carrying the company name, `#jobDescriptionText`
holding 4,030 characters of body — and ran the **unmodified** `extract()`:

```
role            Software Engineer                 0.70   <- og:title, via title_to_role
description     (4,030 chars, the real body)      0.60   <- [id*="jobDescription"] already matches
work_mode       remote                            0.50
salary_min/max  100000 / 120000 USD               0.45
tech_stack      TypeScript, Python, React, ...    0.40
source          indeed.com                        0.90
company         -- MISSING --
location        -- MISSING --
```

**Seven of nine fields, with zero new parser code.** The two misses are both
one selector each, and Indeed's markup hands them over:
`[data-testid="inlineHeader-companyName"]` and
`[data-testid="inlineHeader-companyLocation"]` (confirmed present on the live
page). That is an `indeed()` function in `sites/boards.py` of about a dozen
lines — the same shape and size as the `greenhouse()` and `lever()` functions
beside it — plus one row in `_ROUTES`.

**The transport is the part with a real obstacle, and it is measured.** A
bookmarklet runs in the page's own context, so it inherits the page's CSP.
Indeed's posting page ships:

```
default-src 'self' 'unsafe-inline' data: *.indeed.com accounts.google.com/ ...
```

and **no `connect-src`**, so `default-src` governs connections. A
`fetch('https://worktrack.example/...')` from that page was measured to throw
`TypeError: Failed to fetch`. `XMLHttpRequest` and `sendBeacon` are governed by
the same directive and fail the same way.

So the naive bookmarklet does not work, and someone will lose an afternoon to
that. What does work, because CSP does not govern either mechanism:

```js
// bookmarklet, one line in a bookmark's URL field
javascript:(()=>{const w=open('https://worktrack.example/ingest');
addEventListener('message',e=>{if(e.source===w)w.postMessage(
  {url:location.href,html:document.documentElement.outerHTML},'https://worktrack.example')})})()
```

`window.open` is not restricted by `default-src`, and `postMessage` is outside
CSP entirely. The opened `/ingest` page announces itself, receives the payload,
and POSTs it to `/api/autofill` from *our* origin where no foreign CSP applies.
381,640 bytes is comfortably under `MAX_HTML_BYTES` (2,000,000) and under
Vercel's 4.5 MB request body limit.

**Send the HTML, not extracted fields.** The temptation is to have the
bookmarklet read the company and title itself and post a small JSON. Don't: that
duplicates `extractor/` in JavaScript and leaves two parsers to keep in step.
The HTML round-trip reuses the whole tested Python pipeline, which is the
reason `ExtractRequest.html` was worth having in the first place.

**What breaks, honestly:**

- **Nothing anchors it to a job page.** A user can fire it on their inbox. The
  parser will return a low-confidence mess rather than an error. Acceptable —
  the wizard already shows confidence and says to check every field — but it is
  not an error path, it is a bad fill.
- **A bookmarklet is fragile furniture.** It does not sync reliably across
  devices, it cannot be run on iOS Safari without the share-sheet dance, and a
  user who edits the bookmark breaks it silently.
- **It is a second surface to keep working.** When Indeed changes
  `inlineHeader-companyName`, the fill degrades quietly rather than failing.
- **`/privacy` needs no new name** — and that is the one genuinely good
  property here. Unlike Firecrawl, Apify or any unlocker, **no third party
  receives the URL**. The fetch is the user's own browser, on a page they were
  already looking at. This is the most privacy-preserving option on the list by
  a wide margin.

**Is the UX acceptable?** For the *failure* path, yes — unambiguously better
than what happens now. The comparison is not "one click versus zero"; it is
"one click versus retyping company, role, location, salary and work mode by
hand, which is what `autofill_from_url_alone` leaves you doing today". Five
fields for one click is a good trade. It is **not** acceptable as the primary
path and should never be offered before the ordinary fetch has failed.

**Extension instead of bookmarklet?** A content script is exempt from the
page's CSP and could `fetch` directly, which removes the `postMessage` dance
and the fragility. It costs a Chrome Web Store listing, a review cycle, a
manifest, an update channel and a second thing to build. Not worth it for one
user. Revisit only if Worktrack ever has users who are not Gabe.

**Build cost:** ~12 lines in `sites/boards.py` + 1 row in `registry.py`
+ ~10 lines forwarding `html` in `src/app/api/autofill/route.ts` + a small
`/ingest` page + the bookmarklet above. No new dependency, no new vendor, no
key, nothing to deploy to a service that cannot run Chromium.

### 3. Firecrawl's existing allowance — **already free, already wired, already the next step**

1,000 credits/month, recurring, no card (firecrawl.dev/pricing, read
2026-09-17; cheapest paid is $16/mo for 5,000). At a handful of auto-fills a
day, of which only the *failures* escalate, Gabe would use a few percent.

Nothing to build. `proxy=auto` is already the default and already escalates on
401. **Spend one credit on a real Indeed URL before building anything below
it.** If it opens the page, options 4–7 are all moot.

Which plan the existing key is on is still unverified — that needs the
dashboard, and this evaluation touched no keys.

### 4. ZenRows free tier — **the best of the signup options, and it does fit**

"Free, not a trial. 5,000 credits/month", no card, monthly refresh, no
rollover (zenrows.com/pricing, read 2026-09-17). Cheapest paid: $16/mo for 45K.

The number that matters is buried in their FAQ, not the plan card: **"JavaScript
rendering costs 5 credits, premium proxies 10, and both together 25."** Indeed
needs both. So 5,000 free credits is **200 hard-protected pages a month**. At
Gabe's generous ceiling — 5 auto-fills a day, every one escalating, 150/month —
that is 3,750 credits: **inside the free tier, with 25% headroom and no card.**

Costs a signup and a key in `scraper/.env` plus the Vercel env var. Slots in
beside `_firecrawl_fetch` exactly as `BRIGHTDATA-EVALUATION.md` §4 describes,
same `(html, reason)` contract, ~45 lines.

**Unknown, and it is the same unknown as Bright Data's:** whether it opens
*Indeed* specifically, whose block is a login redirect rather than a puzzle.
Untestable without an account, and the brief said to sign up for nothing.

### 5. ScrapingAnt free tier — **larger headline, smaller reality; does not fit**

"10,000 free credits every month — no credit card", "failed requests cost 0"
(scrapingant.com, read 2026-09-17). Sounds like twice ZenRows.

It is not. Their credit table (docs.scrapingant.com/credits-cost, same date):

| Request | Credits |
|---|---|
| Simple request + datacenter proxy | 1 |
| Headless browser (JS) + datacenter proxy | 10 |
| Simple request + **residential** proxy | 25 |
| **Headless browser (JS) + residential proxy** | **125** |

Indeed needs the last row. 10,000 / 125 = **80 pages a month**, against a
150/month ceiling. **This one runs out**, and it runs out into a paywall at
$19/mo. Ranked below ZenRows on measured arithmetic, not on vibes.

### 6. Jina Reader — **genuinely free and keyless, and measured to fail on Indeed**

The only option here that needs no account at all: `r.jina.ai/<url>`, **20 RPM
with no API key**, no token billing (jina.ai/reader rate-limit table, read
2026-09-17). Ten lines to wire in.

And on Indeed it returns the challenge. Measured twice, on a fake job ID and on
a real one: **HTTP 200, 1,511 bytes, `Title: Just a moment...`**. It is a
datacenter fetcher with a renderer; it has the same problem every other machine
has.

Worth remembering for a *different* job — it is a clean, free way to get
readable text out of an awkward page that is not actively blocking us — but it
does not solve this one, and adding it for Indeed would be adding a dependency
that has already been measured not to work.

### 7. Self-hosted (Crawl4AI, Camoufox, SeleniumBase UC) — **cannot run where it is needed**

Free and open-source, and the honest stealth options if you want one. But they
all need a real browser, and **headless Chromium does not work on this
project's Vercel deployment** — Playwright installs, its Chromium never does.
`INTEGRATIONS.md` already records that production once carried ~300 MB it could
not use.

So this could only run on Gabe's Mac. Which is not disqualifying — `_render`
already does exactly that as a local-only fallback, and the extractor has to be
running locally anyway — but it means it fixes auto-fill *on his laptop* and
never in the deployed app. Option 2 fixes it in both, for less code.

Third-party testing (The Web Scraping Club, 2026) reports self-hosted fortified
browsers at 0–35% success across protected domains, with Camoufox passing
Indeed's anti-bot layer but hitting volume limits. Quoted, not measured here —
treat as an indication, not a number.

Also: every integration guide for these ends at a paid CAPTCHA solver
(CapSolver and similar). That is the point where "free" stops being true.

### 8. Ruled out on measurement

| Option | Why | Measured |
|---|---|---|
| **Public keyless CORS proxies** | allorigins **520**, codetabs **522**, corsproxy.io now **401 "A valid API key is required"**. Datacenter IPs; even working they would hit the same wall. | 2026-09-17 |
| **ScraperAPI** | Not a free tier. "7-day trial, 5,000 credits"; their FAQ separately offers 1,000 credits. A trial is a deadline, and zero budget means nothing that expires into a bill. | 2026-09-17 |
| **Indeed RSS** | `/rss?q=...` returns a real **404**. The feed is gone. | 2026-09-17 |
| **Indeed mobile / `vjs=3` / applystart** | 401 or 403 on every one. No unguarded surface. | 2026-09-17 |
| **Googlebot user-agent** | `403 Blocked - Indeed.com`. Does not work, and would be a lie the codebase has already refused to tell. | 2026-09-17 |
| **Indeed Publisher / affiliate API** | Shut down 2023 / closed to new publishers 2022. Settled in `BRIGHTDATA-EVALUATION.md` §5c. | 2026-09-17 |

---

## 4. What each costs the user, side by side

Money is zero everywhere. Friction is the only axis.

| Option | User friction | Quality it yields | Works in the deployed app |
|---|---|---|---|
| **ATS URL instead of Indeed** | Paste a different link (one click away in their open tab) | **Best available** — 0.90–0.95 every field | Yes |
| **Browser bookmarklet** | One click, on a bookmark they installed once | 0.40–0.70, all nine fields | Yes |
| **Firecrawl (existing)** | None — invisible | Unknown on Indeed | Yes |
| **ZenRows free tier** | None, after Gabe does a signup | Unknown on Indeed | Yes |
| **ScrapingAnt free tier** | None, until credits run out mid-month | Unknown on Indeed | Yes |
| **Jina Reader** | None | **Nothing** — returns the challenge | Yes, uselessly |
| **Self-hosted browser** | None | Unknown, volume-limited | **No** |
| **Paste the description** (today) | Retype 5 fields, paste the body | Whatever they type | Yes |

---

## 5. Recommendation

**Build option 1 now, option 2 next, and nothing else until Firecrawl has been
measured.**

1. **One clause in the Indeed warning**, pointing at the employer's own careers
   page. It is the cheapest change in this document and it produces the *best*
   extraction available — better than the happy path, better than anything
   paid. Do this regardless of what else happens. **Cost: one commit, no code
   outside a string.**
2. **Spend one Firecrawl credit** on a real Indeed URL once the 401 fix lands.
   This is already step 2 of `BRIGHTDATA-EVALUATION.md` and it decides whether
   anything further is needed at all. **Cost: 1 credit.**
3. **If Firecrawl cannot open it: build the bookmarklet.** It is the only route
   measured to work, it is the only one that sends the URL to no third party,
   and its server half already exists. **Cost: ~40 lines, no vendor, no key.**
4. **Do not sign up for ZenRows or ScrapingAnt yet**, and if you ever do, make
   it ZenRows — the arithmetic in §3.4 fits the volume and §3.5 does not.

**If this recommendation is wrong**, the loss is bounded and visible:

- *Wrong because Firecrawl opens Indeed after all* — then options 2 onward were
  never needed, and the cost of having written this was an afternoon. Step 1
  still stands on its own merit.
- *Wrong because the bookmarklet's UX is worse than described* — the fallback
  is the status quo, which is pasting, which already works. Nothing is removed
  to build it.
- *Wrong because Indeed changes its markup* — the bookmarklet degrades to
  seven fields instead of nine, because only `company` and `location` depend on
  Indeed-specific selectors. The rest rides on `og:` tags and generic
  heuristics that do not move.
- *Wrong in the expensive direction* — the ways to overspend here are visible:
  ScrapingAnt's 125-credit rows running out into $19/mo, ScraperAPI's trial
  turning into a bill, or any self-hosted stealth stack ending at a paid CAPTCHA
  solver. All three are marked above.

**The thing this document cannot tell you** is whether any hosted unlocker
opens a page whose block is `from=bot-detection-anonymous` — a redirect to a
login, not a puzzle. Nothing was measured on that because measuring it requires
an account. It is the same open question `BRIGHTDATA-EVALUATION.md` ended on,
and the free tiers are still the only honest way to answer it.

---

## Sources

All read or measured 2026-09-17.

- Indeed's 401/403/404 across nine surfaces, the absent JSON-LD, the CSP
  `default-src`, the refused page-context `fetch`, the signed-in 381,640-byte
  page and the 32-of-32 employer-site search results: measured from this
  machine and from Gabe's own Chrome. Commands and results in §2 and §3.
- `extract()` output on Indeed-shaped markup and on
  `job-boards.greenhouse.io/stripe/jobs/8172510`: run against the repo's own
  `scraper/.venv`, unmodified code.
- [Jina Reader rate limits](https://jina.ai/reader) — 20 RPM without an API key
- [ZenRows pricing](https://www.zenrows.com/pricing) — 5,000 credits/month, no card; JS 5 / premium 10 / both 25
- [ScrapingAnt pricing](https://scrapingant.com/) and [credit costs](https://docs.scrapingant.com/credits-cost) — 10,000/month; browser+residential 125
- [ScraperAPI pricing](https://www.scraperapi.com/pricing/) — 7-day trial, 5,000 credits
- [Firecrawl pricing](https://www.firecrawl.dev/pricing) — 1,000 credits/month, no card
- Keyless ATS APIs: Greenhouse, Ashby, SmartRecruiters, Workable, Arbeitnow — each fetched and confirmed 200
- [Crawl4AI self-hosting](https://docs.crawl4ai.com/core/self-hosting/) and [Cloudflare bypass survey 2026](https://publish.obsidian.md/twsc-public/Web+Scraping/Articles/cloudflare-bypass-2026) — third-party success rates, quoted not measured
- `docs/BRIGHTDATA-EVALUATION.md` for the 401 root cause and Indeed's API history, not repeated here

**No account was created, no key was used, and no application code was changed.**
