"use client";

import { useState } from "react";

export interface ChartPoint {
  index: number;
  matchId: string;
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
  predHome: number | null;
  predAway: number | null;
  pointsThisMatch: number;
  cumulativePoints: number;
  rank: number;
  totalPlayers: number;
}

interface Labels {
  match: string;
  result: string;
  prediction: string;
  rank: string;
  points: string;
  noPrediction: string;
  matchAxis: string;
  rankAxis: string;
}

interface Props {
  points: ChartPoint[];
  labels: Labels;
}

// viewBox geometry — the SVG scales to its container, tooltip is positioned in %.
const W = 800;
const H = 360;
const PAD = { top: 20, right: 20, bottom: 34, left: 40 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

export function RankChart({ points, labels }: Props) {
  const [active, setActive] = useState<number | null>(null);

  const n = points.length;
  const total = points[0]?.totalPlayers ?? 1;
  const maxRank = Math.max(total, 2);

  const xOf = (i: number) =>
    n <= 1 ? PAD.left + PLOT_W / 2 : PAD.left + (i / (n - 1)) * PLOT_W;
  // rank 1 (best) at the top, maxRank at the bottom.
  const yOf = (rank: number) =>
    PAD.top + ((rank - 1) / (maxRank - 1)) * PLOT_H;

  const coords = points.map((p) => ({ x: xOf(p.index), y: yOf(p.rank), p }));
  const linePath = coords.map((c) => `${c.x},${c.y}`).join(" ");

  // Horizontal gridlines at rank 1, mid, and last.
  const gridRanks = Array.from(
    new Set([1, Math.ceil(maxRank / 2), maxRank])
  );

  // Show at most ~8 x-axis labels to avoid crowding 104 matches.
  const xLabelStep = Math.max(1, Math.ceil(n / 8));

  const activePoint = active != null ? coords[active] : null;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={labels.rankAxis}
        onMouseLeave={() => setActive(null)}
      >
        {/* Gridlines + rank labels */}
        {gridRanks.map((r) => {
          const y = yOf(r);
          return (
            <g key={r}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y}
                y2={y}
                className="stroke-border"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <text
                x={PAD.left - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[11px]"
              >
                {r}
              </text>
            </g>
          );
        })}

        {/* X-axis match-number labels */}
        {coords.map((c, i) =>
          i % xLabelStep === 0 || i === n - 1 ? (
            <text
              key={`xl-${c.p.matchId}`}
              x={c.x}
              y={H - PAD.bottom + 18}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {c.p.index + 1}
            </text>
          ) : null
        )}

        {/* The trajectory */}
        {n > 1 && (
          <polyline
            points={linePath}
            fill="none"
            className="stroke-primary"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Visible dots */}
        {coords.map((c, i) => (
          <circle
            key={`dot-${c.p.matchId}`}
            cx={c.x}
            cy={c.y}
            r={active === i ? 5 : 3}
            className={
              active === i
                ? "fill-primary stroke-background"
                : "fill-primary stroke-background"
            }
            strokeWidth={1.5}
          />
        ))}

        {/* Active vertical guide */}
        {activePoint && (
          <line
            x1={activePoint.x}
            x2={activePoint.x}
            y1={PAD.top}
            y2={H - PAD.bottom}
            className="stroke-primary/40"
            strokeWidth={1}
          />
        )}

        {/* Large invisible hit targets for hover/focus */}
        {coords.map((c, i) => (
          <circle
            key={`hit-${c.p.matchId}`}
            cx={c.x}
            cy={c.y}
            r={14}
            fill="transparent"
            tabIndex={0}
            className="cursor-pointer focus:outline-none"
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onClick={() => setActive(i)}
          >
            <title>{`${c.p.homeName} vs ${c.p.awayName}`}</title>
          </circle>
        ))}
      </svg>

      {/* Tooltip — positioned in % so it tracks the responsive SVG */}
      {activePoint && (
        <div
          className="pointer-events-none absolute z-10 w-48 -translate-x-1/2 rounded-lg border bg-popover p-3 text-xs shadow-lg"
          style={{
            left: `${(activePoint.x / W) * 100}%`,
            top: `calc(${(activePoint.y / H) * 100}% + 14px)`,
          }}
        >
          <p className="mb-1.5 font-semibold leading-snug">
            {activePoint.p.homeName} vs {activePoint.p.awayName}
          </p>
          <div className="space-y-1 text-muted-foreground">
            <Row
              label={labels.result}
              value={
                activePoint.p.homeScore != null &&
                activePoint.p.awayScore != null
                  ? `${activePoint.p.homeScore}–${activePoint.p.awayScore}`
                  : "—"
              }
            />
            <Row
              label={labels.prediction}
              value={
                activePoint.p.predHome != null &&
                activePoint.p.predAway != null
                  ? `${activePoint.p.predHome}–${activePoint.p.predAway}`
                  : labels.noPrediction
              }
            />
            <Row
              label={labels.points}
              value={`+${activePoint.p.pointsThisMatch} (${activePoint.p.cumulativePoints})`}
            />
            <Row
              label={labels.rank}
              value={`#${activePoint.p.rank} / ${activePoint.p.totalPlayers}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
