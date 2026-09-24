import { describe, expect, it } from "vitest";
import { assertSafeUrl, guardedLookup, isBlockedAddress, safeFetchText, UnsafeUrlError } from "./ssrf";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::",
    "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "172.32.0.1", "142.250.72.14", "2606:4700::6810:64d7", "::ffff:8.8.8.8"])("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe("assertSafeUrl", () => {
  it("accepts a normal https calendar URL", () => {
    expect(assertSafeUrl("https://courses.uit.edu.vn/calendar/export_execute.php?userid=1&authtoken=x").hostname).toBe(
      "courses.uit.edu.vn",
    );
  });

  it.each([
    ["http://example.com/cal.ics", /https/],
    ["ftp://example.com/cal.ics", /https/],
    ["https://user:pass@example.com/cal.ics", /credentials/],
    ["https://example.com:8443/cal.ics", /port/],
    ["https://127.0.0.1/cal.ics", /Private/],
    ["https://[::1]/cal.ics", /Private/],
    ["https://[::ffff:10.0.0.1]/cal.ics", /Private/],
    ["https://169.254.169.254/latest/meta-data", /Private/],
    ["https://localhost/cal.ics", /Internal/],
    ["https://intranet/cal.ics", /Internal/],
    ["https://printer.local/cal.ics", /Internal/],
    ["not a url", /valid/],
  ])("rejects %s", (url, message) => {
    expect(() => assertSafeUrl(url)).toThrow(message);
  });
});

describe("guardedLookup", () => {
  it("refuses hostnames that resolve to loopback (DNS-rebinding style)", async () => {
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      guardedLookup("localhost", {}, (err) => resolve(err)),
    );
    expect(error).toBeInstanceOf(UnsafeUrlError);
    expect(error?.code).toBe("EBLOCKED");
  });
});

describe("safeFetchText", () => {
  it("rejects unsafe URLs before any network access", async () => {
    await expect(safeFetchText("https://127.0.0.1/x.ics")).rejects.toThrow(UnsafeUrlError);
    await expect(safeFetchText("http://example.com/x.ics")).rejects.toThrow(UnsafeUrlError);
  });
});
