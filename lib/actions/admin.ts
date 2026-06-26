"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scorePrediction, scorePodio } from "@/lib/scoring/scoring";
import { syncResults } from "@/lib/sync";

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function requireAdmin(): Promise<null | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) return { ok: false, error: "Forbidden" };
  return null;
}

// ── Update match result ────────────────────────────────────────────────────────

const UpdateMatchSchema = z
  .object({
    matchId: z.string().uuid(),
    // Knockout-only: assign the teams qualifying into a bracket slot.
    // Omitted entirely for group matches (whose teams come from the feed).
    homeTeamId: z.string().uuid().nullable().optional(),
    awayTeamId: z.string().uuid().nullable().optional(),
    homeScore: z.number().int().min(0).nullable(),
    awayScore: z.number().int().min(0).nullable(),
    status: z.enum(["scheduled", "in_progress", "finished"]),
    penaltyWinnerTeamId: z.string().uuid().nullable(),
    advancingTeamId: z.string().uuid().nullable(),
  })
  .refine(
    (v) => !v.homeTeamId || !v.awayTeamId || v.homeTeamId !== v.awayTeamId,
    { message: "Home and away team must be different", path: ["awayTeamId"] }
  );

export type UpdateMatchInput = z.infer<typeof UpdateMatchSchema>;

export async function updateMatchResult(
  input: UpdateMatchInput
): Promise<ActionResult<{ matchId: string }>> {
  const guard = await requireAdmin();
  if (guard) return guard;

  const parsed = UpdateMatchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.message };

  const { matchId, homeScore, awayScore, status, penaltyWinnerTeamId, advancingTeamId } =
    parsed.data;
  // Only treat the team fields as part of the change when the caller sent them
  // (knockout rows). `undefined` means "leave the existing teams untouched".
  const setTeams =
    parsed.data.homeTeamId !== undefined || parsed.data.awayTeamId !== undefined;
  const homeTeamId = parsed.data.homeTeamId ?? null;
  const awayTeamId = parsed.data.awayTeamId ?? null;

  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Snapshot old value for audit
  const { data: oldMatch } = await admin
    .from("matches")
    .select(
      "home_team_id, away_team_id, home_score, away_score, status, penalty_winner_team_id, advancing_team_id"
    )
    .eq("id", matchId)
    .single();

  const newValue = {
    home_score: homeScore,
    away_score: awayScore,
    status,
    penalty_winner_team_id: penaltyWinnerTeamId,
    advancing_team_id: advancingTeamId,
    ...(setTeams ? { home_team_id: homeTeamId, away_team_id: awayTeamId } : {}),
  };

  const { error } = await admin.from("matches").update(newValue).eq("id", matchId);

  if (error) return { ok: false, error: error.message };

  await admin.from("match_audit").insert({
    match_id: matchId,
    changed_by: user!.id,
    old_value: oldMatch,
    new_value: newValue,
  });

  return { ok: true, data: { matchId } };
}

// ── Rescore all finished matches ───────────────────────────────────────────────

