"use client";

import { useEffect, type ReactNode } from "react";
import { clearLocalState } from "@/lib/local-state";

/** A sign-out form that also forgets this browser's recent files and tabs before the session ends. */
export function SignOutForm({ action, className, children }: { action: () => Promise<void>; className?: string; children: ReactNode }) {
  return (
    <form action={action} onSubmit={clearLocalState} className={className}>
      {children}
    </form>
  );
}

/** Rendered on the sign-in page: nobody is signed in here, so nothing from a previous session should linger. */
export function ClearLocalState() {
  useEffect(() => clearLocalState(), []);
  return null;
}
