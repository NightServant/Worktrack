"""The Deno parser's twenty cases, ported.

WHY PORTED RATHER THAN REWRITTEN. Each of these is a real posting's shape that
someone hit and encoded -- a Workday locale segment, a LinkedIn "hiring X"
phrase, a percent-encoded company, a malformed JSON-LD block sitting beside a
good one. Rewriting the suite against the new implementation would test what
the new implementation happens to do. Porting it tests that behaviour a user
already relies on did not change when the engine underneath it did.

Where an assertion is deliberately different from the TS original, it says so.
"""

from __future__ import annotations

import os

from extractor.challenge import (
    autofill_from_url_alone,
    challenged_site_name,
    looks_like_bot_challenge,
)
from extractor.core import extract


def test_linkedin_metadata_heuristics():
    html = """
      <html><head>
        <meta property="og:title" content="Senior Software Engineer | LinkedIn" />
        <meta property="og:description" content="Apply now for the Senior Software Engineer role at Acme Corp." />
        <title>Senior Software Engineer | LinkedIn</title>
      </head></html>
    """
    result = extract("https://www.linkedin.com/jobs/view/123", html)
    assert "Senior Software Engineer" in result["values"]["role"]
    assert "Acme Corp" in result["values"]["company"]
    assert result["values"]["source"] == "LinkedIn"


def test_greenhouse_company_from_path():
    html = '<html><head><meta property="og:title" content="Backend Engineer - Stripe" /></head></html>'
    result = extract("https://boards.greenhouse.io/stripe/jobs/987", html)
    assert "stripe" in result["values"]["company"].lower()
    assert "Backend Engineer" in result["values"]["role"]


def test_lever_company_from_path():
    html = '<html><head><meta property="og:title" content="Product Designer - Notion" /></head></html>'
    result = extract("https://jobs.lever.co/notion/abc123", html)
    assert "notion" in result["values"]["company"].lower()
    assert "Product Designer" in result["values"]["role"]


def test_workday_company_from_path():
    html = "<html><head><title>Research Engineer - Workday</title></head></html>"
    result = extract(
        "https://wd5.myworkdayjobs.com/en-US/OpenAI/job/San-Francisco/Research-Engineer_444", html
    )
    assert "openai" in result["values"]["company"].lower()
    assert "Research Engineer" in result["values"]["role"]


def test_workday_en_gb_locale():
    html = "<html><head><title>ML Engineer - Workday</title></head></html>"
    result = extract(
        "https://wd5.myworkdayjobs.com/en-GB/OpenAI/job/London/ML-Engineer_999", html
    )
    assert "openai" in result["values"]["company"].lower()
    assert "ML Engineer" in result["values"]["role"]


def test_json_ld_role_company_salary():
    html = """
      <html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"JobPosting","title":"Staff Frontend Engineer",
       "hiringOrganization":{"name":"Example Inc"},
       "baseSalary":{"@type":"MonetaryAmount","value":{"@type":"QuantitativeValue","minValue":180000,"maxValue":230000}}}
      </script></head></html>
    """
    result = extract("https://careers.example.com/jobs/1", html)
    assert result["values"]["role"] == "Staff Frontend Engineer"
    assert result["values"]["company"] == "Example Inc"
    assert result["values"]["salary_min"] == 180000
    assert result["values"]["salary_max"] == 230000


def test_json_ld_graph():
    html = """
      <html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"Organization","name":"Other"},
        {"@type":"JobPosting","title":"Platform Engineer","hiringOrganization":{"name":"Graph Co"},
         "baseSalary":{"value":{"minValue":"120000","maxValue":"160000"}}}]}
      </script></head></html>
    """
    result = extract("https://careers.example.com/jobs/2", html)
    assert result["values"]["role"] == "Platform Engineer"
    assert result["values"]["company"] == "Graph Co"
    assert result["values"]["salary_min"] == 120000
    assert result["values"]["salary_max"] == 160000


def test_json_ld_array():
    html = """
      <html><head><script type="application/ld+json">
      [{"@type":"BreadcrumbList"},
       {"@type":"JobPosting","title":"Data Engineer","hiringOrganization":{"name":"Array Inc"}}]
      </script></head></html>
    """
    result = extract("https://careers.example.com/jobs/3", html)
    assert result["values"]["role"] == "Data Engineer"
    assert result["values"]["company"] == "Array Inc"


def test_json_ld_beats_og_title():
    html = """
      <html><head>
        <meta property="og:title" content="Wrong Title - Example" />
        <script type="application/ld+json">
        {"@type":"JobPosting","title":"Correct Title","hiringOrganization":{"name":"Example"}}
        </script>
      </head></html>
    """
    result = extract("https://careers.example.com/jobs/4", html)
    assert result["values"]["role"] == "Correct Title"


def test_meta_with_content_attribute_first():
    # The TS parser needed a SECOND regex for this, because attribute order is
    # a real thing in source text. A DOM makes the question disappear -- which
    # is a large part of why this milestone exists.
    html = '<html><head><meta content="Backend Engineer - Example Inc" property="og:title" /></head></html>'
    result = extract("https://careers.example.com/jobs/5", html)
    assert result["values"]["role"] == "Backend Engineer"


def test_salary_range_from_text_with_en_dash():
    html = "<html><body><p>Compensation: $120,000 – $150,000 per year</p></body></html>"
    result = extract("https://careers.example.com/jobs/6", html)
    assert result["values"]["salary_min"] == 120000
    assert result["values"]["salary_max"] == 150000


def test_decodes_html_entities():
    html = """
      <html><head>
        <meta property="og:site_name" content="AT&amp;T" />
        <meta property="og:title" content="Network Engineer | Careers" />
      </head></html>
    """
    result = extract("https://careers.example.com/jobs/7", html)
    assert result["values"]["company"] == "AT&T"


def test_malformed_json_ld_does_not_throw():
    html = """
      <html><head>
        <script type="application/ld+json">{ this is not valid json }</script>
        <meta property="og:title" content="Frontend Engineer - Example" />
        <meta property="og:site_name" content="Example Co" />
      </head></html>
    """
    result = extract("https://careers.example.com/jobs/8", html)
    assert result["values"]["role"] == "Frontend Engineer"
    assert result["values"]["company"] == "Example Co"


def test_an_empty_page_produces_values_but_no_scolding():
    # CHANGED 2026-09-06 (Gabe): this used to assert a warning per absent
    # field. Most postings publish no salary -- almost none in the Philippines
    # do -- so a PERFECT extraction ended in a row of warnings, which trains a
    # reader to stop reading them. An empty field is already visible: it is the
    # empty field.
    result = extract("https://careers.example.com/jobs/9", "<html></html>")
    assert result["warnings"] == []
    # Still returns what it could work out from the URL alone, so the form has
    # something to show rather than nothing.
    assert result["values"]["url"] == "https://careers.example.com/jobs/9"
    assert result["values"]["source"] == "careers.example.com"


def test_a_page_that_was_never_read_still_says_so():
    # The one warning worth keeping. A bot challenge means the values are
    # inferred from the URL rather than read from a page, and a caller cannot
    # tell that apart from a successful extraction without being told.
    challenge = "<html><body>Just a moment... Cloudflare</body></html>"
    result = extract("https://ph.jobstreet.com/job/1", challenge, status=403)
    assert result["warnings"]


def test_cleans_linkedin_boilerplate():
    html = """
      <html><head>
        <meta property="og:title" content="Bluesky HR Consultancy Inc. by 2x | LinkedIn" />
        <meta property="og:description" content="Bluesky HR Consultancy Inc. hiring Data Analyst in Makati, National Capital Region" />
        <title>Bluesky HR Consultancy Inc. hiring Data Analyst in Makati, National Capital Region | LinkedIn</title>
      </head></html>
    """
    result = extract("https://www.linkedin.com/jobs/view/123", html)
    company = result["values"]["company"].lower()
    assert "bluesky hr consultancy" in company
    assert "by 2x" not in company
    assert "data analyst" in result["values"]["role"].lower()


def test_decodes_percent_encoded_and_plus():
    html = """
      <html><head>
        <meta property="og:title" content="Senior%20Engineer%20%7C%20Acme%20Corp" />
        <meta property="og:site_name" content="ACME+Corp" />
      </head></html>
    """
    result = extract("https://careers.example.com/jobs/encoded", html)
    assert "Senior Engineer" in result["values"]["role"]
    assert result["values"]["company"] == "ACME Corp"


