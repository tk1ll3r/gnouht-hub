"use client";

import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  FolderKanban,
  Gauge,
  Search,
  Settings,
  Sparkles,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}

const ICONS = {
  today: Sun,
  calendar: CalendarDays,
  courses: BookOpen,
  tasks: CheckSquare,
  projects: FolderKanban,
  groups: Users,
  docs: Search,
  quota: Gauge,
  ai: Sparkles,
  settings: Settings,
} satisfies Record<string, LucideIcon>;

export function NavLinks({ items, orientation = "vertical" }: { items: NavItem[]; orientation?: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  const vertical = orientation === "vertical";
  return (
    <nav className={cn(vertical ? "flex flex-col gap-0.5" : "flex gap-1 overflow-x-auto")} aria-label="Main">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[14px] transition-colors",
              !vertical && "shrink-0 px-2",
              active ? "font-medium text-accent" : "text-muted hover:text-text",
            )}
          >
            {/* The current page is marked with a short ink stroke against the margin, not a filled pill. */}
            {active ? (
              <span
                aria-hidden
                className={cn("absolute bg-accent", vertical ? "top-1/2 -left-2 h-4 w-[3px] -translate-y-1/2 rounded-full" : "right-2 -bottom-2 left-2 h-[2px] rounded-full")}
              />
            ) : null}
            <Icon className="size-4 shrink-0" aria-hidden strokeWidth={active ? 2.25 : 1.75} />
            <span className={cn(!vertical && "sr-only sm:not-sr-only")}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
