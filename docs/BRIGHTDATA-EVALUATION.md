# Bright Data — evaluated for the Indeed 401

Whether to pay Bright Data to fix job-posting extraction on Indeed.

**Checked 2026-09-17.** Every price below was read off Bright Data's own
pricing pages on that date and every behavioural claim was measured from this
machine, not recalled. Read each number as of its date — this is the same rule
`docs/INTEGRATIONS.md` is kept by, and vendor lineups move within a quarter.

**Verdict, up front: do not sign up yet.** The 401 never reaches the fetcher we
already pay for, because of a two-character gap in
`scraper/extractor/challenge.py`. Close that first — it is free, it is the root
cause, and it decides whether Bright Data is needed at all. If Indeed still
will not open after that, Web Unlocker is the right product and it is ~$0.23 a
month at Gabe's volume, inside a free tier he would probably never leave.

---

## 1. What is actually happening (measured 2026-09-17)

```
$ curl -sSI -H "User-Agent: Mozilla/5.0 (Windows NT 10.0 ... Chrome/120)" \
    "https://www.indeed.com/viewjob?jk=0000000000000000"
HTTP/2 401
content-type: text/html
server: cloudflare
cf-ray: a3c66b5fcab3cc15-CEB
set-cookie: __cf_bm=...
```

1,675 bytes of HTML, titled **"Authenticating…"**, whose only content is a
script that redirects to:

```
https://www.indeed.com/account/login?branding=login-required&from=bot-detection-anonymous&continue=...
```

plus Cloudflare's `__CF$cv$params` / `/cdn-cgi/challenge-platform/` bootstrap.
`ph.indeed.com` answers identically. `robots.txt` answers 200, because it is
served outside the check — the same signature JobStreet and SEEK showed on
2026-09-05.

**So this is a bot challenge wearing a 401.** Not a broken link, not a missing
page, not a credential problem of ours. And `from=bot-detection-anonymous` says
exactly what Indeed wants instead: a logged-in session.

### The root cause is ours, and it is two characters wide

`scraper/extractor/challenge.py`:

```python
def looks_like_bot_challenge(status: int, body: str) -> bool:
    if status in (403, 503):
        return True
    head = body[:4000]
    return any(marker.search(head) for marker in _CHALLENGE_MARKERS)
```

Run against the real response body:

```
$ .venv/bin/python -c "...from extractor.challenge import looks_like_bot_challenge..."
bytes 1675
looks_like_bot_challenge(401, body) = False
looks_like_bot_challenge(403, body) = True
visible_text_length = 41
```

The body check misses too: the three `_CHALLENGE_MARKERS` look for
`Just a moment...`, `cf-browser-verification|cf_chl_opt|__cf_chl` and
`Checking your browser before accessing`. Indeed's page says "Authenticating…"
and carries `__CF$cv$params` — none of the three match.

So in `scraper/app.py` the response falls past the challenge branch to:

```python
if response.status_code >= 400:
    return JSONResponse({"error": f"Could not fetch page (status {response.status_code})"}, ...)
```

**Firecrawl is never called.** The `_fetch_rendered` escalation — the thing
Gabe already pays for, the thing that exists for exactly this — sits one branch
above and is skipped because the number is 401 instead of 403. The error Gabe
sees is not Indeed refusing a paid unlocker. It is our code refusing to try.

That changes what this document is deciding. Bright Data is being considered
against a Firecrawl attempt that has never happened.

---

## 2. Which Bright Data product

Four were considered. Only one is the right shape.

