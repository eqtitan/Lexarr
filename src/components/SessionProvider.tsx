"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SessionProvider as NextAuthSessionProvider, useSession } from "next-auth/react";

/** Pages a logged-out visitor may see. Everything else needs an account:
 *  the APIs behind them refuse anonymous calls. */
export const PUBLIC_PATHS = ["/login", "/setup-needed"];

/** Sends a logged-out visitor on any other page to the sign-in page. */
export function RequireSignIn({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname?.startsWith(`${p}/`));

  useEffect(() => {
    if (status === "unauthenticated" && !isPublic) router.replace("/login");
  }, [status, isPublic, router]);

  if (status === "unauthenticated" && !isPublic) return null;
  return <>{children}</>;
}

export default function SessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextAuthSessionProvider>
      <RequireSignIn>{children}</RequireSignIn>
    </NextAuthSessionProvider>
  );
}
