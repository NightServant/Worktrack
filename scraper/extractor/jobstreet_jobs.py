"""JobStreet search, read from the GraphQL payload its own page arrives with.

WHY NOT SIMPLY CALL THE GRAPHQL ENDPOINT, which is what was asked for and what
was tried first (Gabe, 2026-09-21: "use graphql for Jobstreet"). The operation
is `JobSearchV7` and it was recovered in full from the site's own bundle --
`query JobSearchV7($params: JobSearchV7QueryInput!, $locale: Locale!, $zone:
Zone!, $country: JobSearchV7Country!, $timezone: Timezone!, $tagsSubType:
[JobSearchV7TagsSubType!])`. It cannot be called by a client at all -- see the
paragraph below, which is the measured answer rather than the guess this note
first recorded.

SO THE PAYLOAD IS READ WHERE IT IS ALREADY GIVEN AWAY. Every search page ships
the complete `jobSearchV7` response server-rendered into `window.
SEEK_APOLLO_DATA` -- thirty jobs, the pagination, the structured salary, all of
it, in the HTML. Nothing is re-asked for, nothing is re-authorised; this reads
the answer the page was already handed.

THE PAGE ITSELF IS CLOUDFLARE-CHALLENGED, which is the known shape of this
board: a plain server-side GET answers 403, measured again on 2026-09-21. A
real browser gets 200 -- so this rides `_fetch_rendered`, the chain `app.py`
already owns. That is a real browser asking for a public page, not a forged
header.

SO THIS BOARD IS LOCAL-ONLY, AND THAT IS NOT A CONFIGURATION PROBLEM. The
chain tries Firecrawl first and then the local Chromium, and Firecrawl CANNOT
read JobStreet: measured 2026-09-19 as `http-500: All scraping engines failed`
after it tried its own stealth Chrome twice, which is the entire reason
`seek_api` exists. A deployment has no local browser, so the rail reports this
board as unreadable there however `FIRECRAWL_API_KEY` is set -- and the
message it prints says that rather than pointing at a setting that would not
help.

WHY NOT JUST CALL THE ENDPOINT, asked and answered thoroughly on 2026-09-21.
`jobSearchV7` is a SERVER-ONLY operation. Hooking `fetch` on a live search page
and paginating it captures `FeatureFlags`, `GetSavedSearches` and `GetBanner`
and never a search: the browser does not call it, every result page is rendered
on SEEK's own infrastructure, and the operation is in the client bundle for
hydration rather than for calling. Sent from a client -- byte-exact document
from their own bundle, their exact variables, their five context headers, from
their own origin with their own cookies -- the resolver answers 200 and
`{"errors":[{"message":"An error occurred"}]}`. There is no client-callable
search on this board.

WHAT THE PAYLOAD CARRIES that no other board on this rail does: a STRUCTURED
salary -- `{period, min, max, currency}` -- rather than a band printed as prose
for `job_board._salary` to read back. Nothing is guessed here.

THE IDEA CAME FROM `palaganaskurl/jobstreet-scraper` (MIT), which reads the
listing page for ids and then asks for detail per job. Its own routes are dead:
it predates JobStreet's move onto SEEK's platform, so it targets
`www.jobstreet.com.ph/en/job-search/...` and a `getJobDetail` operation that no
longer exists. What survives is the shape of the approach -- read the page you
are given before asking the API for anything.

Everything here is PURE: HTML in, a list of dicts out. The fetch lives in
`app.py`.
"""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote

#: Where a search lives. JobStreet's public search is a PATH, not a query
#: string -- `frontend-developer-jobs`, optionally `/in-Metro-Manila`.
SEARCH_HOST = "https://ph.jobstreet.com"

#: How many jobs one page carries. Theirs, not ours.
PAGE_SIZE = 30


def _slug(text: str) -> str:
    """`Frontend Developer` -> `frontend-developer`."""
    cleaned = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in text)
    return "-".join(cleaned.split()).lower()


def search_url(query: str | None, location: str | None, page: int = 1) -> str:
    """The address of one page of results.

    THE PATH FORM, NOT `?keywords=`. Both work, and the path is the one the
    site publishes, links to and renders canonically -- which is the form least
    likely to be the one that changes.
    """
    term = _slug(query or "") or "jobs"
    path = f"/{term}-jobs" if not term.endswith("jobs") else f"/{term}"
    if location:
        place = _slug(location)
        if place and place not in {"philippines", "anywhere"}:
            path += f"/in-{quote(place)}"
    return f"{SEARCH_HOST}{path}" + (f"?page={page}" if page > 1 else "")


