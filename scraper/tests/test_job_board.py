"""The board actors, against rows shaped like the ones they return.

NO NETWORK AND NO SPEND. Every actor here is pay-per-result, so the mappers are
pure and these rows are saved shapes -- the same arrangement `apify_profile`
has. What is being checked is the part that actually breaks: actors that
disagree about every field name, and a salary band that arrives as prose.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from extractor.job_board import SOURCES, _iso, _salary, to_feed_job, to_feed_jobs


def test_every_source_is_routed_and_labelled() -> None:
    from extractor.job_board import ACTORS, LABELS, ROUTES

    # Glassdoor is gone twice over: its Apify actor went into maintenance, and
    # JobSpy's Glassdoor module returns zero rows for every location tried.
    assert set(SOURCES) == {"linkedin", "jobstreet", "indeed"}
    for source in SOURCES:
        assert ROUTES[source] in {"public", "render", "jobspy", "apify"}
        assert LABELS[source]

    # EXACTLY ONE BOARD IS PAID, AND IT IS JOBSTREET, chosen rather than
    # drifted into. This assertion used to read "nothing is on a paid actor",
    # which held for a few hours on 2026-09-21 while JobStreet was read from
    # its own rendered page. That route works only where a real browser exists,
    # so it was local-only -- and JobStreet's robots.txt disallows the search
    # paths a deployment would have had to crawl to keep it. An actor puts both
    # the crawling and that decision with the operator who runs it.
    #
    # The guard is kept in the narrow form rather than dropped: a SECOND board
    # quietly becoming billable is still a bill nobody chose.
    assert [source for source, route in ROUTES.items() if route == "apify"] == ["jobstreet"]

    # LINKEDIN IS FREE AND PLAIN and must stay that way: it reads its own
    # public guest endpoint, so neither an actor entry nor a JobSpy route
    # belongs to it -- one would be a bill and the other a dependency, for a
    # board that needs neither.
    assert ROUTES["linkedin"] == "public"
    assert "linkedin" not in ACTORS

    # The actor table is kept for the day a board closes its own door, and
    # every entry in it must still name exactly one actor.
    for entry in ACTORS.values():
        assert entry["actor"].count("~") == 1


def test_linkedin_row() -> None:
    job = to_feed_job(
        {
            "title": "Senior Frontend Engineer",
            "companyName": "Chainguard",
            "jobUrl": "https://www.linkedin.com/jobs/view/4012345678",
            "postedAt": "2026-09-19T08:00:00Z",
            "location": "APAC",
            "experienceLevel": "Mid-Senior level",
            "sector": "Software Development",
            "description": "<p>Build the <b>thing</b>.</p>",
        },
        "linkedin",
    )
    assert job is not None
    assert job["title"] == "Senior Frontend Engineer"
    assert job["company"] == "Chainguard"
    assert job["source"] == "linkedin"
    assert job["geo"] == "APAC"
    # Markup is stripped rather than escaped.
    assert job["excerpt"] == "Build the thing."


def test_jobstreet_row_with_a_prose_band() -> None:
    job = to_feed_job(
        {
            "title": "Payroll Operations Manager",
            "advertiser": {"name": "Fresh Prints"},
            "url": "https://ph.jobstreet.com/job/77712345",
            "listingDate": "2026-09-18",
            "location": {"label": "Manila"},
            "salary": "₱45,000 - ₱104,650 per month",
            "classification": "Accounting",
        },
        "jobstreet",
    )
    assert job is not None
    # A nested `{name: ...}` company and a nested `{label: ...}` location.
    assert job["company"] == "Fresh Prints"
    assert job["geo"] == "Manila"
    assert (job["salaryMin"], job["salaryMax"]) == (45_000, 104_650)
    assert job["salaryCurrency"] == "PHP"
    # A monthly figure is left monthly rather than annualised.
    assert job["salaryMax"] == 104_650


def test_indeed_row_with_a_relative_date() -> None:
    job = to_feed_job(
        {
            "positionName": "Technical Account Manager",
            "company": "ClickUp",
            "link": "https://ph.indeed.com/viewjob?jk=abc123",
            "date": "3 days ago",
            "salarySnippet": {"text": "$120K - $150K a year"},
            "jobType": "Full-time",
        },
        "indeed",
    )
    assert job is not None
    assert job["company"] == "ClickUp"
    assert (job["salaryMin"], job["salaryMax"]) == (120_000, 150_000)
    assert job["salaryCurrency"] == "USD"
    posted = datetime.fromisoformat(job["publishedAt"])
    age = datetime.now(tz=timezone.utc) - posted
    assert timedelta(days=2, hours=23) < age < timedelta(days=3, hours=1)


def test_a_row_nested_under_job() -> None:
    # One level of nesting is walked. Kept after Glassdoor was removed, because
    # the shape is not Glassdoor's -- any actor may wrap its payload, and this
    # is the only test that proves `_pick` descends.
    job = to_feed_job(
        {
            "job": {
                "jobTitle": "Commercial Insurance Advisor",
                "employerName": "Welo Global",
                "jobLink": "https://example.test/job-listing/JV_123.htm",
                "postedDate": 1_758_240_000,
            }
        },
        "indeed",
    )
    assert job is not None
    assert job["title"] == "Commercial Insurance Advisor"
    assert job["company"] == "Welo Global"
    assert job["publishedAt"].startswith("2025-")or job["publishedAt"].startswith("2026-")


def test_a_row_missing_title_link_or_date_is_dropped() -> None:
    # The rail groups by day and links the title; without those there is
    # nothing to draw.
    assert to_feed_job({"companyName": "X", "url": "https://x.test/1"}, "indeed") is None
    assert to_feed_job({"title": "X", "postedAt": "2026-09-19"}, "indeed") is None
    assert to_feed_job({"title": "X", "url": "https://x.test/1"}, "indeed") is None


def test_a_javascript_url_is_refused() -> None:
    assert (
        to_feed_job(
            {"title": "X", "url": "javascript:alert(1)", "postedAt": "2026-09-19"}, "indeed"
        )
        is None
    )


def test_rows_are_deduplicated_and_sorted_newest_first() -> None:
    rows = [
        {"title": "A", "url": "https://b.test/1", "postedAt": "2026-09-17T00:00:00Z"},
        {"title": "B", "url": "https://b.test/2", "postedAt": "2026-09-19T00:00:00Z"},
        # The same posting again, as a second search page returns it.
        {"title": "A", "url": "https://b.test/1", "postedAt": "2026-09-17T00:00:00Z"},
        "not a row",
    ]
    jobs = to_feed_jobs(rows, "linkedin")
    assert [job["title"] for job in jobs] == ["B", "A"]


def test_a_headcount_is_not_a_salary() -> None:
    # "500 employees" and a bare year must not become a wage.
    assert _salary("500+ employees") == (None, None, None)
    assert _salary("Posted 2026") == (None, None, None)


def test_unparseable_dates_return_none_rather_than_now() -> None:
    assert _iso("sometime soon") is None
    assert _iso(None) is None


SCRAPYX_ROW = {
    "recordType": "JOB",
    "jobId": "94761372",
    "jobUrl": "https://ph.jobstreet.com/job/94761372",
    "title": "UI/UX Developer (with Frontend Exp)",
    "companyName": "Creathink Solutions.Inc",
    "salaryLabel": "₱70,000 - ₱85,000 per month",
    "workTypes": ["Full time"],
    "workArrangements": ["Remote"],
    "listingDate": "2026-09-21T02:31:14.000Z",
    "locations": ["Metro Manila"],
    "classifications": ["Information & Communication Technology"],
    "teaser": "Design and build the front of a fintech product.",
}


def test_scrapyx_row_maps_onto_the_rail() -> None:
    """The actor JobStreet moved to on 2026-09-21, against its own row shape.

    IT REPLACED `easyapi`, which is the most USED JobStreet actor on Apify and
    the worst on the number that matters: a 62.4% run success rate at $2.99 per
    thousand, against this one's $0.35.
    """
    job = to_feed_job(SCRAPYX_ROW, "jobstreet")
    assert job is not None
    assert job["id"] == "jobstreet:94761372"
    assert job["company"] == "Creathink Solutions.Inc"
    # `locations` and `classifications` are PLURAL here; the first entry is the
    # one the card has room for.
    assert job["geo"] == "Metro Manila"
    assert job["industry"] == "Information & Communication Technology"
    # The arrangement beats the work type on a card beside a location.
    assert job["level"] == "Remote"
    assert job["excerpt"] == "Design and build the front of a fintech product."
    assert job["publishedAt"].startswith("2026-09-21")


def test_the_band_is_read_out_of_scrapyx_prose() -> None:
    # It prints the salary under `salaryLabel` as a sentence, unlike JobStreet's
    # own page payload, which hands over the numbers.
    job = to_feed_job(SCRAPYX_ROW, "jobstreet")
    assert (job["salaryMin"], job["salaryMax"], job["salaryCurrency"]) == (70_000, 85_000, "PHP")


def test_a_summary_or_error_record_is_not_a_job() -> None:
    """The one that would have put junk cards on the rail.

    scrapyx tags every row with `recordType` and emits `SEARCH_SUMMARY` and
    `ERROR` rows alongside the jobs. Untagged rows are every other actor, which
    only ever emits jobs -- so the check is "not something else" rather than
    "is a job", and a new actor is not broken by default.
    """
    assert to_feed_job({"recordType": "SEARCH_SUMMARY", "totalCount": 907}, "jobstreet") is None
    assert to_feed_job({"recordType": "ERROR", "_error": "bad input"}, "jobstreet") is None
    assert len(to_feed_jobs([SCRAPYX_ROW, {"recordType": "SEARCH_SUMMARY"}], "jobstreet")) == 1
    # An untagged row from any other actor still maps.
    untagged = {k: v for k, v in SCRAPYX_ROW.items() if k != "recordType"}
    assert to_feed_job(untagged, "jobstreet") is not None
