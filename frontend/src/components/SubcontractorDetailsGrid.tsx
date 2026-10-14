import { useEffect, useMemo, useRef, useState } from "react";
import { HotTable, type HotTableRef } from "@handsontable/react-wrapper";
import { registerAllModules } from "handsontable/registry";
import type { CellChange, ChangeSource } from "handsontable/common";
import { api, type Project, type Subcontractor, type TpCompany } from "../api";
import { GRID_COLUMNS, DEFAULTABLE_COLUMNS, defaultKeyFor, type GridColumn } from "../lib/gridColumns";
import { effectiveDefaults, ensureContractInfoMigrated } from "../lib/contractDefaults";
import { applySearchFilter } from "../lib/gridSearch";
import { buildCostCode, parseSubTrades } from "../lib/subTrades";
import {
  createEngine,
  loadSubcontractorDetails,
  loadTpCompanies,
  recomputeRow,
  setCell,
  type ComputedRow,
} from "../lib/hyperformulaEngine";
import "handsontable/styles/handsontable.css";
import "handsontable/styles/ht-theme-main.css";
import "./SubcontractorDetailsGrid.css";

registerAllModules();

const NUMBER_COLUMN_KEYS = GRID_COLUMNS.filter((c) => c.type === "number").map((c) => c.key);

interface GridRow {
  /** Absent on a not-yet-saved blank row (Handsontable's trailing spare row). */
  _subId?: number;
  [columnKey: string]: string | number | undefined;
}

interface RowEdits {
  subId: number;
  values: Record<string, string>;
  aTradeChanged: boolean;
}

const DEFAULTABLE_KEYS = new Set(DEFAULTABLE_COLUMNS.map((c) => c.key));

/** Starting column width; the defaults strip and the grid share one width list so they stay aligned. */
function initialWidth(col: GridColumn): number {
  if (col.type === "name-mirror" || col.key === "D_tp_address" || col.key === "E_tp_email") return 220;
  const longest = Math.max(...col.title.split("\n").map((l) => l.length));
  const min = col.type === "checkbox" ? 90 : col.type === "dropdown" ? 140 : 110;
  return Math.max(min, Math.min(260, Math.round(longest * 7) + 30));
}
const ROW_HEADER_WIDTH = 64;

