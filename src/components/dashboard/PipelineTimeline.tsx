"use client";

import type { PipelineEventDTO } from "@/types/dashboard";

interface PipelineTimelineProps {
  events: PipelineEventDTO[];
  currentStatus: string;
}

const stepOrder = ["submitted", "approved", "sent_to_arr", "downloading", "available"];

const stepLabels: Record<string, string> = {
  submitted: "Submitted",
  approved: "Approved",
  sent_to_arr: "Sent to *arr",
  downloading: "Downloading",
  available: "Available",
  denied: "Denied",
  failed: "Failed",
};

function timeBetween(a: string, b: string): string {
  const diff = new Date(b).getTime() - new Date(a).getTime();
  if (diff < 0) return "";
  if (diff < 60000) return `${Math.round(diff / 1000)}s`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m`;
  if (diff < 86400000) return `${(diff / 3600000).toFixed(1)}h`;
  return `${(diff / 86400000).toFixed(1)}d`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

export default function PipelineTimeline({ events, currentStatus }: PipelineTimelineProps) {
  const eventMap = new Map<string, PipelineEventDTO>();
  for (const e of events) {
    // Keep first occurrence of each event type
    if (!eventMap.has(e.event)) {
      eventMap.set(e.event, e);
    }
  }

  // Determine which pipeline to show
  const isDenied = currentStatus === "denied" || eventMap.has("denied");
  const isFailed = eventMap.has("failed");
  const steps = isDenied
    ? ["submitted", "denied"]
    : isFailed
      ? ["submitted", "approved", "sent_to_arr", "failed"]
      : stepOrder;

  // Find the last completed step index
  let activeIndex = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (eventMap.has(steps[i])) {
      activeIndex = i;
      break;
    }
  }

  return (
    <div className="flex items-center gap-0 overflow-x-auto py-2">
      {steps.map((step, i) => {
        const event = eventMap.get(step);
        const isCompleted = event != null;
        const isActive = i === activeIndex && !["available", "denied", "failed"].includes(step);
        const isFuture = !isCompleted;
        const prevEvent = i > 0 ? eventMap.get(steps[i - 1]) : null;

        return (
          <div key={step} className="flex items-center">
            {/* Connector line */}
            {i > 0 && (
              <div className="flex flex-col items-center mx-1">
                <div
                  className="h-0.5 w-8"
                  style={{
                    background: isCompleted ? "var(--success)" : "var(--border)",
                  }}
                />
                {event && prevEvent && (
                  <span className="text-[10px] text-[var(--muted)] mt-0.5">
                    {timeBetween(prevEvent.createdAt, event.createdAt)}
                  </span>
                )}
              </div>
            )}

            {/* Step dot + label */}
            <div className="flex flex-col items-center min-w-[70px]">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  isActive ? "animate-pulse" : ""
                }`}
                style={{
                  background: isCompleted
                    ? step === "denied" || step === "failed"
                      ? "var(--danger)"
                      : "var(--success)"
                    : isActive
                      ? "var(--accent)"
                      : "var(--border)",
                  color: isCompleted || isActive ? "#fff" : "var(--muted)",
                }}
              >
                {isCompleted ? (step === "denied" || step === "failed" ? "!" : "\u2713") : i + 1}
              </div>
              <span
                className="mt-1 text-[11px] font-medium text-center leading-tight"
                style={{
                  color: isCompleted
                    ? "var(--foreground)"
                    : isFuture
                      ? "var(--muted)"
                      : "var(--foreground)",
                }}
              >
                {stepLabels[step] || step}
              </span>
              {event && (
                <span className="text-[10px] text-[var(--muted)]">
                  {timeAgo(event.createdAt)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
