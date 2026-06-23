import { useState } from "react";
import { Modal } from "./Modal";
import type { ImportReport } from "../api";
import "./Forms.css";

interface ImportCsvModalProps {
  path: string;
  report: ImportReport;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

// Shows the import validation report (recognised vs. unknown columns, row
// count) and confirms before writing anything.
export function ImportCsvModal({
  path,
  report,
  onConfirm,
  onClose,
}: ImportCsvModalProps) {
  const [busy, setBusy] = useState(false);
  const fileName = path.split(/[\\/]/).pop() ?? path;

  const blocked = !report.has_id_column;

  const run = async () => {
    if (blocked || busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import CSV"
      onClose={onClose}
      width={540}
      secondaryActions={[{ label: "Cancel", onClick: onClose }]}
      primaryActions={[
        {
          label: busy ? "Importing…" : "Import",
          variant: "primary",
          onClick: run,
          disabled: blocked || busy,
        },
      ]}
    >
      <div className="importrep">
        <p className="importrep__file">
          <strong>{fileName}</strong>
        </p>

        {blocked ? (
          <p className="form__error">
            The first column must be <code>Subcontractor</code>. This file's
            first column is <code>{report.columns[0] ?? "(empty)"}</code> — it
            doesn't look like a SA-2025 export.
          </p>
        ) : (
          <ul className="importrep__stats">
            <li>
              <strong>{report.row_count}</strong> subcontractor row(s)
            </li>
            <li>
              <strong>{report.recognised.length}</strong> recognised field
              column(s)
            </li>
            {report.unknown.length > 0 && (
              <li className="importrep__warn">
                <strong>{report.unknown.length}</strong> unrecognised column(s)
                will be ignored: {report.unknown.join(", ")}
              </li>
            )}
          </ul>
        )}

        {!blocked && (
          <p className="importrep__note">
            Rows are matched to existing subcontractors by name (created if new).
            Recognised fields overwrite existing values for those subcontractors.
          </p>
        )}
      </div>
    </Modal>
  );
}
