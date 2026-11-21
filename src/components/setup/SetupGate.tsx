"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useApi } from "@/lib/use-api";
import type { SetupInfo } from "@/lib/setup";

const PROMPTED_KEY = "lexarr-setup-prompted";

/**
 * Opens the setup guide once per browser session for an admin on a new or
 * reset install (see src/lib/setup.ts). Once per session, so wandering off to
 * look at something never traps the admin in a redirect loop.
 */
export default function SetupGate() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const { data } = useApi<SetupInfo>(isAdmin ? "/api/admin/setup" : null);
  const pathname = usePathname();
  const router = useRouter();
  const prompted = useRef(false);

  useEffect(() => {
    if (!data?.autoLaunch || prompted.current) return;
    if (pathname === "/setup" || pathname?.startsWith("/login")) return;
    prompted.current = true;
    try {
      if (sessionStorage.getItem(PROMPTED_KEY)) return;
      sessionStorage.setItem(PROMPTED_KEY, "1");
    } catch {
      // Storage blocked: the ref above still limits this to once per page load.
    }
    router.replace("/setup");
  }, [data, pathname, router]);

  return null;
}
