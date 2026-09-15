/**
 * SSRF guard for fetch_url — blocks private/reserved IP ranges and limits redirects.
 */

import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_IPV4_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    return BLOCKED_IPV4_RANGES.some((re) => re.test(ip));
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (normalized.startsWith("fe80")) return true;
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.slice(7);
      return BLOCKED_IPV4_RANGES.some((re) => re.test(mapped));
    }
  }
  return false;
}

export async function assertSafeFetchUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("invalid_url");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("unsupported_protocol");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("blocked_host");
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new Error("blocked_ip");
    return parsed;
  }

  const addresses = await dns.lookup(hostname, { all: true });
  for (const addr of addresses) {
    if (isBlockedIp(addr.address)) throw new Error("blocked_ip");
  }

  return parsed;
}

export async function safeFetch(
  rawUrl: string,
  init?: RequestInit & { maxRedirects?: number; maxBytes?: number },
): Promise<Response> {
  const maxRedirects = init?.maxRedirects ?? 3;
  const maxBytes = init?.maxBytes ?? 8000;
  let currentUrl = rawUrl;

  for (let i = 0; i <= maxRedirects; i++) {
    await assertSafeFetchUrl(currentUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(currentUrl, {
      ...init,
      signal: controller.signal,
      redirect: "manual",
    });
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location || i >= maxRedirects) throw new Error("too_many_redirects");
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }

    const ct = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    const trimmed = raw.slice(0, maxBytes);
    return new Response(trimmed, { status: res.status, headers: { "content-type": ct } });
  }

  throw new Error("too_many_redirects");
}
