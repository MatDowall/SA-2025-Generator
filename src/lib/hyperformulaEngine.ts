// A standalone HyperFormula engine (not Handsontable's built-in formulas
// plugin) hosting "TPCompanies", "SubcontractorDetails", "ContractInfo",
// "StaffQS", and a hidden "Mapping" sheet — the last one ports the legacy
// workbook's "SA2025 Template" tab (see mappingFormulas.ts) to compute all
// 154 PDF field values from Contract Info + Subcontractor Details + TP
// Companies + the QS staff directory, exactly as the original did.
import { HyperFormula } from "hyperformula";
import type { TpCompany } from "../api";
import { GRID_COLUMNS } from "./gridColumns";
import { CONTRACT_INFO_CELL_ORDER } from "./contractInfoCellMap";
import { MAPPING_COLUMNS, type MappingContext } from "./mappingFormulas";

export const TP_SHEET = "TPCompanies";
export const SD_SHEET = "SubcontractorDetails";
export const CI_SHEET = "ContractInfo";
export const STAFF_SHEET = "StaffQS";
export const MAPPING_SHEET = "Mapping";

const TP_COLUMNS: (keyof TpCompany)[] = [
  "company",
  "legal_name_register",
  "nzbn",
  "legal_name_nzbn",
  "address_1",
  "address_2",
  "address_3",
  "city",
  "zip",
  "full_address",
  "business_phone",
  "email",
  "directors",
  "trades",
  "standard_cost_code",
];

export function createEngine(): HyperFormula {
  // dateFormats: [] disables HyperFormula's default auto-parsing of
  // date-like strings (e.g. "24/06/2026") into date serial numbers. Every
  // date in this app is a plain typed/imported string copied straight
  // through to a PDF text field or compared with `>" "` for "is this
  // populated" — never used in date arithmetic — so silently coercing it to
  // a number only breaks both: the PDF shows a raw serial instead of the
  // string, and a number is never ">" a string, so "is populated" checkbox
  // formulas evaluate false. Same family of surprise as the boolean
  // auto-coercion noted below; same fix shape (stop HyperFormula's type
  // guessing rather than work around it formula-by-formula).
  const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3", dateFormats: [] });
  hf.addSheet(TP_SHEET);
  hf.addSheet(SD_SHEET);
  hf.addSheet(CI_SHEET);
  hf.addSheet(STAFF_SHEET);
  hf.addSheet(MAPPING_SHEET);
  return hf;
}

/** 0-based column index for a spreadsheet column letter (A=0, B=1, ... AA=26). */
function colIndex(letter: string): number {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Loads TP Companies into the engine; returns the row count (min 1, so
 *  XLOOKUP ranges generated elsewhere are never empty/zero-length). */
export function loadTpCompanies(hf: HyperFormula, companies: TpCompany[]): number {
  const sheetId = hf.getSheetId(TP_SHEET);
  if (sheetId === undefined) return 1;
  const data = companies.map((c) => TP_COLUMNS.map((k) => (c[k] as string | null) ?? ""));
  hf.setSheetContent(sheetId, data.length ? data : [TP_COLUMNS.map(() => "")]);
  return Math.max(companies.length, 1);
}

export interface ComputedRow {
  D_tp_address: string;
  E_tp_email: string;
  M_contract_value: string;
}

/**
 * Loads one row per subcontractor into the SubcontractorDetails sheet (col B
 * mirrors the subcontractor's name; D/E/M are formulas) and returns the
 * computed D/E/M values per subcontractor id for display in Handsontable
 * (which doesn't know about this engine — these are just read back as plain
 * strings and injected into the grid's read-only computed columns).
 */
export function loadSubcontractorDetails(
  hf: HyperFormula,
  subs: { id: number; name: string }[],
  gridValues: Record<number, Record<string, string>>,
  tpRowCount: number,
): Record<number, ComputedRow> {
  const sheetId = hf.getSheetId(SD_SHEET);
  if (sheetId === undefined) return {};

  const data = subs.map((sub, i) => {
    const values = gridValues[sub.id] ?? {};
    const rowNum = i + 1; // HyperFormula/A1 rows are 1-based
    return GRID_COLUMNS.map((col) => {
      if (col.type === "name-mirror") return sub.name;
      if (col.key === "D_tp_address") {
        return `=XLOOKUP(B${rowNum},${TP_SHEET}!A1:A${tpRowCount},${TP_SHEET}!J1:J${tpRowCount})`;
      }
      if (col.key === "E_tp_email") {
        return `=XLOOKUP(B${rowNum},${TP_SHEET}!A1:A${tpRowCount},${TP_SHEET}!L1:L${tpRowCount})`;
      }
      if (col.key === "M_contract_value") {
        return `=SUBTOTAL(9,H${rowNum},J${rowNum},L${rowNum})`;
      }
      const raw = values[col.key] ?? "";
      // Defensive: strip thousands-separator commas regardless of how they
      // got into the stored value (e.g. a numeric editor echoing its own
      // display formatting back into source data) — a comma-containing
      // string silently fails numeric parsing (SUBTOTAL treats it as 0
      // rather than erroring), and this is the one function both the grid's
      // own engine and the recompute pipeline's separate engine share, so
      // fixing it here covers every caller instead of just one.
      return col.type === "number" ? raw.replace(/,/g, "") : raw;
    });
  });

  hf.setSheetContent(sheetId, data.length ? data : [GRID_COLUMNS.map(() => "")]);

  const dCol = GRID_COLUMNS.findIndex((c) => c.key === "D_tp_address");
  const eCol = GRID_COLUMNS.findIndex((c) => c.key === "E_tp_email");
  const mCol = GRID_COLUMNS.findIndex((c) => c.key === "M_contract_value");

  const result: Record<number, ComputedRow> = {};
  subs.forEach((sub, i) => {
    result[sub.id] = {
      D_tp_address: cellText(hf, sheetId, i, dCol),
      E_tp_email: cellText(hf, sheetId, i, eCol),
      M_contract_value: cellText(hf, sheetId, i, mCol),
    };
  });
  return result;
}

/** Re-reads D/E/M for a single subcontractor row after a targeted cell edit
 *  (avoids re-running loadSubcontractorDetails' full rebuild on every keystroke). */
export function recomputeRow(hf: HyperFormula, rowIndex: number): ComputedRow {
  const sheetId = hf.getSheetId(SD_SHEET);
  const dCol = GRID_COLUMNS.findIndex((c) => c.key === "D_tp_address");
  const eCol = GRID_COLUMNS.findIndex((c) => c.key === "E_tp_email");
  const mCol = GRID_COLUMNS.findIndex((c) => c.key === "M_contract_value");
  if (sheetId === undefined) {
    return { D_tp_address: "", E_tp_email: "", M_contract_value: "" };
  }
  return {
    D_tp_address: cellText(hf, sheetId, rowIndex, dCol),
    E_tp_email: cellText(hf, sheetId, rowIndex, eCol),
    M_contract_value: cellText(hf, sheetId, rowIndex, mCol),
  };
}

/** Pushes a single input-cell edit into the engine so dependent formulas
 *  (D/E/M) recompute, without rebuilding the whole sheet. */
export function setCell(hf: HyperFormula, rowIndex: number, gridColIndex: number, value: string) {
  const sheetId = hf.getSheetId(SD_SHEET);
  if (sheetId === undefined) return;
  hf.setCellContents({ sheet: sheetId, row: rowIndex, col: gridColIndex }, value);
}

function cellText(hf: HyperFormula, sheet: number, row: number, col: number): string {
  if (col < 0) return "";
  const v = hf.getCellValue({ sheet, row, col });
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "value" in v) return String((v as { value: unknown }).value ?? "");
  return String(v);
}

