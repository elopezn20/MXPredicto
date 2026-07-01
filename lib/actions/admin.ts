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

// ── Current-round predictions matrix (PDF) ──────────────────────────────────────

export interface PredictionsMatrixMatch {
  id: string;
  homeCode: string;
  awayCode: string;
  homeName: string;
  awayName: string;
  kickoff: string | null;
}

export interface PredictionsMatrixUser {
  userId: string;
  displayName: string;
  /**
   * Prediction per match, keyed by match id. `score` is "h-a" (or null if the
   * player has no prediction for that match); `pen` is the penalty winner's team
   * code for knockout matches, or null.
   */
  cells: Record<string, { score: string; pen: string | null } | null>;
}

export interface PredictionsMatrixReport {
  roundNameKey: string;
  lockTime: string | null;
  isKnockout: boolean;
  matches: PredictionsMatrixMatch[];
  users: PredictionsMatrixUser[];
}

/**
 * Every player's predictions for the current round, shaped as a matrix: one row
 * per player (alphabetical) and one column per match. "Current round" is the
 * first non-podio round (by order_index) that still has any unfinished match.
 * The client renders this into a single printable PDF.
 */
export async function getCurrentRoundPredictionsMatrix(
  locale: string
): Promise<ActionResult<PredictionsMatrixReport>> {
  const guard = await requireAdmin();
  if (guard) return guard;

  const admin = createAdminClient();

  const { data: rounds } = await admin
    .from("rounds")
    .select(
      `id, name_key, order_index, stage, lock_time,
       matches (
         id, kickoff_at, status,
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

  const rawMatches = (currentRound.matches ?? [])
    .slice()
    .sort((a: { kickoff_at: string | null }, b: { kickoff_at: string | null }) =>
      String(a.kickoff_at ?? "").localeCompare(String(b.kickoff_at ?? ""))
    );

  if (rawMatches.length === 0) return { ok: false, error: "noCurrentRound" };

  // Resolve team refs once; keep the ids around to map penalty winners to codes.
  const matchMeta = rawMatches.map(
    (m: {
      id: string;
      kickoff_at: string | null;
      home_team: unknown;
      away_team: unknown;
    }) => {
      const home = one(m.home_team) as {
        id: string;
        name_en: string;
        name_es: string;
        name_ko: string;
        code: string;
      } | null;
      const away = one(m.away_team) as typeof home;
      return { id: m.id, kickoff: m.kickoff_at, home, away };
    }
  );

  const matches: PredictionsMatrixMatch[] = matchMeta.map((m) => ({
    id: m.id,
    homeCode: m.home?.code ?? "?",
    awayCode: m.away?.code ?? "?",
    homeName: teamName(m.home),
    awayName: teamName(m.away),
    kickoff: m.kickoff,
  }));

  const matchIds = matchMeta.map((m) => m.id);
  const homeIdByMatch = new Map(matchMeta.map((m) => [m.id, m.home?.id ?? null]));
  const awayIdByMatch = new Map(matchMeta.map((m) => [m.id, m.away?.id ?? null]));
  const homeCodeByMatch = new Map(matches.map((m) => [m.id, m.homeCode]));
  const awayCodeByMatch = new Map(matches.map((m) => [m.id, m.awayCode]));

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name")
    .order("display_name", { ascending: true });

  // Predictions for these matches, keyed match → user. 60+ players × 16 matches
  // can exceed the 1000-row PostgREST cap, so paginate (see participation).
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

  const users: PredictionsMatrixUser[] = (profiles ?? []).map((prof) => {
    const cells: PredictionsMatrixUser["cells"] = {};
    for (const id of matchIds) {
      const pred = byMatch.get(id)?.get(prof.id);
      if (!pred) {
        cells[id] = null;
        continue;
      }
      let pen: string | null = null;
      if (isKnockout && pred.pen) {
        if (pred.pen === homeIdByMatch.get(id)) pen = homeCodeByMatch.get(id) ?? null;
        else if (pred.pen === awayIdByMatch.get(id)) pen = awayCodeByMatch.get(id) ?? null;
      }
      cells[id] = { score: `${pred.h}-${pred.a}`, pen };
    }
    return { userId: prof.id, displayName: prof.display_name, cells };
  });

  return {
    ok: true,
    data: {
      roundNameKey: currentRound.name_key,
      lockTime: currentRound.lock_time ?? null,
      isKnockout,
      matches,
      users,
    },
  };
}

// ── Podio predictions per player (PDF) ──────────────────────────────────────────

export interface PodioTeamRef {
  nameEn: string;
  nameEs: string;
  nameKo: string;
}

export interface PodioPredictionRow {
  userId: string;
  displayName: string;
  champion: PodioTeamRef | null;
  runnerUp: PodioTeamRef | null;
  third: PodioTeamRef | null;
}

export interface PodioPredictionsListReport {
  lockTime: string | null;
  rows: PodioPredictionRow[];
}

/**
 * Every player's podium pick, one row per player (alphabetical) with their
 * champion / runner-up / third-place teams. The admin client bypasses RLS so
 * this reads every player's row regardless of lock state. The client renders it
 * into a single printable PDF (parallel to the current-round predictions PDF).
 */
export async function getPodioPredictionsList(): Promise<
  ActionResult<PodioPredictionsListReport>
> {
  const guard = await requireAdmin();
  if (guard) return guard;

  const admin = createAdminClient();

  // Deadline for the podium pick (single stage="podio" round). Optional.
  const { data: podioRound } = await admin
    .from("rounds")
    .select("lock_time")
    .eq("stage", "podio")
    .maybeSingle();

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name")
    .order("display_name", { ascending: true });

  const { data: teams } = await admin
    .from("teams")
    .select("id, name_en, name_es, name_ko");

  const teamById = new Map<string, PodioTeamRef>();
  for (const t of teams ?? []) {
    teamById.set(t.id, { nameEn: t.name_en, nameEs: t.name_es, nameKo: t.name_ko });
  }

  // One podio row per user (upsert on user_id) — well under the 1000-row cap.
  const { data: preds } = await admin
    .from("podio_predictions")
    .select("user_id, champion_team_id, runner_up_team_id, third_place_team_id");

  const predByUser = new Map<
    string,
    { champion: string | null; runnerUp: string | null; third: string | null }
  >();
  for (const p of preds ?? []) {
    predByUser.set(p.user_id, {
      champion: p.champion_team_id,
      runnerUp: p.runner_up_team_id,
      third: p.third_place_team_id,
    });
  }

  const teamRef = (id: string | null | undefined): PodioTeamRef | null =>
    id ? (teamById.get(id) ?? null) : null;

  const rows: PodioPredictionRow[] = (profiles ?? []).map((p) => {
    const pick = predByUser.get(p.id);
    return {
      userId: p.id,
      displayName: p.display_name,
      champion: teamRef(pick?.champion),
      runnerUp: teamRef(pick?.runnerUp),
      third: teamRef(pick?.third),
    };
  });

  return {
    ok: true,
    data: {
      lockTime: podioRound?.lock_time ?? null,
      rows,
    },
  };
}
