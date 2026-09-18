"""The extraction service.

INTERNAL ONLY. It has no auth of its own and it must never get a public route:
a service that fetches an arbitrary URL on request IS an open proxy running on
our egress IP with our rate budget, which is the thing the Deno function's
twenty-line comment warns about. `vercel.json` declares it as a service with no
top-level rewrite, so it is unroutable from the internet and reachable only
over the binding `/api/autofill` holds. Auth, rate limiting and the first SSRF
check all live in that route.

The redirect check runs here anyway -- see extractor/net.py for why the second
copy is not redundant.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from extractor.challenge import (
    autofill_from_url_alone,
    looks_like_bot_challenge,
    looks_like_javascript_shell,
)
from extractor.core import extract
from extractor.net import normalize_target_url, reject_reason
from extractor.apify_profile import profile_from_apify
from extractor.github_profile import _login, profile_from_github
from extractor.jobstreet_profile import profile_from_jobstreet
from extractor.merge_profile import merge_profiles
from extractor.profile import extract_profile

REQUEST_TIMEOUT_S = 12.0

#: How long to let a page finish rendering itself, after the network goes idle.
#:
#: MEASURED, on Cloudstaff (2026-09-06). `network_idle` alone returned a page
#: whose 4,930 visible characters were ENTIRELY its cookie banner -- the
#: posting had not been written to the DOM yet. Six seconds got the whole
#: posting; three did not.
RENDER_SETTLE_MS = 6000
RENDER_TIMEOUT_MS = 45_000

#: Firecrawl: a hosted fetcher that runs the page and handles the proxying.
#:
#: IT REPLACES THE BROWSER THIS SERVICE CANNOT SHIP. `playwright` installs on
#: Vercel and its Chromium never does -- the Python builder runs no
#: post-install step -- so JavaScript rendering worked locally and nowhere
#: else. A hosted fetch needs no binary, which is the whole point.
#:
#: `onlyMainContent` MUST BE FALSE. It defaults to true and would hand back the
#: article body without the `<head>` -- and `<head>` is where the JSON-LD
#: JobPosting lives, which is the single best source this parser has. Asking
#: for "the main content" would quietly throw away the good half.
#: Apify: the profile route that actually gets a page.
#:
#: FIRECRAWL COULD NOT DO THIS ONE. It is a fetcher, and LinkedIn answers a
#: signed-out profile request with an anti-bot challenge rather than a page --
#: so the JSON-LD parser in `extractor/profile.py` had nothing to parse (Gabe's
#: first real test, 2026-09-10). This actor solves the challenge server-side
#: and returns structured JSON.
#:
#: `run-sync-get-dataset-items` runs the actor and returns the rows in one
#: call, which is right for one profile and wrong for a hundred. Per-profile
#: latency is 30-90s of real challenge-solving, so the timeout is generous.
#:
#: MEMORY IS PINNED, and it is a cost decision rather than a performance one.
#: The actor bills $0.50 per GIGABYTE at start (minimum one event), and its own
#: default is 4096MB -- so an unpinned run is $2.00 to read one profile. At
#: 1024MB it is $0.50 plus $0.01 for the result.
APIFY_PROFILE_ACTOR = "crawlerbros~linkedin-profile-scraper"
APIFY_ENDPOINT = "https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items"
APIFY_TIMEOUT_S = 180.0
APIFY_MEMORY_MB = 1024

#: GitHub's own API, which needs no fetcher and no key.
#:
#: 60 requests an hour per address unauthenticated, which is far more than a
#: person importing their own profile will ever use, and `GITHUB_TOKEN` raises
#: it to 5,000 where a deployment has one. The alternative -- putting
#: github.com through Firecrawl -- would spend a credit to parse a rendering of
#: data that is published as JSON.
GITHUB_API = "https://api.github.com"
GITHUB_TIMEOUT_S = 12.0

#: How many repositories to look at. The API caps `per_page` at 100, and a
#: second page would be somebody's archive rather than their best work.
GITHUB_REPO_PAGE = 100

FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape"
FIRECRAWL_TIMEOUT_S = 60.0
MAX_HTML_BYTES = 2_000_000

# The header set the Deno function arrived at. Kept verbatim: it is what a
# browser sends, and several boards vary their markup by it.
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Upgrade-Insecure-Requests": "1",
}

def _load_local_env(path: Path = Path(__file__).with_name(".env")) -> None:
    """Reads `scraper/.env` into the environment, for local runs only.

    WHY THIS EXISTS. The web app's secrets live in `.env.local`, which Next
    loads; this service is a separate Python process started by
    `npm run dev:scraper` and never sees that file. Without something here the
    only way to give the extractor a key locally is to export it in whichever
    shell happens to start uvicorn -- which works once and is forgotten by the
    next terminal.

    A DEPLOYMENT NEVER REACHES THIS: the file is gitignored and absent, and
    Vercel sets real environment variables, which take precedence because an
    existing key is left alone.

    Hand-parsed rather than pulling in python-dotenv: it is `KEY=VALUE`, and a
    dependency for twelve lines is a dependency to keep upgrading.
    """
    try:
        if not path.is_file():
            return
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("'\"")
            # A real environment variable always wins.
            if key and key not in os.environ:
                os.environ[key] = value
    except OSError:
        # An unreadable local file must never stop the service starting.
        pass


_load_local_env()

app = FastAPI(title="worktrack-extractor", docs_url=None, redoc_url=None)


class ProfileRequest(BaseModel):
    """One profile address, or several to be read and merged.

    `url` IS KEPT because it is what one deployed client sends, and a request
    model is a wire contract rather than an internal shape. `urls` is the form
    the aggregating panel uses (Gabe, 2026-09-18: read LinkedIn, GitHub,
    JobStreet and Glassdoor and "combine them into one large single profile").
    Either may be sent; both is the same list.
    """

    url: str | None = None
    urls: list[str] | None = None

    def addresses(self) -> list[str]:
        """The requested addresses, in order, without duplicates."""
        raw = [*(self.urls or []), *([self.url] if self.url else [])]
        seen: list[str] = []
        for value in raw:
            if isinstance(value, str) and value.strip() and value not in seen:
                seen.append(value.strip())
        return seen


class ExtractRequest(BaseModel):
    url: str
    #: HTML the CALLER already has, which skips the fetch entirely.
    #:
    #: The parser never cared where the string came from, so this costs nothing
    #: and buys the pages no server can reach: anything behind a login, and
    #: anything whose operator refuses datacenter traffic. A browser that is
    #: already looking at the posting is not a scraper.
    html: str | None = None


def firecrawl_profile_payload(url: str) -> dict[str, Any]:
    """The profile fetch's body.

    SAME SHAPE AS A POSTING'S, and for the same reason: `onlyMainContent` stays
    False because the JSON-LD `ProfilePage` graph lives in `<head>`, which is
    exactly what "main content" throws away. The wait is shorter -- a profile
    is server-rendered for a logged-out visitor, so there is no posting body to
    wait for.
    """
    return {
        "url": url,
        "formats": [{"type": "rawHtml"}],
        "onlyMainContent": False,
        "waitFor": 2000,
        "timeout": RENDER_TIMEOUT_MS,
    }


def firecrawl_payload(url: str) -> dict[str, Any]:
    """The request body, separated so it can be asserted on without a network."""
    return {
        "url": url,
        # v2 takes format OBJECTS, not strings.
        "formats": [{"type": "rawHtml"}],
        # See FIRECRAWL_ENDPOINT: the head is not optional for this parser.
        "onlyMainContent": False,
        "waitFor": RENDER_SETTLE_MS,
        "timeout": RENDER_TIMEOUT_MS,
    }


def firecrawl_html(payload: dict[str, Any]) -> tuple[str | None, str | None]:
    """The HTML and the final URL out of a Firecrawl reply.

    Returns `(html, final_url)`. The final URL matters as much as the HTML: a
    hosted fetcher follows redirects on our behalf, so where it LANDED is the
    thing that has to pass the host check -- exactly the reason the httpx path
    re-checks `response.url` rather than trusting what was asked for.
    """
    if not isinstance(payload, dict) or not payload.get("success"):
        return None, None
    data = payload.get("data")
    if not isinstance(data, dict):
        return None, None
    html = data.get("rawHtml") or data.get("html")
    metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    final = metadata.get("url") or metadata.get("sourceURL")
    return (html if isinstance(html, str) and html.strip() else None,
            final if isinstance(final, str) else None)


async def _firecrawl_fetch(
    url: str, payload: dict[str, Any] | None = None
) -> tuple[str | None, str]:
    """Fetch through Firecrawl. Returns `(html, reason)`.

    `reason` IS THE POINT OF THIS SHAPE. Every failure here used to collapse
    into `None`, which is fine for `/extract` -- it has an ordinary fetch and a
    browser to fall back on, so the caller only needs to know it did not work.
    `/profile` has no fallback: Firecrawl is the only route, so "it did not
    work" is the entire answer the user gets, and "Could not read that profile
    page. Check the link is public" sent Gabe off to check a link that was fine
    (2026-09-10, first real test).

    The reasons are distinguishable because the fixes are: an exhausted plan is
    a billing page, a 401 is a wrong key, a refused host is Firecrawl declining
    the site, and an empty body is a page that rendered to nothing.
    """
    key = os.environ.get("FIRECRAWL_API_KEY", "").strip()
    if not key:
        return None, "no-key"
    try:
        async with httpx.AsyncClient(timeout=FIRECRAWL_TIMEOUT_S) as client:
            response = await client.post(
                FIRECRAWL_ENDPOINT,
                headers={"Authorization": f"Bearer {key}"},
                json=payload or firecrawl_payload(url),
            )
    except httpx.TimeoutException:
        return None, "timeout"
    except Exception:
        return None, "unreachable"

    if response.status_code != 200:
        # 402 is an exhausted plan, 429 a rate limit, 401 a bad key, and 403
        # is Firecrawl declining the site itself. None is worth a stack trace
        # and all four are worth telling apart.
        detail = ""
        try:
            body = response.json()
            if isinstance(body, dict):
                detail = str(body.get("error") or body.get("message") or "")[:200]
        except Exception:
            detail = response.text[:200]
        return None, f"http-{response.status_code}" + (f": {detail}" if detail else "")

    try:
        html, final = firecrawl_html(response.json())
    except Exception:
        return None, "unreadable-response"
    if final and reject_reason(final):
        return None, "redirected-to-blocked-host"
    if not html:
        return None, "empty-body"
    return html, "ok"


async def _fetch_via_firecrawl(
    url: str, payload: dict[str, Any] | None = None
) -> str | None:
    """The `/extract` path, which only needs to know whether it worked."""
    html, _ = await _firecrawl_fetch(url, payload)
    return html


def _render(url: str) -> str | None:
    """The page as a browser sees it, for sites that render themselves.

    A PLAIN HEADLESS BROWSER, deliberately. Scrapling also ships
    `StealthyFetcher`, which exists to defeat bot detection -- this uses
    `DynamicFetcher`, which just runs the page's own JavaScript. Rendering a
    page the way a browser would is ordinary; dressing up to get past a site
    that has said no is a different thing, and not something this service does.
    Sites that refuse it fall through to the caller supplying HTML instead.
    """
    try:
        from scrapling.fetchers import DynamicFetcher

        page = DynamicFetcher.fetch(
            url,
            headless=True,
            network_idle=True,
            timeout=RENDER_TIMEOUT_MS,
            wait=RENDER_SETTLE_MS,
        )
        return page.html_content or None
    except Exception:
        # Rendering is the SECOND attempt, so a failure here is not fatal --
        # the static HTML is still what gets parsed, and its own warnings then
        # describe what was missing.
        return None


async def _fetch_rendered(url: str) -> str | None:
    """The page as a browser sees it, by whichever route is available.

    FIRECRAWL FIRST, because it is the one that works in production. The local
    browser is the fallback: it needs a Chromium that only exists on a
    developer's machine, so in a deployment this second attempt simply returns
    None and the caller falls through to its own message.

    Neither is reached unless the ordinary fetch already came back as a shell
    or a challenge -- rendering costs money or a browser launch, and most pages
    need neither.
    """
    via_firecrawl = await _fetch_via_firecrawl(url)
    if via_firecrawl:
        return via_firecrawl
    return await asyncio.to_thread(_render, url)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _apify_message(reason: str) -> str:
    """One sentence per thing the reader can actually do about it."""
    if reason.startswith("http-401") or reason.startswith("http-403"):
        return "The profile reader rejected our credentials."
    if reason.startswith("http-402"):
        return "The profile reader's credit is used up."
    if reason.startswith("http-429"):
        return "The profile reader is rate limiting us. Try again in a minute."
    return {
        "no-token": "Profile import is not configured for this deployment.",
        "no-key": "Profile import is not configured for this deployment.",
        "timeout": "That profile took too long to read. Try again.",
        "unreachable": "Could not reach the profile reader. Try again shortly.",
        "no-rows": (
            "The reader could not open that profile. Check the address is a "
            "public LinkedIn profile — a private one cannot be read."
        ),
        "empty-row": "That profile came back empty.",
        "unreadable-response": "The profile reader returned something unexpected.",
    }.get(reason, "Could not read that profile page.")


async def _apify_profile(url: str) -> tuple[dict[str, Any] | None, str]:
    """One profile through the Apify actor. Returns `(row, reason)`.

    The reason is the same contract as `_firecrawl_fetch`'s, and for the same
    reason: this endpoint has no fallback worth the name, so why it failed IS
    the answer the user gets. An exhausted credit balance, a rejected token and
    a profile the actor could not read are three different things to do.
    """
    token = os.environ.get("APIFY_TOKEN", "").strip()
    if not token:
        return None, "no-token"

    actor = os.environ.get("APIFY_PROFILE_ACTOR", "").strip() or APIFY_PROFILE_ACTOR
    endpoint = APIFY_ENDPOINT.format(actor=actor)
    try:
        async with httpx.AsyncClient(timeout=APIFY_TIMEOUT_S) as client:
            response = await client.post(
                endpoint,
                headers={"Authorization": f"Bearer {token}"},
                params={"memory": APIFY_MEMORY_MB, "timeout": int(APIFY_TIMEOUT_S)},
                json={
                    "profileUrls": [url],
                    # OFF. It fetches the current employer's own company page
                    # for headcount and industry -- 30-90 seconds more, for
                    # facts a CV does not carry. `industry` is the only one
                    # mapped, and it is not worth doubling the wait.
                    "enrichCompany": False,
                },
            )
    except httpx.TimeoutException:
        return None, "timeout"
    except Exception:
        return None, "unreachable"

    if response.status_code not in (200, 201):
        detail = ""
        try:
            body = response.json()
            if isinstance(body, dict):
                error = body.get("error")
                if isinstance(error, dict):
                    detail = str(error.get("message") or "")[:200]
                else:
                    detail = str(error or body.get("message") or "")[:200]
        except Exception:
            detail = response.text[:200]
        return None, f"http-{response.status_code}" + (f": {detail}" if detail else "")

    try:
        rows = response.json()
    except Exception:
        return None, "unreadable-response"
    if not isinstance(rows, list) or not rows:
        # The actor ran and found nothing. A private profile, a handle that
        # does not exist, or a challenge it could not get past.
        return None, "no-rows"
    row = rows[0]
    if not isinstance(row, dict) or not row:
        return None, "empty-row"
    return row, "ok"


#: The most addresses one request may carry.
#:
#: Four is the panel's own list -- LinkedIn, GitHub, JobStreet, Glassdoor --
#: and the cap is here rather than only in the web route because this service
#: is the thing that spends money: every non-GitHub address is a hosted fetch.
MAX_PROFILE_URLS = 6


def _profile_site(url: str) -> tuple[str, str]:
    """`(route, label)` for an address: how to read it, and what to call it.

    THE ROUTE IS CHOSEN BY HOST because the sites genuinely differ in kind, not
    in difficulty. LinkedIn answers a signed-out request with a challenge and
    needs the actor. GitHub publishes JSON and needs no fetcher at all.
    Everything else is a rendered page with, at best, a schema.org `Person` in
    its head -- which is the same parser whoever wrote the page.

    THE LABEL IS FOR THE READER. A warning has to name the site it is about, or
    somebody with four links has no idea which one to fix.
    """
    host = (urlparse(url).hostname or "").lower()
    host = host[4:] if host.startswith("www.") else host
    if host == "linkedin.com" or host.endswith(".linkedin.com"):
        return "linkedin", "LinkedIn"
    if host == "github.com" or host.endswith(".github.com"):
        return "github", "GitHub"
    if "jobstreet" in host:
        return "page", "JobStreet"
    if "glassdoor" in host:
        return "page", "Glassdoor"
    if "indeed" in host:
        return "page", "Indeed"
    return "page", host or "That site"


async def _github_profile(url: str) -> tuple[dict[str, Any] | None, str]:
    """A GitHub profile and its repositories. Returns `(payload, reason)`.

    NO KEY REQUIRED, and that is why this source is always available while the
    others depend on a deployment's credit. `GITHUB_TOKEN` is used when the
    deployment has one, purely for the rate limit.

    THE REPOSITORIES ARE NOT FATAL. A user that reads and repositories that do
    not is still a profile -- name, bio, location, photo -- so a failed second
    call costs the projects and the languages rather than the import.
    """
    login = _login(url)
    if not login:
        return None, "not-a-profile"

    headers = {"Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        async with httpx.AsyncClient(timeout=GITHUB_TIMEOUT_S) as client:
            user_response = await client.get(
                f"{GITHUB_API}/users/{login}", headers=headers
            )
            if user_response.status_code == 404:
                return None, "no-such-user"
            if user_response.status_code == 403:
                return None, "rate-limited"
            if user_response.status_code != 200:
                return None, f"http-{user_response.status_code}"
            user = user_response.json()
            if not isinstance(user, dict):
                return None, "unreadable-response"
            # An organisation is not a person, and mapping one would put a
            # company's repositories into somebody's CV as their own work.
            if str(user.get("type", "User")).lower() != "user":
                return None, "not-a-person"

            repos: Any = []
            try:
                repo_response = await client.get(
                    f"{GITHUB_API}/users/{login}/repos",
                    headers=headers,
                    params={
                        "per_page": GITHUB_REPO_PAGE,
                        "sort": "updated",
                        "type": "owner",
                    },
                )
                if repo_response.status_code == 200:
                    repos = repo_response.json()
            except Exception:
                repos = []
    except httpx.TimeoutException:
        return None, "timeout"
    except Exception:
        return None, "unreachable"

    return profile_from_github(user, repos, url), "ok"


async def _linkedin_profile(url: str) -> tuple[dict[str, Any] | None, str]:
    """A LinkedIn profile through Apify, then Firecrawl. `(payload, reason)`.

    APIFY FIRST SINCE 2026-09-10. Firecrawl shipped as the only route and did
    not get a page on the first real test: it is a fetcher, and what LinkedIn
    serves a signed-out visitor is an anti-bot challenge. The Apify actor
    solves that server-side and returns structured JSON, which is also richer
    than the JSON-LD -- certifications, projects, websites, and the bullet text
    under each role that the whole import exists for.

    Firecrawl stays behind it rather than being deleted. It costs a fraction as
    much, it is already configured, and on a profile it CAN read it produces
    the same fields -- so when the Apify credit runs out this is the difference
    between a partial import and none.
    """
    reasons: dict[str, str] = {}
    if os.environ.get("APIFY_TOKEN", "").strip():
        row, reason = await _apify_profile(url)
        reasons["apify"] = reason
        if row is not None:
            return {**profile_from_apify(row, url), "via": "apify"}, "ok"

    if not os.environ.get("FIRECRAWL_API_KEY", "").strip():
        return None, ", ".join(f"{k}: {v}" for k, v in reasons.items()) or "no-key"

    html, reason = await _firecrawl_fetch(url, firecrawl_profile_payload(url))
    reasons["firecrawl"] = reason
    if not html:
        return None, ", ".join(f"{k}: {v}" for k, v in reasons.items())
    if len(html.encode("utf-8", "ignore")) > MAX_HTML_BYTES:
        return None, "too-large"
    return {**extract_profile(url, html, "LinkedIn"), "via": "firecrawl"}, "ok"


async def _plain_fetch(url: str) -> tuple[str | None, str]:
    """An ordinary HTTP GET. Returns `(html, reason)`.

    THE FREE ROUTE, AND IT IS TRIED FIRST (2026-09-18). Every profile that was
    not GitHub went straight to Firecrawl, which costs a credit per attempt --
    and measured on a real JobStreet profile, a plain fetch with the browser
    headers this service already sends returns 200 and 105KB of
    server-rendered HTML carrying the whole public profile. Spending money to
    fetch a page that answers an ordinary request is a habit, not a necessity.

    A CHALLENGE OR A JAVASCRIPT SHELL IS NOT A PAGE, and both are reported as
    their own reason so the caller knows there is something better to try.
    `/extract` makes the same two checks for the same reason; see its comments
    for why rendering a page the site serves to browsers is not a disguise.
    """
    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=REQUEST_TIMEOUT_S, headers=BROWSER_HEADERS
        ) as client:
            response = await client.get(url)
    except httpx.TimeoutException:
        return None, "timeout"
    except Exception:
        return None, "unreachable"

    # THE REDIRECT IS A SECOND URL, and only the thing that followed it can see
    # where it landed.
    if reject_reason(str(response.url)):
        return None, "redirected-to-blocked-host"

    html = response.text
    if looks_like_bot_challenge(response.status_code, html):
        return None, "challenge"
    if response.status_code >= 400:
        return None, f"http-{response.status_code}"
    if not html or not html.strip():
        return None, "empty-body"
    if len(html.encode("utf-8", "ignore")) > MAX_HTML_BYTES:
        return None, "too-large"
    if looks_like_javascript_shell(html):
        return None, "javascript-shell"
    return html, "ok"


async def _page_profile(url: str, label: str) -> tuple[dict[str, Any] | None, str]:
    """Any profile page that is not LinkedIn or GitHub. `(payload, reason)`.

    ORDINARY FETCH FIRST, FIRECRAWL SECOND. The plain request is free and
    works on at least one of these sites; Firecrawl is what runs the page when
    a site answers a raw request with a challenge or an empty shell. Both
    reasons ride back in the compound string, so a failure says which route
    was tried and what each said.

    THE PARSER IS CHOSEN BY HOST, and JobStreet earns its own because the
    generic one cannot read it: that page has no JSON-LD and no `og:title`, so
    "fetched fine, parsed to nothing" and "never fetched" produced the same
    empty panel. See `jobstreet_profile`. Anything the site-specific parser
    does not recognise falls through to the generic reader rather than
    failing -- a markup change should cost the extra fields, not the import.

    WHAT A SITE WILL NOT GIVE IS STILL SAID OUT LOUD, naming it. Glassdoor
    publishes no candidate profile at all to a signed-out visitor, and a panel
    that silently added nothing for it would look broken.
    """
    reasons: dict[str, str] = {}
    html, reason = await _plain_fetch(url)
    reasons["fetch"] = reason

    if not html and os.environ.get("FIRECRAWL_API_KEY", "").strip():
        html, reason = await _firecrawl_fetch(url, firecrawl_profile_payload(url))
        reasons["firecrawl"] = reason
        if html and len(html.encode("utf-8", "ignore")) > MAX_HTML_BYTES:
            html, reasons["firecrawl"] = None, "too-large"

    if not html:
        return None, ", ".join(f"{k}: {v}" for k, v in reasons.items())

    if "jobstreet" in (urlparse(url).hostname or "").lower():
        site_specific = profile_from_jobstreet(url, html)
        if site_specific is not None:
            return {**site_specific, "via": "jobstreet"}, "ok"

    return {**extract_profile(url, html, label), "via": "page"}, "ok"


async def _one_profile(url: str) -> dict[str, Any]:
    """One address, read by whichever route fits it.

    NEVER RAISES. Every source reports its own outcome and the endpoint decides
    what a partial set of failures means -- one dead link out of four must not
    cost the other three, which is the entire reason this returns a record
    rather than a payload.
    """
    route, label = _profile_site(url)
    if route == "github":
        payload, reason = await _github_profile(url)
        message = _github_message(reason)
    elif route == "linkedin":
        payload, reason = await _linkedin_profile(url)
        message = _linkedin_message(reason)
    else:
        payload, reason = await _page_profile(url, label)
        message = _page_message(reason, label)

    record: dict[str, Any] = {
        "url": url,
        "site": label,
        "ok": payload is not None,
        "reason": reason,
    }
    if payload is None:
        record["error"] = message
        return record
    record["via"] = payload.get("via", route)
    record["profile"] = payload["profile"]
    record["warnings"] = payload.get("warnings", [])
    return record


def _linkedin_message(reason: str) -> str:
    """The sentence for a LinkedIn read that did not work.

    THE REASON IS COMPOUND when both routes ran -- `apify: no-rows, firecrawl:
    http-402` -- and the LAST one decided the outcome, because Firecrawl only
    runs once Apify has already failed. Naming the first would send somebody to
    top up a credit balance that is fine.
    """
    last = reason.split(", ")[-1]
    route, _, detail = last.partition(": ")
    if not detail:
        return _apify_message(last)
    return _page_message(detail, "LinkedIn") if route == "firecrawl" else _apify_message(detail)


def _github_message(reason: str) -> str:
    return {
        "not-a-profile": "That GitHub link does not point at a person's profile.",
        "no-such-user": "GitHub has no account at that address.",
        "not-a-person": "That GitHub account is an organisation, not a person.",
        "rate-limited": "GitHub is rate limiting us. Try again in a few minutes.",
        "timeout": "GitHub took too long to answer. Try again.",
        "unreachable": "Could not reach GitHub. Try again shortly.",
    }.get(reason, "Could not read that GitHub profile.")


def _page_message(reason: str, label: str) -> str:
    if reason.startswith("http-402"):
        return "The page reader's monthly quota is used up."
    if reason.startswith("http-401"):
        return "The page reader rejected our credentials."
    if reason.startswith("http-403"):
        return f"The page reader will not fetch {label}."
    if reason.startswith("http-429"):
        return "The page reader is rate limiting us. Try again in a minute."
    return {
        "no-key": "Reading that site is not configured for this deployment.",
        "timeout": f"The {label} page took too long to load. Try again.",
        "unreachable": "Could not reach the page reader. Try again shortly.",
        "empty-body": (
            f"{label} showed nothing to a signed-out visitor — most job boards keep a "
            "candidate profile behind a login, and only a public page can be read."
        ),
        "redirected-to-blocked-host": "That link redirected somewhere it should not.",
        "unreadable-response": "The page reader returned something unexpected.",
        "too-large": f"That {label} page is too large to read.",
    }.get(reason, f"Could not read that {label} page.")


def _attributed_about(read: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Every source's own About, best first.

    ONE PARAGRAPH PER SOURCE, DE-DUPLICATED ON ITS WORDS: two sites carrying
    the same text is one About written twice, and whitespace is not a
    difference.

    A CODE HOST'S BIO GOES LAST, whatever order the sources were asked in
    (Gabe, 2026-09-18: "about section fetched the wrong data"). A GitHub bio is
    a one-line tagline by construction -- the field is 160 characters and sits
    under an avatar -- while an About on a profile site is the paragraph
    somebody wrote to be read by an employer. Ranking by the SOURCE rather than
    by length is what keeps that honest: a short LinkedIn About is still the
    one they wrote for this purpose.

    It is a sort, not a filter. With nothing else to show, the bio is still
    better than an empty section -- and it is labelled, so it cannot be
    mistaken for a professional summary.
    """
    about: list[dict[str, str]] = []
    seen: set[str] = set()
    for result in read:
        text = (result.get("profile", {}).get("summary") or "").strip()
        fingerprint = " ".join(text.split()).lower()
        if not text or fingerprint in seen:
            continue
        seen.add(fingerprint)
        about.append({"site": result["site"], "text": text})
    about.sort(key=lambda entry: entry["site"].lower() == "github")
    return about


