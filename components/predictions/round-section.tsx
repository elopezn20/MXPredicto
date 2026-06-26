"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  isLocked: boolean;
  lockedLabel: string;
  openLabel: string;
  children: ReactNode;
}

export function RoundSection({
  title,
  isLocked,
  lockedLabel,
  openLabel,
  children,
}: Props) {
  // Previous (locked) rounds start collapsed so the page leads with what's open.
  const [collapsed, setCollapsed] = useState(isLocked);

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        {isLocked ? (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            className="flex items-center gap-2 rounded-md transition-colors hover:opacity-80"
          >
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                collapsed && "-rotate-90"
              )}
            />
            <h2 className="border-l-4 border-highlight pl-3 text-lg font-semibold text-[#1A2855] dark:text-foreground">
              {title}
            </h2>
          </button>
        ) : (
          <h2 className="border-l-4 border-highlight pl-3 text-lg font-semibold text-[#1A2855] dark:text-foreground">
            {title}
          </h2>
        )}
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            isLocked
              ? "bg-muted text-muted-foreground"
              : "bg-green-100 text-green-700"
          )}
        >
          {isLocked ? lockedLabel : openLabel}
        </span>
      </div>

      {!collapsed && children}
    </section>
  );
}
