// Orchestrates a CSV commit: matches/creates subcontractors by name, then
// reverse-maps each row (see csvReverseMap.ts) into subcontractor_grid_values
// and contract_info_values — never field_values directly. Those are the
// single source of truth the recompute pipeline (useMappingRecompute) computes
// field_values from, so this import is just another way to fill in the grid
// and Contract Info, not a parallel writer of PDF output.
import { api, type ParsedCsv, type Project, type Subcontractor } from "../api";
import { applyCsvRow } from "./csvReverseMap";

export interface CsvImportResult {
  created: number;
  updated: number;
  fields_set: number;
  unknown_columns: string[];
}

export async function importCsvIntoProject(
  project: Project,
  existingSubs: Subcontractor[],
  parsed: ParsedCsv,
  onProgress?: (current: number, total: number) => void,
): Promise<CsvImportResult> {
  const byNameLower = new Map(existingSubs.map((s) => [s.name.toLowerCase(), s]));

  let created = 0;
  let updated = 0;
  let fieldsSet = 0;
  const mergedContractInfo: Record<string, string> = {};

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    onProgress?.(i + 1, parsed.rows.length);
    const subName = (row[0] ?? "").trim();
    if (!subName) continue;

    let sub = byNameLower.get(subName.toLowerCase());
    if (!sub) {
      sub = await api.addSubcontractor(project.id, subName);
      byNameLower.set(subName.toLowerCase(), sub);
      created++;
    } else {
      updated++;
    }

    const rowObj: Record<string, string> = {};
    parsed.columns.forEach((col, i) => {
      rowObj[col] = row[i] ?? "";
    });

    const { grid, contractInfo } = applyCsvRow(rowObj);
    if (Object.keys(grid).length > 0) {
      await api.bulkSetGridValues(sub.id, grid);
      fieldsSet += Object.keys(grid).length;
    }
    // Contract Info is global, not per-row — the export duplicates the same
    // answers on every row, so just merge them all, first value wins.
    for (const [key, value] of Object.entries(contractInfo)) {
      if (!(key in mergedContractInfo)) mergedContractInfo[key] = value;
    }
  }

  if (Object.keys(mergedContractInfo).length > 0) {
    await api.setContractInfoBulk(project.id, mergedContractInfo);
    fieldsSet += Object.keys(mergedContractInfo).length;
  }

  return { created, updated, fields_set: fieldsSet, unknown_columns: [] };
}
