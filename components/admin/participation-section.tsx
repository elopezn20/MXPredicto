"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  getCurrentRoundPredictionsMatrix,
  getNextRoundParticipation,
  getPodioParticipation,
  getPodioPredictionsList,
  getPodioResults,
  type ParticipationReport,
  type PredictionsMatrixReport,
  type PodioParticipationReport,
  type PodioPredictionsListReport,
  type PodioTeamRef,
  type PodioResultsReport,
  type PodioStatus,
} from "@/lib/actions/admin";

const PODIO_SLOTS = 3;

/**
 * Team row colors keyed by English team name. `text` is chosen for contrast
 * against `bg`. Teams not listed fall back to white (dark text).
 */
const TEAM_COLORS: Record<string, { bg: string; text: string }> = {
  France: { bg: "#0055A4", text: "#ffffff" },
  Spain: { bg: "#C60B1E", text: "#ffffff" },
  England: { bg: "#ffffff", text: "#111111" },
  Argentina: { bg: "#75AADB", text: "#111111" },
  Portugal: { bg: "#C60B1E", text: "#ffffff" },
  Brazil: { bg: "#FFDF00", text: "#111111" },
  Germany: { bg: "#000000", text: "#ffffff" },
  Netherlands: { bg: "#FF7900", text: "#111111" },
  Belgium: { bg: "#E30613", text: "#ffffff" },
  Japan: { bg: "#ffffff", text: "#BC002D" },
};

const DEFAULT_TEAM_COLOR = { bg: "#ffffff", text: "#111111" };

function teamColor(nameEn: string): { bg: string; text: string } {
  return TEAM_COLORS[nameEn] ?? DEFAULT_TEAM_COLOR;
}