export async function rescoreAll(): Promise<ActionResult<{ updated: number }>> {
  const guard = await requireAdmin();
  if (guard) return guard;

  const admin = createAdminClient();

  // Fetch all finished matches with their round stage
  const { data: matches, error: matchErr } = await admin
    .from("matches")
    .select("id, home_score, away_score, penalty_winner_team_id, advancing_team_id, home_team_id, away_team_id, rounds(stage)")
    .eq("status", "finished");

  if (matchErr) return { ok: false, error: matchErr.message };
  if (!matches?.length) return { ok: true, data: { updated: 0 } };

  let updated = 0;

  for (const match of matches) {
    const roundData = Array.isArray(match.rounds) ? match.rounds[0] : match.rounds;
    const stage = roundData?.stage === "group" ? "group" : "knockout";

    const { data: preds } = await admin
      .from("predictions")
      .select("id, home_score_pred, away_score_pred, penalty_winner_team_id")
      .eq("match_id", match.id);

    if (!preds?.length) continue;

    for (const pred of preds) {
      const breakdown = scorePrediction(
        {
          home_score_pred: pred.home_score_pred,
          away_score_pred: pred.away_score_pred,
          penalty_winner_team_id: pred.penalty_winner_team_id,
        },
        {
          home_score: match.home_score,
          away_score: match.away_score,
          penalty_winner_team_id: match.penalty_winner_team_id,
          advancing_team_id: match.advancing_team_id,
          home_team_id: match.home_team_id,
          away_team_id: match.away_team_id,
        },
        stage
      );

      await admin
        .from("predictions")
        .update({ points_awarded: breakdown.total })
        .eq("id", pred.id);

      updated++;
    }
  }

  // Score podio predictions if Final and 3rd Place matches are finished
  const { data: finalRound } = await admin
    .from("rounds")
    .select("id")
    .eq("name_key", "rounds.knockout_final")
    .single();

  const { data: thirdRound } = await admin
    .from("rounds")
    .select("id")
    .eq("name_key", "rounds.knockout_3rd")
    .single();

  if (finalRound && thirdRound) {
    const { data: finalMatch } = await admin
      .from("matches")
      .select("home_team_id, away_team_id, home_score, away_score, advancing_team_id")
      .eq("round_id", finalRound.id)
      .eq("status", "finished")
      .maybeSingle();

    const { data: thirdMatch } = await admin
      .from("matches")
      .select("home_team_id, away_team_id, home_score, away_score, advancing_team_id")
      .eq("round_id", thirdRound.id)
      .eq("status", "finished")
      .maybeSingle();

    if (finalMatch && thirdMatch) {
      const champion =
        finalMatch.advancing_team_id ??
        (finalMatch.home_score > finalMatch.away_score
          ? finalMatch.home_team_id
          : finalMatch.away_team_id);
      const runnerUp =
        champion === finalMatch.home_team_id
          ? finalMatch.away_team_id
          : finalMatch.home_team_id;
      const thirdPlace =
        thirdMatch.advancing_team_id ??
        (thirdMatch.home_score > thirdMatch.away_score
          ? thirdMatch.home_team_id
          : thirdMatch.away_team_id);

      const actual = {
        champion_team_id: champion,
        runner_up_team_id: runnerUp,
        third_place_team_id: thirdPlace,
      };

      const { data: podioPreds } = await admin
        .from("podio_predictions")
        .select("id, champion_team_id, runner_up_team_id, third_place_team_id");

      for (const pred of podioPreds ?? []) {
        const pts = scorePodio(pred, actual);
        await admin.from("podio_predictions").update({ points_awarded: pts }).eq("id", pred.id);
      }
    }
  }

  return { ok: true, data: { updated } };
}

// ── Update user display name ───────────────────────────────────────────────────

const UpdateUserDisplayNameSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(50),
});

export async function updateUserDisplayName(
  input: z.infer<typeof UpdateUserDisplayNameSchema>
): Promise<ActionResult<{ userId: string; displayName: string }>> {
  const guard = await requireAdmin();
  if (guard) return guard;

  const parsed = UpdateUserDisplayNameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.message };

  const { userId, displayName } = parsed.data;
  const admin = createAdminClient();

  const { error } = await admin
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", userId);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { userId, displayName } };
}

// ── Update round lock_time ─────────────────────────────────────────────────────

const UpdateRoundLockTimeSchema = z.object({
  roundId: z.string().uuid(),
  lockTime: z.string().datetime(),
});

export async function updateRoundLockTime(
  input: z.infer<typeof UpdateRoundLockTimeSchema>
): Promise<ActionResult<{ roundId: string; lockTime: string }>> {
  const guard = await requireAdmin();
  if (guard) return guard;

  const parsed = UpdateRoundLockTimeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const { roundId, lockTime } = parsed.data;
  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: oldRound } = await admin
    .from("rounds")
    .select("stage, lock_time")
    .eq("id", roundId)
    .single();
  if (!oldRound) return { ok: false, error: "notFound" };

  // Ceiling = earliest kickoff in this round; podio falls back to R32
  let ceilingIso: string | null = null;
  const { data: minRow } = await admin
    .from("matches")
    .select("kickoff_at")
    .eq("round_id", roundId)
    .order("kickoff_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (minRow) {
    ceilingIso = minRow.kickoff_at;
  } else if (oldRound.stage === "podio") {
    const { data: r32 } = await admin
      .from("rounds")
      .select("id")
      .eq("name_key", "rounds.knockout_r32")
      .single();
    if (r32) {
      const { data: r32Min } = await admin
        .from("matches")
        .select("kickoff_at")
        .eq("round_id", r32.id)
        .order("kickoff_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      ceilingIso = r32Min?.kickoff_at ?? null;
    }
  }
  if (!ceilingIso) return { ok: false, error: "noCeiling" };

  if (new Date(lockTime).getTime() > new Date(ceilingIso).getTime()) {
    return { ok: false, error: "afterKickoff" };
  }

  const { error } = await admin
    .from("rounds")
    .update({ lock_time: lockTime })
    .eq("id", roundId);
  if (error) return { ok: false, error: error.message };

  await admin.from("round_audit").insert({
    round_id: roundId,
    changed_by: user!.id,
    old_value: { lock_time: oldRound.lock_time },
    new_value: { lock_time: lockTime },
  });

  return { ok: true, data: { roundId, lockTime } };
}

