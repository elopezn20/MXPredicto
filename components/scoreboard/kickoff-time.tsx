"use client";

import { useSyncExternalStore } from "react";

// Map next-intl locale codes to BCP 47 tags for Intl APIs (matches MatchCard).
const LOCALE_TAG: Record<string, string> = { en: "en", es: "es-CL", ko: "ko-KR" };

// Value never changes; we only use the store to distinguish server vs client.
const emptySubscribe = () => () => {};

interface Props {
  /** ISO 8601 kickoff timestamp (UTC). */
  iso: string;
  locale: string;
  /**
   * Server-rendered label (formatted in a fixed tz) used for SSR and the
   * no-JS fallback. On the client we re-format in the viewer's local timezone
   * — same behaviour as the match cards on the predictions page. Using
   * useSyncExternalStore keeps the first client render equal to the server
   * output (no hydration mismatch), then swaps to the local-tz value.
   */
  fallback: string;
  className?: string;
}

export function KickoffTime({ iso, locale, fallback, className }: Props) {
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const tag = LOCALE_TAG[locale] ?? locale;
  const label = isClient
    ? new Date(iso).toLocaleString(tag, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : fallback;

  return <span className={className}>{label}</span>;
}