def test_challenged_site_names():
    assert challenged_site_name("ph.jobstreet.com") == "JobStreet"
    assert challenged_site_name("www.jobstreet.com.ph") == "JobStreet"
    assert challenged_site_name("www.seek.com.au") == "SEEK"
    # JOBSDB CAME OFF THE LIST, re-measured 2026-09-06 (M7 Task 8): 200 with
    # 950KB of real HTML from the same headers JobStreet still refuses. See
    # extractor/challenge.py for the full table.
    assert challenged_site_name("hk.jobsdb.com") is None
    # A site that does NOT block must not be labelled as one, or the app stops
    # trying to read pages it can read perfectly well.
    assert challenged_site_name("boards.greenhouse.io") is None
    assert challenged_site_name("jobs.lever.co") is None
    # Not a substring match: this must not fire on an unrelated host.
    assert challenged_site_name("notjobstreet.com.evil.test") is None


def test_challenge_detected_by_status_and_by_body():
    assert looks_like_bot_challenge(403, "") is True
    assert looks_like_bot_challenge(503, "") is True
    # THE STATUS ALONE, on an empty body, because that is what pins the status
    # rule: with the real body below either half would answer True and the
    # other could rot untested.
    assert looks_like_bot_challenge(401, "") is True
    assert looks_like_bot_challenge(200, "<html><title>Just a moment...</title>") is True
    assert looks_like_bot_challenge(200, '<div class="cf-browser-verification">') is True
    assert looks_like_bot_challenge(200, "<html><title>Frontend Engineer at Acme</title>") is False


#: Indeed's answer to an anonymous fetch, as measured 2026-09-17 -- 1,675 bytes
#: whose only content is a redirect to a login, quoted in
#: docs/BRIGHTDATA-EVALUATION.md §1. Kept as a fixture rather than paraphrased
#: because every wrong assumption this cost came from the SHAPE: the status is
#: 401 and not 403, the title is "Authenticating..." and not "Just a moment",
#: and the Cloudflare marker is `__CF$cv$params` and not `__cf_chl`.
INDEED_401_BODY = """<!DOCTYPE html><html><head><title>Authenticating...</title>
<meta http-equiv="content-type" content="text/html; charset=UTF-8"></head>
<body><script>window.location.href =
"https://www.indeed.com/account/login?branding=login-required&from=bot-detection-anonymous&continue=%2Fviewjob%3Fjk%3D0000000000000000";
</script><script>window.__CF$cv$params={r:'a3c66b5fcab3cc15',t:'MTc1ODA3'};
var a=document.createElement('script');
a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';
document.getElementsByTagName('head')[0].appendChild(a);</script></body></html>"""


def test_indeed_401_is_a_challenge_and_not_a_failed_fetch():
    """The 401 that never reached Firecrawl (docs/BRIGHTDATA-EVALUATION.md).

    This is the whole defect in one assertion. `app.py` checks this predicate
    BEFORE its generic `status >= 400` branch, so False here meant Indeed was
    answered with "Could not fetch page (status 401)" and the rendered
    escalation we already pay for was never attempted.
    """
    assert looks_like_bot_challenge(401, INDEED_401_BODY) is True
    # AND AGAIN WITH THE STATUS THROWN AWAY. `/extract` re-asks this about
    # whatever the escalation returns, as `looks_like_bot_challenge(200, ...)`
    # -- so if Firecrawl hands back the same interstitial, only the body
    # markers can stop it being parsed as a posting.
    assert looks_like_bot_challenge(200, INDEED_401_BODY) is True


def test_indeed_challenge_is_named_rather_than_blamed_on_the_link():
    # A page that was never read must not come back as a broken URL: the
    # fallback names the site, keeps the link, and asks for a paste.
    assert challenged_site_name("www.indeed.com") == "Indeed"
    assert challenged_site_name("ph.indeed.com") == "Indeed"
    assert challenged_site_name("notindeed.com.evil.test") is None
    result = autofill_from_url_alone("https://www.indeed.com/viewjob?jk=0000000000000000")
    assert result["values"]["source"] == "Indeed"
    assert "Indeed blocks automated reads" in " ".join(result["warnings"])


def test_the_paste_prompt_names_nothing_that_was_deleted():
    # `Tidy and summarise` was removed on 2026-09-10 (the wizard summarises
    # what it FETCHES), and this warning is shown to the one reader the digest
    # never runs for. Telling them to press a control that is not on screen
    # reads as the app being broken rather than the page.
    #
    # BOTH BRANCHES, because the sentence is written twice -- once for a site
    # this module can name and once for anything else -- and the first pass at
    # this test only read the unnamed one.
    for url in ("https://unknown.example/job/1", "https://www.indeed.com/viewjob?jk=1"):
        joined = " ".join(autofill_from_url_alone(url)["warnings"])
        assert "tidy and summarise" not in joined.lower()
        assert "aste" in joined


def test_a_blocked_aggregator_sends_the_reader_upstream():
    # NOT A CONSOLATION PRIZE. Measured 2026-09-17
    # (docs/EXTRACTION-FREE-OPTIONS.md): an aggregator mirror yields ~0.40-0.70
    # confidence per field even when it can be read, because the posting has
    # been reformatted into the aggregator's template, while the employer's own
    # posting -- usually a Greenhouse/Lever/Ashby page `registry.py` already
    # parses natively -- yields 0.90-0.95. So the block is worth answering with
    # "go one step upstream", which beats anything a paid unlocker could buy
    # pointed at the mirror.
    #
    # Both branches again, for the reason the test above this one records.
    for url in ("https://www.indeed.com/viewjob?jk=1", "https://unknown.example/job/1"):
        joined = " ".join(autofill_from_url_alone(url)["warnings"]).lower()
        assert "careers page" in joined
        # And it must still say what to do when there is no employer page.
        assert "aste" in joined


def test_url_alone_says_what_it_can_prove():
    result = autofill_from_url_alone("https://ph.jobstreet.com/job/86776684")
    assert result["values"]["source"] == "JobStreet"
    assert result["values"]["url"] == "https://ph.jobstreet.com/job/86776684"
    # Nothing is invented from the path -- no role, no company.
    assert "role" not in result["values"]
    assert "company" not in result["values"]
    joined = " ".join(result["warnings"])
    assert "JobStreet blocks automated reads" in joined
    assert "aste" in joined  # "Paste"/"paste"


def test_unknown_blocking_host_still_explains_itself():
    result = autofill_from_url_alone("https://unknown.example/job/1")
    assert "source" not in result["values"]
    assert "could not be read" in " ".join(result["warnings"]).lower()


def test_challenge_short_circuits_extraction():
    # The whole pipeline, not just the predicate: a 403 must never reach the
    # parser, or it "succeeds" and returns "Just a moment..." as the role.
    result = extract("https://ph.jobstreet.com/job/1", "<html><title>Just a moment...</title></html>", status=403)
    assert result["values"].get("role") is None
    assert result["values"]["source"] == "JobStreet"


# --- Currencies other than the dollar -----------------------------------
#
# THE DEFECT THESE COVER, found 2026-09-06 from a live "Salary was not found in
# page metadata" on a page that stated one plainly: the range pattern required
# a literal `$` before BOTH numbers, so every non-US posting missed. This
# deployment reads mostly Philippine postings, where `₱50,000 - ₱70,000` is the
# ordinary shape.

def test_peso_range_with_symbol():
    html = "<html><body><p>Salary: ₱50,000 - ₱70,000 per month</p></body></html>"
    result = extract("https://careers.example.com/jobs/peso", html)
    assert result["values"]["salary_min"] == 50000
    assert result["values"]["salary_max"] == 70000
    assert result["values"]["salary_currency"] == "PHP"


def test_currency_code_after_the_range():
    # The suffix form is common on boards outside the US.
    html = "<html><body><p>Offering 50,000 - 70,000 PHP monthly</p></body></html>"
    result = extract("https://careers.example.com/jobs/suffix", html)
    assert result["values"]["salary_min"] == 50000
    assert result["values"]["salary_currency"] == "PHP"


def test_singapore_dollar_is_not_read_as_usd():
    # `S$` ends in `$`. Matching the plain dollar first would label a Singapore
    # salary USD, which is a quiet 30x error rather than a visible failure.
    html = "<html><body><p>S$5,000 - S$7,000</p></body></html>"
    result = extract("https://careers.example.com/jobs/sg", html)
    assert result["values"]["salary_currency"] == "SGD"
    assert result["values"]["salary_min"] == 5000


def test_k_suffix_expands():
    html = "<html><body><p>£40k to £55k</p></body></html>"
    result = extract("https://careers.example.com/jobs/uk", html)
    assert result["values"]["salary_min"] == 40000
    assert result["values"]["salary_max"] == 55000
    assert result["values"]["salary_currency"] == "GBP"


def test_a_page_range_is_not_a_salary():
    html = "<html><body><p>See pages 10-20 of the handbook.</p></body></html>"
    result = extract("https://careers.example.com/jobs/nope", html)
    assert result["values"].get("salary_min") is None


