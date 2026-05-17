"use client";

import { usePathname, useRouter } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";
import { cn } from "@/lib/utils";
import { useTransition } from "react";
import { updatePreferredLocale } from "@/lib/actions/profile";

const LABELS: Record<string, string> = { en: "EN", es: "ES", ko: "한" };

export function LocaleSwitcher({ currentLocale }: { currentLocale: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();

  function switchLocale(locale: string) {
    router.replace(pathname, { locale });
    startTransition(async () => {
      await updatePreferredLocale(locale);
    });
  }

  return (
    <div className="flex gap-0.5">
      {routing.locales.map((locale) => (
        <button
          key={locale}
          onClick={() => switchLocale(locale)}
          className={cn(
            "rounded px-1.5 py-0.5 text-xs font-medium transition-colors",
            locale === currentLocale
              ? "bg-white/20 text-white"
              : "text-white/60 hover:text-white"
          )}
        >
          {LABELS[locale] ?? locale.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
