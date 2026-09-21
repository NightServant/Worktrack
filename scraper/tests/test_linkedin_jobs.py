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


def test_this_service_writes_no_borrowed_credential_of_its_own() -> None:
    """What is still true after JobSpy was adopted, stated narrowly.

    IT IS NOT A CLAIM THAT NOTHING HERE WEARS A DISGUISE. From 2026-09-21 the
    rail's Indeed half runs through JobSpy, whose Indeed module sends a key
    extracted from Indeed's mobile app. That is a real cost, it was chosen
    deliberately, and README section 12 states it rather than denying it.
    A vendored library's behaviour is not something a grep of this tree can
    police, and pretending otherwise would make this a comfort, not a check.

    WHAT IT DOES CHECK is the part that is ours: no module we wrote hardcodes
    somebody else's credential or turns off certificate verification. One
    arriving in a file here would be a different decision from the one that was
    actually taken, made without anybody deciding it.
    """
    from pathlib import Path

    lifted_key = "indeed-api" + "-key"
    banned = (f'"{lifted_key}":', f"'{lifted_key}':", "verify=false")
    for path in Path("extractor").glob("*.py"):
        source = path.read_text(encoding="utf-8").lower()
        for needle in banned:
            assert needle not in source, (
                f"{path} looks like it sends a borrowed credential: {needle}"
            )
