// Agent ↔ cloud protocol: request signing and payload schemas. Node-only (uses node:crypto), so it is
// exported separately as "@hub/core/protocol" and never pulled into browser bundles.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { DOCUMENT_KINDS, isSafeRelativePath, MAX_DOCUMENT_CHARS } from "./documents";

export const SIGNATURE_HEADERS = {
  device: "x-hub-device",
  timestamp: "x-hub-timestamp",
  nonce: "x-hub-nonce",
  signature: "x-hub-signature",
} as const;

/** Requests older or newer than this are rejected (clock skew + replay window). */
export const MAX_SKEW_MS = 5 * 60_000;

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Canonical string: method, path (with query), timestamp, nonce and body hash, one per line. */
export function canonicalRequest(method: string, path: string, timestamp: string, nonce: string, body: string): string {
  return [method.toUpperCase(), path, timestamp, nonce, sha256Hex(body)].join("\n");
}

export function sign(secret: string, canonical: string): string {
  return createHmac("sha256", Buffer.from(secret, "base64url")).update(canonical).digest("hex");
}

export function signedHeaders(deviceId: string, secret: string, method: string, path: string, body: string, now = Date.now()): Record<string, string> {
  const timestamp = String(now);
  const nonce = randomBytes(16).toString("base64url");
  return {
    [SIGNATURE_HEADERS.device]: deviceId,
    [SIGNATURE_HEADERS.timestamp]: timestamp,
    [SIGNATURE_HEADERS.nonce]: nonce,
    [SIGNATURE_HEADERS.signature]: sign(secret, canonicalRequest(method, path, timestamp, nonce, body)),
  };
}

export type VerifyFailure = "missing_headers" | "stale" | "bad_signature";

/** Checks timestamp window and signature in constant time. Nonce uniqueness is checked by the caller (DB). */
export function verifySignature(
  secret: string,
  input: { method: string; path: string; body: string; timestamp: string | null; nonce: string | null; signature: string | null },
  now = Date.now(),
): VerifyFailure | null {
  const { timestamp, nonce, signature } = input;
  if (!timestamp || !nonce || !signature || !/^\d{10,16}$/.test(timestamp) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) {
    return "missing_headers";
  }
  if (Math.abs(now - Number(timestamp)) > MAX_SKEW_MS) return "stale";
  const expected = Buffer.from(sign(secret, canonicalRequest(input.method, input.path, timestamp, nonce, input.body)), "hex");
  const given = Buffer.from(/^[0-9a-f]{64}$/.test(signature) ? signature : "", "hex");
  return given.length === expected.length && timingSafeEqual(given, expected) ? null : "bad_signature";
}

// ── payloads ────────────────────────────────────────────────────────────────

export const pairRequestSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-HJ-NP-Z2-9]{8}$/, "Pairing codes are 8 characters"),
  name: z.string().trim().min(1).max(60),
  platform: z.string().max(40),
  agentVersion: z.string().max(20),
});
export type PairRequest = z.infer<typeof pairRequestSchema>;

export const pairResponseSchema = z.object({ deviceId: z.uuid(), secret: z.string().min(40) });

export const heartbeatSchema = z.object({
  agentVersion: z.string().max(20),
  ninerouter: z.object({ reachable: z.boolean(), loggedIn: z.boolean() }),
  documents: z
    .object({
      folders: z.number().int().min(0).max(100),
      lastSyncAt: z.iso.datetime({ offset: true }).nullable(),
      errors: z.array(z.string().max(200)).max(10),
    })
    .optional(),
});

const finiteOrNull = z.number().finite().nullable();

export const quotaWindowSchema = z.object({
  /** Provider connection id inside 9router (opaque). */
  connectionId: z.string().min(1).max(100),
  provider: z.string().min(1).max(60),
  /** Masked label, e.g. "ng…@gmail.com" or the connection name. */
  accountLabel: z.string().max(120),
  plan: z.string().max(80).nullable(),
  window: z.string().min(1).max(60),
  used: finiteOrNull,
  total: finiteOrNull,
  remainingPct: z.number().min(0).max(100).nullable(),
  resetAt: z.iso.datetime({ offset: true }).nullable(),
  unlimited: z.boolean(),
});
export type QuotaWindow = z.infer<typeof quotaWindowSchema>;

