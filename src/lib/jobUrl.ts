/**
 * Which URLs `/api/autofill` is allowed to hand to the extractor.
 *
 * PORTED FROM the `job-url-autofill` edge function, not re-derived. (That
 * function was deleted on 2026-09-17, never having been deployed; the original
 * list is in git history.)
 * These ranges were settled once, under review, and re-deriving them from
 * memory is how one gets dropped -- which is not hypothetical: the Python copy
 * of this same gate initially leaned on the standard library and silently let
 * carrier-grade NAT through, because Python's `ipaddress` reports
 * 100.64.0.0/10 as public. It is listed explicitly here for the same reason.
 *
 * THIS IS THE PRIMARY CONTROL. The extractor runs the same check again on the
 * URL a redirect lands on, because only the thing performing the fetch can see
 * that -- but this is the one that decides whether a request is made at all.
 * Without it, an authenticated user could point the server at
 * `http://169.254.169.254/` and read cloud metadata off our own egress.
 */

export const MAX_URL_LENGTH = 2048

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/g, '')
}

function parseIpv4(hostname: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null
  const octets = hostname.split('.').map(Number)
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return octets
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets
  if (a === 10) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // RFC 6598 carrier-grade NAT
  if (a >= 224) return true // multicast and above
  return false
}

/**
 * The eight 16-bit groups of an IPv6 address, or null if it is not one.
 * Accepts `::` compression and a trailing dotted quad (`::ffff:1.2.3.4`).
 */
function ipv6Groups(hostname: string): number[] | null {
  let text = hostname
  const quad = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)
  if (quad) {
    const octets = parseIpv4(quad[1])
    if (!octets) return null
    text = `${text.slice(0, quad.index)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const parse = (part: string) => (part ? part.split(':') : [])
  const head = parse(halves[0])
  const tail = halves.length === 2 ? parse(halves[1]) : []
  const missing = 8 - head.length - tail.length
  if ((halves.length === 2 && missing < 1) || (halves.length === 1 && missing !== 0)) return null
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.map((g) => Number.parseInt(g, 16))
}

/**
 * The IPv4 address an IPv6 one carries, when it carries one.
 *
 * ADDED 2026-10-19, after an edge-case test found the bypass: the URL parser
 * rewrites `[::ffff:127.0.0.1]` to `::ffff:7f00:1`, a hostname with colons that
 * named no private IPv6 range -- so it passed, and on a dual-stack server it
 * reaches loopback, the cloud metadata address or the private network. Three
 * forms embed one: IPv4-mapped (`::ffff:0:0/96`), IPv4-compatible (`::/96`,
 * deprecated but parsed) and NAT64 (`64:ff9b::/96`).
 */
function embeddedIpv4(groups: number[]): number[] | null {
  const zero = (from: number, to: number) => groups.slice(from, to).every((g) => g === 0)
  const mapped = zero(0, 5) && groups[5] === 0xffff
  const compatible = zero(0, 6) && (groups[6] !== 0 || groups[7] > 1)
  const nat64 = groups[0] === 0x64 && groups[1] === 0xff9b && zero(2, 6)
  if (!mapped && !compatible && !nat64) return null
  return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff]
}

export function isDisallowedHostname(rawHostname: string): boolean {
  const hostname = normalizeHostname(rawHostname)
  if (!hostname) return true
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return true
  // A single label cannot be a public site and IS the shape of an intranet
  // name -- `http://intranet/`.
  if (!hostname.includes('.') && !hostname.includes(':')) return true

  const ipv4 = parseIpv4(hostname)
  if (ipv4) return isPrivateIpv4(ipv4)

  if (hostname.includes(':')) {
    if (hostname === '::' || hostname === '::1') return true
    const groups = ipv6Groups(hostname)
    // Not parseable as IPv6 is not a public address either.
    if (!groups) return true
    if (groups.every((g) => g === 0) || (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1)) return true
    const ipv4 = embeddedIpv4(groups)
    if (ipv4) return isPrivateIpv4(ipv4)
    // Ranges, not string prefixes: link-local is fe80::/10, so `febf::1` is
    // one, and a `startsWith('fe80:')` let it through. Site-local (fec0::/10,
    // deprecated), unique-local (fc00::/7) and multicast (ff00::/8) too.
    const first = groups[0]
    if ((first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0) return true
    if ((first & 0xfe00) === 0xfc00 || (first & 0xff00) === 0xff00) return true
    // A zone id (`fe80::1%eth0`) does not parse above, so it is refused there.
  }
  return false
}

/**
 * What a person pastes is not always a URL. A bare `acme.com/jobs/1` and a
 * protocol-relative `//acme.com/...` both mean https here.
 */
export function normalizeTargetUrl(rawUrl: string): string {
  const trimmed = (rawUrl ?? '').trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  if (/^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(trimmed)) return `https://${trimmed}`
  return trimmed
}

/** `null` when the URL may be fetched, otherwise the reason it may not. */
export function rejectReason(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return 'URL is required'
  const url = normalizeTargetUrl(rawUrl)
  if (!url) return 'URL is required'
  if (url.length > MAX_URL_LENGTH) return 'URL is too long'

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'Invalid URL format'
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return 'URL must start with http:// or https://'
  }
  if (isDisallowedHostname(parsed.hostname)) return 'URL must be a public job posting URL'
  return null
}