| Product | What it is | Verdict for this |
|---|---|---|
| **Web Unlocker** | POST a URL, get the unblocked HTML back. Residential IPs, browser fingerprints, CAPTCHA solving, optional JS rendering. | **The right one.** It is a *fetcher*, which is the hole in `scraper/` — one URL in, one document out, parsed by our own Scrapling pipeline. Slots in exactly where Firecrawl already sits. |
| **Scraping Browser (Browser API)** | A remote Chromium you drive over CDP with Playwright/Puppeteer. | **Wrong.** We have no script to drive — `/extract` does one GET and parses. We would pay per GB of browser traffic for a session we open and immediately close. It is also the *expensive* way to answer this: see §3. Buy a browser when you need to click, log in or paginate. We need none of those. |
| **SERP API** | Queries Google/Bing/etc. and returns the results page. | **Wrong product entirely.** It reads search engines, not job boards. It cannot fetch `indeed.com/viewjob?jk=…`. It would answer "what does Google say about this job", which is not the question — the wizard is handed a specific URL the user already chose. |
| **Indeed job-posting dataset** (50.5M records, marketplace) | A bulk file of pre-scraped postings, delivered to S3/Snowflake/etc. | **Wrong shape and wrong price.** It is a *corpus*, not a lookup — you buy 100K records and receive a dump. There is no documented way to ask it for the one posting a user just pasted, and the minimum purchase is **$250**. Gabe needs one row at a time, chosen by someone else, seconds after they choose it. |
| *(honourable mention)* **Indeed Jobs Scraper API** (Web Scraper API) | Structured Indeed JSON, triggered with specific job URLs. | **Plausible but redundant.** It does accept a single `viewjob` URL and returns parsed fields at $1.5/1K records, same free tier. But it returns *their* schema, so `extractor/core.py`, `sites/`, `normalise.py` and the whole tested parsing pipeline go unused for Indeed — and then Indeed alone has an untested second extraction path to maintain. Same money as Web Unlocker; more surface. |

**The distinction that decides it:** Web Unlocker returns *the page*, which our
parser already knows how to read. Everything else returns either the wrong
thing (SERP), a bulk corpus (dataset), a session we do not need (Browser), or a
second schema to maintain (Scraper API).

---

## 3. What it costs at Gabe's actual volume

Gabe's usage is a handful of postings a day, and **only the ones that fail**
would reach Bright Data at all — `app.py` escalates after a plain fetch comes
back as a shell or a challenge. Most postings never get there.

Assume a generous 5 auto-fills a day, every day, *all of them* escalating:
**~150 requests/month**.

| | Free tier | Pay as you go | Scale | Enterprise |
|---|---|---|---|---|
| **Web Unlocker** | **5,000 requests/month**, no card | **$1.50 / 1K requests** | $499/mo (383K incl.), then $1.30/1K | contact sales |
| **SERP API** | 5,000 requests/month | $1.50 / 1K | $499/mo (380K incl.) | contact sales |
| **Web Scraper API** | 5,000 records/month | $1.50 / 1K records | $499/mo (384K incl.) | contact sales |
| **Scraping Browser** | 5K credits ≈ 1 GB | **$8 / GB** | $499/mo (71 GB incl.) | contact sales |
| **Indeed dataset** | free sample on request | **$250 minimum**, ~$0.0025/record | 25–80% off on refresh subscriptions | contact sales |

**The free tier is a single shared pool**, per Bright Data's billing docs:
**5,000 credits a month**, ~$7.50 of value, renewed on the 1st, no rollover, no
card required. Web Unlocker, SERP API and Web Scraper API each burn **1 credit
per request/record**; Browser API burns **5 credits per MB** (changed
2026-09-01), which is why a browser session is the expensive answer here.

So at 150 requests a month Gabe uses **3% of the free tier**. If he ever paid
for those same 150, it would be **about $0.23 a month**.

**Monthly commitment:** none on pay-as-you-go — the pricing pages say "set
monthly spend limits" and "cancel anytime", and the $499 Scale plan is opt-in,
not a floor. **What is not published:** whether checkout enforces a minimum
first deposit. Several third-party reviews mention one; Bright Data's own
pricing pages do not state it, and I did not sign up to find out. Treat it as
unknown rather than as zero.

