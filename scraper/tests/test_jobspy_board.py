"""JobSpy's rows, mapped onto the shape the rail draws.

NO NETWORK AND NO LIBRARY IMPORT. `to_feed_jobs` takes anything iterable, so
these are plain dicts shaped like the DataFrame records JobSpy returns --
captured from a real Indeed run on 2026-09-21. That keeps the mapping testable
without pandas in the suite and without a request to somebody's board.
"""

from __future__ import annotations

from datetime import date

from extractor.jobspy_board import SITES, to_feed_job, to_feed_jobs

ROW = {
    "id": "in-842f018e2d806ef7",
    "site": "indeed",
    "title": "Python/Fast API/React Developer",
    "company": "Directio",
    "location": "Mandaluyong, P00, PH",
    "date_posted": date(2026, 9, 20),
    "job_url": "https://ph.indeed.com/viewjob?jk=842f018e2d806ef7",
    "job_url_direct": None,
    "min_amount": 70000.0,
    "max_amount": 100000.0,
    "currency": "PHP",
    "interval": "monthly",
    "job_level": "mid level",
    "job_type": "fulltime",
    "company_industry": "Information Technology",
    "description": "Build things. " * 40,
}


def test_maps_the_fields_the_rail_draws() -> None:
    job = to_feed_job(ROW, "indeed")
    assert job is not None
    assert job["source"] == "indeed"
    assert job["title"] == "Python/Fast API/React Developer"
    assert job["company"] == "Directio"
    assert job["geo"] == "Mandaluyong, P00, PH"
    assert (job["salaryMin"], job["salaryMax"], job["salaryCurrency"]) == (70000, 100000, "PHP")
    assert job["publishedAt"].startswith("2026-09-20")


def test_a_missing_cell_is_nan_and_must_not_reach_the_screen() -> None:
    """The defect this mapper was written around.

    JobSpy returns a pandas DataFrame, and an absent cell is `float('nan')`
    rather than None -- measured on the very first Indeed row, whose `company`
    came back as nan. Untreated it renders as the literal word "nan" under a
    job title.
    """
    job = to_feed_job({**ROW, "company": float("nan"), "job_level": float("nan")}, "indeed")
    assert job is not None
    assert job["company"] == "unnamed company"
    # `level` FALLS BACK TO `job_type` rather than going blank: Indeed fills one
    # or the other on most rows, and "fulltime" is worth more on a card than an
    # empty line.
    assert job["level"] == "fulltime"
    # Blank only when both are missing.
    both_gone = to_feed_job({**ROW, "job_level": float("nan"), "job_type": None}, "indeed")
    assert both_gone is not None and both_gone["level"] is None
    # And the string form, which is what a CSV round trip produces.
    assert to_feed_job({**ROW, "company": "nan"}, "indeed")["company"] == "unnamed company"


def test_a_row_missing_title_link_or_date_is_dropped() -> None:
    # Same rule as every other board: the rail links the title and groups by
    # the day, so a row without them cannot be drawn.
    assert to_feed_job({**ROW, "title": None}, "indeed") is None
    assert to_feed_job({**ROW, "job_url": None, "job_url_direct": None}, "indeed") is None
    assert to_feed_job({**ROW, "date_posted": float("nan")}, "indeed") is None


def test_a_javascript_url_is_refused() -> None:
    # This string ends up in an `href`. It is scheme-checked here as well as in
    # the browser, because a library is a boundary like any other.
    assert to_feed_job({**ROW, "job_url": "javascript:alert(1)"}, "indeed") is None


def test_the_description_is_trimmed_to_an_excerpt() -> None:
    # Kilobytes of third-party markup per row, of which the rail shows two
    # lines. What is not carried cannot be rendered by accident.
    job = to_feed_job(ROW, "indeed")
    assert job is not None
    assert len(job["excerpt"]) <= 281
    assert job["excerpt"].endswith("…")


def test_rows_are_deduplicated_and_sorted_newest_first() -> None:
    older = {**ROW, "job_url": "https://ph.indeed.com/viewjob?jk=old", "date_posted": date(2026, 9, 1)}
    jobs = to_feed_jobs([older, ROW, dict(ROW)], "indeed")
    assert [j["publishedAt"][:10] for j in jobs] == ["2026-09-20", "2026-09-01"]


def test_the_id_falls_back_to_the_address() -> None:
    # The rail keys React rows on this, so it must exist even when the board
    # gives no id of its own.
    job = to_feed_job({**ROW, "id": float("nan")}, "indeed")
    assert job is not None
    assert job["id"] == "indeed:https://ph.indeed.com/viewjob?jk=842f018e2d806ef7"


def test_only_the_boards_actually_routed_here_are_mapped() -> None:
    # LinkedIn reads its own public endpoint, JobStreet reads its own page, and
    # Glassdoor's JobSpy module returns nothing for any location. Indeed is the
    # only board that needs this route at all.
    assert set(SITES) == {"indeed"}
