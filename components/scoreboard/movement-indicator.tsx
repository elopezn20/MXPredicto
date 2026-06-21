import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** Spots moved since the previous game: positive = up, negative = down. */
  delta: number;
  /** Localized accessible label / tooltip, e.g. "Up 2 since last match". */
  title?: string;
}

/**
 * Small green up-arrow (gained places) or red down-arrow (lost places) with the
 * magnitude of the move. Renders nothing when there's no change. Colors avoid
 * the `dark:` variant on purpose — this project has no class-based dark variant
 * configured, so green-600/red-600 (legible in both themes) are used directly.
 */
export function MovementIndicator({ delta, title }: Props) {
  if (delta === 0) return null;
  const up = delta > 0;

  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums",
        up ? "text-green-600" : "text-red-600"
      )}
    >
      {up ? (
        <ArrowUpIcon className="size-3" aria-hidden />
      ) : (
        <ArrowDownIcon className="size-3" aria-hidden />
      )}
      {Math.abs(delta)}
    </span>
  );
}
