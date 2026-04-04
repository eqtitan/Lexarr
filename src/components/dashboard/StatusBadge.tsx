"use client";

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: "var(--warning)", text: "#000", label: "Pending" },
  approved: { bg: "var(--accent)", text: "#fff", label: "Approved" },
  downloading: { bg: "var(--accent)", text: "#fff", label: "Downloading" },
  available: { bg: "var(--success)", text: "#fff", label: "Available" },
  denied: { bg: "var(--danger)", text: "#fff", label: "Denied" },
  failed: { bg: "var(--danger)", text: "#fff", label: "Failed" },
  stalled: { bg: "var(--warning)", text: "#000", label: "Stalled" },
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export default function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const config = statusConfig[status] || { bg: "var(--muted)", text: "#fff", label: status };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}
      style={{ background: config.bg, color: config.text }}
    >
      {config.label}
    </span>
  );
}
