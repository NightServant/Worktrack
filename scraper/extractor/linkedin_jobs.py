"""LinkedIn job search, read through the endpoint their own public pages call.

WHY THIS REPLACES A PAID ACTOR (Gabe, 2026-09-21: "change to use open-sourced
and public APIs for scraping job postings"). The rail's LinkedIn half was
`bebity~linkedin-jobs-scraper` on Apify, billed per posting. It does not need
to be: `linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search` answers an
ordinary GET with ten job cards and no credential of any kind. Measured
2026-09-21 with a bare `curl` -- curl's OWN user-agent, no key, no cookie, no
challenge -- and it returned 200 with ten complete cards.

IT IS THE SAME ROUTE `JobSpy` TAKES for this board, which is worth saying
because JobSpy is where the question started. Its LinkedIn module requests this
exact path with `clear_cookies=True` and no Authorization header. What it adds
over these sixty lines is pagination, seven other boards and a pandas
DataFrame -- and a dependency on pandas, numpy and tls_client inside a service
whose entire job here is one GET and one parse. The method is identical; only
the weight differs. Its INDEED and GLASSDOOR modules are a different matter and
are deliberately not used -- see `job_board.ACTORS`.

WHAT MAKES THIS DIFFERENT FROM A DISGUISE, since this service refuses those.
Nothing here is borrowed or forged. There is no API key lifted from somebody's
mobile app, no bearer token, no session cookie, no impersonated client and no
TLS fingerprint. It is a public page's own data endpoint, asked the same
question the page asks, by something that says what it is. That is the same
test `seek_api` passes and the same one the Indeed route failed.

WHAT THE CARD CARRIES, and what it does not. Title, company, location, posting
URL and an ISO `datetime` are all present and are exactly what the rail draws.
Salary, seniority and the description are NOT on a search card -- they are on
the posting page, which is a second request per row and is what `track it`
already does properly through the app's own extractor. So those come back null
rather than guessed at.

Everything here is PURE: HTML in, a list of dicts out. The fetch lives in
`app.py`, which owns every request and every timeout.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlencode

from lxml import html as lxml_html

#: The endpoint, which is a documented-by-nobody but entirely public path.
#:
#: `jobs-guest` IS THE WHOLE POINT OF THE NAME: it is what LinkedIn serves to
#: somebody who is not signed in, which is what this service is.
SEARCH_URL = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"

#: How many cards one page returns. LinkedIn's, not ours -- `start` steps by it.
PAGE_SIZE = 10


def search_url(query: str | None, location: str | None, start: int = 0) -> str:
    """The address for one page of results.

    THE PARAMETERS ARE THE ONES THE PUBLIC SEARCH FORM SENDS. `f_TPR`,
    `f_WT` and the other filters exist and are deliberately not used: each one
    is a guess about what the reader wants, and the rail already has its own
    field and region controls in front of this.
    """
    params: dict[str, str] = {"start": str(max(0, start))}
    if query:
        params["keywords"] = query
    if location:
        params["location"] = location
    return f"{SEARCH_URL}?{urlencode(params)}"


def _text(node: Any) -> str | None:
    """The visible text of a node, collapsed, or None."""
    if node is None:
        return None
    text = " ".join("".join(node.itertext()).split())
    return text or None


def _first(root: Any, selector: str) -> Any:
    found = root.cssselect(selector)
    return found[0] if found else None


def _job_id(card: Any) -> str | None:
    """`4424593373` out of `urn:li:jobPosting:4424593373`."""
    urn = card.get("data-entity-urn") or ""
    found = re.search(r"jobPosting:(\d+)", urn)
    return found.group(1) if found else None


def _clean_url(href: str | None) -> str | None:
    """The posting address, without the tracking the card appends.

    `?position=1&pageNum=0&refId=...&trackingId=...` says where in OUR search
    the row appeared, which is meaningless to anybody who opens the link later
    and is three quarters of the string. It is also what would make the same
    posting look like a different one to `trackedFeedRoles`, whose address key
    strips a query anyway -- this just stops storing it in the first place.
    """
    if not href:
        return None
    address = href.split("?", 1)[0].strip()
    return address if address.startswith("https://") else None


def jobs_from_html(markup: str, source: str = "linkedin") -> list[dict[str, Any]]:
    """Every readable card on one results page, in the order LinkedIn returned.

    A CARD MISSING A TITLE, A LINK OR A DATE IS DROPPED rather than rendered as
    "undefined" -- the same rule `to_feed_job` applies to every other board,
    because the rail links the title and groups by the day.

    IT NEVER RAISES ON MARKUP IT DOES NOT RECOGNISE. LinkedIn rewrites this
    page whenever it likes; a class name that moves costs the field that used
    it, and a page that changes shape entirely returns an empty list, which the
    caller reports as the board giving nothing. Neither loses the other boards.
    """
    if not markup or not markup.strip():
        return []
    try:
        # A results page is a bare `<li>` list with no document around it, so it
        # is wrapped -- `fragment_fromstring` on several siblings raises.
        root = lxml_html.fromstring(f"<div>{markup}</div>")
    except Exception:
        return []

    jobs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for card in root.cssselect("div.base-search-card, div.job-search-card"):
        title = _text(_first(card, "h3.base-search-card__title"))
        # `is not None`, NOT `or {}`: an lxml element with no children is
        # falsey, so a link tag holding nothing but an href tested as absent.
        link = _first(card, "a.base-card__full-link")
        url = _clean_url(link.get("href") if link is not None else None)
        stamp = _first(card, "time")
        published = (stamp.get("datetime") if stamp is not None else None) or None
        if not title or not url or not published:
            continue
        if url in seen:
            continue
        seen.add(url)

        jobs.append(
            {
                "source": source,
                # PREFIXED AND FALLING BACK TO THE ADDRESS, the same shape the
                # Apify mapper mints, so the rail's React keys and the tracked
                # map behave identically whichever route a row came in by.
                "id": f"{source}:{_job_id(card) or url}",
                "title": title,
                "company": _text(_first(card, "h4.base-search-card__subtitle"))
                or "unnamed company",
                "url": url,
                "geo": _text(_first(card, "span.job-search-card__location")),
                # NOT ON A SEARCH CARD. Each would be a second request per row
                # against a page that rate-limits; `track it` reads the posting
                # properly through the app's own extractor when asked.
                "level": None,
                "industry": None,
                "publishedAt": _iso_day(published),
                "excerpt": None,
                "salaryMin": None,
                "salaryMax": None,
                "salaryCurrency": None,
            }
        )
    return jobs


def _iso_day(value: str) -> str:
    """`2026-06-05` -> an ISO instant at local midnight of that day.

    THE CARD GIVES A DAY, NOT A MOMENT, and the rail groups by local day. Noon
    UTC would be the safe midpoint for an unknown zone, but every other source
    here reports a real instant and the grouping key is built from it -- so the
    day is kept as written and read as midnight, which is what `localDayKey`
    does with it anyway.
    """
    return f"{value}T00:00:00+00:00" if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) else value
