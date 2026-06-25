import { createPortal } from "react-dom";
import "./ImportProgressOverlay.css";

// A deliberately non-dismissible overlay (no close button, no backdrop
// click, no Escape) — CSV import can take several seconds for 20+
// subcontractors (each row is multiple sequential IPC round-trips), and
// without this the app just looked frozen while still accepting clicks,
// which could interleave with the in-flight import and corrupt state.
export function ImportProgressOverlay({
  current,
  total,
  phase = "importing",
}: {
  current: number;
  total: number;
  phase?: "importing" | "recomputing";
}) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const text =
    phase === "recomputing"
      ? "Updating PDF data…"
      : `Importing subcontractor ${current} of ${total}…`;
  return createPortal(
    <div className="importprogress__overlay">
      <div className="importprogress__card" role="alert" aria-busy="true">
        <div className="importprogress__spinner" />
        <p className="importprogress__text">{text}</p>
        <div className="importprogress__bar">
          <div
            className="importprogress__bar-fill"
            style={{ width: phase === "recomputing" ? "100%" : `${pct}%` }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