@app.post("/profile")
async def profile_endpoint(body: ProfileRequest) -> JSONResponse:
    """One person, from every address the caller gave, merged.

    THE ORDER IS AUTHORITY, NOT PREFERENCE. `merge_profiles` takes the first
    non-empty value for every single field, so the caller's order decides whose
    name and headline win; lists are the union whatever the order. The panel
    sends LinkedIn first because it is the source a CV is written from.

    IN PARALLEL, because they are independent reads of different services and
    one of them (LinkedIn's actor) takes 30-90 seconds of real challenge
    solving. Run in series, four addresses would be four minutes.

    A PARTIAL SET IS A SUCCESS. Three sources that read and one that did not is
    a profile plus a sentence about the fourth -- refusing the whole import
    because Glassdoor has no public profile would make the best case impossible.
    Every outcome is reported per address in `sources`, so the panel can say
    which link worked without guessing.

    NO ORDINARY FETCH ANYWHERE, unlike `/extract`. A plain GET of a LinkedIn or
    a JobStreet profile from a datacenter address gets an authentication wall,
    and a local headless browser would work on a laptop and never in a
    deployment. GitHub is the exception that needs no fetcher at all.

    The same SSRF gate as every other fetch in this service, applied to each
    address, and Firecrawl's landed URL is re-checked because a hosted fetcher
    follows redirects on our behalf.
    """
    urls = [normalize_target_url(value) for value in body.addresses()]
    if not urls:
        return JSONResponse({"error": "No profile address was sent"}, status_code=400)
    if len(urls) > MAX_PROFILE_URLS:
        return JSONResponse(
            {"error": f"Send at most {MAX_PROFILE_URLS} profile addresses"},
            status_code=400,
        )
    for url in urls:
        reason = reject_reason(url)
        if reason:
            return JSONResponse({"error": reason}, status_code=400)

    # CONFIGURATION IS CHECKED PER ROUTE, not once for the request: GitHub
    # needs no key, so a deployment with no Firecrawl and no Apify can still
    # read a GitHub profile, and refusing the whole request would hide that.
    results = await asyncio.gather(*[_one_profile(url) for url in urls])

    read = [result for result in results if result["ok"]]
    # EACH SOURCE KEEPS ITS OWN WARNINGS (Gabe, 2026-09-18, pasting the wall
    # back: seven sentences from five sources in one paragraph, with nothing
    # saying which link each one was about). They stay in the flat `warnings`
    # list too -- an older client reads that one -- but the row is where they
    # can actually be acted on.
    sources = [
        {key: value for key, value in result.items() if key != "profile"}
        for result in results
    ]

    if not read:
        # THE REASONS REACH THE USER, because there is no fallback left and a
        # generic message sends them to check links that are fine.
        return JSONResponse(
            {
                "error": results[0].get("error") or "Could not read that profile.",
                "reason": "; ".join(
                    f"{result['site']}: {result['reason']}" for result in results
                ),
                "sources": sources,
            },
            status_code=422,
        )

    profile = merge_profiles([result["profile"] for result in read])

    # WHERE THE ABOUT CAME FROM, AND EVERY SOURCE THAT HAD ONE (Gabe,
    # 2026-09-18: "about section information must come from other sources such
    # as LinkedIn, JobStreet"). `summary` is a single field, so the merge keeps
    # the first non-empty one and the rest are discarded -- which is how a
    # profile ended up introducing itself with a three-word GitHub bio while
    # nothing on the screen said that is what it was.
    #
    # ATTRIBUTED RATHER THAN CONCATENATED. Two sources' About sections are two
    # things the same person wrote for two audiences; running them together
    # makes one paragraph that contradicts itself, and naming each is also the
    # answer to "why does my profile say that".
    #
    # BUILT HERE because a parser only ever sees its own source and cannot know
    # who else had one. `summary` is left exactly as it was, since the CV tools
    # read it as one string.
    about = _attributed_about(read)
    profile["about"] = about
    # AND THE SINGLE FIELD FOLLOWS THE SAME RANKING. `merge_profiles` takes the
    # first non-empty summary in request order, which would leave a GitHub bio
    # as the CV's opening paragraph while the panel showed a LinkedIn About
    # above it -- two answers to one question on one screen.
    if about:
        profile["summary"] = about[0]["text"]

    warnings: list[str] = []
    for result in read:
        for warning in result.get("warnings", []):
            if warning not in warnings:
                warnings.append(warning)
    # A SOURCE THAT FAILED IS A WARNING TOO. It is the only place the reader
    # sees it if they are not looking at the per-source list.
    for result in results:
        if not result["ok"] and result.get("error"):
            warnings.append(result["error"])

    return JSONResponse(
        {"profile": profile, "warnings": warnings, "sources": sources},
        status_code=200,
    )


