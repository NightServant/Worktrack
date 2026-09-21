"""LinkedIn's public guest search, against the markup it actually returns.

NO NETWORK. The card below is one real `<li>` captured from
`jobs-guest/jobs/api/seeMoreJobPostings/search` on 2026-09-21, trimmed of its
tracking attributes. What is pinned is the part that breaks: LinkedIn rewrites
this page whenever it likes, and every field here is found by a class name that
is theirs to change.
"""

from __future__ import annotations

from extractor.linkedin_jobs import jobs_from_html, search_url

CARD = """
<li>
  <div class="base-card base-search-card base-search-card--link job-search-card"
       data-entity-urn="urn:li:jobPosting:4424593373">
    <a class="base-card__full-link"
       href="https://ph.linkedin.com/jobs/view/react-js-developer-at-lee-4424593373?position=1&amp;refId=abc%3D%3D">
      <span class="sr-only">React JS Developer</span>
    </a>
    <div class="base-search-card__info">
      <h3 class="base-search-card__title">
        React JS Developer
      </h3>
      <h4 class="base-search-card__subtitle">
        <a class="hidden-nested-link" href="https://ph.linkedin.com/company/lee">
          Lee Systems Technology Ventures Inc.
        </a>
      </h4>
      <div class="base-search-card__metadata">
        <span class="job-search-card__location">
          Caloocan, National Capital Region, Philippines
        </span>
        <time class="job-search-card__listdate" datetime="2026-06-05">3 months ago</time>
      </div>
    </div>
  </div>
</li>
"""


def test_reads_the_fields_the_rail_draws() -> None:
    jobs = jobs_from_html(CARD)
    assert len(jobs) == 1
    job = jobs[0]
    assert job["source"] == "linkedin"
    assert job["title"] == "React JS Developer"
    assert job["company"] == "Lee Systems Technology Ventures Inc."
    assert job["geo"] == "Caloocan, National Capital Region, Philippines"
    assert job["publishedAt"].startswith("2026-06-05")


def test_the_id_is_the_posting_urn() -> None:
    # The rail keys React rows and the tracked map on this, and an id that
    # changed between searches would remount every card.
    assert jobs_from_html(CARD)[0]["id"] == "linkedin:4424593373"


def test_the_tracking_query_is_dropped_from_the_address() -> None:
    # `?position=1&refId=...` says where in OUR search the row appeared. It is
    # meaningless to anybody opening the link later and is most of the string.
    url = jobs_from_html(CARD)[0]["url"]
    assert url == "https://ph.linkedin.com/jobs/view/react-js-developer-at-lee-4424593373"
    assert "?" not in url


def test_a_card_missing_a_title_link_or_date_is_dropped() -> None:
    # The rail links the title and groups by the day; a row without them cannot
    # be drawn, and "undefined" is not a job.
    no_title = CARD.replace(
        '<h3 class="base-search-card__title">\n        React JS Developer',
        '<h3 class="base-search-card__title">',
    )
    assert jobs_from_html(no_title) == []
    assert jobs_from_html(CARD.replace('datetime="2026-06-05"', "")) == []
    assert jobs_from_html(CARD.replace("base-card__full-link", "x")) == []


def test_unfamiliar_markup_returns_nothing_rather_than_raising() -> None:
    # LinkedIn owns this page. A shape we do not recognise costs the board and
    # must never cost the other boards running beside it.
    assert jobs_from_html("") == []
    assert jobs_from_html("<li><div>a redesign</div></li>") == []
    assert jobs_from_html("<<<not markup") == []


def test_the_same_posting_twice_is_one_row() -> None:
    # A posting that shifts between pages while the loop is running arrives
    # twice.
    assert len(jobs_from_html(CARD + CARD)) == 1


def test_the_search_address_carries_what_the_public_form_sends() -> None:
    url = search_url("frontend developer", "Philippines", 10)
    assert url.startswith(
        "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?"
    )
    assert "keywords=frontend+developer" in url
    assert "location=Philippines" in url
    assert "start=10" in url
    # No credential of any kind goes in the query string, because none
    # exists. `keywords` is the search box, not an api key -- which is why
    # this looks for the credential spellings rather than the substring.
    assert "api_key" not in url.lower() and "apikey" not in url.lower()
    assert "token" not in url.lower() and "auth" not in url.lower()


def test_no_board_is_read_with_a_borrowed_credential() -> None:
    """The line this service does not cross, asserted rather than only written.

    JobSpy's LinkedIn module is clean and takes this same route. Its Indeed
    module sends `indeed-api-key`, a value lifted out of Indeed's iOS app,
    behind that app's own user-agent. If that ever lands in this tree, this
    fails.
    """
    from pathlib import Path

    banned = (
        # A header dict entry, which is how a lifted key is actually sent.
        # `job_board.py` NAMES the key in prose to explain the refusal, and
        # prose has no quote-colon -- so what is banned here is sending one.
        '"indeed-api-key":',
        "'indeed-api-key':",
        '"authorization":',
        "verify=False",
        "is_tls=True",
    )
    for path in Path("extractor").glob("*.py"):
        source = path.read_text(encoding="utf-8")
        for needle in banned:
            assert needle not in source.lower().replace('"authorization": f"bearer {token}"', ""), (
                f"{path} looks like it sends a borrowed credential: {needle}"
            )