function parseList(json: string | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function SubcontractorDetailsGrid({
  project,
  subs,
  onCreateSubcontractor,
  onRenameSubcontractor,
  onDeleteSubcontractor,
  onChanged,
}: {
  project: Project | null;
  subs: Subcontractor[];
  onCreateSubcontractor: (
    name: string,
    initialGridValues?: Record<string, string>,
  ) => Promise<Subcontractor>;
  onRenameSubcontractor: (id: number, name: string) => Promise<void>;
  onDeleteSubcontractor: (sub: Subcontractor) => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<GridRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dropdownOptionsByListKey, setDropdownOptionsByListKey] = useState<
    Record<string, string[]>
  >({});
  const [tpCompanyNames, setTpCompanyNames] = useState<string[]>([]);
  const [subTradeCodeByTrade, setSubTradeCodeByTrade] = useState<Record<string, string>>({});
  const [selectedValue, setSelectedValue] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const hotRef = useRef<HotTableRef>(null);
  const defaultsHotRef = useRef<HotTableRef>(null);
  const [defaultsRows, setDefaultsRows] = useState<GridRow[]>([{}]);
  const [colWidths, setColWidths] = useState<number[]>(() => GRID_COLUMNS.map(initialWidth));
  const engineRef = useRef(createEngine());
  const tpRowCountRef = useRef(1);

  useEffect(() => {
    if (!project) {
      setRows(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await ensureContractInfoMigrated(project, subs);
        if (cancelled) return;
        const [gridValues, companies, settings, contractInfo] = await Promise.all([
          api.getGridValuesForProject(project.id),
          api.listTpCompanies(),
          api.getSettings(),
          api.getContractInfo(project.id),
        ]);
        if (cancelled) return;

        // Self-heal any already-stored comma-corrupted numeric value (see
        // onAfterChange's sanitize step) so old data doesn't keep tripping up
        // SUBTOTAL even after the bug that wrote it is fixed - and actually
        // persist the correction (not just patch the in-memory copy), since
        // other readers of the same data (e.g. the recompute pipeline's own
        // separate engine) would otherwise keep re-fetching the corrupted
        // value from the database forever.
        for (const [subIdStr, values] of Object.entries(gridValues)) {
          const corrections: Record<string, string> = {};
          for (const col of NUMBER_COLUMN_KEYS) {
            if (values[col]?.includes(",")) {
              values[col] = values[col].replace(/,/g, "");
              corrections[col] = values[col];
            }
          }
          if (Object.keys(corrections).length > 0) {
            void api.bulkSetGridValues(Number(subIdStr), corrections);
          }
        }

        const subTradeEntries = parseSubTrades(settings.list_sub_trades);
        const codeByTrade: Record<string, string> = {};
        for (const { trade, code } of subTradeEntries) codeByTrade[trade] = code;
        const defaults = effectiveDefaults(contractInfo, project);

        // The Code column is app-derived, not user-entered - recompute it
        // from the current Trade + Settings cost codes + job number on every
        // load (rather than trusting whatever was last persisted), and
        // persist the correction so PDF generation picks up the same value.
        for (const sub of subs) {
          const values = gridValues[sub.id] ?? (gridValues[sub.id] = {});
          const computedCode = buildCostCode(
            values.A_trade ?? "",
            values.ci_job_number || project.project_number,
            codeByTrade,
          );
          if ((values.C_cost_code ?? "") !== computedCode) {
            values.C_cost_code = computedCode;
            void api.bulkSetGridValues(sub.id, { C_cost_code: computedCode });
          }
        }

        setSubTradeCodeByTrade(codeByTrade);

        const engine = engineRef.current;
        tpRowCountRef.current = loadTpCompanies(engine, companies as TpCompany[]);
        const computed = loadSubcontractorDetails(
          engine,
          subs.map((s) => ({ id: s.id, name: s.name })),
          gridValues,
          tpRowCountRef.current,
        );

        // The defaults strip lives outside the table's data: one editable
        // cell per defaultable column, blank for auto-calculated ones.
        const defaultsRow: GridRow = {};
        for (const col of GRID_COLUMNS) defaultsRow[col.key] = DEFAULTABLE_KEYS.has(col.key) ? defaults[col.key] ?? "" : "";
        defaultsRow.B_subcontractor = "Applies to all rows";
        setDefaultsRows([defaultsRow]);

        const builtRows: GridRow[] = subs.map((sub) => {
          const values = gridValues[sub.id] ?? {};
          const row: GridRow = { _subId: sub.id };
          for (const col of GRID_COLUMNS) {
            if (col.type === "name-mirror") row[col.key] = sub.name;
            else if (col.type === "computed") {
              row[col.key] = computed[sub.id]?.[col.key as keyof ComputedRow] ?? "";
            } else row[col.key] = values[col.key] ?? "";
          }
          return row;
        });

        const [pm, btm, qs] = await Promise.all([
          api.listStaff("PM"),
          api.listStaff("BTM"),
          api.listStaff("QS"),
        ]);
        if (cancelled) return;

        setDropdownOptionsByListKey({
          staff_PM: pm.map((m) => m.name),
          staff_BTM: btm.map((m) => m.name),
          staff_QS: qs.map((m) => m.name),
          list_sub_trades: subTradeEntries.map((e) => e.trade),
          list_mats_off_site: parseList(settings.list_mats_off_site),
        });
        setTpCompanyNames((companies as TpCompany[]).map((c) => c.company));
        setRows(builtRows);
      } catch (e) {
        if (!cancelled) setLoadError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, subs.length]);

  // Re-apply whenever the query changes *or* the grid gets a fresh data set
  // (e.g. switching projects) - a previous trim's physical row indices
  // don't track a wholesale data swap.
  useEffect(() => {
    const hot = hotRef.current?.hotInstance;
    if (hot) applySearchFilter(hot, searchQuery);
  }, [rows, searchQuery]);

  const columns = useMemo(
    () =>
      GRID_COLUMNS.map((col) => {
        const base: Record<string, unknown> = {
          data: col.key,
          title: col.title,
        };
        if (col.type === "checkbox") {
          base.type = "checkbox";
        } else if (col.type === "computed" || col.type === "cost-code") {
          base.readOnly = true;
          base.className = "htComputedColumn";
        } else if (col.type === "dropdown") {
          base.type = "dropdown";
          base.source =
            col.options ??
            dropdownOptionsByListKey[col.settingsListKey ?? `staff_${col.staffRole}`] ??
            [];
        } else if (col.type === "name-mirror") {
          // Autocomplete (not a strict dropdown) against TP Companies' names
          // - D/E's XLOOKUP needs an exact match to find an address/email,
          // but a brand-new subcontractor not yet in TP Companies should
          // still be enterable as free text.
          base.type = "autocomplete";
          base.source = tpCompanyNames;
          base.strict = false;
          base.filter = true;
        } else if (col.type === "number") {
          base.type = "numeric";
          // Explicit format (rather than relying on Handsontable's locale
          // default) - without this, the numeric editor can write the
          // *formatted* display string (with thousands separators) back into
          // the source data on commit, which then fails to parse as a number
          // downstream (HyperFormula's SUBTOTAL silently treats it as 0).
          base.numericFormat = { pattern: "0,0.00" };
        }
        return base;
      }),
    [dropdownOptionsByListKey, tpCompanyNames],
  );

  // The defaults strip is a one-row table above the grid: only defaultable
  // columns are editable; auto-calculated ones are greyed out.
  const defaultCells = (_row: number, col: number) => {
    const gridCol = GRID_COLUMNS[col];
    const base = (columns[col]?.className as string | undefined) ?? "";
    const editable = !!gridCol && DEFAULTABLE_KEYS.has(gridCol.key);
    return {
      readOnly: !editable,
      className: `${base} ${editable ? "htDefaultsCell" : "htNoDefaultCell"}`.trim(),
    };
  };

  // A single gesture can touch a huge number of cells at once - e.g.
  // selecting the top-left corner ("select all") and pressing Delete emits one
  // change per editable cell across every row. The old code did a separate DB
  // write, HyperFormula recompute, and DOM sync *per cell*, which froze the app
  // for a full grid. `applyChanges` instead collects the edits keyed by
  // physical row and flushes one bulk write + one recompute + one DOM sync per
  // affected row, with all engine writes wrapped in a single evaluation
  // suspension so HyperFormula recalculates once rather than per cell. Even so,
  // this work is synchronous and blocks the UI thread; `onAfterChange` shows a
  // "Processing…" overlay and yields a frame for it to paint before starting,
  // for large batches, so the app doesn't look like it has frozen/crashed.
  const applyChanges = (
    hot: NonNullable<HotTableRef["hotInstance"]>,
    changes: CellChange[],
  ) => {
    const editsByRow = new Map<number, RowEdits>();
    let anyEdit = false;

    const engine = engineRef.current;
    engine.suspendEvaluation();
    try {
      for (const [visualRow, prop, oldValue, newValue] of changes) {
        const col = GRID_COLUMNS.find((c) => c.key === prop);
        if (
          !col ||
          col.type === "computed" ||
          col.type === "cost-code"
        )
          continue;

        // `changes` reports a visual row index, but the source-data APIs
        // below (and the HyperFormula engine, which mirrors physical row
        // order) take physical row indices - the two diverge once the
        // search filter trims rows.
        const rowIndex = hot.toPhysicalRow(visualRow);
        if (rowIndex === null) continue;
        const row = hot.getSourceDataAtRow(rowIndex) as GridRow | undefined;
        if (!row) continue;
        const engRow = rowIndex;

        let value = newValue == null ? "" : String(newValue);
        if (col.type === "number" && value) {
          // Defensive backstop: strip thousands-separator commas regardless of
          // why they might be there (e.g. a numeric editor echoing its own
          // display formatting back into source data) - a comma-containing
          // string silently fails numeric parsing downstream (HyperFormula's
          // SUBTOTAL would treat it as 0 rather than erroring).
          const sanitized = value.replace(/,/g, "");
          if (sanitized !== value) {
            value = sanitized;
            hot.setSourceDataAtCell(rowIndex, col.key, sanitized, "sync");
          }
        }

        if (col.type === "name-mirror") {
          const trimmed = value.trim();
          if (!trimmed) {
            // Clearing the Subcontractor cell isn't a valid edit: the name is
            // the row's identity - it drives the sidebar label, the PDF
            // filename, the PDF's Subcontractor_Name field, and D/E's address
            // lookup, all of which stay populated. Leaving B blank would make
            // the grid silently contradict every other surface (and strand
            // D/E showing an address for a "nameless" row). So restore the
            // real entity name rather than accept the blank. (To actually
            // remove a subcontractor, use the sidebar's delete.) A blank spare
            // row has no identity to restore, so just ignore it there.
            if (row._subId) {
              const existing =
                subs.find((s) => s.id === row._subId)?.name ?? String(oldValue ?? "");
              if (existing) hot.setSourceDataAtCell(rowIndex, col.key, existing, "sync");
            }
            continue;
          }
          if (!row._subId) {
            // A blank spare row just got a name typed into it - this *is* the
            // "add a subcontractor" action now, not a prerequisite for one.
            //
            // Anything already typed into *other* columns of this spare row
            // (e.g. a Trade in column A) only lived in the grid's in-memory
            // source data until now - there was no subcontractor id to persist
            // it against. Creating the subcontractor triggers a reload from the
            // database (subs.length changes), which would wipe those unsaved
            // values, so capture and persist them against the new id first.
            const pending: Record<string, string> = {};
            for (const c of GRID_COLUMNS) {
              if (
                c.type === "computed" ||
                c.type === "cost-code" ||
                c.type === "name-mirror"
              )
                continue;
              const v = row[c.key];
              if (v != null && String(v) !== "") pending[c.key] = String(v);
            }
            onCreateSubcontractor(trimmed, pending)
              .then(onChanged)
              .catch((e) => console.error("create failed", e));
          } else if (trimmed !== String(oldValue ?? "").trim()) {
            onRenameSubcontractor(row._subId, trimmed)
              .then(onChanged)
              .catch((e) => console.error("rename failed", e));
            // The name is the XLOOKUP key for D/E - recompute this row.
            const colIndex = GRID_COLUMNS.findIndex((c) => c.key === col.key);
            setCell(engine, engRow, colIndex, trimmed);
            let entry = editsByRow.get(engRow);
            if (!entry) {
              entry = { subId: row._subId, values: {}, aTradeChanged: false };
              editsByRow.set(engRow, entry);
            }
          }
          continue;
        }

        if (!row._subId) continue; // blank spare row with no name yet - nothing to persist to

        const colIndex = GRID_COLUMNS.findIndex((c) => c.key === col.key);
        setCell(engine, engRow, colIndex, value);

        let entry = editsByRow.get(engRow);
        if (!entry) {
          entry = { subId: row._subId, values: {}, aTradeChanged: false };
          editsByRow.set(engRow, entry);
        }
        entry.values[col.key] = value;
        if (col.key === "A_trade" || col.key === "ci_job_number") {
          entry.aTradeChanged = true;
          const trade = col.key === "A_trade" ? value : String(row.A_trade ?? "");
          const job =
            (col.key === "ci_job_number" ? value : String(row.ci_job_number ?? "")) ||
            project?.project_number;
          const newCode = buildCostCode(trade, job, subTradeCodeByTrade);
          entry.values.C_cost_code = newCode;
          hot.setSourceDataAtCell(rowIndex, "C_cost_code", newCode, "sync");
        }
        anyEdit = true;
      }
    } finally {
      // Resume once - HyperFormula recalculates all dependents in one pass.
      engine.resumeEvaluation();
    }

    flushEdits(hot, editsByRow, anyEdit);
  };

  // One DB write + one recompute-read + one DOM sync per affected row.
  const flushEdits = (
    hot: NonNullable<HotTableRef["hotInstance"]>,
    editsByRow: Map<number, RowEdits>,
    anyEdit: boolean,
  ) => {
    const engine = engineRef.current;
    for (const [rowIndex, entry] of editsByRow) {
      if (Object.keys(entry.values).length > 0) {
        void api
          .bulkSetGridValues(entry.subId, entry.values)
          .catch((e) => console.error("save failed", e));
      }
      const computed = recomputeRow(engine, rowIndex);
      hot.setSourceDataAtCell(rowIndex, "D_tp_address", computed.D_tp_address, "sync");
      hot.setSourceDataAtCell(rowIndex, "E_tp_email", computed.E_tp_email, "sync");
      hot.setSourceDataAtCell(rowIndex, "M_contract_value", computed.M_contract_value, "sync");
    }

    hot.render();
    if (anyEdit || editsByRow.size > 0) onChanged();
  };

  // An edit in the defaults strip: persist it as the column's default, then
  // write it into every subcontractor row's cell in that column.
  const onDefaultsAfterChange = (changes: CellChange[] | null, source: ChangeSource) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot || !project || !changes || source === "loadData" || (source as string) === "sync") return;

    const engine = engineRef.current;
    const editsByRow = new Map<number, RowEdits>();
    const allRows = hot.getSourceData() as GridRow[];
    engine.suspendEvaluation();
    try {
      for (const [, prop, , newValue] of changes) {
        const col = GRID_COLUMNS.find((c) => c.key === prop);
        if (!col || !DEFAULTABLE_KEYS.has(col.key)) continue;
        let value = newValue == null ? "" : String(newValue);
        if (col.type === "number") value = value.replace(/,/g, "");
        void api
          .setContractInfoValue(project.id, defaultKeyFor(col), value)
          .catch((e) => console.error("save default failed", e));
        const colIdx = GRID_COLUMNS.findIndex((c) => c.key === col.key);
        allRows.forEach((r, p) => {
          if (!r._subId) return; // the trailing blank spare row
          hot.setSourceDataAtCell(p, col.key, value, "sync");
          setCell(engine, p, colIdx, value);
          let entry = editsByRow.get(p);
          if (!entry) {
            entry = { subId: r._subId, values: {}, aTradeChanged: false };
            editsByRow.set(p, entry);
          }
          entry.values[col.key] = value;
          if (col.key === "A_trade" || col.key === "ci_job_number") {
            const code = buildCostCode(
              String(r.A_trade ?? ""),
              String(r.ci_job_number ?? "") || project.project_number,
              subTradeCodeByTrade,
            );
            entry.values.C_cost_code = code;
            hot.setSourceDataAtCell(p, "C_cost_code", code, "sync");
          }
        });
      }
    } finally {
      engine.resumeEvaluation();
    }
    flushEdits(hot, editsByRow, true);
  };

  // Keep the defaults strip horizontally in step with the grid (and back),
  // and leave room for the grid's vertical scrollbar so columns stay aligned.
  const syncing = useRef(false);
  const holderOf = (ref: React.RefObject<HotTableRef | null>) =>
    ref.current?.hotInstance?.rootElement.querySelector<HTMLElement>(".ht_master .wtHolder") ?? null;
  const syncScroll = (from: React.RefObject<HotTableRef | null>, to: React.RefObject<HotTableRef | null>) => {
    if (syncing.current) return;
    const a = holderOf(from);
    const b = holderOf(to);
    if (!a || !b || a.scrollLeft === b.scrollLeft) return;
    syncing.current = true;
    b.scrollLeft = a.scrollLeft;
    syncing.current = false;
  };
  const padForScrollbar = () => {
    const holder = holderOf(hotRef);
    const strip = holder?.closest(".sdgrid")?.querySelector<HTMLElement>(".sdgrid__defaults");
    if (holder && strip) strip.style.paddingRight = `${holder.offsetWidth - holder.clientWidth}px`;
  };

  const onColumnResize = (newSize: number, column: number) =>
    setColWidths((prev) => prev.map((w, i) => (i === column ? newSize : w)));

  // Above this many cell changes in one gesture, the batched apply takes long
  // enough to be perceptible, so route it through the paint-first overlay path.
  const PROCESSING_THRESHOLD = 40;

  const onAfterChange = (changes: CellChange[] | null, source: ChangeSource) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot || !changes || source === "loadData" || (source as string) === "sync") return;

    if (changes.length < PROCESSING_THRESHOLD) {
      applyChanges(hot, changes);
      return;
    }

    // Snapshot the changes (Handsontable may recycle the array) and defer the
    // heavy work until after the browser has painted the overlay. A single rAF
    // fires before paint; a second, nested rAF runs after it - guaranteeing the
    // "Processing…" state is actually on screen before we block the thread.
    const snapshot = changes.slice();
    setIsProcessing(true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        try {
          applyChanges(hot, snapshot);
        } finally {
          setIsProcessing(false);
        }
      }),
    );
  };

  const onAfterSelectionEnd = (row: number, col: number) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    const gridCol = GRID_COLUMNS[col];
    if (!gridCol) return;
    const value = hot.getDataAtCell(row, col);
    setSelectedLabel(`${gridCol.letter} · ${gridCol.title.replace(/\n/g, " ")}`);
    setSelectedValue(value == null ? "" : String(value));
  };

  const commitFormulaBar = () => {
    const hot = hotRef.current?.hotInstance;
    const sel = hot?.getSelectedLast();
    if (!hot || !sel) return;
    hot.setDataAtCell(sel[0], sel[1], selectedValue);
  };

  // Resolve the subcontractor for the currently selected (right-clicked) row,
  // or undefined for the blank spare row / an unsaved row. Handsontable selects
  // the cell under the cursor before opening the context menu, so the last
  // selection is the right-clicked row.
  const selectedSub = (): Subcontractor | undefined => {
    const hot = hotRef.current?.hotInstance;
    const sel = hot?.getSelectedLast();
    if (!hot || !sel) return undefined;
    const phys = hot.toPhysicalRow(sel[0]);
    if (phys == null) return undefined;
    const row = hot.getSourceDataAtRow(phys) as GridRow | undefined;
    return row?._subId ? subs.find((s) => s.id === row._subId) : undefined;
  };

  // Right-click a row → "Delete subcontractor". Routes through the same
  // confirm-and-delete path as the sidebar (onDeleteSubcontractor) so removal
  // stays consistent across the grid, sidebar and PDF preview. Disabled on the
  // blank spare row, which has no subcontractor to delete.
  const contextMenu = {
    items: {
      delete_subcontractor: {
        name: "Delete subcontractor",
        disabled: () => !selectedSub(),
        callback: () => {
          const sub = selectedSub();
          if (sub) onDeleteSubcontractor(sub);
        },
      },
    },
  };

  if (!project) {
    return <p className="sdgrid__loading">Open a project to enter Subcontractor Details.</p>;
  }
  if (loadError) {
    return <p className="sdgrid__loading">Failed to load: {loadError}</p>;
  }
  if (rows === null) {
    return <p className="sdgrid__loading">Loading Subcontractor Details…</p>;
  }

  return (
    <div className="sdgrid">
      <div className="sdgrid__toolbar">
        <input
          type="search"
          className="sdgrid__search"
          placeholder="Search…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      <div className="sdgrid__formulabar">
        <span className="sdgrid__formulabar-label">{selectedLabel || "Select a cell"}</span>
        <input
          className="sdgrid__formulabar-input"
          value={selectedValue}
          onChange={(e) => setSelectedValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commitFormulaBar()}
          onBlur={commitFormulaBar}
        />
      </div>
      <div className="sdgrid__defaults" title="Values entered here are applied to every row in that column">
        <HotTable
          ref={defaultsHotRef}
          data={defaultsRows}
          columns={columns}
          colHeaders={false}
          rowHeaders={["Defaults"]}
          rowHeaderWidth={ROW_HEADER_WIDTH}
          fixedColumnsStart={2}
          colWidths={colWidths}
          manualColumnResize={true}
          wordWrap={false}
          cells={defaultCells}
          height="auto"
          width="100%"
          themeName="ht-theme-main"
          licenseKey="non-commercial-and-evaluation"
          contextMenu={false}
          afterChange={onDefaultsAfterChange}
          afterColumnResize={onColumnResize}
          afterScrollHorizontally={() => syncScroll(defaultsHotRef, hotRef)}
        />
      </div>
      <div className="sdgrid__table">
        {isProcessing && (
          <div className="sdgrid__processing" role="status" aria-live="polite">
            <div className="sdgrid__processing-box">
              <span className="sdgrid__spinner" aria-hidden="true" />
              <span>Processing…</span>
            </div>
          </div>
        )}
        <HotTable
          ref={hotRef}
          data={rows}
          columns={columns}
          colHeaders={GRID_COLUMNS.map((c) => c.title)}
          rowHeaders={true}
          fixedColumnsStart={2}
          wordWrap={false}
          manualColumnResize={true}
          colWidths={colWidths}
          rowHeaderWidth={ROW_HEADER_WIDTH}
          afterColumnResize={onColumnResize}
          afterScrollHorizontally={() => syncScroll(hotRef, defaultsHotRef)}
          afterRender={padForScrollbar}
          minSpareRows={1}
          trimRows={true}
          height="100%"
          width="100%"
          themeName="ht-theme-main"
          licenseKey="non-commercial-and-evaluation"
          contextMenu={contextMenu}
          afterChange={onAfterChange}
          afterSelectionEnd={onAfterSelectionEnd}
        />
      </div>
    </div>
  );
}
