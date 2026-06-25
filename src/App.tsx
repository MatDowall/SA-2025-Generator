import { useCallback, useEffect, useRef, useState } from "react";
import { MenuBar, type MenuDef } from "./components/MenuBar";
import { TabBar } from "./components/TabBar";
import { SubcontractInfoView } from "./components/SubcontractInfoView";
import { Sidebar } from "./components/Sidebar";
import { PdfViewer, type PdfViewerHandle } from "./components/PdfViewer";
import { StatusBar } from "./components/StatusBar";
import { Modal } from "./components/Modal";
import { PromptModal } from "./components/PromptModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { OpenProjectModal } from "./components/OpenProjectModal";
import { ExportCsvModal } from "./components/ExportCsvModal";
import { ImportCsvModal } from "./components/ImportCsvModal";
import { UpdateBanner } from "./components/UpdateBanner";
import { AboutModal } from "./components/AboutModal";
import { SettingsModal } from "./components/SettingsModal";
import { ImportProgressOverlay } from "./components/ImportProgressOverlay";
import {
  ExportPdfModal,
  type ExportScope,
  type ExportFormat,
} from "./components/ExportPdfModal";
import { useDebouncedFieldSave } from "./hooks/useDebouncedFieldSave";
import { useMappingRecompute } from "./hooks/useMappingRecompute";
import { importCsvIntoProject } from "./lib/csvImport";
import { applyFieldEdit } from "./lib/csvReverseMap";
import { fillTemplate } from "./pdfFill";
import { zipSync } from "fflate";
import {
  api,
  type Project,
  type Subcontractor,
  type ImportReport,
} from "./api";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

const MIN_SIDEBAR_PCT = 15;
const MAX_SIDEBAR_PCT = 50;
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

type Dialog =
  | { kind: "none" }
  | { kind: "newProject" }
  | { kind: "openProject" }
  | { kind: "renameProject" }
  | { kind: "addSub" }
  | { kind: "renameSub"; sub: Subcontractor }
  | { kind: "confirmDeleteProject"; project: Project }
  | { kind: "confirmDeleteSub"; sub: Subcontractor }
  | { kind: "exportCsv" }
  | { kind: "exportPdf" }
  | { kind: "importReport"; path: string; report: ImportReport }
  | { kind: "error"; title: string; message: string }
  | { kind: "about" }
  | { kind: "settings" };

const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").trim();

type AppTab = "pdf" | "subcontract-info";

