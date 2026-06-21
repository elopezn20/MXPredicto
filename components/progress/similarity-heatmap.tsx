import type { SimilarityMatrix } from "@/lib/scoring/pick-similarity";
import { cn } from "@/lib/utils";

export interface SimilarityHeatmapLabels {
  heading: string; // "Pick similarity"
  subtitle: string; // explains it's vs leaderboard neighbours, n matches
  legendLow: string; // "Different"
  legendHigh: string; // "Alike"
  noData: string; // shown when there aren't enough picks to compare
  cellTitle: string; // "{a} vs {b}: {pct}% over {count} match(es)"
  blank: string; // dash shown on the diagonal / empty cells
}

interface Props {
  data: SimilarityMatrix;
  selectedId: string;
  labels: SimilarityHeatmapLabels;
}

// Base ramp colour (blue-600). Cells fade from faint → solid via alpha so the
// card background shows through at low similarity, keeping the scale readable in
// both light and dark themes without theme-specific colours.
const RAMP_RGB = "37, 99, 235";

function cellStyle(value: number | null): React.CSSProperties {
  if (value == null) return {};
  const alpha = 0.08 + value * 0.92;
  return { backgroundColor: `rgba(${RAMP_RGB}, ${alpha.toFixed(3)})` };
}

/** First two initials of a display name, for the compact column headers. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function SimilarityHeatmap({ data, selectedId, labels }: Props) {
  const { players, matrix, shared } = data;

  // Need at least two players and one comparable pair to be meaningful.
  const hasData =
    players.length >= 2 &&
    matrix.some((row) => row.some((v) => v != null));

  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div>
        <h2 className="font-semibold">{labels.heading}</h2>
        <p className="text-sm text-muted-foreground">{labels.subtitle}</p>
      </div>

      {!hasData ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {labels.noData}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-1 text-sm">
              <thead>
                <tr>
                  <th className="w-px" />
                  {players.map((p) => (
                    <th
                      key={p.userId}
                      title={p.displayName}
                      className={cn(
                        "h-8 w-9 text-center align-bottom text-xs font-medium text-muted-foreground",
                        p.userId === selectedId && "text-foreground"
                      )}
                    >
                      {initials(p.displayName)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.map((rowP, i) => {
                  const rowSelected = rowP.userId === selectedId;
                  return (
                    <tr key={rowP.userId}>
                      <th
                        scope="row"
                        className={cn(
                          "max-w-[9rem] truncate pr-2 text-right text-xs font-medium whitespace-nowrap",
                          rowSelected
                            ? "text-foreground"
                            : "text-muted-foreground"
                        )}
                        title={rowP.displayName}
                      >
                        {rowP.displayName}
                      </th>
                      {players.map((colP, j) => {
                        const value = matrix[i]![j] ?? null;
                        const count = shared[i]![j] ?? 0;
                        const colSelected = colP.userId === selectedId;
                        const pct =
                          value == null ? null : Math.round(value * 100);
                        return (
                          <td
                            key={colP.userId}
                            style={cellStyle(value)}
                            title={
                              value == null
                                ? undefined
                                : labels.cellTitle
                                    .replace("{a}", rowP.displayName)
                                    .replace("{b}", colP.displayName)
                                    .replace("{pct}", String(pct))
                                    .replace("{count}", String(count))
                            }
                            className={cn(
                              "h-9 w-9 rounded-md text-center text-[11px] tabular-nums",
                              value == null && "bg-muted/30 text-muted-foreground",
                              value != null && value >= 0.5
                                ? "font-medium text-white"
                                : "text-foreground",
                              (rowSelected || colSelected) &&
                                "ring-1 ring-inset ring-foreground/40"
                            )}
                          >
                            {pct == null ? labels.blank : pct}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{labels.legendLow}</span>
            <span
              className="h-3 w-24 rounded"
              style={{
                background: `linear-gradient(to right, rgba(${RAMP_RGB}, 0.08), rgba(${RAMP_RGB}, 1))`,
              }}
            />
            <span>{labels.legendHigh}</span>
          </div>
        </>
      )}
    </section>
  );
}
