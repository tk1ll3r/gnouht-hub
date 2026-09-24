import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { maskLabel, pairRequestSchema, SIGNATURE_HEADERS, signedHeaders, verifySignature } from "./protocol";

const secret = randomBytes(32).toString("base64url");
const body = JSON.stringify({ hello: "world" });

function verify(headers: Record<string, string>, overrides: Partial<{ method: string; path: string; body: string; secret: string }> = {}, now = Date.now()) {
  return verifySignature(
    overrides.secret ?? secret,
    {
      method: overrides.method ?? "POST",
      path: overrides.path ?? "/api/agent/quota",
      body: overrides.body ?? body,
      timestamp: headers[SIGNATURE_HEADERS.timestamp] ?? null,
      nonce: headers[SIGNATURE_HEADERS.nonce] ?? null,
      signature: headers[SIGNATURE_HEADERS.signature] ?? null,
    },
    now,
  );
}

describe("request signing", () => {
  const headers = signedHeaders("device-1", secret, "POST", "/api/agent/quota", body);

  it("accepts an untouched request", () => {
    expect(verify(headers)).toBeNull();
    expect(headers[SIGNATURE_HEADERS.device]).toBe("device-1");
  });

  it.each([
    ["body", { body: '{"hello":"mallory"}' }],
    ["path", { path: "/api/agent/uit" }],
    ["method", { method: "GET" }],
    ["secret", { secret: randomBytes(32).toString("base64url") }],
  ])("rejects a changed %s", (_label, overrides) => {
    expect(verify(headers, overrides)).toBe("bad_signature");
  });

  it("rejects stale or future timestamps", () => {
    expect(verify(headers, {}, Date.now() + 6 * 60_000)).toBe("stale");
    const old = signedHeaders("device-1", secret, "POST", "/api/agent/quota", body, Date.now() - 10 * 60_000);
    expect(verify(old)).toBe("stale");
  });

  it("rejects missing or malformed headers", () => {
    expect(verify({ ...headers, [SIGNATURE_HEADERS.signature]: "" })).toBe("missing_headers");
    expect(verify({ ...headers, [SIGNATURE_HEADERS.nonce]: "short" })).toBe("missing_headers");
    expect(verify({ ...headers, [SIGNATURE_HEADERS.signature]: "zz" })).toBe("bad_signature");
  });

  it("uses a fresh nonce per request", () => {
    const again = signedHeaders("device-1", secret, "POST", "/api/agent/quota", body);
    expect(again[SIGNATURE_HEADERS.nonce]).not.toBe(headers[SIGNATURE_HEADERS.nonce]);
  });
});

describe("pairRequestSchema", () => {
  it("normalises codes and rejects ambiguous characters", () => {
    expect(pairRequestSchema.parse({ code: "abcd2345", name: "PC", platform: "win32", agentVersion: "0.1.0" }).code).toBe("ABCD2345");
    expect(pairRequestSchema.safeParse({ code: "ABCD0O1I", name: "PC", platform: "win32", agentVersion: "0.1.0" }).success).toBe(false);
  });
});

describe("maskLabel", () => {
  it("hides most of an email local part", () => {
    expect(maskLabel("nguyenvana@gmail.com")).toBe("ng…@gmail.com");
    expect(maskLabel("Work account")).toBe("Work account");
  });
});
