"use client";

import { sendMagicLink } from "@/app/(public)/login/actions";
import { ActionForm, SubmitButton } from "./forms";
import { Field, Input } from "./ui";

export function MagicLinkForm({ next }: { next: string }) {
  return (
    <ActionForm action={sendMagicLink} className="flex flex-col gap-3">
      {(state) => (
        <>
          <input type="hidden" name="next" value={next} />
          <Field label="Email" htmlFor="email" error={state.errors?.email}>
            <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@gm.uit.edu.vn" />
          </Field>
          <SubmitButton pendingLabel="Sending…">Email me a sign-in link</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