@app.post("/extract")
async def extract_endpoint(body: ExtractRequest) -> JSONResponse:
    url = normalize_target_url(body.url)
    reason = reject_reason(url)
    if reason:
        return JSONResponse({"error": reason}, status_code=400)

    # CALLER-SUPPLIED HTML SHORT-CIRCUITS EVERYTHING. No fetch, so no timeout,
    # no redirect check to repeat, and no way for this service to be pointed at
    # something the caller could not already read.
    if body.html:
        if len(body.html.encode("utf-8", "ignore")) > MAX_HTML_BYTES:
            return JSONResponse({"error": "Page content is too large"}, status_code=422)
        return JSONResponse(extract(url, body.html, 200), status_code=200)

    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=REQUEST_TIMEOUT_S, headers=BROWSER_HEADERS
        ) as client:
            response = await client.get(url)
    except httpx.TimeoutException:
        return JSONResponse({"error": "Timed out while fetching job page"}, status_code=504)
    except httpx.HTTPError:
        return JSONResponse({"error": "Could not fetch this URL"}, status_code=422)

    final_url = str(response.url)
    # THE REDIRECT IS A SECOND URL. The caller validated what the user typed;
    # only this can see where it landed.
    if reject_reason(final_url):
        return JSONResponse({"error": "URL redirected to an invalid host"}, status_code=422)

    body_text = response.text

    # A challenge answers before the content-type check, because a 403
    # interstitial is often served as HTML and would otherwise read as a
    # perfectly ordinary failed fetch.
    #
    # RENDERING IS TRIED FIRST, THOUGH, and the distinction matters. JobStreet
    # answers a raw HTTP fetch with Cloudflare's "Just a moment" interstitial
    # and answers an ORDINARY HEADLESS BROWSER with the page (measured
    # 2026-09-06: 403 vs 200, 6,320 visible characters, no challenge). The
    # challenge is aimed at clients that cannot run the page, so running it is
    # not getting around anything -- it is being the kind of client the site
    # already serves.
    #
    # `_render` uses a plain browser for exactly that reason. Scrapling also
    # ships `StealthyFetcher`, whose purpose is to defeat bot detection, and
    # this service does not use it: a site that says no to a real browser has
    # said no, and the answer to that is the caller supplying HTML from their
    # own session, not a better disguise.
    if looks_like_bot_challenge(response.status_code, body_text):
        rendered = await _fetch_rendered(final_url)
        if rendered and not looks_like_bot_challenge(200, rendered):
            return JSONResponse(extract(final_url, rendered, 200), status_code=200)
        return JSONResponse(autofill_from_url_alone(final_url), status_code=200)

    if response.status_code >= 400:
        return JSONResponse(
            {"error": f"Could not fetch page (status {response.status_code})"}, status_code=422
        )

    content_type = (response.headers.get("content-type") or "").lower()
    if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
        return JSONResponse({"error": "URL did not return an HTML page"}, status_code=422)

    if not body_text or len(body_text.encode("utf-8", "ignore")) > MAX_HTML_BYTES:
        return JSONResponse({"error": "Page content is too large or empty"}, status_code=422)

    # A JAVASCRIPT SHELL IS NOT A PAGE. Cloudstaff answers a plain fetch with
    # 110KB of HTML containing fifteen visible characters, because every
    # posting is rendered client-side -- and the extractor then produced three
    # vague warnings about a document that simply had nothing in it. Rendering
    # is tried only here, on the pages that need it, because it costs a browser
    # launch and most pages do not.
    if looks_like_javascript_shell(body_text):
        rendered = await _fetch_rendered(final_url)
        if rendered and not looks_like_javascript_shell(rendered):
            body_text = rendered

    return JSONResponse(extract(final_url, body_text, response.status_code), status_code=200)