export interface StaffQsEntry {
  name: string;
  email: string | null;
}

/** Loads the QS staff directory (used by the Mapping sheet's Contractor_Email
 *  XLOOKUP); returns the row count (min 1, so XLOOKUP ranges are never empty). */
export function loadStaffQs(hf: HyperFormula, staff: StaffQsEntry[]): number {
  const sheetId = hf.getSheetId(STAFF_SHEET);
  if (sheetId === undefined) return 1;
  const data = staff.map((s) => [s.name, s.email ?? ""]);
  hf.setSheetContent(sheetId, data.length ? data : [["", ""]]);
  return Math.max(staff.length, 1);
}

/** Loads the global (single-row) Contract Info answers, keyed by field_key
 *  per CONTRACT_INFO_CELL_ORDER's stable column assignment. */
export function loadContractInfo(hf: HyperFormula, values: Record<string, string>) {
  const sheetId = hf.getSheetId(CI_SHEET);
  if (sheetId === undefined) return;
  const row = CONTRACT_INFO_CELL_ORDER.map((key) => values[key] ?? "");
  hf.setSheetContent(sheetId, [row]);
}

export interface MappingSettings {
  companyName: string;
  companyAddress1: string;
  companyAddress2: string;
}

/**
 * Builds the hidden Mapping sheet (one row per subcontractor, ported from
 * the legacy "SA2025 Template" tab — see mappingFormulas.ts) and reads back
 * every column's computed value, keyed by subcontractor id then AcroForm
 * field name. This is what ultimately gets pushed into `field_values`.
 */
export function buildMapping(
  hf: HyperFormula,
  subs: { id: number }[],
  tpRowCount: number,
  staffQsRowCount: number,
  settings: MappingSettings,
): Record<number, Record<string, string>> {
  const sheetId = hf.getSheetId(MAPPING_SHEET);
  if (sheetId === undefined) return {};

  const width = colIndex("EI") + 1;
  const data = subs.map((_, i) => {
    const row = i + 1;
    const ctx: MappingContext = {
      row,
      tpRowCount,
      staffQsRowCount,
      companyName: settings.companyName,
      companyAddress1: settings.companyAddress1,
      companyAddress2: settings.companyAddress2,
    };
    const rowData = new Array<string>(width).fill("");
    for (const col of MAPPING_COLUMNS) {
      rowData[colIndex(col.letter)] = col.formula(ctx);
    }
    return rowData;
  });

  hf.setSheetContent(sheetId, data.length ? data : [new Array<string>(width).fill("")]);

  const result: Record<number, Record<string, string>> = {};
  subs.forEach((sub, i) => {
    const fields: Record<string, string> = {};
    for (const col of MAPPING_COLUMNS) {
      fields[col.fieldName] = cellText(hf, sheetId, i, colIndex(col.letter));
    }
    result[sub.id] = fields;
  });
  return result;
}
