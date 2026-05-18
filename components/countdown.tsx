"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(new Date(lockTime).getTime() - Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [lockTime]);

  if (remaining <= 0) return null;

  const urgent = remaining < 3_600_000; // < 1 hour

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium ${
        urgent
          ? "border-[#E10F1E]/30 bg-[#E10F1E]/10 text-[#E10F1E] dark:border-[#FF5C39]/30 dark:bg-[#FF5C39]/15 dark:text-[#FF8080]"
          : "border-[#F4C430]/40 bg-[#F4C430]/15 text-black dark:border-[#F4C430]/30 dark:bg-[#F4C430]/10 dark:text-[#F4C430]"
      }`}
    >
      <span className="opacity-70">{label}:</span>
      <span className="font-bold">{roundName}</span>
      <span className="ml-auto font-mono">{formatDuration(remaining)}</span>
    </div>
  );
}
