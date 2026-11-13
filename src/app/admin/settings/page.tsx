"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import MusicRegionsSection from "@/components/admin/settings/MusicRegionsSection";
import NotificationChannelsSection from "@/components/admin/settings/NotificationChannelsSection";

export default function SettingsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const isAdmin = session?.user?.role === "admin";
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!isAdmin) router.replace("/");
  }, [isAdmin, sessionStatus, router]);

  // Clear the action-error banner after a few seconds so it doesn't linger.
  useEffect(() => {
    if (!actionError) return;
    const id = setTimeout(() => setActionError(null), 5000);
    return () => clearTimeout(id);
  }, [actionError]);

  if (!isAdmin) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      {actionError && (
        <div
          className="rounded-lg px-4 py-2 text-sm ring-1"
          style={{ background: "rgba(239,68,68,0.08)", borderColor: "var(--danger)", color: "var(--danger)" }}
          role="alert"
        >
          {actionError}
        </div>
      )}

      <MusicRegionsSection />
      <NotificationChannelsSection onError={setActionError} />
    </div>
  );
}
