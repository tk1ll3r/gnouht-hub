import { LogOut } from "lucide-react";
import Link from "next/link";
import { NavLinks, type NavItem } from "@/components/nav";
import { requireUser } from "@/lib/auth";
import { signOut } from "./actions";

const NAV: NavItem[] = [
  { href: "/today", label: "Today", icon: "today" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/courses", label: "Courses", icon: "courses" },
  { href: "/tasks", label: "Tasks", icon: "tasks" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="hidden border-r border-border bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:px-3 lg:py-4">
        <Link href="/today" className="mb-5 flex items-center gap-2 px-2.5 text-sm font-semibold">
          <svg viewBox="0 0 64 64" className="size-6" aria-hidden>
            <rect width="64" height="64" rx="14" className="fill-accent" />
            <path d="M20 22h24M20 32h16M20 42h10" stroke="white" strokeWidth="6" strokeLinecap="round" />
          </svg>
          gnouht hub
        </Link>
        <NavLinks items={NAV} />
        <div className="mt-auto border-t border-border pt-3">
          <p className="truncate px-2.5 text-[12px] text-muted" title={user.email ?? undefined}>
            {user.email}
          </p>
          <form action={signOut}>
            <button className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text">
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface/95 px-3 py-2 backdrop-blur lg:hidden">
        <Link href="/today" className="mr-1 shrink-0" aria-label="gnouht hub">
          <svg viewBox="0 0 64 64" className="size-6" aria-hidden>
            <rect width="64" height="64" rx="14" className="fill-accent" />
            <path d="M20 22h24M20 32h16M20 42h10" stroke="white" strokeWidth="6" strokeLinecap="round" />
          </svg>
        </Link>
        <div className="min-w-0 flex-1">
          <NavLinks items={NAV} orientation="horizontal" />
        </div>
        <form action={signOut}>
          <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="Sign out">
            <LogOut className="size-4" aria-hidden />
          </button>
        </form>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}
