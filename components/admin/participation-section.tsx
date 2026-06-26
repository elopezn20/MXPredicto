"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  getNextRoundParticipation,
  getPodioParticipation,
  type ParticipationReport,
  type PodioParticipationReport,
  type PodioStatus,
} from "@/lib/actions/admin";

const PODIO_SLOTS = 3;

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

  const [report, setReport] = useState<ParticipationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [podioReport, setPodioReport] = useState<PodioParticipationReport | null>(
    null
  );
  const [podioError, setPodioError] = useState<string | null>(null);
  const [isPodioPending, startPodioTransition] = useTransition();

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

    const order: Record<PodioStatus, number> = { none: 0, partial: 1, complete: 2 };
    const sorted = [...podioReport.rows].sort((a, b) => {
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="flex gap-2">
        <Button onClick={handleLoad} disabled={isPending}>
          {isPending ? t("loading") : t("loadButton")}
        </Button>
        {report && (
          <Button variant="outline" onClick={handleExportPdf}>
            {t("exportPdf")}
          </Button>
        )}
        <Button variant="secondary" onClick={handleLoadPodio} disabled={isPodioPending}>
          {isPodioPending ? t("loading") : t("podioButton")}
        </Button>
        {podioReport && (
          <Button variant="outline" onClick={handleExportPodioPdf}>
            {t("exportPdf")}
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {report && (
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

      {podioError && <p className="text-sm text-destructive">{podioError}</p>}

      {podioReport && (
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
                    const order: Record<PodioStatus, number> = {
                      none: 0,
                      partial: 1,
                      complete: 2,
                    };
                    if (order[a.status] !== order[b.status]) {
                      return order[a.status] - order[b.status];
                    }
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
    </div>
  );
}
