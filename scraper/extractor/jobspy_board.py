"""The boards this service reads through JobSpy, and what that costs.

WHY (Gabe, 2026-09-21, naming the repository twice and then linking it). Indeed
and Glassdoor publish no search API a caller like this one can use -- every
official Indeed endpoint is employer-side and behind a partner agreement -- so
the choice was a paid Apify actor, nothing, or `speedyapply/JobSpy`, which is
MIT and does it for free. This is that third option, chosen deliberately.

WHAT IT COSTS, AND IT IS NOT MONEY. It is worth writing down plainly, because
this service refuses routes on exactly this ground everywhere else and the
README used to claim it always does.

JobSpy's Indeed module sends a key extracted from Indeed's iOS app, behind
that app's own `user-agent` and `indeed-app-info` headers, with TLS
verification disabled; `apis.indeed.com/graphql` is Indeed's PARTNER API and
officially wants a bearer token and a signed agreement. That is a borrowed
credential and an impersonated client.

ONLY INDEED IS ROUTED HERE. Glassdoor was, briefly, and is not: JobSpy's
Glassdoor module returns zero rows for every location tried -- Manila,
Singapore, London, New York -- failing at its own location lookup with a 400
before any search happens.

The MIT licence covers JobSpy's code. It does not cover Indeed's key. Anybody
running this is making that call for themselves, and README section 12 now says
so rather than claiming otherwise.

WHAT IS *NOT* ROUTED THROUGH HERE, and why the split is worth keeping:

  LINKEDIN  reads its own public guest endpoint -- see `linkedin_jobs`. JobSpy
            would work and its LinkedIn module is clean, asking that same path
            with no credential at all. Sixty lines against pandas, numpy and
            tls_client is the only difference, and the lighter one already
            returns a hundred postings. Nothing is gained by moving it.
  JOBSTREET is not in JobSpy at all. It stays on its Apify actor; what is known
            about its own search endpoint is written up in `seek_api`.

Everything here is PURE: a DataFrame in, a list of dicts out. The scrape lives
in `app.py`, which owns every call and every timeout.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timezone
from typing import Any

#: Which JobSpy site each of our sources maps to.
#:
#: THE NAMES HAPPEN TO MATCH TODAY and this table exists so they are not
#: required to. JobSpy's `Site` enum is theirs to rename.
SITES: dict[str, str] = {
    "indeed": "indeed",
}

#: Indeed's scrapers are per-country and the library wants the country NAME.
#:
#: IT IS NOT OPTIONAL FOR INDEED. `country_indeed` decides which Indeed domain
#: is searched, and the default is the United States -- so a reader in Manila
#: asking for "frontend developer" with no country gets American roles, which
#: is the exact failure the rail's region filter exists to prevent.
DEFAULT_COUNTRY = "Philippines"


def _clean(value: Any) -> str | None:
    """A trimmed string, or None.

    `nan` IS THE POINT OF THIS FUNCTION. JobSpy returns a pandas DataFrame, and
    a missing cell is `float('nan')` rather than None -- measured on the very
    first Indeed row, whose `company` came back as nan. Untreated it renders as
    the literal string "nan" under a job title.
    """
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    text = " ".join(str(value).split())
    return text or None if text.lower() != "nan" else None


def _number(value: Any) -> int | None:
    """A positive whole number, or None. Handles nan the same way."""
    if value is None:
        return None
    try:
        if isinstance(value, float) and math.isnan(value):
            return None
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if number > 0 else None


def _iso(value: Any) -> str | None:
    """An ISO instant from JobSpy's `date_posted`.

    IT IS A `datetime.date`, NOT A STRING and not an instant -- a wall-calendar
    day, like Jobicy's and LinkedIn's. Read as UTC midnight, which is what
    `localDayKey` does with it on the way to the rail's day grouping.
    """
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc).isoformat()
    text = _clean(value)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)).isoformat()


def _excerpt(value: Any) -> str | None:
    """Two sentences of the description, never the whole thing.

    A FULL DESCRIPTION IS KILOBYTES OF THIRD-PARTY MARKUP and the rail shows
    two lines. Every other source here is trimmed at this boundary for the same
    reason: what is not carried cannot be rendered by accident.
    """
    text = _clean(value)
    if not text:
        return None
    return text[:280].rstrip() + ("…" if len(text) > 280 else "")


def to_feed_job(row: Any, source: str) -> dict[str, Any] | None:
    """One DataFrame row as a `FeedJob`, or None when it cannot be shown.

    THE SAME THREE FIELDS ARE REQUIRED as for every other board -- a title, a
    link and a date -- because the rail links the title and groups by the day.
    """

    def cell(name: str) -> Any:
        try:
            return row[name]
        except (KeyError, IndexError, TypeError):
            return None

    title = _clean(cell("title"))
    url = _clean(cell("job_url")) or _clean(cell("job_url_direct"))
    published = _iso(cell("date_posted"))
    if not title or not url or not published:
        return None
    if not url.startswith("https://") and not url.startswith("http://"):
        # Scheme-checked here as well as in the browser: this string ends up in
        # an `href`, and `javascript:` there is a script on our own origin.
        return None

    return {
        "source": source,
        # THE SAME SHAPE THE OTHER TWO ROUTES MINT, so the rail's React keys and
        # the tracked map behave identically whichever route a row came in by.
        "id": f"{source}:{_clean(cell('id')) or url}",
        "title": title,
        "company": _clean(cell("company")) or "unnamed company",
        "url": url,
        "geo": _clean(cell("location")),
        "level": _clean(cell("job_level")) or _clean(cell("job_type")),
        "industry": _clean(cell("company_industry")),
        "publishedAt": published,
        "excerpt": _excerpt(cell("description")),
        "salaryMin": _number(cell("min_amount")),
        "salaryMax": _number(cell("max_amount")),
        "salaryCurrency": _clean(cell("currency")),
    }


def to_feed_jobs(frame: Any, source: str) -> list[dict[str, Any]]:
    """Every readable row, newest first, without duplicates.

    IT TAKES ANYTHING ITERABLE so the tests need no pandas: a list of dicts
    behaves the same as a DataFrame's rows here, which keeps the mapping
    testable with no network, no spend and no import of the library itself.
    """
    if frame is None:
        return []
    rows = frame.to_dict("records") if hasattr(frame, "to_dict") else list(frame)

    jobs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        job = to_feed_job(row, source)
        if not job or job["url"] in seen:
            continue
        seen.add(job["url"])
        jobs.append(job)
    jobs.sort(key=lambda job: job["publishedAt"], reverse=True)
    return jobs
