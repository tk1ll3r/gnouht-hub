"use client";

import { useActionState } from "react";
import { verifyMfaCode } from "@/app/(public)/login/mfa/actions";
import { confirmMfaEnrollment, deleteAccount, startMfaEnrollment, type EnrollState } from "@/app/(app)/settings/security-actions";
import { initialActionState } from "@/lib/utils";
import { SubmitButton } from "./forms";
import { Field, Input } from "./ui";

function CodeInput({ id, error }: { id: string; error?: string[] }) {
  return (
    <Field label="Code" htmlFor={id} error={error}>
      <Input
        id={id}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        placeholder="123456"
        className="w-40 text-center text-lg tracking-[0.35em] tabular-nums"
      />
    </Field>
  );
}

export function MfaCodeForm({ next }: { next: string }) {
  const [state, action] = useActionState(verifyMfaCode, initialActionState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <CodeInput id="mfa-code" error={state.errors?.code} />
      {state.message ? <p className="text-[13px] text-danger">{state.message}</p> : null}
      <div>
        <SubmitButton pendingLabel="Checking…">Continue</SubmitButton>
      </div>
    </form>
  );
}

/** Two steps in one card: get a QR code, then confirm it with the first code from the app. */
export function MfaEnrollment() {
  const [started, start] = useActionState<EnrollState>(startMfaEnrollment, {});
  const [confirmed, confirm] = useActionState<EnrollState, FormData>(confirmMfaEnrollment, {});
  if (confirmed.ok) return <p className="text-sm text-ok">{confirmed.message}</p>;
  if (!started.factorId) {
    return (
      <form action={start} className="flex flex-col gap-2">
        <p className="text-[13.5px] text-muted">
          After the email link, the hub will also ask for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 2FAS…). A stolen email link alone then opens nothing.
        </p>
        {started.message ? <p className="text-[13px] text-danger">{started.message}</p> : null}
        <div>
          <SubmitButton variant="secondary" pendingLabel="Preparing…">
            Set up two-step sign-in
          </SubmitButton>
        </div>
      </form>
    );
  }
  return (
    <form action={confirm} className="flex flex-wrap items-start gap-5">
      <input type="hidden" name="factor_id" value={started.factorId} />
      {/* The QR code is an SVG data URI returned by Supabase Auth (CSP allows data: images). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={started.qr} alt="QR code for your authenticator app" width={160} height={160} className="rounded-lg border border-border bg-white p-2" />
      <div className="flex min-w-56 flex-1 flex-col gap-3">
        <p className="text-[13.5px]">Scan the code with your authenticator app, or type this key:</p>
        <code className="w-fit rounded bg-surface-2 px-2 py-1 font-mono text-[13px] break-all select-all">{started.secret}</code>
        <CodeInput id="mfa-enroll-code" error={confirmed.errors?.code} />
        {confirmed.message ? <p className="text-[13px] text-danger">{confirmed.message}</p> : null}
        <div>
          <SubmitButton pendingLabel="Checking…">Turn on</SubmitButton>
        </div>
      </div>
    </form>
  );
}

export function DeleteAccountForm({ email }: { email: string }) {
  const [state, action] = useActionState(deleteAccount, initialActionState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <p className="text-[13.5px] text-muted">
        Deletes your courses, tasks, projects, documents, calendars, devices and AI history for good. Groups you own pass to another member. This cannot be undone.
      </p>
      <Field label={`Type ${email} to confirm`} htmlFor="confirm-email" error={state.errors?.confirm_email}>
        <Input id="confirm-email" name="confirm_email" autoComplete="off" className="max-w-sm" />
      </Field>
      {state.message ? <p className="text-[13px] text-danger">{state.message}</p> : null}
      <div>
        <SubmitButton variant="danger" pendingLabel="Deleting…">
          Delete my account
        </SubmitButton>
      </div>
    </form>
  );
}
