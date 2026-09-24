import type { Metadata } from "next";
import { SubmitButton } from "@/components/forms";
import { MagicLinkForm } from "@/components/login-form";
import { Card } from "@/components/ui";
import { googleConfigured } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";
import { signInWithGoogle } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  invite: "This hub is invite-only. Ask the owner to invite your email address first.",
  link: "That sign-in link is invalid or has expired. Request a new one.",
  oauth: "Google sign-in could not be started. Try again or use an email link.",
  denied: "Sign-in was cancelled.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  const errorKey = typeof params.error === "string" ? params.error : null;
  const error = errorKey ? (ERRORS[errorKey] ?? ERRORS.link) : null;
  const deleted = params.deleted === "1";
  const ended = params.ended === "1";

  return (
    <Card className="w-full max-w-sm p-7">
      <div className="mb-7">
        <h1 className="mb-4 font-hand text-[30px] leading-[3.25rem] text-accent">gnouht hub</h1>
        <p className="text-[14px] text-muted">Your semester in one notebook: classes, deadlines, projects and study groups.</p>
      </div>

      {deleted ? (
        <p role="status" className="mb-4 rounded-lg bg-ok-soft px-3 py-2 text-[13px] text-ok">
          Your account and everything in it were deleted.
        </p>
      ) : null}
      {ended ? (
        <p role="status" className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          This browser was signed out, because the session was ended (for example with “Sign out everywhere”). Sign in again.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      {googleConfigured() ? (
        <>
          <form action={signInWithGoogle}>
            <input type="hidden" name="next" value={next} />
            <SubmitButton variant="secondary" className="w-full" pendingLabel="Redirecting…">
              <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
                <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z" />
                <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.8l4-3z" />
                <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
              </svg>
              Continue with Google
            </SubmitButton>
          </form>
          <div className="my-4 flex items-center gap-3 text-[12px] text-muted">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}

      <MagicLinkForm next={next} />

      <p className="mt-6 text-[12px] leading-relaxed text-muted">
        Registration is invite-only. Nothing you add is visible to anyone else unless you share it with a group.
      </p>
    </Card>
  );
}