// ── Sync from football-data.org ────────────────────────────────────────────────

export async function syncFromFootballData(): Promise<
  ActionResult<{ updated: number; skipped: number; errors: string[] }>
> {
  const guard = await requireAdmin();
  if (guard) return guard;

  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) return { ok: false, error: "FOOTBALL_DATA_API_KEY is not configured." };

  const admin = createAdminClient();

  try {
    const result = await syncResults(admin, apiKey);
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── Next-round participation report ─────────────────────────────────────────────

export interface ParticipationRow {
  userId: string;
  displayName: string;
  predicted: number;
}

export interface ParticipationReport {
  roundNameKey: string;
  lockTime: string;
  totalMatches: number;
  rows: ParticipationRow[];
}

/**
 * Participation snapshot for the next round that is still open (the soonest
 * `lock_time` in the future, among rounds that actually have matches). For each
 * registered player it reports how many of the round's matches they have
 * predicted, so the admin can chase down stragglers before the deadline.
 */
export async function getNextRoundParticipation(): Promise<
  ActionResult<ParticipationReport>
> {
  const guard = await requireAdmin();
  if (guard) return guard;

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // Next round to close: earliest lock_time still in the future.
  const { data: nextRound } = await admin
    .from("rounds")
    .select("id, name_key, lock_time")
    .gt("lock_time", nowIso)
    .order("lock_time", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!nextRound) return { ok: false, error: "noOpenRound" };

  // Matches belonging to that round.
  const { data: matchRows } = await admin
    .from("matches")
    .select("id")
    .eq("round_id", nextRound.id);

  const matchIds = (matchRows ?? []).map((m) => m.id);
  const totalMatches = matchIds.length;

  // Every registered player.
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name")
    .order("display_name", { ascending: true });

  // Predictions for this round's matches, tallied per user. PostgREST caps a
  // single response at 1000 rows (Supabase free tier), and a group round
  // (24 matches × dozens of players) easily exceeds that — a single .in()
  // select would be silently truncated and undercount stragglers. Paginate so
  // every row is counted. (Same pattern as scoreboard/page.tsx.)
  const PAGE_SIZE = 1000;
  const counts = new Map<string, number>();
  if (matchIds.length > 0) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await admin
        .from("predictions")
        .select("user_id")
        .in("match_id", matchIds)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error || !data?.length) break;
      for (const p of data) {
        counts.set(p.user_id, (counts.get(p.user_id) ?? 0) + 1);
      }
      if (data.length < PAGE_SIZE) break;
    }
  }

  const rows: ParticipationRow[] = (profiles ?? []).map((p) => ({
    userId: p.id,
    displayName: p.display_name,
    predicted: counts.get(p.id) ?? 0,
  }));

  return {
    ok: true,
    data: {
      roundNameKey: nextRound.name_key,
      lockTime: nextRound.lock_time,
      totalMatches,
      rows,
    },
  };
}

// ── Podio participation report ──────────────────────────────────────────────────

export type PodioStatus = "none" | "partial" | "complete";

export interface PodioParticipationRow {
  userId: string;
  displayName: string;
  /** How many of the three podio slots (champion / runner-up / third) are filled. */
  filled: number;
  status: PodioStatus;
}

export interface PodioParticipationReport {
  lockTime: string | null;
  rows: PodioParticipationRow[];
}

/** The podio prediction has three slots, all required to count as complete. */
const PODIO_SLOTS = 3;

