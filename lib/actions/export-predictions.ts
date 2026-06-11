"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import ExcelJS from "exceljs";
import sharp from "sharp";

// ── Colors ───────────────────────────────────────────────────────────────────
const COLOR_HOME_WIN = "FFD4EDDA"; // green  tint — home wins
const COLOR_TIE      = "FFFFF3CD"; // yellow tint — draw
const COLOR_AWAY_WIN = "FFF8D7DA"; // red    tint — away wins
const COLOR_HEADER   = "FF1A2855"; // navy        — header
const COLOR_STATS_BG = "FFF0F4FF"; // light blue  — stats

const PIE_HOME  = "#4CAF50"; // green
const PIE_DRAW  = "#FFC107"; // amber
const PIE_AWAY  = "#F44336"; // red

// ── Helpers ──────────────────────────────────────────────────────────────────
function fillFor(home: number, away: number): string {
  if (home > away)  return COLOR_HOME_WIN;
  if (home === away) return COLOR_TIE;
  return COLOR_AWAY_WIN;
}

function applyFill(row: ExcelJS.Row, argb: string) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  });
}

function styleHeader(row: ExcelJS.Row) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_HEADER } };
    cell.font      = { bold: true, color: { argb: "FFF4C430" }, size: 11 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border    = { bottom: { style: "medium", color: { argb: "FFF4C430" } } };
  });
  row.height = 22;
}

