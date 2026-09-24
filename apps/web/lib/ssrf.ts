import "server-only";
import dns from "node:dns";
import net from "node:net";
import { Agent, fetch, type Response } from "undici";

/** Every range that must never be reachable from a user-supplied URL. */
const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64 — can reach internal IPv4
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 — embeds arbitrary IPv4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(address, prefix, "ipv6");
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** True for addresses in private, loopback, link-local, reserved or mapped ranges. */
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible forms are judged by their IPv4 part.
    const mapped = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return blocked.check(mapped[1]!, "ipv4");
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1]!, 16);
      const lo = parseInt(hexMapped[2]!, 16);
      return blocked.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, "ipv4");
    }
    if (/^::ffff:/i.test(address)) return true;
    return blocked.check(address, "ipv6");
  }
  return true; // not an IP at all: refuse rather than guess
}

/**
 * Static checks on a user-supplied URL: https only, default port, no credentials, and IP literals must
 * be public. Hostnames are checked again at connect time by `guardedLookup` (defeats DNS rebinding).
 */
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Not a valid URL");
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("Only https:// URLs are allowed");
  if (url.username || url.password) throw new UnsafeUrlError("URLs with credentials are not allowed");
  if (url.port && url.port !== "443") throw new UnsafeUrlError("Only the default HTTPS port is allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isBlockedAddress(host)) throw new UnsafeUrlError("Private or reserved addresses are not allowed");
  if (!net.isIP(host) && (!host.includes(".") || /\.(localhost|local|internal|lan|home|corp)$/i.test(host) || host === "localhost")) {
    throw new UnsafeUrlError("Internal host names are not allowed");
  }
  return url;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/** dns.lookup replacement used for every outbound connection: fails if any resolved address is blocked. */
export function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((entry) => isBlockedAddress(entry.address))) {
      const error: NodeJS.ErrnoException = new UnsafeUrlError(`${hostname} resolves to a blocked address`);
      error.code = "EBLOCKED";
      return callback(error, "");
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
}

const agent = new Agent({ connect: { lookup: guardedLookup, timeout: 10_000 }, headersTimeout: 10_000, bodyTimeout: 15_000 });

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  status: number;
  url: string;
  headers: Response["headers"];
  body: string;
}

/**
 * GET a user-supplied URL without letting it reach internal services: every hop is re-validated,
 * redirects are followed manually, DNS answers are checked at connect time, and the body is capped.
 */
export async function safeFetchText(raw: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 3;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 15_000);
  let url = assertSafeUrl(raw);

  for (let hop = 0; ; hop++) {
    const response = await fetch(url, {
      dispatcher: agent,
      redirect: "manual",
      signal,
      headers: { "user-agent": "gnouht-hub/1.0 (+https://hub.gnouht.space)", ...options.headers },
    });

    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      await response.body?.cancel();
      if (hop >= maxRedirects) throw new UnsafeUrlError("Too many redirects");
      url = assertSafeUrl(new URL(response.headers.get("location")!, url).toString());
      continue;
    }

    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
      await response.body?.cancel();
      throw new UnsafeUrlError("Response is too large");
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    if (response.body) {
      for await (const chunk of response.body) {
        received += chunk.byteLength;
        if (received > maxBytes) {
          throw new UnsafeUrlError("Response is too large");
        }
        chunks.push(chunk);
      }
    }
    return {
      status: response.status,
      url: url.toString(),
      headers: response.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    };
  }
}
