"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cn, initialActionState, type ActionState } from "@/lib/utils";
import { buttonClass } from "./ui";

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, size, className)}>
      {pending ? (pendingLabel ?? "Saving…") : children}
    </button>
  );
}

/**
 * Form bound to a Server Action with `useActionState`. Field errors are passed to children via a
 * render prop; the general message is shown under the form. Optionally resets after success.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  hideSuccess = false,
}: {
  action: FormAction;
  children: (state: ActionState) => ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  hideSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={formRef} action={formAction} className={className}>
      {children(state)}
      {state.message && !(state.ok && hideSuccess) ? (
        <p role="status" className={cn("mt-2 text-[13px]", state.ok ? "text-ok" : "text-danger")}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Small inline form for one-click actions (toggle, delete). With `confirm`, the first click arms the
 * button ("Confirm?") and only a second click within a few seconds submits — no blocking dialogs.
 */
export function InlineAction({
  action,
  fields,
  children,
  confirm,
  variant = "ghost",
  size = "sm",
  title,
  className,
}: {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  children: ReactNode;
  confirm?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  title?: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (confirm && !armed) {
          event.preventDefault();
          setArmed(true);
        }
      }}
      className="inline-flex"
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton variant={armed ? "danger" : variant} size={size} className={className} pendingLabel="…">
        <span title={armed ? confirm : title}>{armed ? "Confirm?" : children}</span>
      </SubmitButton>
    </form>
  );
}
