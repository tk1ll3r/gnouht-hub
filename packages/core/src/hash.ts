const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;
const encoder = new TextEncoder();

/**
 * 64-bit FNV-1a as 16 hex chars. Used for stable, non-secret identity keys (e.g. a checklist line)
 * where a dependency-free hash that also runs in the browser is preferable to node:crypto.
 */
export function stableHash(input: string): string {
  let hash = FNV_OFFSET;
  for (const byte of encoder.encode(input)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Canonical text for identity comparisons: NFC, lower-case, single spaces. */
export function normalizeForKey(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}