def _payload(markup: str) -> dict[str, Any] | None:
    """The Apollo cache the page was rendered with, or None.

    `raw_decode` RATHER THAN A REGEX. The object runs to hundreds of kilobytes
    and contains every bracket and quote a job description can hold; a
    non-greedy match for the closing brace stops in the middle of somebody's
    salary note. The decoder knows where the value ends because it parses it.
    """
    marker = "SEEK_APOLLO_DATA"
    at = markup.find(marker)
    if at == -1:
        return None
    start = markup.find("{", at)
    if start == -1:
        return None
    try:
        data, _ = json.JSONDecoder().raw_decode(markup[start:])
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _deref(data: dict[str, Any], node: Any) -> Any:
    """An Apollo `{__ref: ...}` pointer resolved against the cache."""
    if isinstance(node, dict) and "__ref" in node:
        return data.get(node["__ref"])
    return node


def _text(data: dict[str, Any], node: Any, *keys: str) -> str | None:
    """A nested localised string, following refs. `{displayName:{text}}`."""
    current = _deref(data, node)
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = _deref(data, current.get(key))
    if not isinstance(current, str):
        return None
    cleaned = " ".join(current.split())
    return cleaned or None


def _number(value: Any) -> int | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if number > 0 else None


def jobs_from_html(markup: str, source: str = "jobstreet") -> list[dict[str, Any]]:
    """Every job on one search page, newest first.

    IT NEVER RAISES. A page that arrives as a challenge, a redirect or a
    redesign yields an empty list, which the caller reports as this board
    giving nothing -- never as the request failing for the boards beside it.
    """
    data = _payload(markup or "")
    if not data:
        return []
    root = data.get("ROOT_QUERY")
    if not isinstance(root, dict):
        return []
    key = next((k for k in root if k.startswith("jobSearchV7")), None)
    if not key:
        return []
    results = (root.get(key) or {}).get("results") or {}
    rows = results.get("jobs")
    if not isinstance(rows, list):
        return []

    jobs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in rows:
        node = _deref(data, raw)
        if not isinstance(node, dict):
            continue

        job_id = node.get("id")
        title = _text(data, node, "title")
        # `url` IS NULL ON A SEARCH ROW -- measured. The canonical address is
        # built from the id, which is the same form `seek_api` already reads a
        # single posting from.
        url = _text(data, node, "url") or (f"{SEARCH_HOST}/job/{job_id}" if job_id else None)
        published = _text(data, node, "listedAt", "dateTimeUtc")
        if not title or not url or not published:
            continue
        if url in seen:
            continue
        seen.add(url)

        salary = _deref(data, node.get("salary")) or {}
        categories = node.get("categories") or []
        first_category = _deref(data, categories[0]) if categories else None

        jobs.append(
            {
                "source": source,
                "id": f"{source}:{job_id or url}",
                "title": title,
                "company": _text(data, node, "advertiser", "name")
                or _text(data, node, "organisation", "name")
                or "unnamed company",
                "url": url,
                "geo": _text(data, node, "location", "displayName", "text"),
                "level": _work_arrangement(data, node),
                "industry": _text(data, first_category, "label") if first_category else None,
                "publishedAt": published,
                "excerpt": _text(data, node, "abstract"),
                # STRUCTURED, AND THE ONLY BOARD HERE THAT IS. No prose to read
                # back, so no band to get wrong.
                "salaryMin": _number(salary.get("min")),
                "salaryMax": _number(salary.get("max")),
                "salaryCurrency": _text(data, salary, "currency"),
            }
        )

    jobs.sort(key=lambda job: job["publishedAt"], reverse=True)
    return jobs


def _work_arrangement(data: dict[str, Any], node: dict[str, Any]) -> str | None:
    """`Remote` / `Hybrid` / `On-site`, or None.

    It is a LIST of refs on the row, and only the first is worth showing: the
    rail prints one short fact beside the location.
    """
    arrangements = node.get("workArrangements")
    if not isinstance(arrangements, list) or not arrangements:
        return None
    return _text(data, arrangements[0], "label", "text")
