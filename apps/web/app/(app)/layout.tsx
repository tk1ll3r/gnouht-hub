import { LogOut } from "lucide-react";
import Link from "next/link";
import { PaletteButton, PaletteProvider } from "@/components/command-palette";
import { NavLinks, type NavItem } from "@/components/nav";
import { SignOutForm } from "@/components/sign-out-form";
import { requireUser } from "@/lib/auth";
import { signOut } from "./actions";

const NAV: NavItem[] = [
  { href: "/today", label: "Today", icon: "today" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/courses", label: "Courses", icon: "courses" },
  { href: "/tasks", label: "Tasks", icon: "tasks" },
  { href: "/projects", label: "Projects", icon: "projects" },
  { href: "/groups", label: "Groups", icon: "groups" },
  { href: "/docs", label: "Search", icon: "docs" },
  { href: "/quota", label: "AI quota", icon: "quota" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

function Wordmark({ className }: { className?: string }) {
  return <span className={`font-hand text-[19px] leading-none text-accent ${className ?? ""}`}>gnouht hub</span>;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();

  return (
    <PaletteProvider userKey={user.id.slice(0, 8)} signOutAction={signOut}>
    <div className="min-h-dvh lg:grid lg:grid-cols-[216px_minmax(0,1fr)]">
      {/* The notebook's red margin line runs the full height between the index and the page. */}
      <aside className="hidden border-r-[1.5px] border-margin lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:py-6 lg:pr-3 lg:pl-5">
        <Link href="/today" className="mb-6 block px-2 py-1" aria-label="gnouht hub, go to Today">
          <Wordmark />
        </Link>
        <PaletteButton className="mb-4" />
        <NavLinks items={NAV} />
        <div className="mt-auto pt-3">
          <p className="truncate px-2 text-[12px] text-muted" title={user.email ?? undefined}>
            {user.email}
          </p>
          <SignOutForm action={signOut}>
            <button className="mt-1 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-muted hover:text-danger">
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </SignOutForm>
        </div>
      </aside>

      <header className="sticky top-0 z-10 flex items-center gap-3 border-b-[1.5px] border-margin bg-bg/95 px-3 py-2 backdrop-blur lg:hidden">
        <Link href="/today" className="shrink-0" aria-label="gnouht hub, go to Today">
          <Wordmark className="text-[16px]" />
        </Link>
        <div className="min-w-0 flex-1">
          <NavLinks items={NAV} orientation="horizontal" />
        </div>
        <SignOutForm action={signOut}>
          <button className="rounded-md p-1.5 text-muted hover:text-danger" aria-label="Sign out">
            <LogOut className="size-4" aria-hidden />
          </button>
        </SignOutForm>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 lg:py-10">{children}</main>
    </div>
    </PaletteProvider>
  );
}