function pct(predicted: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((predicted / total) * 100);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function ParticipationSection() {
  const t = useTranslations("admin.participation");
  const tRounds = useTranslations("rounds");
  const locale = useLocale();

  function teamName(r: {
    nameEn: string;
    nameEs: string;
    nameKo: string;
  }): string {
    if (locale === "ko") return r.nameKo;
    if (locale === "en") return r.nameEn;
    return r.nameEs;
  }

  type View = "matches" | "podio" | "results";
  const [activeView, setActiveView] = useState<View | null>(null);

  const [report, setReport] = useState<ParticipationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [podioReport, setPodioReport] = useState<PodioParticipationReport | null>(
    null
  );
  const [podioError, setPodioError] = useState<string | null>(null);
  const [isPodioPending, startPodioTransition] = useTransition();

  const [resultsReport, setResultsReport] = useState<PodioResultsReport | null>(
    null
  );
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [isResultsPending, startResultsTransition] = useTransition();

  const [fileError, setFileError] = useState<string | null>(null);
  const [isFilePending, startFileTransition] = useTransition();

  const [podioListError, setPodioListError] = useState<string | null>(null);
  const [isPodioListPending, startPodioListTransition] = useTransition();

  function roundLabel(nameKey: string): string {
    const key = nameKey.replace("rounds.", "") as Parameters<typeof tRounds>[0];
    return tRounds(key);
  }

  function podioStatusLabel(status: PodioStatus): string {
    if (status === "complete") return t("statusComplete");
    if (status === "partial") return t("statusPartial");
    return t("statusNone");
  }

  function handleLoad() {
    setError(null);
    setActiveView("matches");
    startTransition(async () => {
      const result = await getNextRoundParticipation();
      if (result.ok) {
        setReport(result.data!);
      } else {
        setReport(null);
        setError(result.error === "noOpenRound" ? t("noOpenRound") : t("errorGeneric"));
      }
    });
  }

  function handleLoadPodio() {
    setPodioError(null);
    setActiveView("podio");
    startPodioTransition(async () => {
      const result = await getPodioParticipation();
      if (result.ok) {
        setPodioReport(result.data!);
      } else {
        setPodioReport(null);
        setPodioError(t("errorGeneric"));
      }
    });
  }

  function handleLoadResults() {
    setResultsError(null);
    setActiveView("results");
    startResultsTransition(async () => {
      const result = await getPodioResults();
      if (result.ok) {
        setResultsReport(result.data!);
      } else {
        setResultsReport(null);
        setResultsError(t("errorGeneric"));
      }
    });
  }

  function handleExportCurrent() {
    setFileError(null);
    startFileTransition(async () => {
      const result = await getCurrentRoundPredictionsMatrix(locale);

      if (!result.ok) {
        setFileError(
          result.error === "noCurrentRound" ? t("noCurrentRound") : t("errorGeneric")
        );
        return;
      }

      renderCurrentPredictionsPdf(result.data!);
    });
  }

  function renderCurrentPredictionsPdf(data: PredictionsMatrixReport) {
    const title = t("currentPdfTitle");
    const roundName = roundLabel(data.roundNameKey);
    const generatedStr = new Date().toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    const lockStr = data.lockTime
      ? new Date(data.lockTime).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";

    const users = [...data.users].sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );

    const fmt1 = (n: number) =>
      n.toLocaleString(locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });

    const flagImg = (url: string | null, size: "sm" | "lg"): string =>
      url
        ? `<img class="flag ${size}" src="${escapeHtml(url)}" alt="" onerror="this.style.display='none'" />`
        : "";

    // ── Per-match aggregates ─────────────────────────────────────────────
    // For every match: average predicted score, advance votes (outright win,
    // or a draw plus that team as penalty pick), draw share, and the mode
    // score.
    const statsByMatch = data.matches.map((m) => {
      const preds = users.flatMap((u) => {
        const c = u.cells[m.id];
        return c ? [{ name: u.displayName, h: c.h, a: c.a, pen: c.pen }] : [];
      });

      const count = preds.length;
      const avgH = count ? preds.reduce((s, p) => s + p.h, 0) / count : 0;
      const avgA = count ? preds.reduce((s, p) => s + p.a, 0) / count : 0;

      let homeVotes = 0;
      let awayVotes = 0;
      for (const p of preds) {
        if (p.h > p.a) homeVotes += 1;
        else if (p.h < p.a) awayVotes += 1;
        else if (p.pen === m.homeCode) homeVotes += 1;
        else if (p.pen === m.awayCode) awayVotes += 1;
      }
      const draws = preds.filter((p) => p.h === p.a).length;

      const freq = new Map<string, number>();
      for (const p of preds) {
        const key = `${p.h}-${p.a}`;
        freq.set(key, (freq.get(key) ?? 0) + 1);
      }
      let topScore: { score: string; count: number } | null = null;
      for (const [score, c] of freq) {
        if (!topScore || c > topScore.count) topScore = { score, count: c };
      }

      return {
        match: m,
        count,
        avgH,
        avgA,
        homeVotes,
        awayVotes,
        draws,
        topScore,
      };
    });

    // ── Section 1: average score cards ───────────────────────────────────
    const matchCards = statsByMatch
      .map((s) => {
        const m = s.match;
        if (s.count === 0) {
          return `<div class="mcard">
            <div class="avgrow">
              <div class="tteam">${flagImg(m.homeFlagUrl, "lg")}<span>${escapeHtml(m.homeName)}</span></div>
              <div class="avgscore muted">—</div>
              <div class="tteam right"><span>${escapeHtml(m.awayName)}</span>${flagImg(m.awayFlagUrl, "lg")}</div>
            </div>
            <div class="mmeta">${escapeHtml(t("noPredictionsYet"))}</div>
          </div>`;
        }
        const topScoreStr = s.topScore
          ? ` · ${escapeHtml(t("topScoreLabel"))}: <strong>${escapeHtml(s.topScore.score)}</strong> (×${s.topScore.count})`
          : "";
        return `<div class="mcard">
          <div class="avgrow">
            <div class="tteam">${flagImg(m.homeFlagUrl, "lg")}<span>${escapeHtml(m.homeName)}</span></div>
            <div class="avgscore">${fmt1(s.avgH)}<span class="dash">–</span>${fmt1(s.avgA)}</div>
            <div class="tteam right"><span>${escapeHtml(m.awayName)}</span>${flagImg(m.awayFlagUrl, "lg")}</div>
          </div>
          <div class="mmeta">${escapeHtml(t("predictionsCountLabel", { count: s.count }))}${topScoreStr}</div>
        </div>`;
      })
      .join("");

    // ── Section 3: advance-consensus horizontal bars ─────────────────────
    // One bar per match, favored team on the left, sorted by strongest
    // consensus first.
    const barData = statsByMatch
      .filter((s) => s.homeVotes + s.awayVotes > 0)
      .map((s) => {
        const denom = s.homeVotes + s.awayVotes;
        const homeFav = s.homeVotes >= s.awayVotes;
        const m = s.match;
        const pct = Math.round((Math.max(s.homeVotes, s.awayVotes) / denom) * 100);
        return {
          pct,
          otherPct: 100 - pct,
          favCode: homeFav ? m.homeCode : m.awayCode,
          favFlag: homeFav ? m.homeFlagUrl : m.awayFlagUrl,
          otherCode: homeFav ? m.awayCode : m.homeCode,
          otherFlag: homeFav ? m.awayFlagUrl : m.homeFlagUrl,
          denom,
        };
      })
      .sort((a, b) => b.pct - a.pct);

    const barRows = barData
      .map(
        (b) => `<div class="brow">
          <div class="bteam">${flagImg(b.favFlag, "lg")}<span>${escapeHtml(b.favCode)}</span></div>
          <div class="btrack">
            <div class="bfill" style="width:${b.pct}%">${b.pct >= 12 ? `<span>${b.pct}%</span>` : ""}</div>
            ${b.otherPct > 0 ? `<div class="brest" style="width:${b.otherPct}%">${b.otherPct >= 12 ? `<span>${b.otherPct}%</span>` : ""}</div>` : ""}
          </div>
          <div class="bteam right"><span>${escapeHtml(b.otherCode)}</span>${flagImg(b.otherFlag, "lg")}</div>
        </div>`
      )
      .join("");

    // ── Section 2: crowd-alignment ranking ───────────────────────────────
    // Every player's average distance to the crowd's average score across
    // the matches they predicted (Δ = |Δhome| + |Δaway| per match).
    const playerAgg = users
      .map((u) => {
        let n = 0;
        let goals = 0;
        let dist = 0;
        for (const s of statsByMatch) {
          const c = u.cells[s.match.id];
          if (!c) continue;
          n += 1;
          goals += c.h + c.a;
          dist += Math.abs(c.h - s.avgH) + Math.abs(c.a - s.avgA);
        }
        return {
          name: u.displayName,
          n,
          avgGoals: n ? goals / n : 0,
          avgDist: n ? dist / n : 0,
        };
      })
      .filter((p) => p.n > 0);

    const fmt2 = (n: number) =>
      n.toLocaleString(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    const rankingRows = [...playerAgg]
      .sort((a, b) => a.avgDist - b.avgDist || a.name.localeCompare(b.name))
      .map(
        (p, i) => `<div class="rrow ${i < 3 ? "top" : ""}">
          <span class="rrank">${i + 1}</span>
          <span class="rname">${escapeHtml(p.name)}</span>
          <span class="rmeta">Δ ${fmt2(p.avgDist)} · ${p.n}/${data.matches.length}</span>
        </div>`
      )
      .join("");

    // ── Section 4: fun stats ─────────────────────────────────────────────
    // A player qualifies once they predicted at least half the matches.
    const minMatches = Math.max(1, Math.ceil(data.matches.length / 2));
    const qualified = playerAgg.filter((p) => p.n >= minMatches);

    const maxBy = <T,>(arr: T[], f: (v: T) => number): T | null =>
      arr.length
        ? arr.reduce((best, v) => (f(v) > f(best) ? v : best))
        : null;
    const goalFest = maxBy(qualified, (p) => p.avgGoals);
    const cautious = maxBy(qualified, (p) => -p.avgGoals);

    const totalPreds = statsByMatch.reduce((s, m) => s + m.count, 0);
    const totalDraws = statsByMatch.reduce((s, m) => s + m.draws, 0);
    const pensPct = totalPreds ? Math.round((totalDraws / totalPreds) * 100) : 0;
    const mostDrawn = maxBy(
      statsByMatch.filter((s) => s.count > 0),
      (s) => s.draws / s.count
    );

    const globalFreq = new Map<string, number>();
    for (const u of users) {
      for (const m of data.matches) {
        const c = u.cells[m.id];
        if (!c) continue;
        globalFreq.set(c.score, (globalFreq.get(c.score) ?? 0) + 1);
      }
    }
    let globalTop: { score: string; count: number } | null = null;
    for (const [score, c] of globalFreq) {
      if (!globalTop || c > globalTop.count) globalTop = { score, count: c };
    }

    const statCard = (
      emoji: string,
      label: string,
      value: string,
      sub: string
    ) => `<div class="stat">
      <div class="stat-label">${emoji} ${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(value)}</div>
      <div class="stat-sub">${escapeHtml(sub)}</div>
    </div>`;

    const statCards = [
      goalFest &&
        statCard(
          "🥅",
          t("statGoalFest"),
          goalFest.name,
          t("statGoalFestDetail", { avg: fmt1(goalFest.avgGoals) })
        ),
      cautious &&
        statCard(
          "🧊",
          t("statCautious"),
          cautious.name,
          t("statGoalFestDetail", { avg: fmt1(cautious.avgGoals) })
        ),
      totalPreds > 0 &&
        statCard(
          "⚽",
          t("statPens"),
          `${pensPct}%`,
          mostDrawn
            ? t("statPensDetail", {
                match: `${mostDrawn.match.homeCode} · ${mostDrawn.match.awayCode}`,
                pct: Math.round((mostDrawn.draws / mostDrawn.count) * 100),
              })
            : ""
        ),
      globalTop &&
        statCard(
          "📊",
          t("statTopScore"),
          globalTop.score,
          t("statTopScoreDetail", { count: globalTop.count })
        ),
    ]
      .filter(Boolean)
      .join("");

    // ── Section 4: full predictions matrix ───────────────────────────────
    const headCells = data.matches
      .map(
        (m, i) => `<th class="match">
          <div class="mnum">${i + 1}</div>
          <div class="mflags">${flagImg(m.homeFlagUrl, "sm")}${flagImg(m.awayFlagUrl, "sm")}</div>
          <div class="mteams">${escapeHtml(m.homeCode)}<span>v</span>${escapeHtml(m.awayCode)}</div>
        </th>`
      )
      .join("");

    const bodyRows = users
      .map((u, i) => {
        const cells = data.matches
          .map((m) => {
            const cell = u.cells[m.id];
            if (!cell) return `<td class="empty">—</td>`;
            const pen = cell.pen
              ? `<span class="pen">P:${escapeHtml(cell.pen)}</span>`
              : "";
            return `<td><span class="score">${escapeHtml(cell.score)}</span>${pen}</td>`;
          })
          .join("");
        return `<tr class="${i % 2 === 1 ? "alt" : ""}">
          <td class="player">${escapeHtml(u.displayName)}</td>
          ${cells}
        </tr>`;
      })
      .join("");

    const origin = window.location.origin;

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} — ${escapeHtml(roundName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
  :root {
    --navy: #1A2855;
    --gold: #F4C430;
    --cream: #F5F0E6;
    --pink: #E91E8C;
    --ink: #0A0A0A;
    --muted: #5B6478;
    --line: #D9CFBE;
  }
  * { box-sizing: border-box; }
  body {
    font-family: "Noto Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink);
    margin: 20px 24px;
    background: #fff;
  }

  /* Header — mirrors the site navbar: dark gradient, logo, glow line */
  header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 20px;
    border-radius: 12px 12px 0 0;
    background: linear-gradient(90deg, #05060A, #0B0F1F, #140A1A);
    color: var(--cream);
  }
  header .logo { height: 44px; width: auto; }
  header .head-main { flex: 1; }
  header h1 { font-size: 21px; font-weight: 800; margin: 0; letter-spacing: 0.02em; }
  header .sub { font-size: 12px; margin-top: 3px; color: rgba(245, 240, 230, 0.75); }
  header .sub strong { color: var(--gold); font-weight: 700; }
  header .head-meta { text-align: right; font-size: 10.5px; color: rgba(245, 240, 230, 0.65); }
  header .head-meta div { margin: 2px 0; }
  .glowline {
    height: 3px;
    margin-bottom: 20px;
    border-radius: 0 0 3px 3px;
    background: linear-gradient(90deg, transparent, var(--pink), var(--gold), transparent);
  }

  section { margin-bottom: 22px; }
  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 800;
    color: var(--navy);
    margin: 0 0 4px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  h2 .chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: var(--navy);
    color: var(--gold);
    font-size: 12px;
  }
  .caption { font-size: 11px; color: var(--muted); margin: 0 0 10px; }

  .flag { object-fit: contain; }
  .flag.lg { height: 22px; width: 30px; }
  .flag.sm { height: 11px; width: 15px; }

  /* Match average cards */
  .match-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .mcard {
    border: 1px solid var(--line);
    border-top: 3px solid var(--gold);
    border-radius: 10px;
    padding: 12px 14px;
    background: #fff;
    page-break-inside: avoid;
  }
  .avgrow { display: flex; align-items: center; gap: 10px; }
  .tteam { display: flex; flex: 1; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--navy); }
  .tteam.right { justify-content: flex-end; text-align: right; }
  .avgscore { font-size: 24px; font-weight: 800; color: var(--navy); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .avgscore .dash { color: var(--gold); margin: 0 6px; }
  .avgscore.muted { color: var(--muted); }
  .mmeta { font-size: 10.5px; color: var(--muted); margin: 6px 0 0; text-align: center; }

  /* Crowd-alignment ranking */
  .rank-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 20px; }
  .rrow {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    border-bottom: 1px solid var(--line);
    padding: 3px 0;
    page-break-inside: avoid;
  }
  .rrank {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    background: var(--cream);
    color: var(--navy);
    font-weight: 800;
    font-size: 10px;
  }
  .rrow.top .rrank { background: var(--gold); }
  .rname { flex: 1; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rmeta { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 10px; }

  /* Advance-consensus bars */
  .bars { display: flex; flex-direction: column; gap: 10px; }
  .brow { display: flex; align-items: center; gap: 12px; page-break-inside: avoid; }
  .bteam { display: flex; align-items: center; gap: 7px; width: 96px; font-weight: 800; font-size: 13px; color: var(--navy); }
  .bteam.right { justify-content: flex-end; }
  .btrack {
    flex: 1;
    display: flex;
    height: 24px;
    border-radius: 7px;
    overflow: hidden;
    border: 1px solid var(--line);
  }
  .bfill {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    background: var(--navy);
    color: var(--gold);
    font-size: 11.5px;
    font-weight: 800;
    padding: 0 8px;
  }
  .brest {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    background: var(--cream);
    color: var(--muted);
    font-size: 11.5px;
    font-weight: 700;
    padding: 0 8px;
  }

  /* Fun stats */
  .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .stat {
    border: 1px solid var(--line);
    border-left: 4px solid var(--gold);
    border-radius: 10px;
    background: #fff;
    padding: 10px 12px;
    page-break-inside: avoid;
  }
  .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 700; }
  .stat-value { font-size: 17px; font-weight: 800; color: var(--navy); margin: 3px 0 2px; }
  .stat-sub { font-size: 10.5px; color: var(--muted); }

  /* Predictions matrix */
  table { width: 100%; border-collapse: collapse; font-size: 10px; table-layout: fixed; }
  th, td { padding: 4px 3px; text-align: center; border: 1px solid var(--line); }
  thead th { background: var(--navy); color: var(--cream); font-weight: 600; }
  th.player, td.player { text-align: left; width: 130px; padding-left: 8px; }
  th.match .mnum { font-size: 8px; opacity: .7; font-weight: 500; }
  th.match .mflags { display: flex; justify-content: center; gap: 3px; margin: 2px 0; }
  th.match .mteams { font-weight: 700; white-space: nowrap; }
  th.match .mteams span { opacity: .55; font-weight: 400; margin: 0 2px; color: var(--gold); }
  td.player { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  td .score { font-variant-numeric: tabular-nums; font-weight: 600; }
  td .pen { display: block; font-size: 7px; color: var(--pink); font-weight: 700; }
  td.empty { color: #9CA3AF; }
  tr.alt td { background: var(--cream); }
  tr.alt td.player { background: #EDE6D6; }

  .page-break { page-break-before: always; }
  @page { size: landscape; margin: 10mm; }
  @media print {
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <header>
    <img class="logo" src="${escapeHtml(origin)}/logo.svg" alt="MX Predicto" onerror="this.style.display='none'" />
    <div class="head-main">
      <h1>${escapeHtml(title)}</h1>
      <div class="sub"><strong>${escapeHtml(roundName)}</strong> · ${escapeHtml(t("totalMatchesLabel", { count: data.matches.length }))} · ${escapeHtml(t("pdfPlayersLabel", { count: users.length }))}</div>
    </div>
    <div class="head-meta">
      <div>${escapeHtml(t("pdfDeadline"))}: ${escapeHtml(lockStr)}</div>
      <div>${escapeHtml(t("pdfGenerated"))}: ${escapeHtml(generatedStr)}</div>
    </div>
  </header>
  <div class="glowline"></div>

  <section>
    <h2><span class="chip">1</span>${escapeHtml(t("avgSectionTitle"))}</h2>
    <p class="caption">${escapeHtml(t("avgSectionCaption"))}</p>
    <div class="match-grid">${matchCards}</div>
  </section>

  <section>
    <h2><span class="chip">2</span>${escapeHtml(t("rankingSectionTitle"))}</h2>
    <p class="caption">${escapeHtml(t("rankingCaption"))}</p>
    ${
      rankingRows
        ? `<div class="rank-grid">${rankingRows}</div>`
        : `<p class="caption">${escapeHtml(t("noPredictionsYet"))}</p>`
    }
  </section>

  <section>
    <h2><span class="chip">3</span>${escapeHtml(t("advanceSectionTitle"))}</h2>
    <p class="caption">${escapeHtml(t("advanceCaption"))}</p>
    ${
      barRows
        ? `<div class="bars">${barRows}</div>`
        : `<p class="caption">${escapeHtml(t("noPredictionsYet"))}</p>`
    }
  </section>

  <section>
    <h2><span class="chip">4</span>${escapeHtml(t("funStatsTitle"))}</h2>
    <div class="stat-grid">${statCards}</div>
  </section>

  <section class="page-break">
    <h2><span class="chip">5</span>${escapeHtml(t("matrixSectionTitle"))}</h2>
    <table>
      <thead>
        <tr>
          <th class="player">${escapeHtml(t("colUser"))}</th>
          ${headCells}
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </section>

  <script>
    window.onload = function () {
      var fontsReady =
        document.fonts && document.fonts.ready
          ? document.fonts.ready
          : Promise.resolve();
      fontsReady.then(function () {
        setTimeout(function () { window.print(); }, 200);
      });
    };
  </script>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  function handleExportPodioList() {
    setPodioListError(null);
    startPodioListTransition(async () => {
      const result = await getPodioPredictionsList();
      if (!result.ok) {
        setPodioListError(t("errorGeneric"));
        return;
      }
      renderPodioPredictionsPdf(result.data!);
    });
  }

  function renderPodioPredictionsPdf(data: PodioPredictionsListReport) {
    const title = t("podioListPdfTitle");
    const generatedStr = new Date().toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    const lockStr = data.lockTime
      ? new Date(data.lockTime).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";

    const rows = [...data.rows].sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );

    const teamCell = (team: PodioTeamRef | null): string => {
      if (!team) return `<td class="empty">—</td>`;
      const c = teamColor(team.nameEn);
      return `<td style="background:${c.bg};color:${c.text}">${escapeHtml(teamName(team))}</td>`;
    };

    const bodyRows = rows
      .map(
        (r, i) => `<tr class="${i % 2 === 1 ? "alt" : ""}">
          <td class="player">${escapeHtml(r.displayName)}</td>
          ${teamCell(r.champion)}
          ${teamCell(r.runnerUp)}
          ${teamCell(r.third)}
        </tr>`
      )
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; color: #1A2855; }
  .meta { font-size: 12px; color: #555; margin-bottom: 16px; }
  .meta div { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 6px 10px; text-align: center; border: 1px solid #e5e7eb; }
  thead th { background: #1A2855; color: #fff; font-weight: 600; }
  th.player, td.player { text-align: left; width: 40%; }
  td.player { font-weight: 600; }
  td.empty { color: #9CA3AF; }
  tr.alt td.player { background: #F3F4F6; }
  @page { margin: 12mm; }
  @media print {
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    tr td, thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    <div><strong>${escapeHtml(t("pdfDeadline"))}:</strong> ${escapeHtml(lockStr)}</div>
    <div><strong>${escapeHtml(t("pdfGenerated"))}:</strong> ${escapeHtml(generatedStr)}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th class="player">${escapeHtml(t("colUser"))}</th>
        <th>${escapeHtml(t("colFirst"))}</th>
        <th>${escapeHtml(t("colSecond"))}</th>
        <th>${escapeHtml(t("colThird"))}</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  function handleExportPdf() {
    if (!report) return;

    const title = t("pdfTitle");
    const roundName = roundLabel(report.roundNameKey);
    const lockStr = new Date(report.lockTime).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    const generatedStr = new Date().toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });

    const sorted = [...report.rows].sort((a, b) => {
      const pa = pct(a.predicted, report.totalMatches);
      const pb = pct(b.predicted, report.totalMatches);
      if (pb !== pa) return pb - pa;
      return a.displayName.localeCompare(b.displayName);
    });

    const bodyRows = sorted
      .map((r) => {
        const p = pct(r.predicted, report.totalMatches);
        return `<tr>
          <td>${escapeHtml(r.displayName)}</td>
          <td class="num">${r.predicted}</td>
          <td class="num">${report.totalMatches}</td>
          <td class="num">${p}%</td>
        </tr>`;
      })
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} — ${escapeHtml(roundName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #555; margin-bottom: 16px; }
  .meta div { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #ddd; }
  th { background: #f3f4f6; font-weight: 600; }
  td.num, th.num { text-align: right; }
  tr:nth-child(even) td { background: #fafafa; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    <div><strong>${escapeHtml(t("pdfRound"))}:</strong> ${escapeHtml(roundName)}</div>
    <div><strong>${escapeHtml(t("pdfDeadline"))}:</strong> ${escapeHtml(lockStr)}</div>
    <div><strong>${escapeHtml(t("pdfTotalMatches"))}:</strong> ${report.totalMatches}</div>
    <div><strong>${escapeHtml(t("pdfGenerated"))}:</strong> ${escapeHtml(generatedStr)}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(t("colUser"))}</th>
        <th class="num">${escapeHtml(t("colPredicted"))}</th>
        <th class="num">${escapeHtml(t("colTotal"))}</th>
        <th class="num">${escapeHtml(t("colPercent"))}</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  function handleExportPodioPdf() {
    if (!podioReport) return;

    const title = t("podioPdfTitle");
    const generatedStr = new Date().toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    const lockStr = podioReport.lockTime
      ? new Date(podioReport.lockTime).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";

    const sorted = [...podioReport.rows].sort((a, b) => {
      if (b.filled !== a.filled) return b.filled - a.filled;
      return a.displayName.localeCompare(b.displayName);
    });

    const bodyRows = sorted
      .map(
        (r) => `<tr>
          <td>${escapeHtml(r.displayName)}</td>
          <td>${escapeHtml(podioStatusLabel(r.status))}</td>
          <td class="num">${r.filled} / ${PODIO_SLOTS}</td>
        </tr>`
      )
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #555; margin-bottom: 16px; }
  .meta div { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #ddd; }
  th { background: #f3f4f6; font-weight: 600; }
  td.num, th.num { text-align: right; }
  tr:nth-child(even) td { background: #fafafa; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    <div><strong>${escapeHtml(t("pdfDeadline"))}:</strong> ${escapeHtml(lockStr)}</div>
    <div><strong>${escapeHtml(t("pdfGenerated"))}:</strong> ${escapeHtml(generatedStr)}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(t("colUser"))}</th>
        <th>${escapeHtml(t("colStatus"))}</th>
        <th class="num">${escapeHtml(t("colSlots"))}</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  function handleExportResultsPdf() {
    if (!resultsReport) return;

    const title = t("resultsPdfTitle");
    const total = resultsReport.totalSubmissions;
    const generatedStr = new Date().toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });

    const sorted = [...resultsReport.rows].sort((a, b) => {
      if (b.first !== a.first) return b.first - a.first;
      if (b.second !== a.second) return b.second - a.second;
      if (b.third !== a.third) return b.third - a.third;
      return teamName(a).localeCompare(teamName(b));
    });

    const bodyRows = sorted
      .map((r) => {
        const c = teamColor(r.nameEn);
        return `<tr style="background:${c.bg};color:${c.text}">
          <td>${escapeHtml(teamName(r))}</td>
          <td class="num">${pct(r.first, total)}%</td>
          <td class="num">${pct(r.second, total)}%</td>
          <td class="num">${pct(r.third, total)}%</td>
          <td class="num">${pct(r.off, total)}%</td>
        </tr>`;
      })
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #555; margin-bottom: 16px; }
  .meta div { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #ddd; }
  th { background: #f3f4f6; font-weight: 600; }
  td.num, th.num { text-align: right; }
  @media print { body { margin: 12mm; } tr { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    <div><strong>${escapeHtml(t("podioSubmissionsLabel", { count: total }))}</strong></div>
    <div><strong>${escapeHtml(t("pdfGenerated"))}:</strong> ${escapeHtml(generatedStr)}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(t("colTeam"))}</th>
        <th class="num">${escapeHtml(t("colFirst"))}</th>
        <th class="num">${escapeHtml(t("colSecond"))}</th>
        <th class="num">${escapeHtml(t("colThird"))}</th>
        <th class="num">${escapeHtml(t("colOffPodium"))}</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  function handleExport() {
    if (activeView === "matches") handleExportPdf();
    else if (activeView === "podio") handleExportPodioPdf();
    else if (activeView === "results") handleExportResultsPdf();
  }

  const canExport =
    (activeView === "matches" && report !== null) ||
    (activeView === "podio" && podioReport !== null) ||
    (activeView === "results" && resultsReport !== null);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={activeView === "matches" ? "default" : "secondary"}
          onClick={handleLoad}
          disabled={isPending}
        >
          {isPending && activeView === "matches" ? t("loading") : t("loadButton")}
        </Button>
        <Button
          variant={activeView === "podio" ? "default" : "secondary"}
          onClick={handleLoadPodio}
          disabled={isPodioPending}
        >
          {isPodioPending && activeView === "podio" ? t("loading") : t("podioButton")}
        </Button>
        <Button
          variant={activeView === "results" ? "default" : "secondary"}
          onClick={handleLoadResults}
          disabled={isResultsPending}
        >
          {isResultsPending && activeView === "results"
            ? t("loading")
            : t("resultsButton")}
        </Button>
        {canExport && (
          <Button variant="outline" onClick={handleExport}>
            {t("exportPdf")}
          </Button>
        )}
        <Button
          variant="outline"
          onClick={handleExportCurrent}
          disabled={isFilePending}
        >
          {isFilePending ? t("loading") : t("currentButton")}
        </Button>
        <Button
          variant="outline"
          onClick={handleExportPodioList}
          disabled={isPodioListPending}
        >
          {isPodioListPending ? t("loading") : t("podioListButton")}
        </Button>
      </div>

      {fileError && <p className="text-sm text-destructive">{fileError}</p>}
      {podioListError && (
        <p className="text-sm text-destructive">{podioListError}</p>
      )}

      {activeView === "matches" && error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {activeView === "matches" && report && (
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {roundLabel(report.roundNameKey)}
            </span>
            {" — "}
            {t("deadlineLabel", {
              time: new Date(report.lockTime).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })}
            {" · "}
            {t("totalMatchesLabel", { count: report.totalMatches })}
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    {t("colUser")}
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    {t("colPredicted")}
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    {t("colTotal")}
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    {t("colPercent")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...report.rows]
                  .sort((a, b) => {
                    const pa = pct(a.predicted, report.totalMatches);
                    const pb = pct(b.predicted, report.totalMatches);
                    if (pb !== pa) return pb - pa;
                    return a.displayName.localeCompare(b.displayName);
                  })
                  .map((r) => (
                    <tr key={r.userId} className="border-b text-xs hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{r.displayName}</td>
                      <td className="px-3 py-2 text-right">{r.predicted}</td>
                      <td className="px-3 py-2 text-right">{report.totalMatches}</td>
                      <td className="px-3 py-2 text-right">
                        {pct(r.predicted, report.totalMatches)}%
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeView === "podio" && podioError && (
        <p className="text-sm text-destructive">{podioError}</p>
      )}

      {activeView === "podio" && podioReport && (
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{t("podioTitle")}</span>
            {podioReport.lockTime && (
              <>
                {" — "}
                {t("deadlineLabel", {
                  time: new Date(podioReport.lockTime).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
                })}
              </>
            )}
            {" · "}
            {t("podioSummary", {
              complete: podioReport.rows.filter((r) => r.status === "complete").length,
              partial: podioReport.rows.filter((r) => r.status === "partial").length,
              none: podioReport.rows.filter((r) => r.status === "none").length,
            })}
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    {t("colUser")}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    {t("colStatus")}
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    {t("colSlots")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...podioReport.rows]
                  .sort((a, b) => {
                    if (b.filled !== a.filled) return b.filled - a.filled;
                    return a.displayName.localeCompare(b.displayName);
                  })
                  .map((r) => (
                    <tr key={r.userId} className="border-b text-xs hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{r.displayName}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            r.status === "complete"
                              ? "text-green-600 dark:text-green-400"
                              : r.status === "partial"
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground"
                          }
                        >
                          {podioStatusLabel(r.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.filled} / {PODIO_SLOTS}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeView === "results" && resultsError && (
        <p className="text-sm text-destructive">{resultsError}</p>
      )}

      {activeView === "results" && resultsReport && (
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{t("resultsTitle")}</span>
            {" · "}
            {t("podioSubmissionsLabel", { count: resultsReport.totalSubmissions })}
          </div>

          {resultsReport.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noVotes")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                      {t("colTeam")}
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                      {t("colFirst")}
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                      {t("colSecond")}
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                      {t("colThird")}
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                      {t("colOffPodium")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...resultsReport.rows]
                    .sort((a, b) => {
                      if (b.first !== a.first) return b.first - a.first;
                      if (b.second !== a.second) return b.second - a.second;
                      if (b.third !== a.third) return b.third - a.third;
                      return teamName(a).localeCompare(teamName(b));
                    })
                    .map((r) => {
                      const c = teamColor(r.nameEn);
                      const total = resultsReport.totalSubmissions;
                      return (
                        <tr
                          key={r.teamId}
                          className="border-b text-xs"
                          style={{ backgroundColor: c.bg, color: c.text }}
                        >
                          <td className="px-3 py-2 font-medium">{teamName(r)}</td>
                          <td className="px-3 py-2 text-right">{pct(r.first, total)}%</td>
                          <td className="px-3 py-2 text-right">{pct(r.second, total)}%</td>
                          <td className="px-3 py-2 text-right">{pct(r.third, total)}%</td>
                          <td className="px-3 py-2 text-right">{pct(r.off, total)}%</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
