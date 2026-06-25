import { useCallback, useEffect, useRef, useState } from "react";
import { HotTable, type HotTableRef } from "@handsontable/react-wrapper";
import { registerAllModules } from "handsontable/registry";
import type { CellChange, ChangeSource } from "handsontable/common";
import { api, type NzbnSearchResult, type TpCompany } from "../api";
import { CompanyMatchModal } from "./CompanyMatchModal";
import "handsontable/styles/handsontable.css";
import "handsontable/styles/ht-theme-main.css";
import "./TpCompaniesGrid.css";

registerAllModules();

function activeRenderer(
  _instance: unknown,
  td: HTMLTableCellElement,
  _row: number,
  _col: number,
  _prop: string | number,
  value: unknown,
): HTMLTableCellElement {
  td.innerHTML = "";
  td.classList.remove("tpgrid__active--yes", "tpgrid__active--no", "tpgrid__active--unknown");
  if (value === 1) {
    td.textContent = "Active";
    td.classList.add("tpgrid__active--yes");
  } else if (value === 0) {
    td.textContent = "Inactive";
    td.classList.add("tpgrid__active--no");
  } else {
    td.textContent = "—";
    td.classList.add("tpgrid__active--unknown");
  }
  return td;
}

const COLUMNS: {
  data: keyof TpCompany;
  title: string;
  width?: number;
  readOnly?: boolean;
  renderer?: typeof activeRenderer;
}[] = [
  { data: "company", title: "Company", width: 180 },
  { data: "is_active", title: "Active", width: 90, readOnly: true, renderer: activeRenderer },
  { data: "legal_name_register", title: "Legal Name From Companies Register", width: 220 },
  { data: "nzbn", title: "NZBN", width: 120 },
  { data: "legal_name_nzbn", title: "Legal Name With NZBN", width: 220 },
  { data: "address_1", title: "Address 1", width: 180 },
  { data: "address_2", title: "Address 2", width: 140 },
  { data: "address_3", title: "Address 3", width: 140 },
  { data: "city", title: "City", width: 120 },
  { data: "zip", title: "Zip", width: 90 },
  { data: "full_address", title: "Full Address", width: 260 },
  { data: "business_phone", title: "Business Phone", width: 140 },
  { data: "email", title: "Email", width: 200 },
  { data: "directors", title: "Directors", width: 160 },
  { data: "trades", title: "Trade(S)", width: 200 },
  { data: "standard_cost_code", title: "Standard Cost Code List", width: 240 },
];

function normalizeName(s: string): string {
  return s.trim().toLowerCase();
}

interface MatchModalState {
  rowIndex: number;
  companyId: number;
  searchTerm: string;
  loading: boolean;
  error: string | null;
  results: NzbnSearchResult[];
}

// Fields the NZBN-match flow can update on a row — kept here so the grid sync
// after a match and the backend's merge in apply_nzbn_match stay in step.
const NZBN_MATCH_FIELDS: (keyof TpCompany)[] = [
  "legal_name_register",
  "nzbn",
  "legal_name_nzbn",
  "address_1",
  "address_2",
  "address_3",
  "zip",
  "full_address",
  "business_phone",
  "email",
  "directors",
  "is_active",
];

