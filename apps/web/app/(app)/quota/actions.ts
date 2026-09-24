"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/lib/utils";
import { fieldErrors, formObject, uuid } from "@/lib/validation";

const manualQuotaSchema = z.object({
  name: z.string().trim().min(1, "Required").max(60),
  unit: z.string().trim().min(1).max(20),
  used: z.coerce.number().min(0).max(1e6),
  limit_value: z.coerce.number().positive("Must be positive").max(1e6),
  resets_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal(""))
    .transform((v) => v || null),
});

export async function saveManualQuota(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireUser();
  const parsed = manualQuotaSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const id = uuid.safeParse(formData.get("id"));
  const { error } = id.success
    ? await supabase.from("manual_quotas").update(parsed.data).eq("id", id.data)
    : await supabase.from("manual_quotas").insert(parsed.data);
  if (error) return { message: "Could not save the quota." };
  refresh();
  return { ok: true, message: "Saved." };
}

export async function deleteManualQuota(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  await supabase.from("manual_quotas").delete().eq("id", id.data);
  refresh();
}
