"""The same posting once, however many times a board listed it.

NO NETWORK. `_dedupe_jobs` is pure: rows in, rows out.
"""

from __future__ import annotations

from app import _dedupe_jobs


def row(**over):
    base = {
        "source": "indeed",
        "id": "indeed:1",
        "title": "Operations & Trade Accounts Manager",
        "company": "d2B",
        "url": "https://ph.indeed.com/viewjob?jk=aaa",
        "publishedAt": "2026-09-21T00:00:00+00:00",
    }
    base.update(over)
    return base


def test_the_same_advert_listed_twice_is_one_row() -> None:
    """The defect Gabe saw: "double information about job postings".

    Indeed listed one job twice under different ids because it was posted to
    two locations -- same company, same title, different `jk`, so the URLs
    differ and an address-only dedupe let both through.
    """
    jobs = _dedupe_jobs(
        [
            row(id="indeed:1", url="https://ph.indeed.com/viewjob?jk=aaa"),
            row(id="indeed:2", url="https://ph.indeed.com/viewjob?jk=bbb"),
        ]
    )
    assert len(jobs) == 1
    # The first survives, and the caller sorts newest-first before calling.
    assert jobs[0]["id"] == "indeed:1"


def test_a_repeated_address_is_still_one_row() -> None:
    # The case every route already handled: one posting on two search pages.
    assert len(_dedupe_jobs([row(), row(id="indeed:9")])) == 1


def test_the_same_job_on_two_boards_is_two_rows() -> None:
    # Not a duplicate: two real listings, and which one to open is the
    # reader's choice. The key is scoped to one source for exactly this.
    jobs = _dedupe_jobs(
        [
            row(source="indeed", url="https://ph.indeed.com/viewjob?jk=aaa"),
            row(source="jobstreet", id="jobstreet:5", url="https://ph.jobstreet.com/job/5"),
        ]
    )
    assert len(jobs) == 2


def test_two_different_roles_at_one_company_both_survive() -> None:
    jobs = _dedupe_jobs(
        [
            row(url="https://ph.indeed.com/viewjob?jk=aaa", title="Backend Engineer"),
            row(url="https://ph.indeed.com/viewjob?jk=bbb", title="Frontend Engineer"),
        ]
    )
    assert len(jobs) == 2


def test_a_row_with_no_company_is_not_matched_on_its_blank() -> None:
    # Indeed leaves `company` empty on some rows. Two unrelated jobs both
    # called "unnamed company" must not collapse into one.
    jobs = _dedupe_jobs(
        [
            row(url="https://ph.indeed.com/viewjob?jk=aaa", company="", title="Analyst"),
            row(url="https://ph.indeed.com/viewjob?jk=bbb", company="", title="Analyst"),
        ]
    )
    assert len(jobs) == 2
