"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** Header content: title, status badge, points, etc. */
  header: ReactNode;
  /** Locked rounds are collapsible and start collapsed. */
  collapsible: boolean;
  /** Override the initial state — e.g. the most recently locked round starts open. */
  defaultCollapsed?: boolean;
  children: ReactNode;
}

export function RoundSection({
  header,
  collapsible,
  defaultCollapsed,
  children,
}: Props) {
  // Previous (locked) rounds start collapsed so the page leads with what's current.
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? collapsible);

  return (
    <section className="space-y-2">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="flex w-full items-center gap-2 text-left transition-colors hover:opacity-80"
        >
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              collapsed && "-rotate-90"
            )}
          />
          {header}
        </button>
      ) : (
        <div className="flex items-center gap-2">{header}</div>
      )}

      {!collapsed && children}
    </section>
  );
}