def test_a_backwards_range_is_rejected():
    html = "<html><body><p>70,000 - 50,000 PHP</p></body></html>"
    result = extract("https://careers.example.com/jobs/backwards", html)
    assert result["values"].get("salary_min") is None


def test_currency_alone_is_not_offered():
    # A currency with no amount is a fact about the page's footer, not about
    # the salary.
    html = "<html><body><p>Prices in PHP. Salary negotiable.</p></body></html>"
    result = extract("https://careers.example.com/jobs/nofigure", html)
    assert result["values"].get("salary_currency") is None


# --- The posting body ---------------------------------------------------

def test_description_comes_from_json_ld_as_text():
    # JSON-LD `description` is HTML far more often than not, and the
    # destination is a textarea that the ATS keyword match reads as words.
    html = """
      <html><head><script type="application/ld+json">
      {"@type":"JobPosting","title":"Engineer",
       "description":"<p>Build things.</p><ul><li>React</li><li>TypeScript</li></ul>"}
      </script></head><body></body></html>
    """
    result = extract("https://careers.example.com/jobs/desc", html)
    text = result["values"]["description"]
    assert "<p>" not in text
    assert "Build things." in text
    # Block tags become newlines, so the list items do not run together.
    assert "React" in text and "TypeScript" in text
    assert "ReactTypeScript" not in text
    assert result["confidence"]["description"] == 0.95


def test_description_falls_back_to_a_long_meta_summary():
    # Accepted only when it is long enough to plausibly BE the posting. Some
    # boards really do put the whole thing in og:description.
    body = "We are hiring a backend engineer. " * 12
    html = f"""
      <html><head>
        <meta property="og:description" content="{body}" />
      </head><body></body></html>
    """
    result = extract("https://careers.example.com/jobs/meta", html)
    assert result["values"]["description"].startswith("We are hiring a backend engineer.")
    # A SUMMARY, not the posting -- and the confidence says so.
    assert result["confidence"]["description"] == 0.4


def test_a_marketing_tagline_is_not_a_job_description():
    # THE REAL FAILURE, 2026-09-06. Auto-fill filled the description with this
    # exact copy from a Cloudstaff posting -- the site's og:description, which
    # is identical on every page of the site and says nothing about the job.
    #
    # It is worse than an empty field. A wrong ROLE is visibly wrong and gets
    # corrected; a wrong DESCRIPTION silently becomes what the ATS keyword
    # match scores against and what AI tailoring is told the job is.
    tagline = (
        "Experience an extraordinary global career at Cloudstaff, the #1 workplace "
        "everywhere. Join our talented team and be part of something bigger. Apply now!"
    )
    html = f"""
      <html><head>
        <meta property="og:description" content="{tagline}" />
      </head><body><p>Short page.</p></body></html>
    """
    result = extract("https://cloudstaff.com/jobs/1", html)
    assert not result["values"].get("description")


def test_description_is_read_from_the_page_body():
    # A posting that published no JSON-LD still HAS its posting on the page.
    body = "You will build and maintain our internal tooling. " * 8
    html = f"""
      <html><head>
        <meta property="og:description" content="Great careers await. Apply now!" />
      </head><body>
        <nav>Home Jobs Contact</nav>
        <div class="job-description"><p>{body}</p></div>
        <footer>Copyright 2026</footer>
      </body></html>
    """
    result = extract("https://careers.example.com/jobs/body", html)
    assert result["values"]["description"].startswith("You will build and maintain")
    assert "Apply now" not in result["values"]["description"]
    assert "Copyright" not in result["values"]["description"]
    assert result["confidence"]["description"] == 0.6


def test_the_longest_candidate_wins():
    # `main` often wraps the whole page including its chrome; the posting body
    # is reliably the densest block of prose on the page.
    short = "Apply today. " * 3
    long = "Responsibilities include building the thing. " * 10
    html = f"""
      <html><body>
        <main><p>{short}</p><div class="job-description"><p>{long}</p></div></main>
      </body></html>
    """
    result = extract("https://careers.example.com/jobs/longest", html)
    assert "Responsibilities include" in result["values"]["description"]


def test_json_ld_description_beats_the_meta_summary():
    html = """
      <html><head>
        <meta property="og:description" content="short summary" />
        <script type="application/ld+json">
        {"@type":"JobPosting","title":"Engineer","description":"The full posting body."}
        </script>
      </head><body></body></html>
    """
    result = extract("https://careers.example.com/jobs/both", html)
    assert result["values"]["description"] == "The full posting body."


# --- Tech stack and tags ------------------------------------------------
#
# Both are `string[]` columns on `jobs` that the extractor never filled. The
# cost of the gap was not cosmetic: tech_stack is what the ATS keyword match
# reads, so an empty one scored a CV against nothing.

def test_skills_become_the_tech_stack():
    html = """
      <html><head><script type="application/ld+json">
      {"@type":"JobPosting","title":"Engineer","skills":"React, TypeScript, GraphQL"}
      </script></head><body></body></html>
    """
    result = extract("https://careers.example.com/j/skills", html)
    assert result["values"]["tech_stack"] == ["React", "TypeScript", "GraphQL"]
    assert result["confidence"]["tech_stack"] == 0.9


def test_skills_as_a_list_of_objects():
    # schema.org fields arrive as a string, a list, or a list of {name: ...}.
    html = """
      <html><head><script type="application/ld+json">
      {"@type":"JobPosting","title":"Engineer",
       "skills":[{"name":"Python"},{"name":"Django"}]}
      </script></head><body></body></html>
    """
    result = extract("https://careers.example.com/j/objs", html)
    assert result["values"]["tech_stack"] == ["Python", "Django"]


def test_employment_type_and_industry_become_tags():
    html = """
      <html><head><script type="application/ld+json">
      {"@type":"JobPosting","title":"Engineer",
       "employmentType":"FULL_TIME","industry":"Software"}
      </script></head><body></body></html>
    """
    result = extract("https://careers.example.com/j/tags", html)
    assert result["values"]["tags"] == ["full-time", "Software"]


def test_tech_is_recognised_in_prose_when_no_skills_array():
    body = "You will use React, Docker and PostgreSQL daily. " * 6
    html = f"""
      <html><body><div class="job-description"><p>{body}</p></div></body></html>
    """
    result = extract("https://careers.example.com/j/prose", html)
    assert set(result["values"]["tech_stack"]) == {"React", "Docker", "PostgreSQL"}
    # Offered low, because a word in a sentence is not the posting saying so.
    assert result["confidence"]["tech_stack"] == 0.4


def test_prose_scan_respects_word_boundaries():
    # `Go` must not fire on "going", and `React` must not fire on "reaction".
    body = "A reaction to going public. No stack listed here at all. " * 6
    html = f"""
      <html><body><div class="job-description"><p>{body}</p></div></body></html>
    """
    result = extract("https://careers.example.com/j/bounds", html)
    assert not result["values"].get("tech_stack")


def test_prose_scan_reads_the_posting_not_the_page_furniture():
    # A page's nav and footer name technologies too, and they are not what the
    # job asked for -- so the scan runs over the description only.
    body = "We need a copywriter with strong editorial judgement. " * 6
    html = f"""
      <html><body>
        <div class="job-description"><p>{body}</p></div>
        <footer>Built with React and hosted on AWS.</footer>
      </body></html>
    """
    result = extract("https://careers.example.com/j/footer", html)
    assert not result["values"].get("tech_stack")


def test_json_ld_skills_beat_the_prose_scan():
    html = """
      <html><head><script type="application/ld+json">
      {"@type":"JobPosting","title":"Engineer","skills":"Rust",
       "description":"Some React and Docker mentioned in passing."}
      </script></head><body></body></html>
    """
    result = extract("https://careers.example.com/j/both2", html)
    assert result["values"]["tech_stack"] == ["Rust"]


def test_duplicate_skills_collapse_keeping_the_first_spelling():
    html = """
      <html><head><script type="application/ld+json">
      {"@type":"JobPosting","title":"Engineer","skills":["React","react","REACT"]}
      </script></head><body></body></html>
    """
    result = extract("https://careers.example.com/j/dupes", html)
    assert result["values"]["tech_stack"] == ["React"]


# --- Firecrawl, the fetcher that works in production ---------------------

from app import firecrawl_html, firecrawl_payload  # noqa: E402


def test_firecrawl_asks_for_the_whole_page_not_the_main_content():
    # `onlyMainContent` DEFAULTS TO TRUE and would hand back the article body
    # without the <head> -- which is where the JSON-LD JobPosting lives, the
    # single best source this parser has. Asking for "the main content" would
    # quietly throw away the good half.
    payload = firecrawl_payload("https://ph.jobstreet.com/job/1")
    assert payload["onlyMainContent"] is False