export const usageRowSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  provider: z.string().min(1).max(60),
  model: z.string().min(1).max(120),
  requests: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  costUsd: z.number().min(0),
});
export type UsageRow = z.infer<typeof usageRowSchema>;

export const quotaPayloadSchema = z.object({
  capturedAt: z.iso.datetime({ offset: true }),
  windows: z.array(quotaWindowSchema).max(200),
  usage: z.array(usageRowSchema).max(500),
  errors: z.array(z.string().max(200)).max(50).default([]),
});
export type QuotaPayload = z.infer<typeof quotaPayloadSchema>;

export const uitCourseSchema = z.object({
  moodleCourseId: z.number().int().positive(),
  code: z.string().regex(/^[A-Za-z0-9._-]{2,20}$/),
  classCode: z.string().max(40).nullable(),
  name: z.string().min(1).max(160),
  url: z.url().max(500).nullable(),
});
export const uitDeadlineSchema = z.object({
  eventId: z.number().int().positive(),
  moodleCourseId: z.number().int().positive().nullable(),
  title: z.string().min(1).max(300),
  dueAt: z.iso.datetime({ offset: true }),
  url: z.url().max(500).nullable(),
  kind: z.enum(["task", "assignment", "quiz", "exam", "report", "milestone"]),
});
export const uitPayloadSchema = z.object({
  source: z.enum(["moodle_ws"]),
  courses: z.array(uitCourseSchema).max(40),
  deadlines: z.array(uitDeadlineSchema).max(500),
});
export type UitPayload = z.infer<typeof uitPayloadSchema>;

// ── project documents ───────────────────────────────────────────────────────

export const MAX_PROJECT_FILES = 1000;
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const relativePathSchema = z.string().refine(isSafeRelativePath, "invalid relative path");

/** Step 1: the agent lists every indexable file of a watched folder (path + content hash). */
export const projectSyncSchema = z.object({
  /** sha256 of the folder's normalised absolute path: recognises the folder without revealing it. */
  folderKey: sha256Schema,
  name: z.string().trim().min(1).max(120),
  /** Last path segments only, for display ("…/Research/IDS"). */
  folderLabel: z.string().max(200),
  manifest: z
    .array(z.object({ path: relativePathSchema, hash: sha256Schema }))
    .max(MAX_PROJECT_FILES)
    .refine((files) => new Set(files.map((f) => f.path)).size === files.length, "duplicate paths"),
});
export type ProjectSync = z.infer<typeof projectSyncSchema>;
export const projectSyncResponseSchema = z.object({
  projectId: z.uuid(),
  archived: z.boolean(),
  /** Paths whose stored hash differs. The agent intersects this with its own listing before reading anything. */
  need: z.array(z.string()),
});

export const documentUploadSchema = z.object({
  projectId: z.uuid(),
  documents: z
    .array(
      z.object({
        path: relativePathSchema,
        kind: z.enum(DOCUMENT_KINDS),
        hash: sha256Schema,
        sizeBytes: z.number().int().min(0).max(200 * 1024 * 1024),
        modifiedAt: z.iso.datetime({ offset: true }),
        /** Extracted text, secrets already redacted on the PC. Empty when extraction failed. */
        text: z.string().max(MAX_DOCUMENT_CHARS),
        truncated: z.boolean(),
        /** Secrets the agent removed (the hub redacts again and adds its own count). */
        redactions: z.number().int().min(0).max(100_000).default(0),
        error: z.string().max(200).nullable(),
      }),
    )
    .min(1)
    .max(50),
});
export type DocumentUpload = z.infer<typeof documentUploadSchema>;

/** Masks an email-like label: "nguyenvana@gmail.com" → "ng…@gmail.com". */
export function maskLabel(label: string): string {
  const at = label.indexOf("@");
  if (at > 0) return `${label.slice(0, Math.min(2, at))}…${label.slice(at)}`.slice(0, 120);
  return label.slice(0, 120);
}
