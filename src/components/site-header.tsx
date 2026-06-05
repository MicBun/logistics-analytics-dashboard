import Link from "next/link";

/**
 * App chrome: name + top-level nav. Server component — it has no interactivity,
 * so there is no reason to ship it to the client.
 */
export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="font-semibold tracking-tight">
          Logistics Analytics
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link href="/" className="transition-colors hover:text-foreground">
            Dashboard
          </Link>
          <Link href="/ask" className="transition-colors hover:text-foreground">
            Ask AI
          </Link>
        </nav>
      </div>
    </header>
  );
}