function App() {
  // Top-level tabs
  const [activeTab, setActiveTab] = useState<AppTab>("pdf");

  // Layout
  const [sidebarPct, setSidebarPct] = useState(30);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const mainRef = useRef<HTMLDivElement>(null);

  // PDF viewer
  const viewerRef = useRef<PdfViewerHandle>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [status, setStatus] = useState("Loading…");

  // Project workspace
  const [project, setProject] = useState<Project | null>(null);
  const [subs, setSubs] = useState<Subcontractor[]>([]);
  const [activeSubId, setActiveSubId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const close = () => setDialog({ kind: "none" });
  const [importProgress, setImportProgress] = useState<
    { current: number; total: number; phase?: "importing" | "recomputing" } | null
  >(null);

  // Recomputes field_values from Contract Info + Subcontractor Details
  // (the single source of truth) — lives here, not inside SubcontractInfoView,
  // so it stays active (and reachable from e.g. CSV import) regardless of
  // which top-level tab is showing.
  const { recompute: recomputeFieldValues, recomputeNow: recomputeFieldValuesNow } =
    useMappingRecompute(project, subs);

  // Surface a thrown error to the user instead of failing silently.
  const reportError = (title: string, e: unknown) => {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
    setDialog({ kind: "error", title, message });
  };
  // Wrap an async action so any failure opens the error modal.
  const guard =
    <A extends unknown[]>(title: string, fn: (...args: A) => Promise<void>) =>
    async (...args: A) => {
      try {
        await fn(...args);
      } catch (e) {
        reportError(title, e);
      }
    };

  // Active subcontractor's form values (shown/edited on the PDF overlay).
  const {
    values,
    onFieldChange,
    load: loadValues,
    flush: flushPending,
    activeIdRef,
    pendingRef,
  } = useDebouncedFieldSave(activeSubId, api.getFieldValues, api.setFieldValue);

  // The PDF overlay is directly editable, but field_values is otherwise
  // purely computed from Contract Info + Subcontractor Details — without
  // this, a PDF-direct edit would just get silently overwritten by the next
  // recompute. Mirror any edit that has a reverse-map target back into the
  // grid/Contract Info so the two stay in sync regardless of which surface
  // the user actually typed into.
  // Keyed by field name — a single shared timer would let editing field B
  // cancel field A's still-pending sync (e.g. tabbing through several PDF
  // fields inside one debounce window), silently dropping A's write.
  const pdfReverseSyncTimers = useRef<Map<string, number>>(new Map());
  const onPdfFieldChange = useCallback(
    (name: string, value: string) => {
      onFieldChange(name, value);
      const existing = pdfReverseSyncTimers.current.get(name);
      if (existing) clearTimeout(existing);
      pdfReverseSyncTimers.current.set(
        name,
        window.setTimeout(() => {
          pdfReverseSyncTimers.current.delete(name);
          const grid: Record<string, string> = {};
          const contractInfo: Record<string, string> = {};
          applyFieldEdit(name, value, grid, contractInfo, true);
          const gridEntries = Object.entries(grid);
          const ciEntries = Object.entries(contractInfo);
          if (gridEntries.length === 0 && ciEntries.length === 0) return;
          if (activeSubId) {
            for (const [key, v] of gridEntries) void api.setGridValue(activeSubId, key, v);
          }
          if (project) {
            for (const [key, v] of ciEntries) void api.setContractInfoValue(project.id, key, v);
          }
          recomputeFieldValues();
        }, 350),
      );
    },
    [onFieldChange, activeSubId, project, recomputeFieldValues],
  );

  // The Subcontract Info recompute pipeline writes fresh field_values in the
  // background while the user is on that tab — useDebouncedFieldSave only
  // reloads when activeSubId itself changes, so without this the PDF tab
  // would keep showing stale values after switching back without having
  // changed which subcontractor is active.
  useEffect(() => {
    if (activeTab === "pdf") void loadValues(activeSubId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Persist any unsaved edits before the window closes (the debounce may not
  // have fired yet for the active subcontractor).
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win
      .onCloseRequested(async (event) => {
        if (pendingRef.current.size === 0) return; // nothing to save
        event.preventDefault();
        await flushPending(activeIdRef.current);
        await win.destroy();
      })
      .then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [flushPending, pendingRef, activeIdRef]);

  const openProject = useCallback(async (p: Project) => {
    const list = await api.listSubcontractors(p.id);
    setProject(p);
    setSubs(list);
    setActiveSubId(list[0]?.id ?? null);
    await api.setLastProject(p.id);
    close();
  }, []);

  // Restore the last-opened project on startup.
  useEffect(() => {
    (async () => {
      try {
        const lastId = await api.getLastProject();
        if (lastId == null) return;
        const projects = await api.listProjects();
        const found = projects.find((p) => p.id === lastId);
        if (found) await openProject(found);
      } catch {
        /* ignore restore errors */
      }
    })();
  }, [openProject]);

  // --- project handlers ---
  const createProject = async (v: Record<string, string>) => {
    const p = await api.createProject(v.name, v.number);
    await openProject(p);
  };
  const renameProject = async (v: Record<string, string>) => {
    if (!project) return;
    await api.renameProject(project.id, v.name, v.number);
    setProject({ ...project, name: v.name.trim(), project_number: v.number.trim() });
    close();
  };
  const deleteProject = async (p: Project) => {
    await api.deleteProject(p.id);
    if (project?.id === p.id) {
      setProject(null);
      setSubs([]);
      setActiveSubId(null);
      await api.setLastProject(null);
    }
    setDialog({ kind: "openProject" }); // back to the picker (refreshes list)
  };

  // --- subcontractor handlers ---
  const addSub = async (v: Record<string, string>) => {
    if (!project) return;
    const s = await api.addSubcontractor(project.id, v.name);
    setSubs((prev) => [...prev, s]);
    setActiveSubId(s.id);
    close();
  };
  const renameSub = async (id: number, v: Record<string, string>) => {
    await api.renameSubcontractor(id, v.name);
    setSubs((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name: v.name.trim() } : s)),
    );
    close();
  };
  // Used by the Subcontractor Details grid, which is itself a valid entry
  // point for creating/renaming subcontractors (typing a name into a blank
  // row), not just the Sidebar's "Add Subcontractor" dialog.
  const createSubcontractorByName = useCallback(
    async (name: string) => {
      if (!project) throw new Error("No project open");
      const s = await api.addSubcontractor(project.id, name);
      setSubs((prev) => [...prev, s]);
      return s;
    },
    [project],
  );
  const renameSubcontractorByName = useCallback(async (id: number, name: string) => {
    await api.renameSubcontractor(id, name);
    setSubs((prev) => prev.map((s) => (s.id === id ? { ...s, name: name.trim() } : s)));
  }, []);
  const deleteSub = async (s: Subcontractor) => {
    await api.deleteSubcontractor(s.id);
    setSubs((prev) => prev.filter((x) => x.id !== s.id));
    setActiveSubId((cur) => (cur === s.id ? null : cur));
    close();
  };

  // Splitter drag
  const onSplitterDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const row = mainRef.current;
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSidebarPct(Math.min(MAX_SIDEBAR_PCT, Math.max(MIN_SIDEBAR_PCT, pct)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
  const firstPage = () => viewerRef.current?.goToPage(1);
  const lastPage = () => viewerRef.current?.goToPage(pageCount || 1);
  const prevPage = () => viewerRef.current?.goToPage(Math.max(1, page - 1));
  const nextPage = () =>
    viewerRef.current?.goToPage(Math.min(pageCount || 1, page + 1));

  const onDocLoaded = useCallback((count: number) => {
    setPageCount(count);
    setStatus("Ready");
  }, []);
  const onViewerError = useCallback((msg: string) => setStatus(msg), []);

  // Import CSV: pick a file, validate it, then show the report for confirmation.
  const pickImportCsv = guard("Could not read CSV", async () => {
    if (!project) return;
    const path = await open({
      multiple: false,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (typeof path !== "string") return;
    const report = await api.analyzeImportCsv(path);
    setDialog({ kind: "importReport", path, report });
  });

  const commitImport = guard("CSV import failed", async (path: string) => {
    if (!project) return;
    close(); // dismiss the report dialog — the progress overlay takes over
    try {
      const parsed = await api.parseImportCsv(path);
      setImportProgress({ current: 0, total: parsed.rows.length });
      const res = await importCsvIntoProject(project, subs, parsed, (current, total) =>
        setImportProgress({ current, total }),
      );
      const list = await api.listSubcontractors(project.id);
      setSubs(list);
      if (activeSubId && list.some((s) => s.id === activeSubId)) {
        await loadValues(activeSubId);
      } else {
        setActiveSubId(list[0]?.id ?? null);
      }
      // Keep the overlay up through this — it rebuilds the whole HyperFormula
      // engine across every subcontractor and can take real time, so it must
      // stay awaited under the same busy indicator rather than being kicked
      // off via the normal fire-and-forget debounced recompute.
      setImportProgress({ current: parsed.rows.length, total: parsed.rows.length, phase: "recomputing" });
      await recomputeFieldValuesNow();
      setStatus(
        `Imported: ${res.created} created, ${res.updated} updated, ${res.fields_set} values set`,
      );
    } finally {
      setImportProgress(null);
    }
  });

  // Export CSV: prompt for a save location, then write via the backend.
  const exportCsv = guard("CSV export failed", async (fields: string[]) => {
    if (!project) return;
    await flushPending(activeSubId); // ensure latest edits are saved first
    const suggested = `${project.project_number}-${project.name}.csv`.replace(
      /[\\/:*?"<>|]/g,
      "_",
    );
    const path = await save({
      defaultPath: suggested,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return; // user cancelled
    const rows = await api.exportProjectCsv(project.id, fields, path);
    close();
    setStatus(`Exported ${rows} subcontractor row(s) to ${path}`);
  });

  // Export the whole project as a portable .saproj snapshot.
  const exportProjectFile = guard("Project export failed", async () => {
    if (!project) return;
    await flushPending(activeIdRef.current);
    const name = `${sanitize(project.project_number)}-${sanitize(project.name)}.saproj`;
    const path = await save({
      defaultPath: name,
      filters: [{ name: "SA-2025 Project", extensions: ["saproj"] }],
    });
    if (!path) return;
    await api.exportProjectFile(project.id, path);
    setStatus(`Saved project to ${name}`);
  });

  // Import a .saproj file (by path) as a new project and open it. Shared by
  // the menu picker and by double-clicking a .saproj file in Explorer.
  const importAndOpenPath = useCallback(
    async (path: string) => {
      const imported = await api.importProjectFile(path);
      await openProject(imported);
      setStatus(`Imported project: ${imported.name}`);
    },
    [openProject],
  );

  // Import a .saproj file as a new project and open it.
  const importProjectFile = guard("Project import failed", async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: "SA-2025 Project", extensions: ["saproj"] }],
    });
    if (typeof path !== "string") return;
    await importAndOpenPath(path);
  });

  // Opening a .saproj file from Explorer launches the app with it as a CLI
  // arg (cold start) or, if the app is already running, the OS routes the
  // launch through the single-instance plugin, which forwards it as an event.
  useEffect(() => {
    (async () => {
      try {
        const launchFile = await api.getLaunchFile();
        if (launchFile) await importAndOpenPath(launchFile);
      } catch (e) {
        reportError("Project import failed", e);
      }
    })();
    const unlisten = listen<string>("open-project-file", (event) => {
      importAndOpenPath(event.payload).catch((e) =>
        reportError("Project import failed", e),
      );
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [importAndOpenPath]);

  // Export PDF: fill the template per subcontractor (pdf-lib), optionally
  // flatten, and write the file / zip via the backend.
  const pdfName = (subName: string) =>
    `${sanitize(project!.project_number)}-${sanitize(project!.name)}-${sanitize(subName)}.pdf`;

  const exportPdf = guard(
    "PDF export failed",
    async (scope: ExportScope, format: ExportFormat) => {
    if (!project) return;
    await flushPending(activeIdRef.current); // include latest edits
    const flatten = format === "flat";
    const template = await api.getTemplatePdf();

    if (scope === "current") {
      const sub = subs.find((s) => s.id === activeSubId);
      if (!sub) return;
      const v = await api.getFieldValues(sub.id);
      const bytes = await fillTemplate(template, v, flatten);
      const name = pdfName(sub.name);
      const path = await save({
        defaultPath: name,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!path) return;
      await api.writeBinaryFile(path, Array.from(bytes));
      close();
      setStatus(`Exported ${name}`);
      return;
    }

    // batch → zip
    if (subs.length === 0) {
      setStatus("No subcontractors to export.");
      return;
    }
    const files: Record<string, Uint8Array> = {};
    for (const sub of subs) {
      const v = await api.getFieldValues(sub.id);
      files[pdfName(sub.name)] = await fillTemplate(template.slice(0), v, flatten);
    }
    const zip = zipSync(files, { level: 6 });
    const zipName = `${sanitize(project.project_number)}-${sanitize(project.name)}.zip`;
    const path = await save({
      defaultPath: zipName,
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
    });
    if (!path) return;
    await api.writeBinaryFile(path, Array.from(zip));
    close();
    setStatus(`Exported ${subs.length} PDF(s) to ${zipName}`);
    },
  );

  const needProject = (fn: () => void) => () =>
    project ? fn() : setDialog({ kind: "newProject" });

  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        { label: "New Project…", action: () => setDialog({ kind: "newProject" }) },
        { label: "Open Project…", action: () => setDialog({ kind: "openProject" }) },
        { label: "Import Project…", action: importProjectFile },
        { label: "Export Project…", action: exportProjectFile, disabled: !project, separatorAfter: true },
        { label: "Add Subcontractor…", action: needProject(() => setDialog({ kind: "addSub" })), disabled: !project, separatorAfter: true },
        { label: "Import CSV…", action: pickImportCsv, disabled: !project },
        { label: "Export CSV…", action: () => setDialog({ kind: "exportCsv" }), disabled: !project },
        { label: "Export PDF…", action: () => setDialog({ kind: "exportPdf" }), disabled: !project },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Rename Project…", action: () => setDialog({ kind: "renameProject" }), disabled: !project },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Zoom In", action: zoomIn, shortcut: "Ctrl++" },
        { label: "Zoom Out", action: zoomOut, shortcut: "Ctrl+−" },
        { label: "Reset Zoom", action: () => setZoom(1), separatorAfter: true },
        {
          label: sidebarVisible ? "Hide Sidebar" : "Show Sidebar",
          action: () => setSidebarVisible((v) => !v),
        },
      ],
    },
    {
      label: "Settings",
      items: [{ label: "Settings…", action: () => setDialog({ kind: "settings" }) }],
    },
    {
      label: "Help",
      items: [{ label: "About SA-2025 Generator", action: () => setDialog({ kind: "about" }) }],
    },
  ];

  const activeSub = subs.find((s) => s.id === activeSubId) ?? null;

  return (
    <div className="app">
      <UpdateBanner />
      <MenuBar menus={menus} />
      <TabBar
        tabs={[
          { key: "pdf", label: "PDF" },
          { key: "subcontract-info", label: "Subcontract Info" },
        ]}
        active={activeTab}
        onSelect={setActiveTab}
      />

      {activeTab === "pdf" && (
        <div className="app__main" ref={mainRef}>
          {sidebarVisible && (
            <>
              <div className="app__sidebar" style={{ width: `${sidebarPct}%` }}>
                <Sidebar
                  project={project}
                  subcontractors={subs}
                  activeId={activeSubId}
                  onNewProject={() => setDialog({ kind: "newProject" })}
                  onOpenProject={() => setDialog({ kind: "openProject" })}
                  onRenameProject={() => setDialog({ kind: "renameProject" })}
                  onSelect={setActiveSubId}
                  onAddSubcontractor={() => setDialog({ kind: "addSub" })}
                  onRenameSubcontractor={(s) => setDialog({ kind: "renameSub", sub: s })}
                  onDeleteSubcontractor={(s) => setDialog({ kind: "confirmDeleteSub", sub: s })}
                />
              </div>
              <div
                className="app__splitter"
                onMouseDown={onSplitterDown}
                role="separator"
                aria-orientation="vertical"
                title="Drag to resize"
              />
            </>
          )}
          <div className="app__canvas">
            <PdfViewer
              ref={viewerRef}
              zoom={zoom}
              values={values}
              editable={activeSubId != null}
              onFieldChange={onPdfFieldChange}
              onLoaded={onDocLoaded}
              onPageChange={setPage}
              onError={onViewerError}
            />
          </div>
        </div>
      )}

      {activeTab === "subcontract-info" && (
        <SubcontractInfoView
          project={project}
          subs={subs}
          onCreateSubcontractor={createSubcontractorByName}
          onRenameSubcontractor={renameSubcontractorByName}
          onChanged={recomputeFieldValues}
        />
      )}

      <StatusBar
        page={page}
        pageCount={pageCount}
        zoom={zoom}
        onFirstPage={firstPage}
        onPrevPage={prevPage}
        onNextPage={nextPage}
        onLastPage={lastPage}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomReset={() => setZoom(1)}
        message={
          activeSub
            ? `${project?.project_number} · ${project?.name} — ${activeSub.name}`
            : project
              ? `${project.project_number} · ${project.name}`
              : status
        }
      />

      {/* --- dialogs --- */}
      {dialog.kind === "newProject" && (
        <PromptModal
          title="New Project"
          submitLabel="Create"
          fields={[
            { key: "name", label: "Project name", required: true, placeholder: "e.g. Riverside Apartments" },
            { key: "number", label: "Project number", required: true, placeholder: "e.g. 2025-014" },
          ]}
          onSubmit={createProject}
          onClose={close}
        />
      )}

      {dialog.kind === "renameProject" && project && (
        <PromptModal
          title="Rename Project"
          fields={[
            { key: "name", label: "Project name", required: true, initial: project.name },
            { key: "number", label: "Project number", required: true, initial: project.project_number },
          ]}
          onSubmit={renameProject}
          onClose={close}
        />
      )}

      {dialog.kind === "openProject" && (
        <OpenProjectModal
          onOpen={openProject}
          onRequestDelete={(p) => setDialog({ kind: "confirmDeleteProject", project: p })}
          onClose={close}
        />
      )}

      {dialog.kind === "addSub" && (
        <PromptModal
          title="Add Subcontractor"
          submitLabel="Add"
          fields={[{ key: "name", label: "Subcontractor name", required: true }]}
          onSubmit={addSub}
          onClose={close}
        />
      )}

      {dialog.kind === "renameSub" && (
        <PromptModal
          title="Rename Subcontractor"
          fields={[{ key: "name", label: "Subcontractor name", required: true, initial: dialog.sub.name }]}
          onSubmit={(v) => renameSub(dialog.sub.id, v)}
          onClose={close}
        />
      )}

      {dialog.kind === "confirmDeleteProject" && (
        <ConfirmModal
          title="Delete Project"
          message={`Delete “${dialog.project.name}” (#${dialog.project.project_number}) and all its subcontractor agreements? This cannot be undone.`}
          onConfirm={() => deleteProject(dialog.project)}
          onClose={() => setDialog({ kind: "openProject" })}
        />
      )}

      {dialog.kind === "confirmDeleteSub" && (
        <ConfirmModal
          title="Delete Subcontractor"
          message={`Delete “${dialog.sub.name}” and its agreement data? This cannot be undone.`}
          onConfirm={() => deleteSub(dialog.sub)}
          onClose={close}
        />
      )}

      {dialog.kind === "exportCsv" && project && (
        <ExportCsvModal
          projectId={project.id}
          onExport={exportCsv}
          onClose={close}
        />
      )}

      {dialog.kind === "exportPdf" && project && (
        <ExportPdfModal
          hasActive={activeSubId != null}
          subCount={subs.length}
          activeName={subs.find((s) => s.id === activeSubId)?.name}
          onExport={exportPdf}
          onClose={close}
        />
      )}

      {dialog.kind === "importReport" && (
        <ImportCsvModal
          path={dialog.path}
          report={dialog.report}
          onConfirm={() => commitImport(dialog.path)}
          onClose={close}
        />
      )}

      {dialog.kind === "error" && (
        <Modal
          title={dialog.title}
          onClose={close}
          width={500}
          primaryActions={[
            { label: "Close", variant: "primary", onClick: close },
          ]}
        >
          <p style={{ marginTop: 0 }}>The operation could not be completed:</p>
          <pre className="errordetail">{dialog.message}</pre>
        </Modal>
      )}

      {dialog.kind === "about" && <AboutModal onClose={close} />}
      {dialog.kind === "settings" && <SettingsModal onClose={close} />}

      {importProgress && (
        <ImportProgressOverlay
          current={importProgress.current}
          total={importProgress.total}
          phase={importProgress.phase}
        />
      )}
    </div>
  );
}

export default App;
