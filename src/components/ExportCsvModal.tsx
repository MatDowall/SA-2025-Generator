import { useEffect, useMemo, useState } from "react";
import { Modal } from "./Modal";
import { loadFieldMap, dataFields, type FieldDef } from "../fieldMap";
import { api } from "../api";
import "./ExportCsvModal.css";

interface ExportCsvModalProps {
  projectId: number;
  onExport: (fields: string[]) => Promise<void> | void;
  onClose: () => void;
}

// Lets the user choose which page-1–10 form fields become CSV columns.
// The selection is remembered per project.
export function ExportCsvModal({
  projectId,
  onExport,
  onClose,
}: ExportCsvModalProps) {
  const [fields, setFields] = useState<FieldDef[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const map = await loadFieldMap();
      const data = dataFields(map);
      setFields(data);
      const remembered = await api.getCsvSelection(projectId);
      setSelected(
        new Set(remembered ?? data.map((f) => f.name)), // default: all
      );
    })();
  }, [projectId]);

  const byPage = useMemo(() => {
    const m = new Map<number, FieldDef[]>();
    for (const f of fields ?? []) {
      const p = f.page ?? 0;
      if (!m.has(p)) m.set(p, []);
      m.get(p)!.push(f);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [fields]);

  const toggle = (name: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  const setMany = (names: string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      names.forEach((n) => (on ? next.add(n) : next.delete(n)));
      return next;
    });

  const allNames = fields?.map((f) => f.name) ?? [];

  const doExport = async () => {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    try {
      // Persist selection in field-map order so columns are stable.
      const ordered = allNames.filter((n) => selected.has(n));
      await api.setCsvSelection(projectId, ordered);
      await onExport(ordered);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Export CSV — choose columns"
      onClose={onClose}
      width={560}
      secondaryActions={[
        { label: "Select all", onClick: () => setMany(allNames, true) },
        { label: "None", onClick: () => setMany(allNames, false) },
      ]}
      primaryActions={[
        {
          label: busy ? "Exporting…" : `Export (${selected.size})`,
          variant: "primary",
          onClick: doExport,
          disabled: selected.size === 0 || busy,
        },
      ]}
    >
      {fields === null ? (
        <p>Loading fields…</p>
      ) : (
        <div className="csvsel">
          <p className="csvsel__note">
            Columns come from the template's form fields (pages 1–10). Rows are
            this project's subcontractors.
          </p>
          {byPage.map(([pageNo, pageFields]) => {
            const names = pageFields.map((f) => f.name);
            const allOn = names.every((n) => selected.has(n));
            return (
              <div className="csvsel__page" key={pageNo}>
                <div className="csvsel__page-head">
                  <label className="csvsel__page-title">
                    <input
                      type="checkbox"
                      checked={allOn}
                      onChange={(e) => setMany(names, e.target.checked)}
                    />
                    Page {pageNo}
                    <span className="csvsel__count">
                      {names.filter((n) => selected.has(n)).length}/{names.length}
                    </span>
                  </label>
                </div>
                <div className="csvsel__fields">
                  {pageFields.map((f) => (
                    <label className="csvsel__field" key={f.name} title={f.type}>
                      <input
                        type="checkbox"
                        checked={selected.has(f.name)}
                        onChange={() => toggle(f.name)}
                      />
                      <span className="csvsel__fname">{f.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
