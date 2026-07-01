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

    const headCells = data.matches
      .map(
        (m, i) => `<th class="match">
          <div class="mnum">${i + 1}</div>
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

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} — ${escapeHtml(roundName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; color: #1A2855; }
  .meta { font-size: 12px; color: #555; margin-bottom: 16px; }
  .meta div { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; table-layout: fixed; }
  th, td { padding: 4px 3px; text-align: center; border: 1px solid #e5e7eb; }
  thead th { background: #1A2855; color: #fff; font-weight: 600; }
  th.player, td.player { text-align: left; width: 130px; padding-left: 8px; }
  thead th.player { background: #1A2855; }
  th.match .mnum { font-size: 8px; opacity: .7; font-weight: 500; }
  th.match .mteams { font-weight: 700; white-space: nowrap; }
  th.match .mteams span { opacity: .55; font-weight: 400; margin: 0 2px; }
  td.player { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  td .score { font-variant-numeric: tabular-nums; font-weight: 600; }
  td .pen { display: block; font-size: 7px; color: #E91E8C; font-weight: 700; }
  td.empty { color: #9CA3AF; }
  tr.alt td { background: #F3F4F6; }
  tr.alt td.player { background: #E9EBF0; }
  @page { size: landscape; margin: 10mm; }
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
    <div><strong>${escapeHtml(t("pdfRound"))}:</strong> ${escapeHtml(roundName)} · ${escapeHtml(t("totalMatchesLabel", { count: data.matches.length }))}</div>
    <div><strong>${escapeHtml(t("pdfDeadline"))}:</strong> ${escapeHtml(lockStr)}</div>
    <div><strong>${escapeHtml(t("pdfGenerated"))}:</strong> ${escapeHtml(generatedStr)}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th class="player">${escapeHtml(t("colUser"))}</th>
        ${headCells}
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
