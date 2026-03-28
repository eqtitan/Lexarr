"use client";

interface ProgressBarProps {
  value: number; // 0-100
  color?: string; // CSS custom property or color
  height?: string;
  className?: string;
}

export default function ProgressBar({
  value,
  color = "var(--accent)",
  height = "4px",
  className = "",
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div
      className={`w-full overflow-hidden rounded-full ${className}`}
      style={{ height, background: "var(--border)" }}
    >
      <div
        className="h-full rounded-full transition-all duration-500 ease-out"
        style={{
          width: `${clamped}%`,
          background: color,
        }}
      />
    </div>
  );
}
