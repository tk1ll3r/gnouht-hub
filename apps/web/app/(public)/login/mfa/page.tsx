import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signOut } from "@/app/(app)/actions";
import { MfaCodeForm } from "@/components/security-forms";
import { Card } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Two-step sign-in" };

export default async function MfaPage({ searchParams }: PageProps<"/login/mfa">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.state === "ended") redirect("/auth/ended");
  if (session.state === "ok") redirect(next);
  const { user } = session;

  return (
    <Card className="w-full max-w-sm p-7">
      <h1 className="mb-1 text-[20px] font-semibold tracking-tight">Enter your code</h1>
      <p className="mb-5 text-[14px] text-muted">
        Open your authenticator app and type the 6-digit code for gnouht hub ({user.email}).
      </p>
      <MfaCodeForm next={next} />
      <form action={signOut} className="mt-5">
        <button className="text-[13px] text-muted hover:text-danger">Sign out and use another account</button>
      </form>
    </Card>
  );
}
