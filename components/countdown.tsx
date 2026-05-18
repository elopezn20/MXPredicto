"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

function formatDuration(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

interface CountdownProps {
  lockTime: string;
  roundName: string;
  label: string;
}

export function Countdown({ lockTime, roundName, label }: CountdownProps) {
  const [remaining, setRemaining] = useState(
    new Date(lockTime).getTime() - Date.now()
  );
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(new Date(lockTime).getTime() - Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [lockTime]);

  if (remaining <= 0) return null;

  const urgent = remaining < 3_600_000;

  const textColor = urgent
    ? isDark ? "#FF8080" : "#E10F1E"
    : isDark ? "#F4C430" : "#000000";

  const bgColor = urgent
    ? isDark ? "rgba(255,92,57,0.15)" : "rgba(225,15,30,0.10)"
    : isDark ? "rgba(244,196,48,0.10)" : "rgba(244,196,48,0.15)";

  const borderColor = urgent
    ? isDark ? "rgba(255,92,57,0.30)" : "rgba(225,15,30,0.30)"
    : isDark ? "rgba(244,196,48,0.30)" : "rgba(244,196,48,0.40)";

  return (
    <div
      className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium"
      style={{ color: textColor, backgroundColor: bgColor, borderColor }}
    >
      <span className="opacity-70">{label}:</span>
      <span className="font-bold">{roundName}</span>
      <span className="ml-auto font-mono">{formatDuration(remaining)}</span>
    </div>
  );
}
