import { useCallback, useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { zipSync } from "fflate";
import { api, type Project, type Subcontractor, type TpCompany, type StaffMember } from "../api";
import {
  DEFAULT_LOA_BODY,
  LOA_GLOBAL_BODY_KEY,
  LOA_PROJECT_BODY_KEY,
  resolveLetterValues,
} from "../lib/letterOfAward";
import { renderLetterOfAward } from "../lib/loaPdf";
import { PdfBytesPreview } from "./PdfBytesPreview";
import { LoaBodyEditor } from "./LoaBodyEditor";
import "./LetterOfAwardView.css";

const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").trim();

interface ProjectData {
  contractInfo: Record<string, string>;
  settings: Record<string, string>;
  tpCompanies: TpCompany[];
  qsStaff: StaffMember[];
}

// Trade Partner "Letter of Award" tab. One letter per subcontractor, drawing
// recipient names/addresses from the same subcontractor + TP Companies data
// that drives the Subcontract Agreements. The body is editable per project
// (overriding the global default set in Settings).
export function LetterOfAwardView({
  project,
  subs,
  activeSubId,
  onSelect,
  zoom,
}: {
  project: Project | null;
  subs: Subcontractor[];
  activeSubId: number | null;
  onSelect: (id: number) => void;
  zoom: number;
}) {
  const [data, setData] = useState<ProjectData | null>(null);
  const [grid, setGrid] = useState<Record<string, string> | null>(null);
  const [body, setBody] = useState("");
  const [committedBody, setCommittedBody] = useState("");
  const [hasOverride, setHasOverride] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState("");
  const saveTimer = useRef<number | null>(null);

  const activeSub = subs.find((s) => s.id === activeSubId) ?? null;

  const letterFileName = (subName: string) =>
    `${sanitize(project?.project_number ?? "")}-${sanitize(project?.name ?? "")}-${sanitize(subName)}-LOA.pdf`;

  // Effective global template (global Settings value, or the built-in default).
  const globalBody = useCallback(
    (settings: Record<string, string>) =>
      (settings[LOA_GLOBAL_BODY_KEY] ?? "").trim() || DEFAULT_LOA_BODY,
    [],
  );

  // Load project-level data (Contract Info, Settings, TP Companies, QS staff)
  // and the effective body template whenever the project changes.
  useEffect(() => {
    if (!project) {
      setData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const [contractInfo, settings, tpCompanies, qsStaff] = await Promise.all([
        api.getContractInfo(project.id),
        api.getSettings(),
        api.listTpCompanies(),
        api.listStaff("QS"),
      ]);
      if (cancelled) return;
      const override = (contractInfo[LOA_PROJECT_BODY_KEY] ?? "").trim();
      const effective = override || globalBody(settings);
      setData({ contractInfo, settings, tpCompanies, qsStaff });
      setHasOverride(Boolean(override));
      setBody(effective);
      setCommittedBody(effective);
    })();
    return () => {
      cancelled = true;
    };
  }, [project, globalBody]);

  // Load the active subcontractor's grid values.
  useEffect(() => {
    if (!activeSub) {
      setGrid(null);
      return;
    }
    let cancelled = false;
    api.getGridValues(activeSub.id).then((g) => {
      if (!cancelled) setGrid(g);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSub]);

  // Re-render the preview whenever the committed body, active sub, or its data
  // changes.
  useEffect(() => {
    if (!project || !activeSub || !data || !grid) {
      setBytes(null);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError("");
    (async () => {
      try {
        const values = resolveLetterValues({
          project,
          sub: activeSub,
          grid,
          contractInfo: data.contractInfo,
          tpCompanies: data.tpCompanies,
          qsStaff: data.qsStaff,
        });
        const pdf = await renderLetterOfAward(committedBody, values);
        if (cancelled) return;
        setBytes(pdf);
        setStatus("idle");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project, activeSub, data, grid, committedBody]);

  // Body edits: update immediately, debounce the (re-render + persist) so we
  // don't rebuild the PDF on every keystroke.
  const onBodyChange = (next: string) => {
    setBody(next);
    setHasOverride(true);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      setCommittedBody(next);
      if (project) void api.setContractInfoValue(project.id, LOA_PROJECT_BODY_KEY, next);
    }, 450);
  };

  const resetToGlobal = () => {
    if (!project || !data) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const effective = globalBody(data.settings);
    setBody(effective);
    setCommittedBody(effective);
    setHasOverride(false);
    void api.setContractInfoValue(project.id, LOA_PROJECT_BODY_KEY, "");
  };

  // Export the currently-previewed letter (reuses the rendered bytes).
  const exportCurrent = async () => {
    if (!project || !activeSub || !bytes || busy) return;
    setBusy(true);
    setExportMsg("");
    try {
      const name = letterFileName(activeSub.name);
      const path = await save({
        defaultPath: name,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!path) return;
      await api.writeBinaryFile(path, Array.from(bytes));
      setExportMsg(`Exported ${name}`);
    } catch (e) {
      setExportMsg(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Render every subcontractor's letter and export them as a single zip.
  const exportAll = async () => {
    if (!project || !data || busy) return;
    if (subs.length === 0) {
      setExportMsg("No subcontractors to export.");
      return;
    }
    setBusy(true);
    setExportMsg("");
    try {
      const files: Record<string, Uint8Array> = {};
      for (const sub of subs) {
        const g = await api.getGridValues(sub.id);
        const values = resolveLetterValues({
          project,
          sub,
          grid: g,
          contractInfo: data.contractInfo,
          tpCompanies: data.tpCompanies,
          qsStaff: data.qsStaff,
        });
        files[letterFileName(sub.name)] = await renderLetterOfAward(committedBody, values);
      }
      const zip = zipSync(files, { level: 6 });
      const zipName = `${sanitize(project.project_number)}-${sanitize(project.name)}-Letters-of-Award.zip`;
      const path = await save({
        defaultPath: zipName,
        filters: [{ name: "Zip archive", extensions: ["zip"] }],
      });
      if (!path) return;
      await api.writeBinaryFile(path, Array.from(zip));
      setExportMsg(`Exported ${subs.length} letter(s) to ${zipName}`);
    } catch (e) {
      setExportMsg(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!project) {
    return (
      <div className="loa">
        <div className="loa__empty">
          <p>Open a project to generate Letters of Award.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="loa">
      <aside className="loa__sidebar">
        <div className="loa__head">
          <span className="loa__title">Subcontractors ({subs.length})</span>
        </div>
        {subs.length === 0 ? (
          <p className="loa__hint">
            No subcontractors yet. Add them under Subcontract Info →
            Subcontractor Details.
          </p>
        ) : (
          <ul className="sublist">
            {subs.map((s) => (
              <li
                key={s.id}
                className={`sublist__row ${activeSubId === s.id ? "is-active" : ""}`}
                onClick={() => onSelect(s.id)}
              >
                <span className="sublist__name">{s.name}</span>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="loa__main">
        <div className="loa__toolbar">
          <button
            className={`btn btn--secondary ${editorOpen ? "is-active" : ""}`}
            onClick={() => setEditorOpen((v) => !v)}
          >
            {editorOpen ? "Hide letter body" : "Edit letter body"}
          </button>
          <span className="loa__source">
            Body: {hasOverride ? "Project override" : "Global default"}
          </span>
          <div className="loa__toolbar-spacer" />
          {exportMsg && <span className="loa__exportmsg">{exportMsg}</span>}
          <button
            className="btn btn--secondary"
            onClick={exportCurrent}
            disabled={busy || !activeSub || !bytes}
            title="Export the selected subcontractor's letter as a PDF"
          >
            Export letter
          </button>
          <button
            className="btn btn--primary"
            onClick={exportAll}
            disabled={busy || subs.length === 0}
            title="Export every subcontractor's letter as a zip"
          >
            {busy ? "Exporting…" : `Export all (${subs.length})`}
          </button>
        </div>

        <div className="loa__content">
          <div className="loa__preview">
            {!activeSub ? (
              <div className="loa__placeholder">
                <p>Select a subcontractor to preview their Letter of Award.</p>
              </div>
            ) : status === "loading" ? (
              <div className="loa__placeholder">
                <p>Generating letter…</p>
              </div>
            ) : status === "error" ? (
              <div className="loa__placeholder">
                <p>Could not generate the letter.</p>
                <p className="loa__hint">{error}</p>
              </div>
            ) : bytes ? (
              <PdfBytesPreview bytes={bytes} zoom={zoom} />
            ) : null}
          </div>

          {editorOpen && (
            <div className="loa__editor">
              <div className="loa__editorhead">
                <span className="loa__editortitle">Letter body (this project)</span>
                <button
                  className="btn btn--secondary"
                  disabled={!hasOverride}
                  onClick={resetToGlobal}
                  title="Discard this project's override and use the global default"
                >
                  Reset to global
                </button>
              </div>
              <LoaBodyEditor value={body} onChange={onBodyChange} minHeight={0} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
