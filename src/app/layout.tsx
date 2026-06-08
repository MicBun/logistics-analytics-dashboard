import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://logistics.micbun.com"
).replace(/\/+$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Logistics Analytics",
  description:
    "AI-powered logistics analytics dashboard — KPIs, charts, and natural-language queries over a unified order dataset.",
  openGraph: {
    title: "Logistics Analytics",
    description:
      "AI-powered logistics analytics dashboard — KPIs, charts, and natural-language queries over a unified order dataset.",
    url: "/",
    siteName: "Logistics Analytics",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: next-themes sets the theme class on <html>
    // before hydration (to avoid a flash of the wrong theme), so the server
    // and client html attributes legitimately differ.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <SiteHeader />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
