import type { Metadata } from "next";
import Nav from "@/components/Nav";
import SessionProvider from "@/components/SessionProvider";
import { ToastProvider } from "@/components/Toast";
import ErrorBoundary from "@/components/ErrorBoundary";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lexarr",
  description: "Unified media request portal",
};

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
            <main className="mx-auto max-w-5xl px-4 py-6">
              <ErrorBoundary>{children}</ErrorBoundary>
            </main>
          </ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