def test_firecrawl_asks_for_raw_html_in_the_v2_shape():
    # v2 takes format OBJECTS, not strings. `["rawHtml"]` is the v1 shape and
    # is rejected.
    payload = firecrawl_payload("https://ph.jobstreet.com/job/1")
    assert payload["formats"] == [{"type": "rawHtml"}]


def test_firecrawl_reply_yields_html_and_where_it_landed():
    html, final = firecrawl_html(
        {
            "success": True,
            "data": {
                "rawHtml": "<html>posting</html>",
                "metadata": {"url": "https://ph.jobstreet.com/job/1?x=1"},
            },
        }
    )
    assert html == "<html>posting</html>"
    # The FINAL url matters as much as the html: a hosted fetcher follows
    # redirects for us, so where it landed is what has to pass the host check.
    assert final == "https://ph.jobstreet.com/job/1?x=1"


def test_firecrawl_falls_back_to_cleaned_html_when_raw_is_absent():
    html, _ = firecrawl_html({"success": True, "data": {"html": "<html>b</html>"}})
    assert html == "<html>b</html>"


def test_firecrawl_failure_is_not_mistaken_for_a_page():
    # 402 (plan exhausted) and 429 (rate limited) both arrive as success=false
    # or a non-200; neither may look like a successful read.
    assert firecrawl_html({"success": False, "error": "Payment Required"}) == (None, None)
    assert firecrawl_html({"success": True, "data": {}}) == (None, None)
    assert firecrawl_html({}) == (None, None)
    assert firecrawl_html({"success": True, "data": {"rawHtml": "   "}}) == (None, None)


def test_local_env_file_never_overrides_a_real_variable(tmp_path, monkeypatch):
    # A deployment sets real environment variables and must win: the local file
    # is a developer convenience, not a source of truth.
    from app import _load_local_env

    env_file = tmp_path / ".env"
    env_file.write_text('FIRECRAWL_API_KEY=from-file\nOTHER_KEY="quoted"\n# a comment\n')

    monkeypatch.setenv("FIRECRAWL_API_KEY", "from-environment")
    monkeypatch.delenv("OTHER_KEY", raising=False)
    _load_local_env(env_file)

    assert os.environ["FIRECRAWL_API_KEY"] == "from-environment"
    # Quotes are stripped, comments and blank lines skipped.
    assert os.environ["OTHER_KEY"] == "quoted"


def test_a_missing_local_env_file_is_not_an_error(tmp_path):
    from app import _load_local_env

    _load_local_env(tmp_path / "nope.env")


# --- Why a profile fetch failed, which is the whole answer for /profile ------

import asyncio  # noqa: E402

import httpx  # noqa: E402

from app import _firecrawl_fetch  # noqa: E402