/**
 * Podio participation snapshot: for every registered player, whether they have
 * submitted their podium pick fully, partially, or not at all. There is a single
 * `stage = "podio"` round whose `lock_time` is the deadline; the admin client
 * bypasses RLS so this reads every player's row regardless of lock state.
 */
export async function getPodioParticipation(): Promise<
  ActionResult<PodioParticipationReport>
> {
  const guard = await requireAdmin();
  if (guard) return guard;

  const admin = createAdminClient();

  // Deadline for the podium pick (single stage="podio" round). Optional — the
  // report is still meaningful before the round row exists.
  const { data: podioRound } = await admin
    .from("rounds")
    .select("lock_time")
    .eq("stage", "podio")
    .maybeSingle();

  // Every registered player.
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name")
    .order("display_name", { ascending: true });

  // One podio row per user (upsert on user_id), so this is well under the 1000
  // PostgREST cap — no pagination needed.
  const { data: preds } = await admin
    .from("podio_predictions")
    .select("user_id, champion_team_id, runner_up_team_id, third_place_team_id");

  const filledByUser = new Map<string, number>();
  for (const p of preds ?? []) {
    let filled = 0;
    if (p.champion_team_id) filled += 1;
    if (p.runner_up_team_id) filled += 1;
    if (p.third_place_team_id) filled += 1;
    filledByUser.set(p.user_id, filled);
  }

  const rows: PodioParticipationRow[] = (profiles ?? []).map((p) => {
    const filled = filledByUser.get(p.id) ?? 0;
    const status: PodioStatus =
      filled === 0 ? "none" : filled >= PODIO_SLOTS ? "complete" : "partial";
    return { userId: p.id, displayName: p.display_name, filled, status };
  });

  return {
    ok: true,
    data: {
      lockTime: podioRound?.lock_time ?? null,
      rows,
    },
  };
}

// ── Podio results breakdown ─────────────────────────────────────────────────────

export interface PodioResultRow {
  teamId: string;
  nameEn: string;
  nameEs: string;
  nameKo: string;
  /** Submissions placing this team as champion. */
  first: number;
  /** Submissions placing this team as runner-up. */
  second: number;
  /** Submissions placing this team as third place. */
  third: number;
  /** Submissions that did not include this team in any podio slot. */
  off: number;
}

export interface PodioResultsReport {
  /** Number of podio submissions counted (rows with at least one slot filled). */
  totalSubmissions: number;
  rows: PodioResultRow[];
}

/**
 * Podio results breakdown: for every team that received at least one podio vote,
 * the share of submissions placing it 1st / 2nd / 3rd / off-podium. Denominator
 * is the number of submissions, so each team's four shares sum to 100%.
 */
export async function getPodioResults(): Promise<ActionResult<PodioResultsReport>> {
  const guard = await requireAdmin();
  if (guard) return guard;

  const admin = createAdminClient();

  const { data: teams } = await admin
    .from("teams")
    .select("id, name_en, name_es, name_ko");

  const { data: preds } = await admin
    .from("podio_predictions")
    .select("champion_team_id, runner_up_team_id, third_place_team_id");

  // Tally placements per team; a submission is any row with at least one slot.
  const first = new Map<string, number>();
  const second = new Map<string, number>();
  const third = new Map<string, number>();
  let totalSubmissions = 0;

  for (const p of preds ?? []) {
    if (!p.champion_team_id && !p.runner_up_team_id && !p.third_place_team_id) {
      continue;
    }
    totalSubmissions += 1;
    if (p.champion_team_id) first.set(p.champion_team_id, (first.get(p.champion_team_id) ?? 0) + 1);
    if (p.runner_up_team_id) second.set(p.runner_up_team_id, (second.get(p.runner_up_team_id) ?? 0) + 1);
    if (p.third_place_team_id) third.set(p.third_place_team_id, (third.get(p.third_place_team_id) ?? 0) + 1);
  }

  const rows: PodioResultRow[] = (teams ?? [])
    .map((t) => {
      const f = first.get(t.id) ?? 0;
      const s = second.get(t.id) ?? 0;
      const th = third.get(t.id) ?? 0;
      return {
        teamId: t.id,
        nameEn: t.name_en,
        nameEs: t.name_es,
        nameKo: t.name_ko,
        first: f,
        second: s,
        third: th,
        off: totalSubmissions - f - s - th,
      };
    })
    // Only teams with at least one podio vote.
    .filter((r) => r.first + r.second + r.third > 0);

  return { ok: true, data: { totalSubmissions, rows } };
}

