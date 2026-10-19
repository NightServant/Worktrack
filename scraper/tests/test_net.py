"""The SSRF gate.

This is the security-critical half of the service, and it is ported rather than
rewritten for that reason -- the ranges below are the ones the Deno function
chose after review, and re-deriving them from memory is how one gets dropped.

`is_disallowed_hostname` is deliberately conservative: a name it cannot resolve
to a public address is refused. A false refusal costs one auto-fill; a false
allow is an open proxy on our egress IP.
"""

from __future__ import annotations

import pytest

from extractor.net import is_disallowed_hostname, normalize_target_url, reject_reason


@pytest.mark.parametrize(
    "host",
    [
        "localhost",
        "app.localhost",
        "printer.local",
        "db.internal",
        "intranet",  # single label -- the shape of an internal target
        "127.0.0.1",
        "10.0.0.1",
        "172.16.0.1",
        "172.31.255.255",
        "192.168.1.1",
        "169.254.169.254",  # cloud metadata, the classic SSRF target
        "100.64.0.1",  # carrier-grade NAT
        "0.0.0.0",
        "224.0.0.1",  # multicast
        "::1",
        "fe80::1",  # link-local
        "fd00::1",  # unique-local
    ],
)
def test_private_and_internal_hosts_are_refused(host):
    assert is_disallowed_hostname(host) is True


@pytest.mark.parametrize(
    "host",
    ["boards.greenhouse.io", "jobs.lever.co", "www.linkedin.com", "8.8.8.8", "careers.example.com"],
)
def test_public_hosts_are_allowed(host):
    # The positive companion: a gate that refuses everything passes every
    # negative test above and breaks the feature.
    assert is_disallowed_hostname(host) is False


def test_trailing_dot_and_brackets_do_not_bypass():
    # `127.0.0.1.` and `[::1]` are the same targets wearing punctuation.
    assert is_disallowed_hostname("127.0.0.1.") is True
    assert is_disallowed_hostname("[::1]") is True


def test_normalises_what_a_person_pastes():
    assert normalize_target_url("acme.com/jobs/1") == "https://acme.com/jobs/1"
    assert normalize_target_url("//acme.com/jobs/1") == "https://acme.com/jobs/1"
    assert normalize_target_url("https://acme.com/jobs/1") == "https://acme.com/jobs/1"
    assert normalize_target_url("  ") == ""


def test_reject_reason_covers_scheme_length_and_host():
    assert reject_reason("") == "URL is required"
    assert reject_reason("https://acme.com/" + "a" * 3000) == "URL is too long"
    assert reject_reason("ftp://acme.com/x") == "URL must start with http:// or https://"
    assert reject_reason("file:///etc/passwd") == "URL must start with http:// or https://"
    assert reject_reason("http://169.254.169.254/latest/meta-data/") == (
        "URL must be a public job posting URL"
    )
    assert reject_reason("https://boards.greenhouse.io/acme/jobs/1") is None


# --- Edge cases, 2026-10-19 ("implement more test case scenarios to catch
# more bugs"). Each of these got through before the fix beside it.

import asyncio  # noqa: E402

import httpx  # noqa: E402

from extractor.net import BlockedUrl, fetch_public  # noqa: E402


@pytest.mark.parametrize(
    "url",
    [
        # `ipaddress` refuses these spellings as not-an-address, so they read
        # as ordinary names -- and the resolver then takes them for loopback,
        # exactly as inet_aton does.
        "http://0x7f.0.0.1/",
        "http://0177.0.0.1/",
        "http://127.1/",
        "http://0x7f000001/",
        "http://10.1/",
        "http://0251.0376.0251.0376/",  # 169.254.169.254, octal
    ],
)
def test_legacy_ipv4_spellings_are_refused(url):
    assert reject_reason(url) is not None


def test_a_legacy_spelling_of_a_public_address_still_passes():
    # 0x5d.0xb8.0xd8.0x22 is 93.184.216.34.
    assert reject_reason("http://0x5d.0xb8.0xd8.0x22/") is None


def _transport(routes):
    """A fake network: `routes` maps a URL to (status, headers, body)."""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        status, headers, body = routes[str(request.url)]
        return httpx.Response(status, headers=headers, text=body)

    return httpx.MockTransport(handler), seen


def _public(_host):
    return ["93.184.216.34"]


def test_a_name_that_resolves_to_an_internal_address_is_refused_before_any_request():
    # A public-looking domain whose A record is 169.254.169.254 passes every
    # string check. Only resolving it shows where it goes.
    transport, seen = _transport({"https://evil.example/": (200, {}, "secret")})

    async def run():
        async with httpx.AsyncClient(transport=transport) as client:
            await fetch_public(client, "https://evil.example/", resolve=lambda _h: ["169.254.169.254"])

    with pytest.raises(BlockedUrl):
        asyncio.run(run())
    assert seen == []


def test_a_redirect_to_an_internal_address_is_refused_before_it_is_followed():
    # The old code followed the redirect and THEN checked where it landed:
    # the response was refused, but the request to the internal address had
    # already been made.
    transport, seen = _transport(
        {
            "https://jobs.example/1": (302, {"location": "http://127.0.0.1/admin"}, ""),
            "http://127.0.0.1/admin": (200, {}, "internal"),
        }
    )

    async def run():
        async with httpx.AsyncClient(transport=transport) as client:
            await fetch_public(client, "https://jobs.example/1", resolve=_public)

    with pytest.raises(BlockedUrl):
        asyncio.run(run())
    assert seen == ["https://jobs.example/1"]


def test_ordinary_redirects_are_followed_to_the_page():
    transport, seen = _transport(
        {
            "https://jobs.example/1": (301, {"location": "/jobs/1"}, ""),
            "https://jobs.example/jobs/1": (200, {}, "<html>posting</html>"),
        }
    )

    async def run():
        async with httpx.AsyncClient(transport=transport) as client:
            return await fetch_public(client, "https://jobs.example/1", resolve=_public)

    response = asyncio.run(run())
    assert response.status_code == 200
    assert str(response.url) == "https://jobs.example/jobs/1"
    assert seen == ["https://jobs.example/1", "https://jobs.example/jobs/1"]


def test_a_redirect_loop_stops():
    transport, _ = _transport(
        {
            "https://jobs.example/a": (302, {"location": "https://jobs.example/b"}, ""),
            "https://jobs.example/b": (302, {"location": "https://jobs.example/a"}, ""),
        }
    )

    async def run():
        async with httpx.AsyncClient(transport=transport) as client:
            await fetch_public(client, "https://jobs.example/a", resolve=_public)

    with pytest.raises(BlockedUrl):
        asyncio.run(run())


def test_extract_refuses_a_redirect_to_an_internal_host(monkeypatch):
    # End to end through the endpoint, so the wiring is pinned and not only
    # the helper: a fetch refused at a hop answers 422 with no page read.
    import app as service

    async def refuse(*_args, **_kwargs):
        raise BlockedUrl("URL must be a public job posting URL")

    monkeypatch.setattr(service, "fetch_public", refuse)
    response = asyncio.run(service.extract_endpoint(service.ExtractRequest(url="https://jobs.example/1")))
    assert response.status_code == 422
    assert b"invalid host" in response.body
