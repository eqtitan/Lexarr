"use client";

import Link from "next/link";
import type { ServiceHealthDTO } from "@/types/dashboard";

interface ServiceHealthBarProps {
  services: ServiceHealthDTO[];
}

export default function ServiceHealthBar({ services }: ServiceHealthBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {services.map((svc) => (
        <Link
          key={svc.name}
          href={`/admin/dashboard/${svc.name.toLowerCase()}`}
          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-[var(--card-hover)]"
          title={svc.error || `${svc.responseMs}ms`}
        >
          <div
            className="h-2.5 w-2.5 rounded-full"
            style={{
              background: svc.healthy ? "var(--success)" : "var(--danger)",
              boxShadow: svc.healthy ? "0 0 6px var(--success)" : "0 0 6px var(--danger)",
            }}
          />
          <span className="text-sm font-medium">{svc.name}</span>
          {!svc.healthy && svc.error && (
            <span className="text-xs text-[var(--danger)]">down</span>
          )}
          {svc.healthy && (
            <span className="text-xs text-[var(--muted)]">{svc.responseMs}ms</span>
          )}
        </Link>
      ))}
    </div>
  );
}
