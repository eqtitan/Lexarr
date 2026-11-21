"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useState, useRef, useEffect } from "react";
import NotificationBell from "./NotificationBell";
import { APP_VERSION, getChannel } from "@/lib/version";
import { useApi } from "@/lib/use-api";
import type { UpdateStatus } from "@/lib/update-check";

const links = [
  { href: "/", label: "Search" },
  { href: "/requests", label: "Requests" },
];

const adminLinks = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/audit", label: "Audit" },
  { href: "/admin/readiness", label: "Readiness" },
];

export default function Nav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role;
  // Admins only. The server caches GitHub's answer for a day, so an hour-long
  // client refresh is cheap and a long-open tab still hears about a release.
  const { data: update } = useApi<UpdateStatus>(role === "admin" ? "/api/admin/update-check" : null, {
    refreshInterval: 60 * 60 * 1000,
  });
  const updateAvailable = update?.enabled && update.updateAvailable ? update : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isAdminPage = pathname.startsWith("/admin");

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [menuOpen]);

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // The setup page is shown before anything works (no session, no APIs).
  if (pathname.startsWith("/setup-needed")) return null;

  return (
    <nav className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link
          href="/"
          className="flex items-baseline gap-2 text-xl font-bold tracking-tight"
        >
          <span>
            <span className="text-[var(--accent)]">Lex</span>arr
          </span>
          <span
            className="text-xs font-normal tracking-normal text-[var(--muted)]"
            title={`Lexarr ${APP_VERSION} (${getChannel()})`}
          >
            v{APP_VERSION}
            {getChannel() !== "stable" && (
              <span className="ml-1 hidden sm:inline">{getChannel()}</span>
            )}
          </span>
        </Link>
        <div className="flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                pathname === l.href
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {l.label}
            </Link>
          ))}
          {role === "admin" && (
            <Link
              href="/admin/dashboard"
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isAdminPage
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              Admin
            </Link>
          )}
          {updateAvailable && (
            <a
              href={updateAvailable.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`Lexarr ${updateAvailable.latest} is available (you have ${updateAvailable.current})`}
              className="ml-1 hidden rounded-full bg-[var(--accent)]/15 px-2.5 py-1 text-xs font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/25 sm:inline-block"
            >
              Update {updateAvailable.latest}
            </a>
          )}
          {session ? (
            <>
            <NotificationBell />
            <div ref={menuRef} className="relative ml-2">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium text-[var(--foreground)] ring-1 ring-[var(--border)] transition-all hover:ring-[var(--accent)]/50 hover:bg-[var(--card)]"
              >
                {session.user?.image ? (
                  <img
                    src={session.user.image}
                    alt=""
                    className="h-6 w-6 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-white">
                    {(session.user?.name || "?")[0].toUpperCase()}
                  </span>
                )}
                <span className="hidden sm:inline">{session.user?.name}</span>
                <svg
                  className={`h-3.5 w-3.5 text-[var(--muted)] transition-transform ${menuOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-2 w-52 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-[var(--card)] ring-1 ring-[var(--border)] shadow-xl shadow-black/30 z-50">
                  <div className="border-b border-[var(--border)] px-4 py-3">
                    <p className="truncate text-sm font-semibold">
                      {session.user?.name}
                    </p>
                    <p className="truncate text-xs text-[var(--muted)]">
                      {session.user?.email ||
                        (role === "admin" ? "Admin" : "User")}
                    </p>
                    {role === "admin" && session.user?.email && (
                      <span className="mt-1 inline-block rounded bg-[var(--accent)]/20 px-1.5 py-0.5 text-[10px] font-bold text-[var(--accent)]">
                        ADMIN
                      </span>
                    )}
                  </div>

                  <div className="py-1">
                    {updateAvailable && (
                      <a
                        href={updateAvailable.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium text-[var(--accent)] transition-colors hover:bg-[var(--card-hover)]"
                      >
                        <span className="flex h-4 w-4 items-center justify-center text-base leading-none">↑</span>
                        Update available: {updateAvailable.latest}
                      </a>
                    )}
                    <Link
                      href="/requests"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--card-hover)]"
                    >
                      <svg
                        className="h-4 w-4 text-[var(--muted)]"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                        />
                      </svg>
                      My Requests
                    </Link>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        void signOut({ callbackUrl: "/login" });
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--card-hover)]"
                    >
                      <svg
                        className="h-4 w-4 text-[var(--muted)]"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M8 7h12m0 0l-4-4m4 4l-4 4m0 5H8m0 0l4 4m-4-4l4-4"
                        />
                      </svg>
                      Switch Account
                    </button>
                  </div>

                  <div className="border-t border-[var(--border)] py-1">
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        void signOut({ callbackUrl: "/" });
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-[var(--danger)] transition-colors hover:bg-[var(--card-hover)]"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                        />
                      </svg>
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
            </>
          ) : (
            <Link
              href="/login"
              className="ml-2 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>

      {/* Admin sub-navigation */}
      {isAdminPage && role === "admin" && (
        <div className="border-t border-[var(--border)] bg-[var(--card)]/50">
          <div className="mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-4 py-1.5">
            {adminLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  pathname === l.href
                    ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
