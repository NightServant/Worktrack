"""JobStreet search, read out of the payload its own page ships with.

NO NETWORK. The cache below is the shape a real search page embeds, trimmed to
one job and its referenced nodes -- captured 2026-09-21. What is pinned is the
part that breaks: Apollo stores references rather than values, so every field
here is one `__ref` hop away from being None.
"""

from __future__ import annotations

import json

from extractor.jobstreet_jobs import jobs_from_html, search_url

CACHE = {
    "ROOT_QUERY": {
        "__typename": "Query",
        'jobSearchV7({"params":{"searchIntent":{"text":"frontend developer"}}})': {
            "__typename": "JobSearchV7Response",
            "results": {
                "__typename": "JobSearchV7Results",
                "jobs": [{"__ref": "JobSearchV7Job:94761372"}],
                "pagination": {"page": 1, "pageSize": 30, "resultCount": 907},
            },
        },
    },
    "JobSearchV7Job:94761372": {
        "__typename": "JobSearchV7Job",
        "id": "94761372",
        "title": "UI/UX Developer (with Frontend Exp)",
        "abstract": "Design and build the front of a fintech product.",
        "url": None,
        "advertiser": {"__typename": "JobSearchV7JobAdvertiser", "name": "Creathink Solutions.Inc"},
        "location": {"__ref": "JobSearchV7JobLocation:2061100"},
        "listedAt": {"__typename": "SeekDateTime", "dateTimeUtc": "2026-09-21T02:31:14.000Z"},
        "salary": {"period": "monthly", "min": 70000, "max": 85000, "currency": "PHP"},
        "workArrangements": [{"__ref": "JobSearchV7WorkArrangements:3"}],
        "categories": [{"__ref": "SeekClassification:6287"}],
    },
    "JobSearchV7JobLocation:2061100": {
        "displayName": {"__typename": "JobSearchV7LocalizedText", "text": "Metro Manila"},
    },
    "JobSearchV7WorkArrangements:3": {"id": "3", "label": {"text": "Remote"}},
    "SeekClassification:6287": {"id": "6287", "label": "Information & Communication Technology"},
}

PAGE = (
    "<html><body><script>window.SEEK_APOLLO_DATA="
    + json.dumps(CACHE)
    + ";window.SOMETHING_ELSE={};</script></body></html>"
)


def test_reads_a_job_through_its_references() -> None:
    jobs = jobs_from_html(PAGE)
    assert len(jobs) == 1
    job = jobs[0]
    assert job["source"] == "jobstreet"
    assert job["title"] == "UI/UX Developer (with Frontend Exp)"
    # Both of these are `__ref` hops; without dereferencing they come back None.
    assert job["company"] == "Creathink Solutions.Inc"
    assert job["geo"] == "Metro Manila"
    assert job["level"] == "Remote"
    assert job["industry"] == "Information & Communication Technology"
    assert job["publishedAt"].startswith("2026-09-21")


def test_the_salary_is_structured_rather_than_prose() -> None:
    """The one board on this rail that needs no band parsed out of a sentence.

    Every other source prints "₱70,000 - ₱85,000 per month" for
    `job_board._salary` to read back. This one hands over the numbers.
    """
    job = jobs_from_html(PAGE)[0]
    assert (job["salaryMin"], job["salaryMax"], job["salaryCurrency"]) == (70000, 85000, "PHP")


def test_the_address_is_built_from_the_id_when_the_row_has_none() -> None:
    # `url` IS NULL ON A SEARCH ROW -- measured. The canonical address is the
    # one `seek_api` already reads a single posting from.
    assert jobs_from_html(PAGE)[0]["url"] == "https://ph.jobstreet.com/job/94761372"


def test_the_payload_is_decoded_rather_than_matched() -> None:
    """A regex for the closing brace stops inside somebody's job description.

    The object runs to hundreds of kilobytes and holds every bracket and quote
    a salary note can contain, so it is parsed by the JSON decoder, which knows
    where the value ends. The trailing assignment after it must not confuse it.
    """
    import copy

    assert len(jobs_from_html(PAGE)) == 1
    tricky = copy.deepcopy(CACHE)
    tricky["JobSearchV7Job:94761372"]["abstract"] = (
        'Build {"the": "front"} of a product; see } and { and "quotes" in the copy'
    )
    nested = (
        "<html><body><script>window.SEEK_APOLLO_DATA="
        + json.dumps(tricky)
        + ";window.SOMETHING_ELSE={};</script></body></html>"
    )
    assert len(jobs_from_html(nested)) == 1


def test_a_challenged_or_redesigned_page_yields_nothing_rather_than_raising() -> None:
    # A 403 challenge, a redirect or a rewrite costs this board and must never
    # cost the boards running beside it.
    assert jobs_from_html("") == []
    assert jobs_from_html("<html><body>Just a moment...</body></html>") == []
    assert jobs_from_html("<script>window.SEEK_APOLLO_DATA={not json;</script>") == []
    assert jobs_from_html("<script>window.SEEK_APOLLO_DATA={};</script>") == []


def test_a_row_missing_a_title_or_a_date_is_dropped() -> None:
    import copy

    no_title = copy.deepcopy(CACHE)
    no_title["JobSearchV7Job:94761372"]["title"] = None
    page = PAGE.replace(json.dumps(CACHE), json.dumps(no_title))
    assert jobs_from_html(page) == []


def test_the_search_address_is_the_path_form_the_site_publishes() -> None:
    assert search_url("frontend developer", None, 1) == (
        "https://ph.jobstreet.com/frontend-developer-jobs"
    )
    assert "?page=2" in search_url("frontend developer", None, 2)
    # A country-level location is the whole site, not a filter.
    assert search_url("frontend developer", "Philippines", 1).endswith("-jobs")
    assert "/in-metro-manila" in search_url("frontend developer", "Metro Manila", 1)