// ── SVG Pie chart → PNG buffer ────────────────────────────────────────────────
async function buildPieChartPng(
  homeWins: number,
  draws: number,
  awayWins: number,
  homeLabel: string,
  awayLabel: string,
): Promise<Buffer> {
  const size    = 320;
  const cx      = size / 2;
  const cy      = size / 2 - 20; // shift up to leave room for legend
  const r       = 110;
  const total   = homeWins + draws + awayWins;

  // Slices: [value, color, label, pct]
  const slices: [number, string, string][] = [
    [homeWins, PIE_HOME, `${homeLabel} Win`],
    [draws,    PIE_DRAW, "Draw"],
    [awayWins, PIE_AWAY, `${awayLabel} Win`],
  ];

  function polarToXY(angleDeg: number, radius: number) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  }

  let paths = "";
  let startAngle = 0;

  for (const [value, color, label] of slices) {
    if (total === 0 || value === 0) continue;
    const sweep      = (value / total) * 360;
    const endAngle   = startAngle + sweep;
    const largeArc   = sweep > 180 ? 1 : 0;
    const [x1, y1]   = polarToXY(startAngle, r);
    const [x2, y2]   = polarToXY(endAngle, r);
    const midAngle   = startAngle + sweep / 2;
    const [lx, ly]   = polarToXY(midAngle, r * 0.65);
    const pct        = ((value / total) * 100).toFixed(1);

    paths += `
      <path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z"
            fill="${color}" stroke="#fff" stroke-width="2"/>
      <text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle"
            font-family="sans-serif" font-size="13" font-weight="bold" fill="#fff">${pct}%</text>`;

    startAngle = endAngle;
  }

  // Empty-state circle
  if (total === 0) {
    paths = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ccc"/>
             <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
                   font-family="sans-serif" font-size="14" fill="#666">No predictions</text>`;
  }

  // Legend
  const legendItems = slices.map(([value, color, label], i) => {
    const pct = total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "0%";
    const lx  = cx - 100 + i * 70;
    const ly  = size - 28;
    return `
      <rect x="${lx}" y="${ly}" width="12" height="12" fill="${color}" rx="2"/>
      <text x="${lx + 16}" y="${ly + 10}" font-family="sans-serif" font-size="11" fill="#333">${label} ${pct}</text>`;
  });

  // Title
  const title = `
    <text x="${cx}" y="18" text-anchor="middle" font-family="sans-serif"
          font-size="14" font-weight="bold" fill="#1A2855">Prediction Split</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" style="background:#fff">
    ${title}
    ${paths}
    ${legendItems.join("")}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── Main export ───────────────────────────────────────────────────────────────
type ExportResult = {
  ok: boolean;
  error?: string;
  base64?: string;
  filename?: string;
};

type RoundWithMatches = {
  id: string;
  name_key: string;
  matches: unknown;
};

const ROUND_SELECT = `id, name_key,
   matches (
     id,
     home_team:home_team_id ( code, name_en ),
     away_team:away_team_id ( code, name_en )
   )`;

export async function exportLastClosedRoundPredictions(): Promise<ExportResult> {
  const admin = createAdminClient();
  const now   = new Date().toISOString();

  const { data: round, error: roundErr } = await admin
    .from("rounds")
    .select(ROUND_SELECT)
    .neq("stage", "podio")
    .lt("lock_time", now)
    .order("lock_time", { ascending: false })
    .limit(1)
    .single();

  if (roundErr || !round) return { ok: false, error: "No closed round found." };
  return buildPredictionsWorkbook(round as RoundWithMatches);
}

export async function exportNextRoundPredictions(): Promise<ExportResult> {
  const admin = createAdminClient();
  const now   = new Date().toISOString();

  const { data: round, error: roundErr } = await admin
    .from("rounds")
    .select(ROUND_SELECT)
    .neq("stage", "podio")
    .gt("lock_time", now)
    .order("lock_time", { ascending: true })
    .limit(1)
    .single();

  if (roundErr || !round) return { ok: false, error: "No upcoming round found." };
  return buildPredictionsWorkbook(round as RoundWithMatches);
}

async function buildPredictionsWorkbook(nextRound: RoundWithMatches): Promise<ExportResult> {
  const admin = createAdminClient();

  const matches = (nextRound.matches as unknown as {
    id: string;
    home_team: { code: string; name_en: string } | null;
    away_team: { code: string; name_en: string } | null;
  }[]) ?? [];

  if (matches.length === 0) return { ok: false, error: "No matches found for the closed round." };

  // 2. Fetch all predictions (paginated — PostgREST caps responses at 1000 rows,
  //    and users × matches easily exceeds that, silently dropping players).
  const matchIds = matches.map((m) => m.id);
  const PAGE = 1000;
  type PredRow = {
    match_id: string;
    user_id: string;
    home_score_pred: number | null;
    away_score_pred: number | null;
    profiles: { display_name: string } | { display_name: string }[] | null;
  };
  const predictions: PredRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error: predErr } = await admin
      .from("predictions")
      .select(`match_id, user_id, home_score_pred, away_score_pred, profiles!user_id ( display_name )`)
      .in("match_id", matchIds)
      .range(from, from + PAGE - 1);

    if (predErr) return { ok: false, error: predErr.message };
    predictions.push(...((page ?? []) as unknown as PredRow[]));
    if (!page || page.length < PAGE) break;
  }

  // 3. Build workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = "MX Predicto";
  wb.created = new Date();

  for (const match of matches) {
    const ht = Array.isArray(match.home_team) ? match.home_team[0] : match.home_team;
    const at = Array.isArray(match.away_team) ? match.away_team[0] : match.away_team;

    const homeCode = ht?.code ?? "HOME";
    const awayCode = at?.code ?? "AWAY";
    const homeName = ht?.name_en ?? homeCode;
    const awayName = at?.name_en ?? awayCode;

    const sheetName = `${homeCode} vs ${awayCode}`.slice(0, 31);
    const ws        = wb.addWorksheet(sheetName);

    // Columns
    ws.columns = [
      { key: "username",   header: "Username",            width: 22 },
      { key: "home",       header: `Home (${homeName})`,  width: 24 },
      { key: "home_score", header: "Home Score",           width: 13 },
      { key: "away_score", header: "Away Score",           width: 13 },
      { key: "away",       header: `Away (${awayName})`,  width: 24 },
      { key: "result",     header: "Result",               width: 14 },
    ];

    styleHeader(ws.getRow(1));

    // Prediction rows
    const matchPreds = (predictions ?? [])
      .filter((p) => p.match_id === match.id)
      .map((p) => {
        const profile = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
        const displayName = profile?.display_name ?? p.user_id ?? "—";
        const h = p.home_score_pred ?? null;
        const a = p.away_score_pred ?? null;
        const result =
          h === null || a === null ? "—"
          : h > a  ? `${homeCode} Win`
          : h === a ? "Draw"
          : `${awayCode} Win`;
        return { username: displayName, home: homeName, home_score: h ?? "—", away_score: a ?? "—", away: awayName, result, _h: h, _a: a };
      })
      .sort((a, b) => a.username.localeCompare(b.username));

    let homeWins = 0, draws = 0, awayWins = 0;
    let totalHomeGoals = 0, totalAwayGoals = 0, scoredCount = 0;

    for (const pred of matchPreds) {
      const row = ws.addRow({
        username:   pred.username,
        home:       pred.home,
        home_score: pred.home_score,
        away_score: pred.away_score,
        away:       pred.away,
        result:     pred.result,
      });
      row.getCell("home_score").alignment = { horizontal: "center" };
      row.getCell("away_score").alignment = { horizontal: "center" };
      row.getCell("result").alignment     = { horizontal: "center" };

      if (pred._h !== null && pred._a !== null) {
        applyFill(row, fillFor(pred._h, pred._a));
        totalHomeGoals += pred._h;
        totalAwayGoals += pred._a;
        scoredCount++;
        if (pred._h > pred._a) homeWins++;
        else if (pred._h === pred._a) draws++;
        else awayWins++;
      }
    }

    const total = homeWins + draws + awayWins;
    const pct   = (n: number) => total > 0 ? `${n}  (${((n / total) * 100).toFixed(1)}%)` : "0";
    const avg   = (n: number) => scoredCount > 0 ? (n / scoredCount).toFixed(2) : "—";

    // Spacer
    ws.addRow({});

    // Stats section
    const addStatRow = (label: string, value: string) => {
      const row = ws.addRow({});
      row.getCell(1).value     = label;
      row.getCell(2).value     = value;
      row.getCell(1).font      = { bold: true, size: 11 };
      row.getCell(1).alignment = { horizontal: "left" };
      row.getCell(2).alignment = { horizontal: "left" };
      [1, 2].forEach((c) => {
        row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_STATS_BG } };
      });
    };

    const statsRow = ws.lastRow!.number + 1;

    addStatRow("📊  STATISTICS", "");
    addStatRow(`🟢  ${homeCode} Wins`,       pct(homeWins));
    addStatRow("🟡  Draws",                  pct(draws));
    addStatRow(`🔴  ${awayCode} Wins`,       pct(awayWins));
    addStatRow("⚽  Avg Home Goals",         avg(totalHomeGoals));
    addStatRow("⚽  Avg Away Goals",         avg(totalAwayGoals));
    addStatRow("👥  Total Predictions",      String(total));

    // Pie chart image
    try {
      const pngBuf  = await buildPieChartPng(homeWins, draws, awayWins, homeCode, awayCode);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const imageId = wb.addImage({ buffer: pngBuf as any, extension: "png" });
      ws.addImage(imageId, {
        tl: { col: 7,  row: statsRow - 1 } as ExcelJS.Anchor,
        br: { col: 12, row: statsRow + 13 } as ExcelJS.Anchor,
      });
    } catch {
      // Chart generation failed silently — stats table still present
    }
  }

  // 4. Serialize
  const roundLabel = nextRound.name_key.replace("rounds.", "");
  const filename   = `predictions_${roundLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const buffer     = await wb.xlsx.writeBuffer();
  const base64     = Buffer.from(buffer).toString("base64");

  return { ok: true, base64, filename };
}
