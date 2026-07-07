"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
  content: ReactNode;
}

interface Props {
  tabs: Tab[];
}

export function ProfileTabs({ tabs }: Props) {
  const [activeId, setActiveId] = useState(tabs[0]?.id);

  return (
    <div className="space-y-5">
      <div role="tablist" className="flex gap-1 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeId}
            onClick={() => setActiveId(tab.id)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm transition-colors",
              tab.id === activeId
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Panels stay mounted so switching back keeps collapse/expand state. */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          hidden={tab.id !== activeId}
          className="space-y-5"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
