import { useEffect, useRef } from "react";
import { pdfjsLib } from "../pdf";
import "./PdfBytesPreview.css";

// Renders in-memory PDF bytes (e.g. a generated Letter of Award) to canvases
// using the app's already-configured pdf.js. Read-only preview — no form layer.
// `zoom` matches the app-wide zoom control (1 = 100%).
export function PdfBytesPreview({
  bytes,
  zoom = 1,
}: {
  bytes: Uint8Array;
  zoom?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    // pdf.js takes ownership of the buffer — hand it a fresh copy.
    const task = pdfjsLib.getDocument({ data: bytes.slice(0) });

    (async () => {
      const doc = await task.promise;
      if (cancelled) return;
      container.replaceChildren();
      const scale = zoom;
      const dpr = window.devicePixelRatio || 1;
      for (let n = 1; n <= doc.numPages; n++) {
        const pageProxy = await doc.getPage(n);
        if (cancelled) break;
        const viewport = pageProxy.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.className = "pdfbytes__page";
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        container.appendChild(canvas);
        const renderViewport = dpr !== 1 ? pageProxy.getViewport({ scale: scale * dpr }) : viewport;
        await pageProxy.render({ canvas, canvasContext: ctx, viewport: renderViewport }).promise;
      }
    })().catch((e) => {
      if (!cancelled) console.error("preview render failed", e);
    });

    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [bytes, zoom]);

  return <div className="pdfbytes" ref={containerRef} />;
}
