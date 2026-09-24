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
  return (
    <nav className={cn(orientation === "vertical" ? "flex flex-col gap-0.5" : "flex gap-1 overflow-x-auto")} aria-label="Main">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
              orientation === "horizontal" && "shrink-0 px-2",
              active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className={cn(orientation === "horizontal" && "sr-only sm:not-sr-only")}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
