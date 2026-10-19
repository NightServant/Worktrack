"""Which hostnames this service is allowed to fetch.

A SECOND COPY OF THE GATE, ON PURPOSE. `/api/autofill` validates the URL the
user supplied before it calls this service, and that is the primary control.
This runs again HERE because a redirect is a second URL: the caller validated
what was typed, and only the thing performing the fetch can see where it landed.
The Deno function made exactly this check after `redirect: 'follow'` for the
same reason.

Ported from the `job-url-autofill` edge function (deleted 2026-09-17, in git
history), including the
ranges it chose: RFC1918, loopback, link-local, carrier-grade NAT and
multicast, plus IPv6 loopback, link-local and unique-local. Single-label hosts
are refused because `http://intranet/` is the shape of an internal target.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from collections.abc import Callable, Iterable
from typing import Any
from urllib.parse import urljoin, urlsplit

MAX_URL_LENGTH = 2048

_CARRIER_GRADE_NAT = ipaddress.ip_network("100.64.0.0/10")


def normalize_hostname(hostname: str) -> str:
    return hostname.strip().lower().strip("[]").rstrip(".")


def _legacy_ipv4(host: str) -> ipaddress.IPv4Address | None:
    """The address an inet_aton-style spelling names, or None.

    ADDED 2026-10-19, from an edge-case test: `ipaddress` refuses `127.1`,
    `0177.0.0.1` and `0x7f.0.0.1` as not-an-address, so they read as ordinary
    names and passed -- and the resolver then takes every one of them for
    loopback. One to four parts, each decimal, octal (leading 0) or hex (0x),
    the last part filling the bytes that remain: what inet_aton accepts.
    """
    parts = host.split(".")
    if not 1 <= len(parts) <= 4 or not all(re.fullmatch(r"0x[0-9a-f]*|\d+", p) for p in parts):
        return None
    try:
        values = [int(p, 16) if p.startswith("0x") else int(p, 8) if len(p) > 1 and p.startswith("0") else int(p) for p in parts]
    except ValueError:
        return None
    *head, last = values
    if any(v > 255 for v in head) or last >= 256 ** (4 - len(head)):
        return None
    number = 0
    for v in head:
        number = number * 256 + v
    number = number * 256 ** (4 - len(head)) + last
    return ipaddress.IPv4Address(number)


def _is_internal_address(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if address in _CARRIER_GRADE_NAT:
        # RFC 6598, 100.64.0.0/10. Python's `ipaddress` reports this as
        # PUBLIC -- `is_private`, `is_reserved`, `is_link_local` and
        # `is_multicast` are all False for 100.64.0.1, checked on 3.13 -- so
        # the stdlib alone would have let it through. The Deno function blocked
        # it explicitly (`a === 100 && b >= 64 && b <= 127`), and porting the
        # range rather than trusting the library is what kept it blocked. The
        # test for it is what found the gap.
        return True
    return (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


def is_disallowed_hostname(raw_hostname: str) -> bool:
    host = normalize_hostname(raw_hostname or "")
    if not host:
        return True
    if host == "localhost" or host.endswith(".localhost"):
        return True
    if host.endswith(".local") or host.endswith(".internal"):
        return True
    # A single label cannot be a public site, and IS the shape of an intranet
    # name. Checked before the IP parse so `intranet` is refused too.
    if "." not in host and ":" not in host:
        return True
    try:
        address: ipaddress.IPv4Address | ipaddress.IPv6Address | None = ipaddress.ip_address(host)
    except ValueError:
        address = _legacy_ipv4(host)
    if address is None:
        return False
    return _is_internal_address(address)


def normalize_target_url(raw_url: str) -> str:
    """What a person pastes is not always a URL. A bare `acme.com/jobs/1` and a
    protocol-relative `//acme.com/...` both mean https here."""
    trimmed = (raw_url or "").strip()
    if not trimmed:
        return ""
    if trimmed.startswith("//"):
        return f"https:{trimmed}"
    if re.match(r"^[a-z][a-z0-9+.-]*://", trimmed, re.I):
        return trimmed
    if re.match(r"^[\w.-]+\.[a-z]{2,}(/|$)", trimmed, re.I):
        return f"https://{trimmed}"
    return trimmed


def reject_reason(url: str) -> str | None:
    """None when the URL may be fetched, else why not."""
    if not url:
        return "URL is required"
    if len(url) > MAX_URL_LENGTH:
        return "URL is too long"
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        return "URL must start with http:// or https://"
    if is_disallowed_hostname(parts.hostname or ""):
        return "URL must be a public job posting URL"
    return None


class BlockedUrl(Exception):
    """A URL, a redirect or a resolved address this service must not fetch."""


#: Enough for http -> https -> www -> the posting; a site needing more is lost.
MAX_REDIRECTS = 5


def _resolve(host: str) -> list[str]:
    return sorted({info[4][0] for info in socket.getaddrinfo(host, None)})


async def fetch_public(
    client: Any,
    url: str,
    *,
    resolve: Callable[[str], Iterable[str]] = _resolve,
    **kwargs: Any,
) -> Any:
    """GET a URL the reader supplied, refusing anything internal at EVERY hop.

    ADDED 2026-10-19, from two edge-case tests:

    - A REDIRECT WAS FOLLOWED, THEN JUDGED. `follow_redirects=True` requested
      the redirect's target and only afterwards did the caller check where it
      had landed -- so a page redirecting to `http://127.0.0.1/admin` had its
      response refused, but the request had already been made. Each hop is now
      checked before it is requested.
    - A NAME IS NOT AN ADDRESS. A public-looking domain whose A record is
      169.254.169.254 passed every string check. Each hop's host is resolved
      and refused if ANY address it resolves to is internal.

    What this cannot close is a resolver that answers differently a moment
    later (DNS rebinding); that needs the connection pinned to the address
    checked, which httpx does not offer. The window is one lookup wide.
    """
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        reason = reject_reason(current)
        if reason:
            raise BlockedUrl(reason)
        host = urlsplit(current).hostname or ""
        try:
            literal = ipaddress.ip_address(normalize_hostname(host))
        except ValueError:
            literal = None
        if literal is None:
            try:
                addresses = list(await asyncio.to_thread(lambda: list(resolve(host))))
            except OSError as err:
                raise BlockedUrl("Could not resolve this URL") from err
            if not addresses or any(_is_internal_address(ipaddress.ip_address(a)) for a in addresses):
                raise BlockedUrl("URL must be a public job posting URL")
        response = await client.get(current, follow_redirects=False, **kwargs)
        location = response.headers.get("location")
        if response.is_redirect and location:
            current = urljoin(str(response.url), location)
            continue
        return response
    raise BlockedUrl("Too many redirects")
