"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * App-wide theme context (next-themes).
 *
 * - attribute="class": toggles the .dark class on <html> — exactly how
 *   globals.css scopes its dark palette, so no CSS changes are needed.
 * - defaultTheme="system" + enableSystem: respect the OS preference until the
 *   visitor explicitly picks a theme with the header toggle.
 * - disableTransitionOnChange: without it, every themed element animates its
 *   colors when the class flips — a site-wide flash, not a pleasant fade.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
