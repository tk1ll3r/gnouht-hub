"use client";

import { useActionState } from "react";
import { createPairingCode } from "@/app/(app)/settings/device-actions";
import { initialActionState } from "@/lib/utils";
import { SubmitButton } from "./forms";

export function DevicePairing() {
  const [state, action] = useActionState(createPairingCode, initialActionState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-[13px] text-muted">
        On your PC run <code className="rounded bg-surface-2 px-1 font-mono">npx hub-agent pair</code> and enter the code below. It works once and expires in 10 minutes.
      </p>
      {state.ok && state.message ? (
        <p className="font-mono text-2xl font-semibold tracking-[0.3em]" aria-live="polite">
          {state.message.slice(0, 4)}-{state.message.slice(4)}
        </p>
      ) : state.message ? (
        <p className="text-[13px] text-danger">{state.message}</p>
      ) : null}
      <div>
        <SubmitButton variant="secondary" pendingLabel="Creating…">
          {state.ok ? "New code" : "Pair a device"}
        </SubmitButton>
      </div>
    </form>
  );
}
