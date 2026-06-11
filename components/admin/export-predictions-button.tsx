"use client";

import { useState } from "react";
import {
  exportLastClosedRoundPredictions,
  exportNextRoundPredictions,
} from "@/lib/actions/export-predictions";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";

function downloadBase64(base64: string, filename: string) {
  const byteChars = atob(base64);
  const byteArr   = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
  const blob = new Blob([byteArr], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportButton({
  label,
  action,
}: {
  label: string;
  action: () => Promise<{ ok: boolean; error?: string; base64?: string; filename?: string }>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function handleExport() {
    setLoading(true);
    setError(null);
    const result = await action();
    if (!result.ok || !result.base64 || !result.filename) {
      setError(result.error ?? "Unknown error");
    } else {
      downloadBase64(result.base64, result.filename);
    }
    setLoading(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handleExport}
        disabled={loading}
        className="gap-2"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {loading ? "Generating…" : label}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function ExportLastClosedPredictionsButton() {
  return (
    <ExportButton
      label="Export predictions (last closed round)"
      action={exportLastClosedRoundPredictions}
    />
  );
}

export function ExportNextRoundPredictionsButton() {
  return (
    <ExportButton
      label="Export predictions (next round)"
      action={exportNextRoundPredictions}
    />
  );
}