export function TpCompaniesGrid() {
  const [rows, setRows] = useState<TpCompany[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [matchModal, setMatchModal] = useState<MatchModalState | null>(null);
  const hotRef = useRef<HotTableRef>(null);
  // Ids captured by beforeRemoveRow, consumed by afterRemoveRow — by the time
  // "after" fires, Handsontable has already spliced the row out, so its data
  // (and id) must be read before that happens.
  const pendingDeleteIds = useRef<number[]>([]);

  useEffect(() => {
    api
      .listTpCompanies()
      .then(setRows)
      .catch((e) => setLoadError(String(e)));
  }, []);

  // These are passed as ordinary HotTable props (not registered manually via
  // addHook) so the wrapper's own lifecycle management keeps them attached
  // to whichever instance is actually live — manual addHook/removeHook in a
  // separate effect raced with React StrictMode's dev-only double-mount and
  // ended up attached to an instance that had already been destroyed.
  // Each handler looks up `hotRef.current` fresh at call time (not a closure
  // over React state), so it always reads the live grid's current data.
  const onBeforeRemoveRow = (
    _index: number,
    _amount: number,
    physicalRows: number[],
  ) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    pendingDeleteIds.current = physicalRows
      .map((r) => (hot.getSourceDataAtRow(r) as TpCompany | undefined)?.id)
      .filter((id): id is number => Boolean(id));
  };

  const onAfterRemoveRow = () => {
    const ids = pendingDeleteIds.current;
    pendingDeleteIds.current = [];
    for (const id of ids) {
      api.deleteTpCompany(id).catch((e) => console.error("delete failed", e));
    }
  };

  // Tag our own programmatic writes (assigning the saved id/ordering back
  // onto a row) so afterChange ignores them instead of re-triggering a save.
  const SYNC_SOURCE = "TpCompaniesGrid.sync";

  // Fetches detail for `nzbn` and writes the resulting fields straight into
  // the live grid row — used both after the modal's "Use Selected" and after
  // an auto-resolved exact match.
  const applyMatch = useCallback(async (rowIndex: number, companyId: number, nzbn: string) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    const updated = await api.applyNzbnMatch(companyId, nzbn);
    for (const field of NZBN_MATCH_FIELDS) {
      hot.setSourceDataAtCell(rowIndex, field, updated[field], SYNC_SOURCE);
    }
  }, []);

  // Searches the NZBN register for `name`. A single exact (case/whitespace
  // insensitive) name match applies automatically; anything else — zero
  // matches, several matches, or only fuzzy matches — opens the picker modal.
  const runRegisterCheck = useCallback(
    async (rowIndex: number, companyId: number, name: string) => {
      setMatchModal({ rowIndex, companyId, searchTerm: name, loading: true, error: null, results: [] });
      try {
        const results = await api.searchNzbnCompanies(name);
        const exact = results.filter((r) => normalizeName(r.name) === normalizeName(name));
        if (exact.length === 1) {
          await applyMatch(rowIndex, companyId, exact[0].nzbn);
          setMatchModal(null);
          return;
        }
        setMatchModal({ rowIndex, companyId, searchTerm: name, loading: false, error: null, results });
      } catch (e) {
        setMatchModal({ rowIndex, companyId, searchTerm: name, loading: false, error: String(e), results: [] });
      }
    },
    [applyMatch],
  );

  const onAfterChange = (changes: CellChange[] | null, source: ChangeSource) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot || !changes || source === "loadData" || (source as string) === SYNC_SOURCE) return;
    // A typed-in (not pasted-as-part-of-a-bulk-op) change to the Company name
    // itself re-triggers the same register check a right-click "Check
    // Companies Register" would — covers both renaming an existing row and
    // typing a brand-new name into the trailing spare row.
    const companyChangedRows = new Set(
      changes
        .filter(([, prop, oldVal, newVal]) => prop === "company" && newVal !== oldVal && String(newVal ?? "").trim() !== "")
        .map(([row]) => row),
    );
    const affectedRows = new Set(changes.map(([row]) => row));
    for (const rowIndex of affectedRows) {
      const row = hot.getSourceDataAtRow(rowIndex) as TpCompany | undefined;
      if (!row || !row.company || row.company.trim() === "") continue;
      // A blank spare row's id/ordering are explicitly null (Handsontable's
      // default for an unset cell), but the backend's TpCompany requires
      // real integers for those — null only round-trips through Option<T>
      // fields, not i64. Normalize before sending.
      const payload: TpCompany = { ...row, id: row.id ?? 0, ordering: row.ordering ?? 0 };
      api
        .upsertTpCompany(payload)
        .then((saved) => {
          // getSourceDataAtRow returns a detached snapshot, not a live
          // reference — mutating it directly never reaches Handsontable's
          // actual data store. setSourceDataAtCell is the real write API.
          hot.setSourceDataAtCell(rowIndex, "id", saved.id, SYNC_SOURCE);
          hot.setSourceDataAtCell(rowIndex, "ordering", saved.ordering, SYNC_SOURCE);
          // upsertTpCompany's insert path always appends new rows to the end
          // of the ordering sequence — re-sync every row's ordering to match
          // its current on-screen position so a row typed into the middle of
          // the grid (e.g. via "insert row above") stays there on reload.
          const orderedIds = (hot.getSourceData() as TpCompany[])
            .map((r) => r.id)
            .filter((id): id is number => Boolean(id));
          api.reorderTpCompanies(orderedIds).catch((e) => console.error("reorder failed", e));
          if (companyChangedRows.has(rowIndex)) {
            void runRegisterCheck(rowIndex, saved.id, saved.company);
          }
        })
        .catch((e) => console.error("save failed", e));
    }
  };

  const onContextMenuCheckRegister = useCallback(
    (_key: string, selection: { start: { row: number } }[]) => {
      const hot = hotRef.current?.hotInstance;
      if (!hot || selection.length === 0) return;
      const rowIndex = selection[0].start.row;
      const row = hot.getSourceDataAtRow(rowIndex) as TpCompany | undefined;
      if (!row || !row.company || !row.company.trim() || !row.id) return;
      void runRegisterCheck(rowIndex, row.id, row.company);
    },
    [runRegisterCheck],
  );

  if (loadError) {
    return <p className="tpgrid__loading">Failed to load TP Companies: {loadError}</p>;
  }

  if (rows === null) {
    return <p className="tpgrid__loading">Loading TP Companies…</p>;
  }

  return (
    <div className="tpgrid">
      <HotTable
        ref={hotRef}
        data={rows}
        columns={COLUMNS}
        colHeaders={COLUMNS.map((c) => c.title)}
        rowHeaders={true}
        height="100%"
        width="100%"
        themeName="ht-theme-main"
        licenseKey="non-commercial-and-evaluation"
        minSpareRows={1}
        contextMenu={{
          items: {
            check_register: {
              name: "Check Companies Register",
              callback: onContextMenuCheckRegister,
            },
            sp1: "---------",
            row_above: {},
            row_below: {},
            remove_row: {},
            sp2: "---------",
            undo: {},
            redo: {},
          },
        }}
        beforeRemoveRow={onBeforeRemoveRow}
        afterRemoveRow={onAfterRemoveRow}
        afterChange={onAfterChange}
      />
      {matchModal && (
        <CompanyMatchModal
          searchTerm={matchModal.searchTerm}
          loading={matchModal.loading}
          error={matchModal.error}
          results={matchModal.results}
          onClose={() => setMatchModal(null)}
          onSelect={(nzbn) => {
            void applyMatch(matchModal.rowIndex, matchModal.companyId, nzbn).then(
              () => setMatchModal(null),
              (e) => setMatchModal((prev) => (prev ? { ...prev, error: String(e) } : prev)),
            );
          }}
        />
      )}
    </div>
  );
}
