import { useEffect, useMemo, useRef, useState } from "react";
import { HotTable, type HotTableRef } from "@handsontable/react-wrapper";
import { registerAllModules } from "handsontable/registry";
import type { CellChange, ChangeSource } from "handsontable/common";
import { api, type Project, type Subcontractor, type TpCompany } from "../api";
import { GRID_COLUMNS, CI_COLUMNS } from "../lib/gridColumns";
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
  /** The pinned top row: holds the per-column defaults, not a subcontractor. */
  _isDefaults?: 1;
  [columnKey: string]: string | number | undefined;
}

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
            values.ci_job_number || defaults.job_number,
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

        const defaultsRow: GridRow = { _isDefaults: 1 };
        for (const col of GRID_COLUMNS) defaultsRow[col.key] = "";
        defaultsRow.B_subcontractor = "DEFAULTS (applies to all rows)";
        for (const col of CI_COLUMNS) defaultsRow[col.key] = defaults[col.ciKey!] ?? "";

        const subRows: GridRow[] = subs.map((sub) => {
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
        const builtRows: GridRow[] = [defaultsRow, ...subRows];

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
    if (hot) applySearchFilter(hot, searchQuery, 1);
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

  // Row 0 is the pinned defaults row: only the former-Contract-Info columns
  // are editable there, and the whole row gets a distinct tint.
  const cells = (row: number, col: number) => {
    if (row !== 0) return {};
    const gridCol = GRID_COLUMNS[col];
    const base = (columns[col]?.className as string | undefined) ?? "";
    return {
      readOnly: !gridCol?.ciKey,
      className: `${base} htDefaultsRow`.trim(),
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
    interface RowEdits {
      subId: number;
      values: Record<string, string>;
      aTradeChanged: boolean;
    }
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
        // Row 0 is the pinned defaults row, so the HyperFormula engine (one
        // row per subcontractor) is offset by one from the grid's source data.
        const engRow = rowIndex - 1;

        if (row._isDefaults) {
          // Defaults row: persist the default, then broadcast it to every
          // subcontractor row's cell in this column.
          if (!col.ciKey || !project) continue;
          const newDefault = newValue == null ? "" : String(newValue);
          void api
            .setContractInfoValue(project.id, col.ciKey, newDefault)
            .catch((e) => console.error("save default failed", e));
          const colIdx = GRID_COLUMNS.findIndex((c) => c.key === col.key);
          const allRows = hot.getSourceData() as GridRow[];
          allRows.forEach((r, p) => {
            if (p === 0 || !r._subId) return;
            hot.setSourceDataAtCell(p, col.key, newDefault, "sync");
            setCell(engine, p - 1, colIdx, newDefault);
            let e = editsByRow.get(p - 1);
            if (!e) {
              e = { subId: r._subId, values: {}, aTradeChanged: false };
              editsByRow.set(p - 1, e);
            }
            e.values[col.key] = newDefault;
            if (col.key === "ci_job_number") {
              const code = buildCostCode(
                String(r.A_trade ?? ""),
                newDefault || project.project_number,
                subTradeCodeByTrade,
              );
              e.values.C_cost_code = code;
              hot.setSourceDataAtCell(p, "C_cost_code", code, "sync");
            }
          });
          anyEdit = true;
          continue;
        }
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
          const job = col.key === "ci_job_number" ? value : String(row.ci_job_number ?? "");
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

    // One DB write + one recompute-read + one DOM sync per affected row.
    for (const [engRow, entry] of editsByRow) {
      const rowIndex = engRow + 1; // grid source row (row 0 is the defaults row)
      if (Object.keys(entry.values).length > 0) {
        void api
          .bulkSetGridValues(entry.subId, entry.values)
          .catch((e) => console.error("save failed", e));
      }
      const computed = recomputeRow(engine, engRow);
      hot.setSourceDataAtCell(rowIndex, "D_tp_address", computed.D_tp_address, "sync");
      hot.setSourceDataAtCell(rowIndex, "E_tp_email", computed.E_tp_email, "sync");
      hot.setSourceDataAtCell(rowIndex, "M_contract_value", computed.M_contract_value, "sync");
    }

    hot.render();
    if (anyEdit || editsByRow.size > 0) onChanged();
  };

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
          fixedRowsTop={1}
          cells={cells}
          wordWrap={false}
          manualColumnResize={true}
          autoColumnSize={true}
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
