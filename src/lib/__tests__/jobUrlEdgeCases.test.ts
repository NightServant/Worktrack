import { describe, it, expect } from 'vitest'
import { rejectReason } from '../jobUrl'

/**
 * EDGE CASES FOR THE SSRF GUARD (Gabe, 2026-10-19: "implement more test case
 * scenarios to catch more bugs"). Both server routes that fetch a page a
 * reader names -- /api/autofill and /api/profile -- refuse it here first, so
 * every spelling of an internal address has to land on a refusal. The URL
 * parser normalises many of them before this sees the hostname; the cases are
 * written as an attacker would type them, not as they arrive.
 */
const blocked = (url: string) => expect(rejectReason(url), url).not.toBeNull()
const allowed = (url: string) => expect(rejectReason(url), url).toBeNull()

describe('internal addresses in every spelling', () => {
  it('refuses loopback however the IPv4 is written', () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://127.1/',
      'http://2130706433/', // decimal
      'http://0x7f000001/', // hex
      'http://0177.0.0.1/', // octal
      'http://0x7f.0.0.1/',
      'http://127.0.0.1.:8080/', // trailing dot
    ]) {
      blocked(url)
    }
  })

  it('refuses the cloud metadata address and the unspecified one', () => {
    blocked('http://169.254.169.254/latest/meta-data/')
    blocked('http://0.0.0.0/')
    blocked('http://0/')
  })

  it('refuses IPv6 loopback, link-local and unique-local, long form too', () => {
    for (const url of [
      'http://[::1]/',
      'http://[0:0:0:0:0:0:0:1]/',
      'http://[::]/',
      'http://[fe80::1]/',
      'http://[fd00::1]/',
      'http://[fc00::1]/',
      'http://[febf::1]/', // still fe80::/10
      'http://[fec0::1]/', // site-local
      'http://[ff02::1]/', // multicast
    ]) {
      blocked(url)
    }
  })

  it('refuses an IPv4 address smuggled inside IPv6', () => {
    // ::ffff:127.0.0.1 is the IPv4-mapped form, and the URL parser rewrites
    // it to ::ffff:7f00:1 -- a hostname with colons that names no private
    // IPv6 range, yet reaches 127.0.0.1 on a dual-stack host.
    for (const url of [
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:7f00:1]/',
      'http://[::ffff:169.254.169.254]/',
      'http://[::ffff:10.0.0.1]/',
      'http://[::ffff:192.168.1.1]/',
      'http://[::127.0.0.1]/', // IPv4-compatible (deprecated, still parsed)
      'http://[64:ff9b::7f00:1]/', // NAT64 to 127.0.0.1
    ]) {
      blocked(url)
    }
  })

  it('refuses local names however they are dressed', () => {
    for (const url of [
      'http://localhost/',
      'http://LOCALHOST/',
      'http://localhost./',
      'http://api.localhost/',
      'http://printer.local/',
      'http://metadata.google.internal/',
      'http://intranet/',
    ]) {
      blocked(url)
    }
  })

  it('reads the real host past credentials in the URL', () => {
    // The host is what follows the @, and that is what has to be judged.
    blocked('http://jobs.example.com@127.0.0.1/')
    allowed('http://user:pass@jobs.example.com/')
  })
})

describe('what is not a web page', () => {
  it('refuses every scheme but http and https', () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/x',
      'gopher://example.com/',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
    ]) {
      blocked(url)
    }
  })

  it('refuses nothing, whitespace, non-strings and a URL past the length cap', () => {
    for (const value of ['', '   ', null, undefined, 42, {}, `https://example.com/${'a'.repeat(3000)}`]) {
      expect(rejectReason(value), String(value).slice(0, 30)).not.toBeNull()
    }
  })
})

describe('public postings still pass', () => {
  it('allows ordinary posting URLs, bare hosts and public IPs', () => {
    for (const url of [
      'https://www.linkedin.com/jobs/view/123',
      'jobstreet.com.ph/job/456',
      '  https://careers.acme.com/123  ',
      'HTTPS://BOARDS.GREENHOUSE.IO/acme/jobs/1',
      'http://93.184.216.34/',
      'https://[2606:2800:220:1:248:1893:25c8:1946]/',
      'https://xn--bcher-kva.example/', // punycode
    ]) {
      allowed(url)
    }
  })

  it('does not take a public address that merely starts like a private one', () => {
    // 172.32 is past 172.16/12; 100.128 is past CGNAT's 100.64/10; 11.x is public.
    allowed('http://172.32.0.1/')
    allowed('http://100.128.0.1/')
    allowed('http://11.0.0.1/')
    blocked('http://172.31.255.255/')
    blocked('http://100.64.0.1/')
  })
})