**The one figure this table cannot give you** is the success rate on Indeed
specifically. Bright Data advertises "98%" across all sites. Nothing on their
site, in their docs, or in their public skills repo states what Web Unlocker
returns for an Indeed page whose block is `from=bot-detection-anonymous` — a
redirect to a *login*, not a puzzle. An unlocker can look like a real browser;
it cannot be a logged-in Indeed account. **This is the live risk in the whole
decision** and the free tier is the only honest way to answer it.

---

## 4. How it would slot into `scraper/`

It sits **beside `_firecrawl_fetch` in `scraper/app.py`**, not in a new module —
that is where every hosted fetcher in this service already lives, next to
`_apify_profile` which was added the same way on 2026-09-10. A `brightdata.py`
would be the first fetcher to get its own file, for no reason the other two did
not also have.

The interface it has to satisfy is one function:

```python
async def _brightdata_fetch(url: str) -> tuple[str | None, str]:
    """Returns (html, reason). Same contract as _firecrawl_fetch."""
```

`reason` is not decoration — it is the contract `_firecrawl_fetch` and
`_apify_profile` both keep, because `/profile` has no fallback and the reason
*is* the message the user gets. Distinguishable reasons: `no-key`, `timeout`,
`unreachable`, `http-401` (our key), `http-402` (out of credit), `empty-body`.

