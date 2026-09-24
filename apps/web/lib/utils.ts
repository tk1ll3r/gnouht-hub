import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Result returned by every form Server Action: shaped for the UI, never raw database rows. */
export interface ActionState {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[] | undefined>;
}

export const initialActionState: ActionState = {};
