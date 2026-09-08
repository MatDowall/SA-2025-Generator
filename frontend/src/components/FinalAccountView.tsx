import { useCallback, useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { zipSync } from "fflate";
import { api, type Project, type Subcontractor, type TpCompany, type StaffMember } from "../api";
import { resolveLetterValues } from "../lib/letterOfAward";
import {
  DEFAULT_FA_BODY,
  FA_GLOBAL_BODY_KEY,
  FA_PROJECT_BODY_KEY,
  FA_PLACEHOLDERS,
  FA_VARIATIONS_KEY,
  computeFinalAccountMoney,
} from "../lib/finalAccount";
import { renderFinalAccount } from "../lib/finalAccountPdf";
import { openEmailDraftWithPdf, recipientEmailForSub } from "../lib/emailDraft";
import { loadEmailTemplates, renderEmailTemplate } from "../lib/emailTemplate";
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

// "Final Account" tab. One Agreed Final Account Statement per subcontractor,
// drawing recipient names/addresses and the contract sum from the same
// subcontractor + TP Companies + grid data that drives the Subcontract
// Agreements and Letters of Award. The body is editable per project (overriding
// the global default set in Settings). Mirrors LetterOfAwardView.
export function FinalAccountView({
  project,
  subs,
  activeSubId,
  onSelect,
  zoom,
  onEmailed,
}: {
  project: Project | null;
  subs: Subcontractor[];
  activeSubId: number | null;
  onSelect: (id: number) => void;
  zoom: number;
  /** Called after an email draft is opened, so the app can offer to log the
   *  statement as sent in the subcontractor's audit trail. */
  onEmailed?: (sub: Subcontractor) => void;
}) {
  const [data, setData] = useState<ProjectData | null>(null);
  const [grid, setGrid] = useState<Record<string, string> | null>(null);
  const [body, setBody] = useState("");
  const [committedBody, setCommittedBody] = useState("");
  const [hasOverride, setHasOverride] = useState(false);
  // "Plus Variations" figure, entered per subcontractor and stored on the grid.
  const [variations, setVariations] = useState("");
  const [committedVariations, setCommittedVariations] = useState("");
  const varTimer = useRef<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState("");
  const saveTimer = useRef<number | null>(null);

  const activeSub = subs.find((s) => s.id === activeSubId) ?? null;

  const fileName = (subName: string) =>
    `${sanitize(project?.project_number ?? "")}-${sanitize(project?.name ?? "")}-${sanitize(subName)}-FA.pdf`;

  // Effective global template (global Settings value, or the built-in default).
  const globalBody = useCallback(
    (settings: Record<string, string>) =>
      (settings[FA_GLOBAL_BODY_KEY] ?? "").trim() || DEFAULT_FA_BODY,
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
      const override = (contractInfo[FA_PROJECT_BODY_KEY] ?? "").trim();
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
      if (cancelled) return;
      setGrid(g);
      const v = g[FA_VARIATIONS_KEY] ?? "";
      setVariations(v);
      setCommittedVariations(v);
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
        const money = computeFinalAccountMoney(values.Sum, committedVariations);
        const pdf = await renderFinalAccount(committedBody, values, money);
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
  }, [project, activeSub, data, grid, committedBody, committedVariations]);

  // Body edits: update immediately, debounce the (re-render + persist) so we
  // don't rebuild the PDF on every keystroke.
  const onBodyChange = (next: string) => {
    setBody(next);
    setHasOverride(true);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      setCommittedBody(next);
      if (project) void api.setContractInfoValue(project.id, FA_PROJECT_BODY_KEY, next);
    }, 450);
  };

  // Variation edits: update immediately, debounce the (re-render + persist).
  const onVariationsChange = (next: string) => {
    setVariations(next);
    if (varTimer.current) window.clearTimeout(varTimer.current);
    varTimer.current = window.setTimeout(() => {
      setCommittedVariations(next);
      if (activeSub) void api.setGridValue(activeSub.id, FA_VARIATIONS_KEY, next);
    }, 450);
  };

  const resetToGlobal = () => {
    if (!project || !data) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const effective = globalBody(data.settings);
    setBody(effective);
    setCommittedBody(effective);
    setHasOverride(false);
    void api.setContractInfoValue(project.id, FA_PROJECT_BODY_KEY, "");
  };

  // Export the currently-previewed statement (reuses the rendered bytes).
  const exportCurrent = async () => {
    if (!project || !activeSub || !bytes || busy) return;
    setBusy(true);
    setExportMsg("");
    try {
      const name = fileName(activeSub.name);
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

  // Open a mail-client draft with the currently-previewed statement attached and
  // the trade partner's email pre-filled as recipient (reuses the rendered
  // bytes). The user reviews and sends it themselves.
  const emailCurrent = async () => {
    if (!project || !activeSub || !bytes || !data || busy) return;
    setBusy(true);
    setExportMsg("");
    try {
      const name = fileName(activeSub.name);
      const to = recipientEmailForSub(activeSub.name, data.tpCompanies);
      const tpl = await loadEmailTemplates();
      const tokens = {
        Document: "Final Account",
        Subcontractor: activeSub.name,
        Project_Name: project.name,
        Project_Number: project.project_number,
      };
      await openEmailDraftWithPdf({
        to,
        subject: renderEmailTemplate(tpl.subject, tokens),
        body: renderEmailTemplate(tpl.body, tokens),
        attachmentName: name,
        pdfBytes: bytes,
      });
      setExportMsg(to ? `Draft opened for ${to}` : "Draft opened (no email on file)");
      onEmailed?.(activeSub);
    } catch (e) {
      setExportMsg(`Email failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Render every subcontractor's statement and export them as a single zip.
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
        const money = computeFinalAccountMoney(values.Sum, g[FA_VARIATIONS_KEY] ?? "");
        files[fileName(sub.name)] = await renderFinalAccount(committedBody, values, money);
      }
      const zip = zipSync(files, { level: 6 });
      const zipName = `${sanitize(project.project_number)}-${sanitize(project.name)}-Final-Accounts.zip`;
      const path = await save({
        defaultPath: zipName,
        filters: [{ name: "Zip archive", extensions: ["zip"] }],
      });
      if (!path) return;
      await api.writeBinaryFile(path, Array.from(zip));
      setExportMsg(`Exported ${subs.length} statement(s) to ${zipName}`);
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
          <p>Open a project to generate Final Account statements.</p>
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
            {editorOpen ? "Hide statement text" : "Edit statement text"}
          </button>
          <span className="loa__source">
            Body: {hasOverride ? "Project override" : "Global default"}
          </span>
          <label className="loa__varfield" title="Plus Variations (excl GST) - adds to the Final Adjusted Contract Value">
            <span>Plus Variations $</span>
            <input
              className="form__input loa__varinput"
              inputMode="decimal"
              placeholder="0.00"
              value={variations}
              disabled={!activeSub}
              onChange={(e) => onVariationsChange(e.target.value)}
            />
          </label>
          <div className="loa__toolbar-spacer" />
          {exportMsg && <span className="loa__exportmsg">{exportMsg}</span>}
          <button
            className="btn btn--secondary"
            onClick={emailCurrent}
            disabled={busy || !activeSub || !bytes}
            title="Open an email draft with this statement attached"
          >
            Email statement
          </button>
          <button
            className="btn btn--secondary"
            onClick={exportCurrent}
            disabled={busy || !activeSub || !bytes}
            title="Export the selected subcontractor's statement as a PDF"
          >
            Export statement
          </button>
          <button
            className="btn btn--primary"
            onClick={exportAll}
            disabled={busy || subs.length === 0}
            title="Export every subcontractor's statement as a zip"
          >
            {busy ? "Exporting…" : `Export all (${subs.length})`}
          </button>
        </div>

        <div className="loa__content">
          <div className="loa__preview">
            {!activeSub ? (
              <div className="loa__placeholder">
                <p>Select a subcontractor to preview their Final Account statement.</p>
              </div>
            ) : status === "loading" ? (
              <div className="loa__placeholder">
                <p>Generating statement…</p>
              </div>
            ) : status === "error" ? (
              <div className="loa__placeholder">
                <p>Could not generate the statement.</p>
                <p className="loa__hint">{error}</p>
              </div>
            ) : bytes ? (
              <PdfBytesPreview bytes={bytes} zoom={zoom} />
            ) : null}
          </div>

          {editorOpen && (
            <div className="loa__editor">
              <div className="loa__editorhead">
                <span className="loa__editortitle">Statement paragraphs (this project)</span>
                <button
                  className="btn btn--secondary"
                  disabled={!hasOverride}
                  onClick={resetToGlobal}
                  title="Discard this project's override and use the global default"
                >
                  Reset to global
                </button>
              </div>
              <LoaBodyEditor
                value={body}
                onChange={onBodyChange}
                minHeight={0}
                placeholders={FA_PLACEHOLDERS}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