The call itself (checked against Bright Data's REST docs, 2026-09-17):

```
POST https://api.brightdata.com/request
Authorization: Bearer <key>
{"zone": "<zone name>", "url": "<target>", "format": "raw", "render": true}
```

`format: "raw"` returns the HTML as the response body; `format: "json"` wraps it
as `{status_code, headers, body}`.

Then one line in `_fetch_rendered`, which is already the escalation ladder:

```python
via_firecrawl = await _fetch_via_firecrawl(url)
if via_firecrawl: return via_firecrawl
via_brightdata = await _fetch_via_brightdata(url)   # <- new
if via_brightdata: return via_brightdata
return await asyncio.to_thread(_render, url)
```

**Size:** ~45–55 lines including the docstring, modelled directly on
`_firecrawl_fetch` (which is 45). Plus ~4 lines in `_fetch_rendered`, plus one
test in `scraper/tests/test_extract.py` beside the existing
`_fetch(monkeypatch, status=…)` cases — which is how the Firecrawl reasons are
already covered, with no network.

**Config:**

| Variable | Why |
|---|---|
| `BRIGHTDATA_API_KEY` | Bearer token. |
| `BRIGHTDATA_ZONE` | **Required in the body and not derivable** — a zone is created in their dashboard and named there. This is the one that will be forgotten. |

Placement is the same trap Firecrawl and Apify both hit: the fetch is in
`scraper/app.py`, so the key must reach the **Python** process. `scraper/.env`
locally (gitignored, read by `_load_local_env`), an ordinary Vercel project
variable in a deployment. It does nothing in `.env.local`.

**One gap to go in with your eyes open.** Firecrawl hands back
`data.metadata.url`, and `_firecrawl_fetch` re-checks that landed URL against
the SSRF gate — because a hosted fetcher follows redirects on our behalf.
Bright Data's response shape documents `status_code`, `headers` and `body`;
there is no documented guaranteed final-URL field. The risk is smaller than it
looks (their proxies cannot reach anything internal of ours either), but the
check that exists for Firecrawl would have nothing to check, and that should be
a comment in the code rather than a silent omission.

**And `/privacy` gets a third name.** It lists Firecrawl and Apify because they
receive a URL the user pasted. Bright Data would too.

---

## 5. The alternatives, including the free ones

### a. Firecrawl already has the anti-bot mode, and it is already switched on

Firecrawl's `proxy` parameter takes `basic`, `enhanced` or `auto`, and
**`auto` is the default**. From their docs, checked 2026-09-17: a request
starts on basic proxies, and **if the target answers 401, 403 or 429**,
Firecrawl treats that as the proxy being insufficient and retries on enhanced
ones. `404` does not escalate, because a different proxy would not change the
answer.

> "Enhanced proxy requests cost the same as basic requests — 1 credit per
> request… an escalated retry is not charged separately."

Three consequences:

1. **401 is a status Firecrawl explicitly escalates on.** Indeed's block is
   precisely the case the feature was built for.
2. **`firecrawl_payload()` does not set `proxy`**, so it already gets `auto`.
   There is nothing to switch on. Nothing to pay.
3. **The escalation costs nothing extra** — so there is no credit argument for
   avoiding it. (Third-party write-ups still call this "stealth mode" and quote
   a 5× credit surcharge; the current docs use `basic`/`enhanced`/`auto` and
   state no surcharge. Trust the docs page, dated.)

Firecrawl's free tier is 1,000 credits/month (`INTEGRATIONS.md`, 2026-09-07);
paid starts at $16/mo for 5,000. **Which plan this key is on was not verified** —
that needs the dashboard, and this evaluation touched no keys.

### b. The free fix, and it is the root cause

Two edits in `scraper/extractor/challenge.py`:

```python
#: 401 IS A BOT CHALLENGE HERE. Indeed answers an anonymous fetch with
#: HTTP 401 and a Cloudflare page that redirects to
#: /account/login?from=bot-detection-anonymous (measured 2026-09-17).
if status in (401, 403, 503):
```

and a row in `_CHALLENGED_HOSTS` for `indeed.com`, so the fallback message
names the site instead of saying "that page".

That single number change routes Indeed into `_fetch_rendered` → Firecrawl on
enhanced proxies, and if *that* fails, into `autofill_from_url_alone` — which
returns **200 with a real message and a paste prompt** instead of the dead
`Could not fetch page (status 401)`. Both outcomes are strictly better than
today's, and neither costs a cent.

**The trade-off, stated honestly:** 401 genuinely means "not authorised", so a
page that truly requires a login would now be labelled a challenge rather than
an error. For this service that is the correct reading — every target is a
public posting URL a user pasted, and a 401 on one *is* a refusal to serve
bots. `test_extract.py:234` already pins 403 and 503; the new status wants a
line there too, and the real 1,675-byte body makes a good fixture.

### c. Indeed's own API: there isn't one, and this is settled

- The **Publisher API** — the free XML feed with a numeric publisher ID — was
  shut down for the vast majority of publishers in **2023**.
- The **affiliate/publisher programme** has been closed to new publishers since
  **October 2022**.
- **Job Sync API** and the other surviving endpoints are **employer- and
  ATS-side**: they push jobs *into* Indeed. Nothing reads postings out.
- There is no self-serve key at any tier — not paid, not rate-limited, not
  waitlisted.

This is the same lesson `INTEGRATIONS.md` already records for LinkedIn,
JobStreet and SEEK: *whatever a job board exposes to developers is built for
employers.* It belongs in the ruled-out table, not in a follow-up.

### d. A different source for the same posting — free, and already built

Most Indeed listings are syndicated from an employer's own ATS. `registry.py`
already routes **Greenhouse, Lever, Workday and LinkedIn** to dedicated
extractors, and every ATS posting carries JSON-LD, which `core.py` reads first
and scores 0.95. Pasting the company's own posting URL instead of the Indeed
mirror gets a *better* extraction than any unlocker would, for nothing. Worth
one line in the wizard's failure message.

### e. Pasting, which already works

The wizard never blocks on the fetch — `autofillPosting.ts` advances to review
on every failure path and the description column takes a paste, which then goes
through the digest. That is the designed answer to a site that says no, and it
is the one thing on the user's side that can read a page their own browser is
already past.

**One thing that is built and unreachable:** `ExtractRequest` in `app.py`
accepts caller-supplied `html`, which skips the fetch entirely — but
`/api/autofill` only forwards `url`, and no client ever sends `html`. A
"paste the page source" affordance is therefore already half-built on the
server. Not a recommendation, just a fact worth not rediscovering.

---

## 6. Recommendation

**Do the free fix first; do not sign up today.** The 401 is currently refused
by our own code before the paid fetcher we already have is ever asked, so there
is no evidence Bright Data is needed — and buying a fetcher to fix a routing
bug is the expensive way to discover that.

The sequence, and none of it needs an account:

1. Add `401` to `looks_like_bot_challenge` and Indeed to `_CHALLENGED_HOSTS`.
   Pin both in `test_extract.py`. **Cost: one commit.**
2. Auto-fill a real Indeed URL and read the `reason` Firecrawl returns.
   **Cost: 1 credit.** If Firecrawl's enhanced proxies open the page, this
   evaluation is over and Bright Data is a row in the ruled-out table.
3. Only if it does not: open a Bright Data account, create a Web Unlocker zone,
   and spend some of the **5,000 free monthly credits** on the same URL before
   writing a line of `_brightdata_fetch`. **Cost: $0, no card.**

**If the recommendation is wrong**, the loss is small and bounded:

- *Wrong because Firecrawl can't open Indeed either* → two days' delay and
  1 credit, and the fix still stands on its own: the failure message becomes
  honest and points at pasting instead of blaming a valid URL.
- *Wrong because Web Unlocker can't open it either* → nothing, if you test on
  the free tier before integrating. Everything above says to. The scenario
  where this costs real money is writing `_brightdata_fetch` *first* and
  discovering the 98% figure does not include a site that answers with a login
  redirect — about 50 lines and an evening, on top of a vendor and a key to
  keep alive.
- *Wrong because Gabe's volume grows* → it does not change the answer. Even at
  20 auto-fills a day, every one escalating, he is at 12% of the free tier.
- *Wrong in the expensive direction* → the ways to overpay here are all visible
  from the table: the $250 dataset minimum for a product that cannot answer
  a single-URL lookup, the $499/mo Scale plan at 0.04% utilisation, or the
  Scraping Browser at $8/GB for a session with nothing to drive.

---

## Sources

All read 2026-09-17.

- [Web Unlocker pricing](https://brightdata.com/pricing/web-unlocker) · [SERP API pricing](https://brightdata.com/pricing/serp) · [Web Scraper API pricing](https://brightdata.com/pricing/web-scraper) · [Scraping Browser pricing](https://brightdata.com/pricing/scraping-browser) · [Dataset marketplace pricing](https://brightdata.com/pricing/datasets)
- [Bright Data free tier (billing docs)](https://docs.brightdata.com/general/account/billing-and-pricing/free-tier) — the 5,000 shared monthly credits and per-product credit costs
- [Web Unlocker REST reference](https://docs.brightdata.com/api-reference/rest-api/unlocker/unlock-website) — endpoint, `zone`, `format`, response shape
- [Indeed job posting dataset](https://brightdata.com/products/datasets/indeed/job-posting) · [Indeed Jobs Scraper API](https://brightdata.com/products/web-scraper/indeed/job)
- [Firecrawl proxy / stealth docs](https://docs.firecrawl.dev/features/stealth-mode) · [Firecrawl /scrape reference](https://docs.firecrawl.dev/api-reference/endpoint/scrape) · [Firecrawl pricing](https://www.firecrawl.dev/pricing)
- Indeed Publisher API shutdown: [What happened to the Indeed Publisher API](https://jobspipe.dev/blog/indeed-publisher-api) · [Does Indeed have an API?](https://rolesapi.com/blog/does-indeed-have-an-api/) · [Job Sync API guide (Indeed's own docs — employer side)](https://docs.indeed.com/job-sync-api/job-sync-api-guide)
- Indeed's 401, the Cloudflare headers and the `looks_like_bot_challenge` result: measured from this machine, 2026-09-17, commands shown in §1.

**No account was created, no key was used, and no code was changed.**
