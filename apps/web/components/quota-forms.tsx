"use client";

import { saveManualQuota } from "@/app/(app)/quota/actions";
import { ActionForm, SubmitButton } from "./forms";
import { Field, Input } from "./ui";

export function ManualQuotaForm({ quota }: { quota?: { id: string; name: string; unit: string; used: number; limit_value: number; resets_on: string | null } }) {
  return (
    <ActionForm action={saveManualQuota} resetOnSuccess={!quota} hideSuccess className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {(state) => (
        <>
          {quota ? <input type="hidden" name="id" value={quota.id} /> : null}
          <Field label="Name" htmlFor={`mq-name-${quota?.id ?? "new"}`} error={state.errors?.name} className="col-span-2 sm:col-span-4">
            <Input id={`mq-name-${quota?.id ?? "new"}`} name="name" defaultValue={quota?.name} placeholder="Kaggle GPU" required />
          </Field>
          <Field label="Used" htmlFor={`mq-used-${quota?.id ?? "new"}`} error={state.errors?.used}>
            <Input id={`mq-used-${quota?.id ?? "new"}`} name="used" type="number" step="0.1" min={0} defaultValue={quota?.used ?? 0} />
          </Field>
          <Field label="Limit" htmlFor={`mq-limit-${quota?.id ?? "new"}`} error={state.errors?.limit_value}>
            <Input id={`mq-limit-${quota?.id ?? "new"}`} name="limit_value" type="number" step="0.1" min={0.1} defaultValue={quota?.limit_value ?? 30} />
          </Field>
          <Field label="Unit" htmlFor={`mq-unit-${quota?.id ?? "new"}`} error={state.errors?.unit}>
            <Input id={`mq-unit-${quota?.id ?? "new"}`} name="unit" defaultValue={quota?.unit ?? "hours"} />
          </Field>
          <Field label="Resets" htmlFor={`mq-reset-${quota?.id ?? "new"}`} error={state.errors?.resets_on}>
            <Input id={`mq-reset-${quota?.id ?? "new"}`} name="resets_on" type="date" defaultValue={quota?.resets_on ?? ""} />
          </Field>
          <div className="col-span-2 sm:col-span-4">
            <SubmitButton size="sm" variant={quota ? "secondary" : "primary"}>
              {quota ? "Update" : "Add quota"}
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
