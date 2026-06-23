import { useState } from "react";
import { Modal } from "./Modal";
import "./Forms.css";

export type ExportScope = "current" | "batch";
export type ExportFormat = "fillable" | "flat";

interface ExportPdfModalProps {
  hasActive: boolean;
  subCount: number;
  activeName?: string;
  onExport: (scope: ExportScope, format: ExportFormat) => Promise<void> | void;
  onClose: () => void;
}

export function ExportPdfModal({
  hasActive,
  subCount,
  activeName,
  onExport,
  onClose,
}: ExportPdfModalProps) {
  const [scope, setScope] = useState<ExportScope>(hasActive ? "current" : "batch");
  const [format, setFormat] = useState<ExportFormat>("flat");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onExport(scope, format);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Export PDF"
      onClose={onClose}
      width={460}
      secondaryActions={[{ label: "Cancel", onClick: onClose }]}
      primaryActions={[
        {
          label: busy ? "Exporting…" : "Export",
          variant: "primary",
          onClick: run,
          disabled: busy,
        },
      ]}
    >
      <div className="form">
        <fieldset className="radioset">
          <legend>What to export</legend>
          <label className={`radioset__opt ${!hasActive ? "is-disabled" : ""}`}>
            <input
              type="radio"
              name="scope"
              checked={scope === "current"}
              disabled={!hasActive}
              onChange={() => setScope("current")}
            />
            <span>
              Current subcontractor
              {activeName ? ` — ${activeName}` : ""}
            </span>
          </label>
          <label className="radioset__opt">
            <input
              type="radio"
              name="scope"
              checked={scope === "batch"}
              onChange={() => setScope("batch")}
            />
            <span>All subcontractors ({subCount}) — zipped</span>
          </label>
        </fieldset>

        <fieldset className="radioset">
          <legend>Format</legend>
          <label className="radioset__opt">
            <input
              type="radio"
              name="format"
              checked={format === "flat"}
              onChange={() => setFormat("flat")}
            />
            <span>
              Flattened — values baked in, not editable
            </span>
          </label>
          <label className="radioset__opt">
            <input
              type="radio"
              name="format"
              checked={format === "fillable"}
              onChange={() => setFormat("fillable")}
            />
            <span>Fillable — form fields remain editable</span>
          </label>
        </fieldset>
      </div>
    </Modal>
  );
}
