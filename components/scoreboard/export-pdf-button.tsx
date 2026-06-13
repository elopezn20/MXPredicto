"use client";

import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Triggers the browser's print dialog (destination: "Save as PDF"). Print
 * styles in globals.css isolate the #scoreboard-print region, so only the
 * scoreboard + next-match panel end up in the document. We use print rather
 * than a canvas-based exporter because Tailwind v4's oklch colors break
 * html2canvas-style rasterizers, whereas the browser's own print engine
 * renders them faithfully.
 */
export function ExportPdfButton({ label }: { label: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="no-print"
      onClick={() => window.print()}
    >
      <DownloadIcon />
      {label}
    </Button>
  );
}
