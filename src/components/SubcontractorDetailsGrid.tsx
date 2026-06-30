import { useEffect, useMemo, useRef, useState } from "react";
import { HotTable, type HotTableRef } from "@handsontable/react-wrapper";
import { registerAllModules } from "handsontable/registry";
import type { CellChange, ChangeSource } from "handsontable/common";
import { api, type Project, type Subcontractor, type TpCompany } from "../api";
import { GRID_COLUMNS } from "../lib/gridColumns";
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
  onChanged,
}: {
  project: Project | null;
  subs: Subcontractor[];
  onCreateSubcontractor: (name: string) => Promise<Subcontractor>;
  onRenameSubcontractor: (id: number, name: string) => Promise<void>;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<GridRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dropdownOptionsByListKey, setDropdownOptionsByListKey] = useState<
    Record<string, string[]>
  >({});
  const [tpCompanyNames, setTpCompanyNames] = useState<string[]>([]);
  const [subTradeCodeByTrade, setSubTradeCodeByTrade] = useState<Record<string, string>>({});
  const [jobNumber, setJobNumber] = useState("");
  const [selectedValue, setSelectedValue] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
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
        const [gridValues, companies, settings, contractInfo] = await Promise.all([
          api.getGridValuesForProject(project.id),
          api.listTpCompanies(),
          api.getSettings(),
          api.getContractInfo(project.id),
        ]);
        if (cancelled) return;

        // Self-heal any already-stored comma-corrupted numeric value (see
        // onAfterChange's sanitize step) so old data doesn't keep tripping up
        // SUBTOTAL even after the bug that wrote it is fixed — and actually
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
        // Contract Info's Job Number field only *displays* a fallback to the
        // project's own number until the user types into it (see
        // ContractInfoForm's displayValues) — api.getContractInfo returns the
        // real stored value, which is empty in that case, so apply the same
        // fallback here.
        const job = contractInfo.job_number || project.project_number || "";

        // The Code column is app-derived, not user-entered — recompute it
        // from the current Trade + Settings cost codes + job number on every
        // load (rather than trusting whatever was last persisted), and
        // persist the correction so PDF generation picks up the same value.
        for (const sub of subs) {
          const values = gridValues[sub.id] ?? (gridValues[sub.id] = {});
          const computedCode = buildCostCode(values.A_trade ?? "", job, codeByTrade);
          if ((values.C_cost_code ?? "") !== computedCode) {
            values.C_cost_code = computedCode;
            void api.bulkSetGridValues(sub.id, { C_cost_code: computedCode });
          }
        }

        setSubTradeCodeByTrade(codeByTrade);
        setJobNumber(job);

        const engine = engineRef.current;
        tpRowCountRef.current = loadTpCompanies(engine, companies as TpCompany[]);
        const computed = loadSubcontractorDetails(
          engine,
          subs.map((s) => ({ id: s.id, name: s.name })),
          gridValues,
          tpRowCountRef.current,
        );

        const builtRows: GridRow[] = subs.map((sub) => {
          const values = gridValues[sub.id] ?? {};
          const row: GridRow = { _subId: sub.id };
          for (const col of GRID_COLUMNS) {
            if (col.type === "name-mirror") row[col.key] = sub.name;
            else if (col.type === "computed") {
              row[col.key] = computed[sub.id]?.[col.key as keyof ComputedRow] ?? "";
            } else if (col.type === "contract-info-mirror") {
              row[col.key] = contractInfo[col.contractInfoKey!] ?? "";
            } else row[col.key] = values[col.key] ?? "";
          }
          return row;
        });

        setDropdownOptionsByListKey({
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
  // (e.g. switching projects) — a previous trim's physical row indices
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
        } else if (col.type === "contract-info-mirror") {
          base.readOnly = true;
          if (col.contractInfoKey === "required_until_other") {
            // text mirror, not boolean
          } else {
            base.type = "checkbox";
          }
        } else if (col.type === "computed" || col.type === "cost-code") {
          base.readOnly = true;
          base.className = "htComputedColumn";
        } else if (col.type === "dropdown") {
          base.type = "dropdown";
          base.source = dropdownOptionsByListKey[col.settingsListKey!] ?? [];
        } else if (col.type === "name-mirror") {
          // Autocomplete (not a strict dropdown) against TP Companies' names
          // — D/E's XLOOKUP needs an exact match to find an address/email,
          // but a brand-new subcontractor not yet in TP Companies should
          // still be enterable as free text.
          base.type = "autocomplete";
          base.source = tpCompanyNames;
          base.strict = false;
          base.filter = true;
        } else if (col.type === "number") {
          base.type = "numeric";
          // Explicit format (rather than relying on Handsontable's locale
          // default) — without this, the numeric editor can write the
          // *formatted* display string (with thousands separators) back into
          // the source data on commit, which then fails to parse as a number
          // downstream (HyperFormula's SUBTOTAL silently treats it as 0).
          base.numericFormat = { pattern: "0,0.00" };
        }
        return base;
      }),
    [dropdownOptionsByListKey, tpCompanyNames],
  );

  const onAfterChange = (changes: CellChange[] | null, source: ChangeSource) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot || !changes || source === "loadData" || (source as string) === "sync") return;
    for (const [visualRow, prop, oldValue, newValue] of changes) {
      const col = GRID_COLUMNS.find((c) => c.key === prop);
      if (!col || col.type === "computed" || col.type === "contract-info-mirror" || col.type === "cost-code")
        continue;

      // `changes` reports a visual row index, but the source-data APIs
      // below (and the HyperFormula engine, which mirrors physical row
      // order) take physical row indices — the two diverge once the
      // search filter trims rows.
      const rowIndex = hot.toPhysicalRow(visualRow);
      if (rowIndex === null) continue;
      const row = hot.getSourceDataAtRow(rowIndex) as GridRow | undefined;
      if (!row) continue;
      let value = newValue == null ? "" : String(newValue);
      if (col.type === "number" && value) {
        // Defensive backstop: strip thousands-separator commas regardless of
        // why they might be there (e.g. a numeric editor echoing its own
        // display formatting back into source data) — a comma-containing
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
        if (!trimmed) continue; // ignore clearing the name — not a delete affordance
        if (!row._subId) {
          // A blank spare row just got a name typed into it — this *is* the
          // "add a subcontractor" action now, not a prerequisite for one.
          onCreateSubcontractor(trimmed)
            .then(onChanged)
            .catch((e) => console.error("create failed", e));
        } else if (trimmed !== String(oldValue ?? "").trim()) {
          onRenameSubcontractor(row._subId, trimmed)
            .then(onChanged)
            .catch((e) => console.error("rename failed", e));
          // The name is the XLOOKUP key for D/E — recompute this row.
          const colIndex = GRID_COLUMNS.findIndex((c) => c.key === col.key);
          setCell(engineRef.current, rowIndex, colIndex, trimmed);
          const computed = recomputeRow(engineRef.current, rowIndex);
          hot.setSourceDataAtCell(rowIndex, "D_tp_address", computed.D_tp_address, "sync");
          hot.setSourceDataAtCell(rowIndex, "E_tp_email", computed.E_tp_email, "sync");
        }
        continue;
      }

      if (!row._subId) continue; // blank spare row with no name yet — nothing to persist to
      api
        .setGridValue(row._subId, col.key, value)
        .then(onChanged)
        .catch((e) => console.error("save failed", e));

      const colIndex = GRID_COLUMNS.findIndex((c) => c.key === col.key);
      setCell(engineRef.current, rowIndex, colIndex, value);
      const computed = recomputeRow(engineRef.current, rowIndex);
      hot.setSourceDataAtCell(rowIndex, "D_tp_address", computed.D_tp_address, "sync");
      hot.setSourceDataAtCell(rowIndex, "E_tp_email", computed.E_tp_email, "sync");
      hot.setSourceDataAtCell(rowIndex, "M_contract_value", computed.M_contract_value, "sync");

      if (col.key === "A_trade") {
        const newCode = buildCostCode(value, jobNumber, subTradeCodeByTrade);
        hot.setSourceDataAtCell(rowIndex, "C_cost_code", newCode, "sync");
        void api.setGridValue(row._subId, "C_cost_code", newCode).then(onChanged);
      }
    }
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
        <HotTable
          ref={hotRef}
          data={rows}
          columns={columns}
          colHeaders={GRID_COLUMNS.map((c) => c.title)}
          rowHeaders={true}
          fixedColumnsStart={2}
          wordWrap={false}
          manualColumnResize={true}
          autoColumnSize={true}
          minSpareRows={1}
          trimRows={true}
          height="100%"
          width="100%"
          themeName="ht-theme-main"
          licenseKey="non-commercial-and-evaluation"
          afterChange={onAfterChange}
          afterSelectionEnd={onAfterSelectionEnd}
        />
      </div>
    </div>
  );
}
