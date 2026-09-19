"""JobStreet and SEEK, read through the endpoint their own pages call.

WHY THERE IS A WHOLE FILE FOR ONE BOARD (Gabe, 2026-09-19: "I want the autofill
to work properly"). The HTML route to this platform is shut and cannot be
opened: a plain request answers 403 with a Cloudflare challenge -- from a
residential address as readily as from a data centre -- and Firecrawl, bought
for exactly this, answered `http-500: All scraping engines failed` after trying
its own stealth Chrome twice. The same posting is published unauthenticated at
`/graphql` on the same host, and a bare request gets the whole record in half a
second. Everything below pins that mapping, because the endpoint is the only
way these postings reach the reader at all.

NO NETWORK, like every other test here. `api_request` and `envelope_from_job`
are pure; `app.py` owns the request.
"""

from __future__ import annotations

from extractor.normalise import infer_work_mode
from extractor.seek_api import api_request, envelope_from_job, job_from_reply

#: Trimmed from the live reply for ph.jobstreet.com/job/94730110, 2026-09-19.
JOB = {
    "title": "Front-End Web Developer (HTML5, CSS3) | WFH",
    "advertiser": {"name": "Deployed Philippines Inc."},
    "location": {"label": "Ortigas, Pasig City, Metro Manila, PH"},
    "salary": {"label": "₱70,000 – ₱100,000 per month"},
    "workTypes": {"label": "Full time"},
    "classifications": [
        {"label": "Developers/Programmers (Information & Communication Technology)"}
    ],
    "content": (
        "<p><strong>About the Client</strong></p><p>A London-based creative agency.</p>"
        "<p>You will build interfaces with HTML, CSS and JavaScript, and use Figma and Git.</p>"
    ),
}


def test_it_asks_the_right_host_for_the_right_job():
    endpoint, body = api_request("https://ph.jobstreet.com/job/94730110?ref=saved")
    assert endpoint == "https://ph.jobstreet.com/graphql"
    # THE TRACKING QUERY IS NOT THE IDENTITY. `?ref=saved`, `?type=standard`
    # and `#sol=...` all ride along on a link somebody copied.
    assert body["variables"] == {"jobId": "94730110"}


def test_it_covers_the_platform_rather_than_one_country():
    # SEEK owns JobStreet and serves the same schema from the same path under
    # every one of these names.
    for url in (
        "https://www.jobstreet.com.ph/job/1",
        "https://ph.jobstreet.com/job/2",
        "https://www.seek.com.au/job/3",
    ):
        assert api_request(url) is not None, url


def test_it_refuses_everything_that_is_not_this_platform():
    # The caller asks this about every challenged URL, so a wrong yes here
    # would post a SEEK query at somebody else's server.
    assert api_request("https://www.indeed.com/viewjob?jk=1") is None
    assert api_request("https://jobstreet.com.evil.test/job/1") is None
    # A board page rather than a posting has nothing to ask about.
    assert api_request("https://ph.jobstreet.com/frontend-developer-jobs") is None


def test_graphql_answers_200_with_errors():
    # THE SHAPE THAT BITES: a failed query is a successful request carrying an
    # `errors` array and a null `data`, so a status check alone would hand the
    # mapper a None and call it a posting.
    assert job_from_reply({"errors": [{"message": "Unknown argument"}], "data": None}) is None
    assert job_from_reply({"data": {"jobDetails": None}}) is None
    assert job_from_reply("not json at all") is None
    assert job_from_reply({"data": {"jobDetails": {"job": JOB}}}) == JOB


def test_it_maps_the_record_the_advert_is_drawn_from():
    envelope = envelope_from_job("https://ph.jobstreet.com/job/94730110", JOB)
    values = envelope["values"]
    assert values["role"] == "Front-End Web Developer (HTML5, CSS3) | WFH"
    assert values["company"] == "Deployed Philippines Inc."
    assert values["location"] == "Ortigas, Pasig City, Metro Manila, PH"
    assert values["source"] == "ph.jobstreet.com"
    # The advertiser's own salary string, read by the same parser that handles
    # one written into prose -- the currency is a glyph, not a country guess.
    assert values["salary_min"] == 70000
    assert values["salary_max"] == 100000
    assert values["salary_currency"] == "PHP"
    # Work type and category are FACETS, not skills.
    assert values["tags"][0] == "Full time"
    assert "Developers/Programmers" in values["tags"][1]
    assert "HTML" in values["tech_stack"]
    assert "About the Client" in values["description"]
    assert "<p>" not in values["description"]
    # Sits with JSON-LD's, because it is the same class of source.
    assert envelope["confidence"]["role"] == 0.95
    assert envelope["warnings"] == []


def test_wfh_in_the_title_is_a_work_mode():
    # The Philippine boards write "| WFH" in the TITLE where other markets
    # write "Remote", and the schema has no work-mode field of its own -- so
    # without this every WFH posting read as no work mode at all.
    assert infer_work_mode("Front-End Web Developer (HTML5, CSS3) | WFH") == "remote"
    assert envelope_from_job("https://ph.jobstreet.com/job/1", JOB)["values"]["work_mode"] == "remote"
    # And it stays word-bounded rather than matching inside another word.
    assert infer_work_mode("Head of WFHQ operations") is None


def test_a_reply_missing_everything_is_still_an_envelope():
    # A renamed field must cost that field, not the posting: the caller writes
    # whatever came back into a form the reader then checks.
    envelope = envelope_from_job("https://ph.jobstreet.com/job/1", {})
    assert envelope["values"]["url"] == "https://ph.jobstreet.com/job/1"
    assert "role" not in envelope["values"]
    assert envelope["warnings"] == []
