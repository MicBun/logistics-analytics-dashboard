"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";

/**
 * App chrome: name + top-level nav + theme toggle. A client component now —
 * usePathname drives the active-route style and the toggle is interactive; a
 * header that shows where you are is worth the few KB of JS.
 */
const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/ask", label: "Ask the data" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="font-semibold tracking-tight">
          Logistics Analytics
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <nav className="flex items-center gap-4 text-sm">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "font-medium text-foreground"
                      : "text-muted-foreground transition-colors hover:text-foreground"
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
