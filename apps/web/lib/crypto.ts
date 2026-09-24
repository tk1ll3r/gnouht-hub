import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

export interface KeyRing {
  current: { version: number; key: Buffer };
  previous?: { version: number; key: Buffer };
}

function decodeKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("Encryption keys must be exactly 32 bytes");
  return key;
}

export function keyRingFromEnv(): KeyRing {
  const e = env();
  const ring: KeyRing = { current: { version: e.APP_ENC_KEY_VERSION, key: decodeKey(e.APP_ENC_KEY) } };
  if (e.APP_ENC_KEY_PREVIOUS && e.APP_ENC_KEY_PREVIOUS_VERSION) {
    ring.previous = { version: e.APP_ENC_KEY_PREVIOUS_VERSION, key: decodeKey(e.APP_ENC_KEY_PREVIOUS) };
  }
  return ring;
}

/**
 * AES-256-GCM. The associated data binds a ciphertext to the row it belongs to (e.g. `calendar:<id>`),
 * so a ciphertext copied into another row fails authentication instead of decrypting.
 * Format: `v<keyVersion>.<iv>.<tag>.<ciphertext>` (base64url parts).
 */
export function encryptSecret(plaintext: string, aad: string, ring: KeyRing = keyRingFromEnv()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ring.current.key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v" + ring.current.version, iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptSecret(payload: string, aad: string, ring: KeyRing = keyRingFromEnv()): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || !/^v\d+$/.test(parts[0]!)) throw new Error("Malformed ciphertext");
  const version = Number(parts[0]!.slice(1));
  const entry = [ring.current, ring.previous].find((k) => k?.version === version);
  if (!entry) throw new Error(`No key for ciphertext version ${version}`);
  const [iv, tag, ciphertext] = parts.slice(1).map((part) => Buffer.from(part, "base64url"));
  if (iv!.length !== 12 || tag!.length !== 16) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", entry.key, iv!);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(ciphertext!), decipher.final()]).toString("utf8");
}

/** True when the ciphertext was produced with an older key and should be re-encrypted. */
export function needsReencryption(payload: string, ring: KeyRing = keyRingFromEnv()): boolean {
  return !payload.startsWith(`v${ring.current.version}.`);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Random URL-safe token with `bytes` bytes of entropy (default 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Constant-time string comparison (hashing first equalises lengths). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}
