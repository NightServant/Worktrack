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

    # NOTHING IS ON A PAID ACTOR ANY MORE. Every board reads either its own
    # endpoint, its own page, or a free library -- which is the whole point of
    # the work on 2026-09-21. An actor creeping back in is a bill nobody chose.
    assert "apify" not in set(ROUTES.values())

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
