import type { Metadata } from "next";
import Nav from "@/components/Nav";
import SessionProvider from "@/components/SessionProvider";
import { ToastProvider } from "@/components/Toast";
import ErrorBoundary from "@/components/ErrorBoundary";
import SetupGate from "@/components/setup/SetupGate";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lexarr",
  description: "Unified media request portal",
};

/**
 * Apply dynamic rendering to every route.
 *
 * Lexarr is a self-hosted, single-instance app with no SSG-valuable
 * content — every page is either client-fetched (search / requests /
 * admin dashboards) or behind auth. Without this, Next.js pre-renders
 * page shells at build time and serves them with
 * `Cache-Control: s-maxage=31536000`, which strands tabs on the
 * previous deploy's JS chunks after a container swap. Forcing dynamic
 * rendering ensures every request sees the current build's shell +
 * chunk references, which is what matters for an app redeployed
 * multiple times per week.
 *
 * NB: route-segment config exports (`dynamic`, `revalidate`, etc) are
 * only read from SERVER components. `page.tsx` is `"use client"` and
 * so can't declare this itself — the root layout is the right home.
 */
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <ToastProvider>
            <Nav />
            <SetupGate />
            <main className="mx-auto max-w-5xl px-4 py-6">
              <ErrorBoundary>{children}</ErrorBoundary>
            </main>
          </ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