def _fetch(monkeypatch, *, status=200, body=None, key="fc-test", raises=None):
    """Runs `_firecrawl_fetch` against a stubbed transport."""
    monkeypatch.setenv("FIRECRAWL_API_KEY", key)

    async def post(self, *args, **kwargs):
        if raises is not None:
            raise raises
        return httpx.Response(
            status,
            json=body if body is not None else {},
            request=httpx.Request("POST", "https://api.firecrawl.dev/v2/scrape"),
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    return asyncio.run(_firecrawl_fetch("https://www.linkedin.com/in/example"))


def test_a_working_fetch_reports_ok(monkeypatch):
    html, reason = _fetch(
        monkeypatch,
        body={"success": True, "data": {"rawHtml": "<html>profile</html>"}},
    )
    assert html == "<html>profile</html>"
    assert reason == "ok"


def test_every_failure_names_itself(monkeypatch):
    # WHY THIS MATTERS MORE HERE THAN ON /extract. That endpoint has an
    # ordinary fetch and a browser behind it, so "it did not work" is enough.
    # /profile has no fallback -- Firecrawl is the only route -- so the reason
    # IS the answer the user gets. One generic sentence sent Gabe off to check
    # a link that was fine (2026-09-10, first real test).
    assert _fetch(monkeypatch, key="")[1] == "no-key"
    assert _fetch(monkeypatch, status=401, body={"error": "Unauthorized"})[1].startswith(
        "http-401"
    )
    assert _fetch(monkeypatch, status=402, body={"error": "Payment Required"})[1].startswith(
        "http-402"
    )
    assert _fetch(monkeypatch, status=403, body={"error": "Forbidden"})[1].startswith("http-403")
    assert _fetch(monkeypatch, status=429, body={"error": "Too Many"})[1].startswith("http-429")
    # A 200 that carried no page is its own thing: LinkedIn answers some
    # profiles with a sign-in wall that renders to nothing.
    assert _fetch(monkeypatch, body={"success": True, "data": {}})[1] == "empty-body"
    assert _fetch(monkeypatch, raises=httpx.TimeoutException("slow"))[1] == "timeout"
    assert _fetch(monkeypatch, raises=httpx.ConnectError("down"))[1] == "unreachable"


def test_the_upstream_error_text_survives_into_the_reason(monkeypatch):
    # The distinguishing detail is usually in Firecrawl's own message -- "this
    # site is not supported" reads very differently from "quota exceeded".
    _, reason = _fetch(monkeypatch, status=403, body={"error": "domain not supported"})
    assert "domain not supported" in reason


# --- Apify's profile rows, the source that actually gets a page -------------

from extractor.apify_profile import profile_from_apify  # noqa: E402

ROW = {
    "name": "Satya Nadella",
    "headline": "Chairman and CEO at Microsoft",
    "location": "Redmond, Washington",
    "summary": "As chairman and CEO of Microsoft, I define my mission...",
    "profileUrl": "https://www.linkedin.com/in/satyanadella",
    "profilePicture": "https://media.licdn.com/dms/image/x",
    "currentCompany": {"name": "Microsoft", "industry": "Software Development"},
    "currentPositions": [
        {
            "company": "Microsoft",
            "title": "Chairman and CEO",
            "startDate": "2014",
            "location": "Redmond",
            "description": "Define the mission.\nShip the software.",
        }
    ],
    "pastPositions": [
        {"company": "Sun Microsystems", "title": "Engineer", "startDate": "1990", "endDate": "1992"}
    ],
    "education": [
        {"school": "University of Chicago", "degree": "MBA", "fieldOfStudy": "Business", "startDate": "1994", "endDate": "1996"}
    ],
    "certifications": [{"name": "Some Cert", "issuer": "An Authority", "issueDate": "Mar 2020"}],
    "projects": [{"title": "A project", "description": "What it did", "url": "https://example.dev"}],
    "websites": [{"label": "Portfolio", "url": "https://example.dev"}, "https://second.example"],
}


def test_an_apify_row_maps_onto_the_profile_the_app_stores():
    out = profile_from_apify(ROW, "satyanadella")
    p = out["profile"]
    assert p["name"] == "Satya Nadella"
    assert p["headline"] == "Chairman and CEO at Microsoft"
    assert p["location"] == "Redmond, Washington"
    assert p["pictureUrl"] == "https://media.licdn.com/dms/image/x"
    assert p["url"] == "https://www.linkedin.com/in/satyanadella"
    # `industry` is the one field worth taking off the company object.
    assert p["industry"] == "Software Development"
    assert p["websites"] == ["https://example.dev", "https://second.example"]


def test_current_roles_come_before_past_ones():
    # A CV reads most-recent-first, and the actor hands these back as two
    # lists precisely because it knows which is which -- concatenating in
    # whatever order they arrived would throw that away.
    roles = profile_from_apify(ROW, "x")["profile"]["experiences"]
    assert [r["company"] for r in roles] == ["Microsoft", "Sun Microsystems"]
    assert roles[0]["period"] == "2014 – Present"
    assert roles[1]["period"] == "1990 – 1992"
    # THE FIELD THE IMPORT EXISTS FOR. The JSON-LD route never carried it.
    assert roles[0]["description"] == "Define the mission.\nShip the software."


def test_a_degree_and_its_field_read_as_one_line():
    edu = profile_from_apify(ROW, "x")["profile"]["education"][0]
    assert edu == {"school": "University of Chicago", "degree": "MBA, Business", "period": "1994 – 1996"}


def test_certifications_and_projects_survive():
    p = profile_from_apify(ROW, "x")["profile"]
    assert p["certifications"] == [
        {"name": "Some Cert", "authority": "An Authority", "period": "Mar 2020"}
    ]
    assert p["projects"] == [
        {"title": "A project", "description": "What it did", "url": "https://example.dev"}
    ]


def test_what_a_signed_out_profile_cannot_carry_is_said_out_loud():
    # LinkedIn does not publish skills or languages to a guest, so no scraper
    # of one can return them. A profile that imports with an empty skills list
    # looks like a broken import rather than a limit of the source.
    out = profile_from_apify(ROW, "x")
    assert out["profile"]["skills"] == []
    assert out["profile"]["languages"] == []
    assert any("Skills and languages" in w for w in out["warnings"])


def test_a_row_with_nothing_in_it_does_not_raise():
    # The actor omits a field entirely rather than returning null, so every
    # read has to tolerate absence -- a crash here loses the whole import.
    out = profile_from_apify({}, "https://www.linkedin.com/in/nobody")
    assert out["profile"]["name"] is None
    assert out["profile"]["experiences"] == []
    assert out["profile"]["url"] == "https://www.linkedin.com/in/nobody"
    assert any("No work history" in w for w in out["warnings"])


def test_redacted_role_detail_is_reported_rather_than_left_to_be_noticed():
    # Superseded by `test_missing_titles_and_missing_descriptions_are_reported
    # _separately` below, which pins the wording that replaced this one after
    # the first real runs showed titles going missing too.
    row = {"currentPositions": [{"company": "Acme", "title": "Engineer"}]}
    out = profile_from_apify(row, "x")
    assert any("bullet text under each role" in w for w in out["warnings"])


def test_the_bullet_text_under_a_role_keeps_its_line_breaks():
    # `_clean` collapses newlines, which is right for a name and wrong here:
    # it turned four bullets into one run-on sentence and destroyed the only
    # structure the field has. The app renders this `whitespace-pre-wrap`.
    row = {
        "summary": "First paragraph.\n\n\nSecond paragraph.",
        "currentPositions": [
            {"company": "Acme", "title": "Engineer", "description": "  Did a thing.  \n\n  Did another.  "}
        ],
    }
    out = profile_from_apify(row, "x")["profile"]
    assert out["experiences"][0]["description"] == "Did a thing.\n\nDid another."
    # Runs of blank lines collapse to one, so a scrape does not arrive ragged.
    assert out["summary"] == "First paragraph.\n\nSecond paragraph."


def test_a_redacted_title_falls_back_to_the_actor_s_own_title_fields():
    # MEASURED, NOT ASSUMED (2026-09-10). Bill Gates and Satya Nadella both
    # came back from the real actor with every per-position `title` empty
    # while company and dates mapped fine -- LinkedIn redacts the job title
    # for signed-out visitors far more often than the README suggests. The
    # actor exposes `currentTitle` and `allTitles` for exactly this.
    one_current = {
        "currentTitle": "Chairman and CEO",
        "currentPositions": [{"company": "Microsoft", "startDate": "2014-02"}],
    }
    roles = profile_from_apify(one_current, "x")["profile"]["experiences"]
    assert roles[0]["title"] == "Chairman and CEO"
    assert roles[0]["period"] == "2014-02 – Present"


def test_current_title_is_not_pinned_onto_a_role_it_may_not_belong_to():
    # Three current positions and one `currentTitle`: which one is it? The
    # actor does not say, and a title on the wrong employer is worse than a
    # blank one.
    three_current = {
        "currentTitle": "Chair",
        "currentPositions": [{"company": "A"}, {"company": "B"}, {"company": "C"}],
    }
    roles = profile_from_apify(three_current, "x")["profile"]["experiences"]
    assert [r["title"] for r in roles] == ["", "", ""]


def test_all_titles_fills_in_only_when_it_lines_up_one_to_one():
    aligned = {
        "allTitles": ["Engineer", "Intern"],
        "currentPositions": [{"company": "A"}],
        "pastPositions": [{"company": "B"}],
    }
    assert [r["title"] for r in profile_from_apify(aligned, "x")["profile"]["experiences"]] == [
        "Engineer",
        "Intern",
    ]
    # A shorter list means the correspondence is unknown. Indexing into it
    # anyway would put a real title on the wrong employer.
    ragged = {
        "allTitles": ["Engineer"],
        "currentPositions": [{"company": "A"}],
        "pastPositions": [{"company": "B"}],
    }
    assert [r["title"] for r in profile_from_apify(ragged, "x")["profile"]["experiences"]] == ["", ""]


def test_missing_titles_and_missing_descriptions_are_reported_separately():
    # The first version of this warning asserted "the titles and dates came
    # through, the bullet text did not" -- and on the first two real profiles
    # the titles had NOT come through, so it was confidently wrong about the
    # very thing the reader was looking at.
    row = {"currentPositions": [{"company": "Acme"}]}
    warnings = profile_from_apify(row, "x")["warnings"]
    assert any("does not show job titles" in w for w in warnings)
    assert any("bullet text under each role" in w for w in warnings)

    titled = {"currentPositions": [{"company": "Acme", "title": "Engineer"}]}
    warnings = profile_from_apify(titled, "x")["warnings"]
    assert not any("does not show job titles" in w for w in warnings)
    assert any("bullet text under each role" in w for w in warnings)


def test_linkedins_own_seo_blurb_is_not_stored_as_an_about_section():
    # MEASURED ON A REAL PROFILE (2026-09-10). The actor returned this as
    # `summary`: it is the og:description meta tag, which LinkedIn serves a
    # search engine when the About is not public. Storing it would put
    # LinkedIn's marketing copy at the top of a CV.
    row = {
        "name": "Elijah Gabe Cervantes",
        "summary": (
            "Experience: Dominican College of Tarlac · Education: Tarlac State "
            "University · Location: Bamban · 44 connections on LinkedIn. View "
            "Elijah Gabe Cervantes’ profile on LinkedIn, a professional "
            "community of 1 billion members."
        ),
    }
    out = profile_from_apify(row, "x")
    assert out["profile"]["summary"] is None
    assert any("No About section" in w for w in out["warnings"])


def test_a_real_about_section_survives():
    # The guard must not eat a genuine About that happens to mention the word.
    row = {"summary": "I build job-search tooling.\nCurrently learning Rust."}
    out = profile_from_apify(row, "x")
    assert out["profile"]["summary"] == "I build job-search tooling.\nCurrently learning Rust."
    assert not any("No About section" in w for w in out["warnings"])


# --- GitHub, the source that needs no fetcher --------------------------------

from extractor.github_profile import profile_from_github  # noqa: E402
from extractor.merge_profile import merge_profiles  # noqa: E402

GH_USER = {
    "login": "octocat",
    "type": "User",
    "name": "Mona Lisa",
    "company": "@github",
    "blog": "monalisa.dev",
    "location": "San Francisco",
    "bio": "I build things and write about them.",
    "avatar_url": "https://avatars.githubusercontent.com/u/1",
    "html_url": "https://github.com/octocat",
}

GH_REPOS = [
    {
        "name": "worktrack",
        "description": "A job search tracker.",
        "html_url": "https://github.com/octocat/worktrack",
        "language": "TypeScript",
        "stargazers_count": 40,
        "fork": False,
    },
    {
        "name": "notes",
        "description": None,
        "html_url": "https://github.com/octocat/notes",
        "language": "TypeScript",
        "stargazers_count": 90,
        "fork": False,
    },
    {
        "name": "somebody-elses",
        "description": "A fork of someone else's work.",
        "html_url": "https://github.com/octocat/somebody-elses",
        "language": "Go",
        "stargazers_count": 900,
        "fork": True,
    },
    {
        "name": "extractor",
        "description": "Reads a job posting.",
        "html_url": "https://github.com/octocat/extractor",
        "language": "Python",
        "stargazers_count": 5,
        "fork": False,
    },
]


def test_a_github_account_maps_onto_the_profile_the_app_stores():
    p = profile_from_github(GH_USER, GH_REPOS, "https://github.com/octocat")["profile"]
    assert p["name"] == "Mona Lisa"
    assert p["summary"] == "I build things and write about them."
    assert p["location"] == "San Francisco"
    assert p["headline"] == "@github"
    # A bare host is what GitHub stores; the panel needs something openable.
    assert p["websites"] == ["https://monalisa.dev"]


def test_forks_and_nameless_repositories_are_not_projects():
    # A fork is somebody else's work, and a repository with no description is
    # a name a reader cannot judge -- the 900-star fork and the 90-star
    # undescribed repo are both out, however well they would have ranked.
    projects = profile_from_github(GH_USER, GH_REPOS, "x")["profile"]["projects"]
    assert [item["title"] for item in projects] == ["worktrack", "extractor"]


def test_languages_become_skills_counted_over_repositories():
    # Counted per repository rather than by bytes: one enormous vendored file
    # should not outrank ten projects. The fork's Go does not count.
    skills = profile_from_github(GH_USER, GH_REPOS, "x")["profile"]["skills"]
    assert skills == ["TypeScript", "Python"]


def test_github_says_it_carries_no_work_history():
    # Structural, not a failed read: a profile that imports with no roles looks
    # broken unless something says GitHub never had any.
    warnings = profile_from_github(GH_USER, GH_REPOS, "x")["warnings"]
    assert any("no work history" in w for w in warnings)
    assert profile_from_github(GH_USER, GH_REPOS, "x")["profile"]["experiences"] == []


# --- Merging several sources into one person ---------------------------------


def test_the_first_source_wins_a_single_value_and_later_ones_fill_the_gaps():
    linkedin = {"name": "Elijah Gabe Cervantes", "headline": "Frontend Engineer", "location": None}
    github = {"name": "gabe", "headline": "@worktrack", "location": "Bamban, Philippines"}
    merged = merge_profiles([linkedin, github])
    assert merged["name"] == "Elijah Gabe Cervantes"
    assert merged["headline"] == "Frontend Engineer"
    # The gap LinkedIn left is the whole point of the second source.
    assert merged["location"] == "Bamban, Philippines"


def test_an_empty_source_cannot_blank_a_field_another_source_filled():
    merged = merge_profiles([{"name": None, "skills": []}, {"name": "Mona", "skills": ["Go"]}])
    assert merged["name"] == "Mona"
    assert merged["skills"] == ["Go"]


def test_lists_are_the_union_without_duplicates():
    merged = merge_profiles(
        [
            {"skills": ["TypeScript", "React"], "languages": ["English"]},
            {"skills": ["typescript", "Python"], "languages": ["English", "Filipino"]},
        ]
    )
    assert merged["skills"] == ["TypeScript", "React", "Python"]
    assert merged["languages"] == ["English", "Filipino"]


def test_the_same_role_from_two_sources_becomes_one_complete_role():
    # THE MOST VALUABLE THING THIS MERGE DOES. A signed-out LinkedIn page gives
    # the title and the dates and never the bullet text; an export gives the
    # bullet text. Two half-entries under one employer is what a reader would
    # otherwise have to reconcile by hand.
    page = {
        "experiences": [
            {"title": "Frontend Engineer", "company": "Worktrack", "period": "2024 – Present",
             "location": None, "description": None}
        ]
    }
    export = {
        "experiences": [
            {"title": "frontend engineer", "company": "worktrack", "period": None,
             "location": "Remote", "description": "- Shipped the editor"}
        ]
    }
    roles = merge_profiles([page, export])["experiences"]
    assert len(roles) == 1
    assert roles[0]["period"] == "2024 – Present"
    assert roles[0]["description"] == "- Shipped the editor"
    assert roles[0]["location"] == "Remote"


def test_different_roles_are_kept_apart():
    roles = merge_profiles(
        [
            {"experiences": [{"title": "Frontend Engineer", "company": "Worktrack"}]},
            {"experiences": [{"title": "Intern", "company": "Worktrack"}]},
        ]
    )["experiences"]
    assert len(roles) == 2


# --- Which route reads which address -----------------------------------------

from app import ProfileRequest, _profile_site  # noqa: E402


def test_each_profile_host_picks_its_own_route():
    assert _profile_site("https://www.linkedin.com/in/someone") == ("linkedin", "LinkedIn")
    assert _profile_site("https://github.com/octocat") == ("github", "GitHub")
    assert _profile_site("https://ph.jobstreet.com/profile/x")[1] == "JobStreet"
    assert _profile_site("https://www.glassdoor.com/member/home")[1] == "Glassdoor"
    # Everything else is a page, named after itself so a warning can say which.
    assert _profile_site("https://monalisa.dev/about") == ("page", "monalisa.dev")


def test_a_lookalike_host_is_not_the_site_it_imitates():
    # `linkedin.com.evil.test` ends with neither `linkedin.com` nor
    # `.linkedin.com`, and routing it to the LinkedIn reader would spend an
    # Apify run on somebody else's page.
    assert _profile_site("https://linkedin.com.evil.test/in/x")[0] == "page"
    assert _profile_site("https://notgithub.com/octocat")[0] == "page"


def test_one_address_or_many_arrive_as_one_ordered_list():
    assert ProfileRequest(url="https://github.com/a").addresses() == ["https://github.com/a"]
    both = ProfileRequest(
        url="https://github.com/a", urls=["https://linkedin.com/in/b", "https://github.com/a"]
    )
    # Order is authority for the merge, and a repeat is not a second source.
    assert both.addresses() == ["https://linkedin.com/in/b", "https://github.com/a"]


# --- A JobStreet profile, which has neither JSON-LD nor og:title -------------

from extractor.jobstreet_profile import profile_from_jobstreet  # noqa: E402
from extractor.profile import extract_profile  # noqa: E402

JOBSTREET_HTML = """
<html><head><title>Elijah Gabe Cervantes, Frontend Developer at Dominican College | Jobstreet</title>
<meta property="og:site_name" content="Jobstreet Philippines">
<meta name="description" content="Find out more about Elijah Gabe Cervantes.">
</head><body>
<script>window.__APOLLO_STATE__ = {"ROOT_QUERY":{"__typename":"Query",
"publicProfileView({\\"input\\":{\\"slug\\":\\"elijahgabe-cervantes-d3y9lqn7kx\\"}})":{
"__typename":"RestrictedPublicProfileView","slug":"elijahgabe-cervantes-d3y9lqn7kx",
"firstName":"Elijah Gabe","lastName":"Cervantes",
"profileAvatarUrls":{"image256Url":"https://s3.example/avatar?X-Amz-Expires=43200"},
"homeLocation":{"__typename":"PublicProfileLocation","countryCode":"PH",
"label({\\"locale\\":\\"en-PH\\"})":"Bamban, Tarlac, PH"},
"workHistories":[{"__typename":"RestrictedPublicProfileWorkHistory",
"companyName":"Dominican College of Tarlac","roleTitle":"Frontend Developer and UI/UX Designer"}],
"hasVerifiedCredentials":true}}};</script>
</body></html>
"""


def test_a_jobstreet_profile_is_read_from_its_own_graphql_cache():
    # MEASURED ON THE REAL PAGE (2026-09-18): zero ld+json blocks and an og:
    # set that is site branding, so the generic reader had nothing. The cache
    # the page hydrates from carries the fields as structured data.
    out = profile_from_jobstreet("https://ph.jobstreet.com/profiles/x", JOBSTREET_HTML)
    assert out is not None
    p = out["profile"]
    assert p["name"] == "Elijah Gabe Cervantes"
    assert p["location"] == "Bamban, Tarlac, PH"
    assert p["experiences"] == [
        {
            "title": "Frontend Developer and UI/UX Designer",
            "company": "Dominican College of Tarlac",
            "period": None,
            "location": None,
            "description": None,
        }
    ]
    assert p["headline"] == "Frontend Developer and UI/UX Designer at Dominican College of Tarlac"


def test_the_jobstreet_avatar_is_not_stored():
    # The URLs are pre-signed with X-Amz-Expires=43200 -- twelve hours -- so
    # storing one puts a broken image on the panel by tomorrow.
    p = profile_from_jobstreet("x", JOBSTREET_HTML)["profile"]
    assert p["pictureUrl"] is None


def test_what_jobstreet_withholds_is_said_out_loud():
    warnings = profile_from_jobstreet("x", JOBSTREET_HTML)["warnings"]
    assert any("current role" in w for w in warnings)


def test_a_page_without_the_cache_falls_through_rather_than_storing_a_blank():
    # None, not an empty profile: the caller then tries the generic reader,
    # which is the difference between "the markup moved" and "no name".
    assert profile_from_jobstreet("x", "<html><body>hello</body></html>") is None


def test_the_document_title_is_the_last_source_of_a_name_and_headline():
    # A page with no graph and no og:title is not rare. Its <title> is
    # "Name, Headline | Site", which is a name and a headline for free.
    out = extract_profile("https://ph.jobstreet.com/profiles/x", JOBSTREET_HTML, "JobStreet")
    assert out["profile"]["name"] == "Elijah Gabe Cervantes"
    assert out["profile"]["headline"] == "Frontend Developer at Dominican College"
    assert any("JobStreet did not return the structured half" in w for w in out["warnings"])


# --- One project, two names --------------------------------------------------


def test_a_repository_and_a_profile_entry_are_one_project():
    # Gabe, 2026-09-18: "there are repeating information about projects -- one
    # from LinkedIn and one from GitHub". The prose title wins because it is
    # first; the repository's URL fills the gap it left.
    merged = merge_profiles(
        [
            {"projects": [{"title": "FIFO page replacement algorithm", "description": "A Java CLI.", "url": None}]},
            {"projects": [{"title": "FIFO_Algorithm", "description": "This Java CLI program.", "url": "https://github.com/x/FIFO_Algorithm"}]},
        ]
    )["projects"]
    assert len(merged) == 1
    assert merged[0]["title"] == "FIFO page replacement algorithm"
    assert merged[0]["url"] == "https://github.com/x/FIFO_Algorithm"


def test_a_slug_and_a_sentence_are_the_same_name():
    merged = merge_profiles(
        [
            {"projects": [{"title": "The Online Resume Builder"}]},
            {"projects": [{"title": "Online-Resume-Builder"}]},
        ]
    )["projects"]
    assert [item["title"] for item in merged] == ["The Online Resume Builder"]


def test_two_projects_that_merely_share_a_word_stay_apart():
    merged = merge_profiles(
        [
            {"projects": [{"title": "Java Calculator"}]},
            {"projects": [{"title": "Java"}, {"title": "Weather app in Java"}]},
        ]
    )["projects"]
    assert len(merged) == 3


def test_two_roles_at_one_employer_are_never_merged():
    # The fuzzy rule is projects-only on purpose: these two share most of their
    # words, and merging them would silently delete a job.
    merged = merge_profiles(
        [
            {"experiences": [{"title": "Frontend Engineer", "company": "Worktrack"}]},
            {"experiences": [{"title": "Senior Frontend Engineer", "company": "Worktrack"}]},
        ]
    )["experiences"]
    assert len(merged) == 2


def test_every_source_with_an_about_is_kept_and_named():
    # `summary` is one field and the merge keeps the first non-empty one, so a
    # second source's About was discarded silently -- which is how a profile
    # came to introduce somebody with a three-word GitHub bio.
    from app import _attributed_about

    about = _attributed_about(
        [
            {"site": "LinkedIn", "profile": {"summary": "Builds job-search tooling."}},
            {"site": "GitHub", "profile": {"summary": "All will be well."}},
            {"site": "JobStreet", "profile": {"summary": None}},
        ]
    )
    assert about == [
        {"site": "LinkedIn", "text": "Builds job-search tooling."},
        {"site": "GitHub", "text": "All will be well."},
    ]


def test_the_same_about_from_two_sources_is_one_paragraph():
    from app import _attributed_about

    about = _attributed_about(
        [
            {"site": "LinkedIn", "profile": {"summary": "Builds job-search tooling."}},
            {"site": "JobStreet", "profile": {"summary": "builds   job-search tooling."}},
        ]
    )
    assert [entry["site"] for entry in about] == ["LinkedIn"]


def test_an_employer_with_no_role_is_not_a_second_job():
    # LinkedIn does not show job titles to signed-out visitors on some
    # profiles, so it returns the company and the dates with an EMPTY title;
    # JobStreet returns the same job with its title. The panel listed the
    # employer twice -- once as a job with no name (Gabe, 2026-09-18).
    partial = {
        "experiences": [
            {
                "title": "",
                "company": "Dominican College of Tarlac",
                "period": "2025 – Present",
                "location": "Capas, Central Luzon, Philippines",
                "description": None,
            }
        ]
    }
    titled = {
        "experiences": [
            {
                "title": "Frontend Developer and UI/UX Designer",
                "company": "Dominican College of Tarlac",
                "period": None,
                "location": None,
                "description": None,
            }
        ]
    }
    # BOTH DIRECTIONS. The real order is LinkedIn first, so the incomplete
    # record arrives first -- which the first pass at this did not handle.
    for order in ([partial, titled], [titled, partial]):
        roles = merge_profiles(order)["experiences"]
        assert len(roles) == 1
        assert roles[0]["title"] == "Frontend Developer and UI/UX Designer"
        assert roles[0]["period"] == "2025 – Present"
        assert roles[0]["location"] == "Capas, Central Luzon, Philippines"


def test_a_third_source_naming_the_same_job_does_not_add_a_duplicate():
    # Filling a blank title changes the record's key, so the index has to be
    # rewritten or the next source misses it.
    partial = {"experiences": [{"title": "", "company": "Acme"}]}
    titled = {"experiences": [{"title": "Engineer", "company": "Acme"}]}
    assert len(merge_profiles([partial, titled, titled])["experiences"]) == 1


def test_a_github_bio_never_outranks_a_real_about():
    from app import _attributed_about

    about = _attributed_about(
        [
            {"site": "GitHub", "profile": {"summary": "All will be well."}},
            {"site": "LinkedIn", "profile": {"summary": "Frontend developer in Manila."}},
        ]
    )
    # A 160-character tagline under an avatar is not the paragraph somebody
    # wrote to be read by an employer, whatever order the sources were in.
    assert [entry["site"] for entry in about] == ["LinkedIn", "GitHub"]


def test_a_bio_is_still_better_than_an_empty_about():
    from app import _attributed_about

    about = _attributed_about([{"site": "GitHub", "profile": {"summary": "All will be well."}}])
    assert [entry["site"] for entry in about] == ["GitHub"]


# --- A LinkedIn profile as its owner sees it, handed over by bookmarklet -----

from extractor.linkedin_page import profile_from_linkedin_page  # noqa: E402

#: SHAPED LIKE THE REAL PAGE, NOT COPIED FROM IT: the section anchors LinkedIn
#: scrolls its own navigation to, list items, and every line printed twice --
#: once `aria-hidden` for the eye, once `visually-hidden` for a screen reader.
#:
#: WHAT THIS PROVES AND WHAT IT CANNOT. It proves the reader's logic: slicing
#: by anchor, taking one of each doubled pair, and mapping lines to fields by
#: order. It cannot prove LinkedIn still writes this markup tomorrow -- nothing
#: offline can, which is why the reader returns None rather than a blank when
#: it recognises nothing, and the caller falls through to the ordinary one.
LINKEDIN_PAGE = """
<html><head><title>(3) Elijah Gabe Cervantes | LinkedIn</title></head><body>
<h1>Elijah Gabe Cervantes</h1>
<section><div id="about"></div>
  <div><span aria-hidden="true">I build job-search tooling in Next.js and Supabase, and I care about the parts nobody sees.</span>
  <span class="visually-hidden">I build job-search tooling in Next.js and Supabase, and I care about the parts nobody sees.</span></div>
</section>
<section><div id="experience"></div><ul>
  <li>
    <div><span aria-hidden="true">Frontend Developer and UI/UX Designer</span><span class="visually-hidden">Frontend Developer and UI/UX Designer</span></div>
    <span><span aria-hidden="true">Dominican College of Tarlac \u00b7 Part-time</span></span>
    <span><span aria-hidden="true">Jan 2025 - Present \u00b7 9 mos</span></span>
    <span><span aria-hidden="true">Capas, Central Luzon, Philippines \u00b7 On-site</span></span>
    <div><span aria-hidden="true">Rebuilt the college intranet in Next.js.</span></div>
    <div><span aria-hidden="true">Skills: React, TypeScript and Figma</span></div>
  </li>
</ul></section>
<section><div id="education"></div><ul><li>
  <div><span aria-hidden="true">Tarlac State University</span></div>
  <span><span aria-hidden="true">Bachelor of Science, Information Technology</span></span>
  <span><span aria-hidden="true">2022 - 2026</span></span>
</li></ul></section>
<section><div id="licenses_and_certifications"></div><ul><li>
  <div><span aria-hidden="true">Introduction to Networks</span></div>
  <span><span aria-hidden="true">Cisco Networking Academy</span></span>
  <span><span aria-hidden="true">Issued Jan 2024</span></span>
</li></ul></section>
<section><div id="skills"></div><ul>
  <li><div><span aria-hidden="true">JavaScript</span></div><span><span aria-hidden="true">3 endorsements</span></span></li>
  <li><div><span aria-hidden="true">React</span></div></li>
</ul></section>
</body></html>
"""


def test_a_captured_profile_carries_what_no_fetch_can_get():
    out = profile_from_linkedin_page("https://www.linkedin.com/in/x/", LINKEDIN_PAGE)
    assert out is not None
    p = out["profile"]
    assert p["name"] == "Elijah Gabe Cervantes"
    # THE THREE THINGS EVERY WARNING WAS ABOUT: the About, the skills, and the
    # bullet text under a role. None of them are on a signed-out page.
    assert p["summary"].startswith("I build job-search tooling")
    assert p["skills"][:3] == ["React", "TypeScript", "Figma"]
    role = p["experiences"][0]
    assert role["title"] == "Frontend Developer and UI/UX Designer"
    assert role["company"] == "Dominican College of Tarlac"
    assert role["period"] == "Jan 2025 - Present \u00b7 9 mos"
    assert role["location"] == "Capas, Central Luzon, Philippines"
    assert role["description"] == "Rebuilt the college intranet in Next.js."


def test_a_line_printed_twice_is_read_once():
    # Every line on the page exists twice -- aria-hidden for the eye,
    # visually-hidden for a screen reader. Read naively, a role arrives as
    # "Engineer Engineer".
    p = profile_from_linkedin_page("x", LINKEDIN_PAGE)["profile"]
    assert p["experiences"][0]["title"].count("Frontend") == 1
    assert p["summary"].count("I build") == 1


def test_education_and_certifications_come_through_too():
    p = profile_from_linkedin_page("x", LINKEDIN_PAGE)["profile"]
    assert p["education"] == [
        {
            "school": "Tarlac State University",
            "degree": "Bachelor of Science, Information Technology",
            "period": "2022 - 2026",
        }
    ]
    assert p["certifications"][0]["authority"] == "Cisco Networking Academy"
    assert p["certifications"][0]["period"] == "Issued Jan 2024"


def test_a_page_with_no_recognised_section_falls_through():
    # None, not a blank profile: the caller then parses it with the ordinary
    # reader, so a markup change costs the extra fields and never the import.
    assert profile_from_linkedin_page("x", "<html><body><p>hello</p></body></html>") is None


def test_a_captured_page_is_never_fetched():
    from app import _parse_supplied

    record = _parse_supplied(
        "https://www.linkedin.com/in/x/", LINKEDIN_PAGE, "linkedin", "LinkedIn"
    )
    assert record["ok"] is True
    assert record["via"] == "bookmarklet"
    assert record["profile"]["skills"]


def test_a_captured_page_the_reader_cannot_parse_still_reads_as_a_profile():
    # The ordinary reader is behind it: JSON-LD, then og tags, then the title.
    from app import _parse_supplied

    record = _parse_supplied(
        "https://www.linkedin.com/in/x/",
        "<html><head><title>Ada Lovelace - Engineer | LinkedIn</title></head><body></body></html>",
        "linkedin",
        "LinkedIn",
    )
    assert record["ok"] is True
    assert record["profile"]["name"] == "Ada Lovelace"


# --- The second actor's shape, mapped by the same reader ---------------------

#: `supreme_coder/linkedin-profile-scraper`, which replaced `crawlerbros` on
#: 2026-09-18: a hundredth of the price and it publishes skills and languages,
#: which the old one never returned at all.
#:
#: SHAPED FROM ITS PUBLISHED INPUT SCHEMA, ITS CHANGELOG AND ITS FIELD LIST --
#: `positions/employmentType` and `positions/totalDuration` are named in the
#: changelog, `firstName`/`lastName`/`about`/`occupation` in the README's table
#: -- because the actor documents no output schema. So this proves the MAPPER
#: reads that shape, not that the actor still writes it. The net under a wrong
#: guess is in `app._linkedin_profile`: a row that maps to no name and no roles
#: is treated as a failed read and Firecrawl takes over.
SUPREME_ROW = {
    "firstName": "Elijah Gabe",
    "lastName": "Cervantes",
    "occupation": "Frontend Developer and UI/UX Designer",
    "about": "I build job-search tooling in Next.js and Supabase.",
    "geoLocationName": "Bamban, Central Luzon, Philippines",
    "profilePicHighQuality": "https://media.licdn.com/dms/image/x",
    "linkedinUrl": "https://www.linkedin.com/in/elijah-gabe-cervantes-0252b4340/",
    "positions": [
        {
            "title": "Frontend Developer and UI/UX Designer",
            "companyName": "Dominican College of Tarlac",
            "totalDuration": "Jan 2025 - Present · 9 mos",
            "locationName": "Capas, Central Luzon, Philippines",
            "description": "Rebuilt the college intranet in Next.js.",
            "employmentType": "Part-time",
        }
    ],
    "educations": [
        {
            "schoolName": "Tarlac State University",
            "degreeName": "Bachelor of Science",
            "fieldOfStudy": "Information Technology",
            "dateRange": "2022 - 2026",
        }
    ],
    "certifications": [
        {"name": "Introduction to Networks", "issuer": "Cisco Networking Academy", "issueDate": "Jan 2024"}
    ],
    "skills": [{"name": "React"}, {"name": "TypeScript"}, "Figma"],
    "languages": [{"name": "English", "proficiency": "Professional"}, {"name": "Filipino"}],
}


def test_the_new_actor_row_maps_onto_the_same_profile():
    p = profile_from_apify(SUPREME_ROW, "https://www.linkedin.com/in/x/")["profile"]
    assert p["name"] == "Elijah Gabe Cervantes"
    assert p["headline"] == "Frontend Developer and UI/UX Designer"
    assert p["summary"] == "I build job-search tooling in Next.js and Supabase."
    assert p["location"] == "Bamban, Central Luzon, Philippines"
    assert p["url"] == "https://www.linkedin.com/in/elijah-gabe-cervantes-0252b4340/"


def test_the_new_actor_brings_skills_and_languages_the_old_one_never_had():
    # The two things every warning on the profile screen was about. Strings or
    # `{name}` objects, because the actor mixes both.
    p = profile_from_apify(SUPREME_ROW, "x")["profile"]
    assert p["skills"] == ["React", "TypeScript", "Figma"]
    assert p["languages"] == ["English", "Filipino"]


def test_a_flat_positions_list_reads_like_the_split_one():
    roles = profile_from_apify(SUPREME_ROW, "x")["profile"]["experiences"]
    assert roles == [
        {
            "title": "Frontend Developer and UI/UX Designer",
            "company": "Dominican College of Tarlac",
            "period": "Jan 2025 - Present · 9 mos",
            "location": "Capas, Central Luzon, Philippines",
            "description": "Rebuilt the college intranet in Next.js.",
        }
    ]


def test_educations_and_issuer_spellings_both_read():
    p = profile_from_apify(SUPREME_ROW, "x")["profile"]
    assert p["education"] == [
        {
            "school": "Tarlac State University",
            "degree": "Bachelor of Science, Information Technology",
            "period": "2022 - 2026",
        }
    ]
    assert p["certifications"][0]["authority"] == "Cisco Networking Academy"


def test_the_skills_warning_is_not_printed_over_skills():
    # It was unconditional, because the old actor could never return any.
    # Claiming it now would be the app arguing with what is on screen beside it.
    warnings = profile_from_apify(SUPREME_ROW, "x")["warnings"]
    assert not any("Skills and languages did not come through" in w for w in warnings)
    assert any(
        "Skills and languages did not come through" in w
        for w in profile_from_apify({"name": "Nobody"}, "x")["warnings"]
    )


def test_the_old_actor_row_still_maps():
    # One mapper, two actors: the row that shipped for eight days still reads.
    p = profile_from_apify(ROW, "x")["profile"]
    assert p["name"] == "Satya Nadella"
    assert p["experiences"]


def test_a_role_with_no_employer_is_not_a_second_job():
    # THE SAME BUG THE OTHER WAY ROUND (Gabe, 2026-09-18, second report). The
    # captured page returned the title, the duration and the bullet text with
    # no employer; JobStreet returned the same job with its employer and
    # nothing else. Anchored on the company, the fold could not see it.
    captured = {
        "experiences": [
            {
                "title": "Frontend Developer and UI/UX Designer",
                "company": None,
                "period": "3 mos",
                "location": "Capas, Central Luzon, Philippines",
                "description": "• Designed prototypes for key web pages using Figma.",
            }
        ]
    }
    named = {
        "experiences": [
            {
                "title": "Frontend Developer and UI/UX Designer",
                "company": "Dominican College of Tarlac",
                "period": None,
                "location": None,
                "description": None,
            }
        ]
    }
    for order in ([captured, named], [named, captured]):
        roles = merge_profiles(order)["experiences"]
        assert len(roles) == 1
        assert roles[0]["company"] == "Dominican College of Tarlac"
        assert roles[0]["period"] == "3 mos"
        assert roles[0]["description"].startswith("• Designed prototypes")


def test_the_same_title_at_two_employers_stays_two_jobs():
    # The clause that keeps the fold honest: two records that BOTH name both
    # fields are compared normally, and these disagree on the company.
    roles = merge_profiles(
        [
            {"experiences": [{"title": "Engineer", "company": "Acme"}]},
            {"experiences": [{"title": "Engineer", "company": "Globex"}]},
        ]
    )["experiences"]
    assert len(roles) == 2


def test_the_company_may_arrive_as_an_object():
    # `supreme_coder` returns `company: {name: ...}` on a position, and a
    # string-only read left the employer blank -- which is what produced the
    # duplicate above in the first place.
    row = {
        "firstName": "A",
        "lastName": "B",
        "positions": [
            {
                "title": "Frontend Developer",
                "company": {"name": "Dominican College of Tarlac"},
                "locationName": "Capas, Central Luzon, Philippines · On-site",
                "totalDuration": "3 mos",
            }
        ],
    }
    role = profile_from_apify(row, "x")["profile"]["experiences"][0]
    assert role["company"] == "Dominican College of Tarlac"
    # And the work mode is not part of the place: this app records that on an
    # application, not on a person.
    assert role["location"] == "Capas, Central Luzon, Philippines"
