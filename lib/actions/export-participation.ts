"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import ExcelJS from "exceljs";

function completionColor(pct: number): string {
  if (pct === 100) return "FFD4EDDA";
  if (pct === 0)   return "FFF8D7DA";
  return "FFFFF3CD";
}

const COLOR_HEADER = "FF1A2855";

function styleHeader(row: ExcelJS.Row) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_HEADER } };
    cell.font      = { bold: true, color: { argb: "FFF4C430" }, size: 11 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border    = { bottom: { style: "medium", color: { argb: "FFF4C430" } } };
  });
  row.height = 22;
}

async function buildParticipationWorkbook(roundId: string, roundLabel: string): Promise<{
  ok: boolean;
  error?: string;
  base64?: string;
  filename?: string;
}> {
  const admin = createAdminClient();

  const { data: matches, error: matchErr } = await admin
    .from("matches")
    .select("id")
    .eq("round_id", roundId);

  if (matchErr) return { ok: false, error: matchErr.message };

  const matchIds     = (matches ?? []).map((m) => m.id);
  const totalMatches = matchIds.length;

  if (totalMatches === 0) return { ok: false, error: "No matches found for this round." };

  const { data: profiles, error: profErr } = await admin
    .from("profiles")
    .select("id, display_name")
    .order("display_name", { ascending: true });

  if (profErr) return { ok: false, error: profErr.message };

  // Paginate: PostgREST caps a single response at 1000 rows, and
  // (users × matches) easily exceeds that, which silently drops users.
  const PAGE = 1000;
  const predMap = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data: page, error: predErr } = await admin
      .from("predictions")
      .select("user_id, match_id")
      .in("match_id", matchIds)
      .range(from, from + PAGE - 1);

    if (predErr) return { ok: false, error: predErr.message };
    for (const p of page ?? []) {
      predMap.set(p.user_id, (predMap.get(p.user_id) ?? 0) + 1);
    }
    if (!page || page.length < PAGE) break;
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "MX Predicto";
  wb.created = new Date();

  const ws = wb.addWorksheet("Participation");

  ws.columns = [
    { key: "rank",     header: "#",                  width: 6  },
    { key: "username", header: "Username",            width: 26 },
    { key: "made",     header: "Predictions Made",    width: 20 },
    { key: "total",    header: "Total Matches",       width: 16 },
    { key: "pct",      header: "Completion %",        width: 16 },
    { key: "status",   header: "Status",              width: 14 },
  ];

  styleHeader(ws.getRow(1));

  const sorted = (profiles ?? [])
    .map((profile) => {
      const made = predMap.get(profile.id) ?? 0;
      const pct  = totalMatches > 0 ? (made / totalMatches) * 100 : 0;
      return { username: profile.display_name ?? "—", made, pct };
    })
    .sort((a, b) => b.pct - a.pct || a.username.localeCompare(b.username));

  sorted.forEach(({ username, made, pct }, i) => {
    const status = pct === 100 ? "✅ Complete" : pct === 0 ? "❌ None" : "⚠️ Partial";

    const row = ws.addRow({
      rank:     i + 1,
      username,
      made,
      total:    totalMatches,
      pct:      parseFloat(pct.toFixed(1)),
      status,
    });

    ["rank", "made", "total", "pct", "status"].forEach((key) => {
      row.getCell(key).alignment = { horizontal: "center" };
    });

    row.getCell("pct").numFmt = '0.0"%"';

    const argb = completionColor(pct);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    });

    row.height = 18;
  });

  ws.addRow({});
  const total    = sorted.length;
  const complete = sorted.filter((r) => r.pct === 100).length;
  const partial  = sorted.filter((r) => r.pct > 0 && r.pct < 100).length;
  const none     = sorted.filter((r) => r.pct === 0).length;
  const avgPct   = total > 0 ? sorted.reduce((s, r) => s + r.pct, 0) / total : 0;

  for (const [label, value] of [
    ["👥 Total Players",    total],
    ["✅ Complete (100%)",  complete],
    ["⚠️ Partial",          partial],
    ["❌ No predictions",   none],
    ["📊 Avg Completion",  `${avgPct.toFixed(1)}%`],
  ] as [string, string | number][]) {
    const row = ws.addRow({});
    row.getCell(1).value = label;
    row.getCell(2).value = value;
    row.getCell(1).font  = { bold: true, size: 11 };
    [1, 2].forEach((c) => {
      row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F4FF" } };
    });
  }

  const buffer   = await wb.xlsx.writeBuffer();
  const base64   = Buffer.from(buffer).toString("base64");
  const filename = `participation_${roundLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return { ok: true, base64, filename };
}

export async function exportLastClosedRoundParticipation(): Promise<{
  ok: boolean;
  error?: string;
  base64?: string;
  filename?: string;
}> {
  const admin = createAdminClient();
  const now   = new Date().toISOString();

  const { data: round, error: roundErr } = await admin
    .from("rounds")
    .select("id, name_key")
    .neq("stage", "podio")
    .lt("lock_time", now)
    .order("lock_time", { ascending: false })
    .limit(1)
    .single();

  if (roundErr || !round) return { ok: false, error: "No closed round found." };

  const label = round.name_key.replace("rounds.", "");
  return buildParticipationWorkbook(round.id, label);
}

export async function exportNextRoundParticipation(): Promise<{
  ok: boolean;
  error?: string;
  base64?: string;
  filename?: string;
}> {
  const admin = createAdminClient();
  const now   = new Date().toISOString();

  const { data: round, error: roundErr } = await admin
    .from("rounds")
    .select("id, name_key")
    .neq("stage", "podio")
    .gt("lock_time", now)
    .order("lock_time", { ascending: true })
    .limit(1)
    .single();

  if (roundErr || !round) return { ok: false, error: "No upcoming round found." };

  const label = round.name_key.replace("rounds.", "");
  return buildParticipationWorkbook(round.id, label);
}
