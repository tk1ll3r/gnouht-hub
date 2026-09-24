import "server-only";
import { z } from "zod";

const optional = z.string().trim().min(1).optional().catch(undefined);

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20),
  /** Public origin of the app, e.g. https://hub.gnouht.space (no trailing slash). */
  APP_URL: z.url().transform((url) => url.replace(/\/+$/, "")),
  /** 32 random bytes, base64 — encrypts OAuth refresh tokens and secret calendar URLs. */
  APP_ENC_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "APP_ENC_KEY must be 32 random bytes in base64"),
  APP_ENC_KEY_VERSION: z.coerce.number().int().min(1).max(999).default(1),
  /** Previous key kept during rotation so existing ciphertexts stay readable. */
  APP_ENC_KEY_PREVIOUS: z.string().regex(/^[A-Za-z0-9+/]{43}=$/).optional().catch(undefined),
  APP_ENC_KEY_PREVIOUS_VERSION: z.coerce.number().int().min(1).max(999).optional().catch(undefined),
  /** Bearer secret for /api/cron/* (called by pg_cron). */
  CRON_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  RESEND_API_KEY: optional,
  EMAIL_FROM: z.string().default("gnouht hub <noreply@gnouht.space>"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated server environment. Throws a readable error listing every missing/invalid variable. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
      throw new Error(`Invalid server environment — ${problems}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function googleConfigured(): boolean {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env();
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}
