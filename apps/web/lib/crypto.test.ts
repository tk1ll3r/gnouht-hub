import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, needsReencryption, safeEqual, type KeyRing } from "./crypto";

const ring = (): KeyRing => ({ current: { version: 2, key: randomBytes(32) }, previous: { version: 1, key: randomBytes(32) } });

describe("encryptSecret / decryptSecret", () => {
  const keys = ring();

  it("round-trips and produces a fresh IV each time", () => {
    const a = encryptSecret("refresh-token-123", "calendar:abc", keys);
    const b = encryptSecret("refresh-token-123", "calendar:abc", keys);
    expect(a).not.toBe(b);
    expect(a.startsWith("v2.")).toBe(true);
    expect(decryptSecret(a, "calendar:abc", keys)).toBe("refresh-token-123");
  });

  it("fails when the ciphertext is moved to another row (AAD mismatch)", () => {
    const sealed = encryptSecret("secret", "calendar:abc", keys);
    expect(() => decryptSecret(sealed, "calendar:xyz", keys)).toThrow();
  });

  it("fails on any tampering", () => {
    const sealed = encryptSecret("secret", "calendar:abc", keys);
    const parts = sealed.split(".");
    const flipped = Buffer.from(parts[3]!, "base64url");
    flipped[0] = flipped[0]! ^ 1;
    parts[3] = flipped.toString("base64url");
    expect(() => decryptSecret(parts.join("."), "calendar:abc", keys)).toThrow();
    expect(() => decryptSecret("v2.bad", "calendar:abc", keys)).toThrow(/Malformed/);
  });

  it("decrypts ciphertexts from the previous key during rotation and flags them", () => {
    const old: KeyRing = { current: keys.previous! };
    const sealed = encryptSecret("legacy", "calendar:abc", old);
    expect(decryptSecret(sealed, "calendar:abc", keys)).toBe("legacy");
    expect(needsReencryption(sealed, keys)).toBe(true);
    expect(() => decryptSecret(sealed.replace(/^v1/, "v9"), "calendar:abc", keys)).toThrow(/No key/);
  });
});

describe("safeEqual", () => {
  it("compares in constant time regardless of length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