// ── Current-round predictions workbook (Excel) ──────────────────────────────────

export interface CurrentPredictionsFile {
  filename: string;
  /** base64-encoded .xlsx payload. */
  base64: string;
}

export interface PredictionsFileLabels {
  player: string;
  noPrediction: string;
  penaltyWinner: string;
  kickoff: string;
  venue: string;
  /** Raw status value → display label. */
  statusValues: Record<string, string>;
  vs: string;
  fileBaseName: string;
}

/**
 * Builds an Excel workbook of every player's predictions for the current round's
 * matches that are NOT yet finished — one sheet per match, players alphabetical.
 * "Current round" is the first non-podio round (by order_index) that still has
 * any unfinished match. Returns the file base64-encoded for the client to save.
 */
export async function getCurrentRoundPredictionsFile(
  locale: string,
  labels: PredictionsFileLabels
): Promise<ActionResult<CurrentPredictionsFile>> {
  const guard = await requireAdmin();
  if (guard) return guard;

  const admin = createAdminClient();

  const { data: rounds } = await admin
    .from("rounds")
    .select(
      `id, name_key, order_index, stage,
       matches (
         id, kickoff_at, venue, status,
         home_team:home_team_id ( id, name_en, name_es, name_ko, code ),
         away_team:away_team_id ( id, name_en, name_es, name_ko, code )
       )`
    )
    .neq("stage", "podio")
    .order("order_index", { ascending: true });

  const one = (rel: unknown) =>
    Array.isArray(rel) ? (rel[0] ?? null) : (rel ?? null);
  const teamName = (team: {
    name_en: string;
    name_es: string;
    name_ko: string;
  } | null): string => {
    if (!team) return "—";
    if (locale === "ko") return team.name_ko;
    if (locale === "en") return team.name_en;
    return team.name_es;
  };

  const currentRound = (rounds ?? []).find((r) =>
    (r.matches ?? []).some((m: { status: string }) => m.status !== "finished")
  );
  if (!currentRound) return { ok: false, error: "noCurrentRound" };

  const isKnockout = currentRound.stage !== "group";

  const matches = (currentRound.matches ?? [])
    .filter((m: { status: string }) => m.status !== "finished")
    .sort((a: { kickoff_at: string | null }, b: { kickoff_at: string | null }) =>
      String(a.kickoff_at ?? "").localeCompare(String(b.kickoff_at ?? ""))
    );

  if (matches.length === 0) return { ok: false, error: "noCurrentRound" };

  const matchIds = matches.map((m: { id: string }) => m.id);

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name")
    .order("display_name", { ascending: true });

  // Predictions for these matches, tallied per match → user. 62 players × 24
  // matches exceeds the 1000-row PostgREST cap, so paginate (see participation).
  const PAGE_SIZE = 1000;
  const byMatch = new Map<
    string,
    Map<string, { h: number; a: number; pen: string | null }>
  >();
  if (matchIds.length > 0) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await admin
        .from("predictions")
        .select(
          "match_id, user_id, home_score_pred, away_score_pred, penalty_winner_team_id"
        )
        .in("match_id", matchIds)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error || !data?.length) break;
      for (const p of data) {
        let m = byMatch.get(p.match_id);
        if (!m) {
          m = new Map();
          byMatch.set(p.match_id, m);
        }
        m.set(p.user_id, {
          h: p.home_score_pred,
          a: p.away_score_pred,
          pen: p.penalty_winner_team_id,
        });
      }
      if (data.length < PAGE_SIZE) break;
    }
  }

  // ── Build the workbook ───────────────────────────────────────────────────────
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  const NAVY = "FF1A2855";
  const PINK = "FFE91E8C";
  const STRIPE = "FFF3F4F6";
  const MUTED = "FF9CA3AF";

  const usedNames = new Set<string>();
  function sheetName(raw: string, idx: number): string {
    const cleaned = raw.replace(/[\\/?*[\]:]/g, " ").trim();
    let candidate = `${idx + 1}. ${cleaned}`.slice(0, 31);
    let n = 2;
    while (usedNames.has(candidate)) {
      candidate = `${idx + 1}.${n++} ${cleaned}`.slice(0, 31);
    }
    usedNames.add(candidate);
    return candidate;
  }

  matches.forEach(
    (
      m: {
        id: string;
        kickoff_at: string | null;
        venue: string | null;
        status: string;
        home_team: unknown;
        away_team: unknown;
      },
      idx: number
    ) => {
      const home = one(m.home_team) as {
        id: string;
        name_en: string;
        name_es: string;
        name_ko: string;
        code: string;
      } | null;
      const away = one(m.away_team) as typeof home;
      const homeName = teamName(home);
      const awayName = teamName(away);

      const colCount = isKnockout ? 4 : 3;
      const ws = wb.addWorksheet(
        sheetName(`${home?.code ?? "?"} vs ${away?.code ?? "?"}`, idx),
        { views: [{ state: "frozen", ySplit: 4 }] }
      );

      ws.getColumn(1).width = 30;
      ws.getColumn(2).width = Math.max(14, homeName.length + 4);
      ws.getColumn(3).width = Math.max(14, awayName.length + 4);
      if (isKnockout) ws.getColumn(4).width = 22;

      // Title row.
      ws.mergeCells(1, 1, 1, colCount);
      const title = ws.getCell(1, 1);
      title.value = `${homeName} ${labels.vs} ${awayName}`;
      title.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
      title.alignment = { horizontal: "center", vertical: "middle" };
      title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      ws.getRow(1).height = 26;

      // Subtitle: kickoff · venue · status.
      ws.mergeCells(2, 1, 2, colCount);
      const subtitleParts: string[] = [];
      if (m.kickoff_at) {
        subtitleParts.push(
          `${labels.kickoff}: ${new Date(m.kickoff_at).toLocaleString(locale, {
            dateStyle: "medium",
            timeStyle: "short",
          })}`
        );
      }
      if (m.venue) subtitleParts.push(`${labels.venue}: ${m.venue}`);
      subtitleParts.push(labels.statusValues[m.status] ?? m.status);
      const subtitle = ws.getCell(2, 1);
      subtitle.value = subtitleParts.join("   ·   ");
      subtitle.font = { italic: true, size: 10, color: { argb: MUTED } };
      subtitle.alignment = { horizontal: "center" };

      // Header row (row 4).
      const headers = isKnockout
        ? [labels.player, homeName, awayName, labels.penaltyWinner]
        : [labels.player, homeName, awayName];
      const headerRow = ws.getRow(4);
      headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PINK } };
        cell.alignment = {
          horizontal: i === 0 ? "left" : "center",
          vertical: "middle",
        };
        cell.border = { bottom: { style: "thin", color: { argb: NAVY } } };
      });
      headerRow.height = 20;

      // Data rows (one per player, alphabetical).
      (profiles ?? []).forEach((prof, i) => {
        const pred = byMatch.get(m.id)?.get(prof.id);
        const row = ws.getRow(5 + i);
        const nameCell = row.getCell(1);
        nameCell.value = prof.display_name;
        nameCell.alignment = { horizontal: "left" };

        if (pred) {
          row.getCell(2).value = pred.h;
          row.getCell(3).value = pred.a;
          if (isKnockout) {
            const penName = !pred.pen
              ? "—"
              : pred.pen === home?.id
                ? homeName
                : pred.pen === away?.id
                  ? awayName
                  : "—";
            row.getCell(4).value = penName;
          }
        } else {
          row.getCell(2).value = "—";
          row.getCell(3).value = "—";
          if (isKnockout) row.getCell(4).value = "—";
          nameCell.font = { color: { argb: MUTED } };
        }

        for (let c = 2; c <= colCount; c++) {
          row.getCell(c).alignment = { horizontal: "center" };
          if (!pred) row.getCell(c).font = { color: { argb: MUTED } };
        }

        // Zebra striping for readability.
        if (i % 2 === 1) {
          for (let c = 1; c <= colCount; c++) {
            row.getCell(c).fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: STRIPE },
            };
          }
        }
      });
    }
  );

  const buffer = await wb.xlsx.writeBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const datePart = new Date().toISOString().slice(0, 10);
  const filename = `${labels.fileBaseName}-${datePart}.xlsx`;

  return { ok: true, data: { filename, base64 } };
}
