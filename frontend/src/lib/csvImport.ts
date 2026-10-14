// Orchestrates a CSV commit: matches/creates subcontractors by name, then
// reverse-maps each row (see csvReverseMap.ts) into subcontractor_grid_values
// and contract_info_values - never field_values directly. Those are the
// single source of truth the recompute pipeline (useMappingRecompute) computes
// field_values from, so this import is just another way to fill in the grid
// and Contract Info, not a parallel writer of PDF output.
import { api, type ParsedCsv, type Project, type Subcontractor } from "../api";
import { applyCsvRow } from "./csvReverseMap";
import { newSubcontractorDefaults } from "./contractDefaults";
import { ciGridKey } from "./gridColumns";

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

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    onProgress?.(i + 1, parsed.rows.length);
    const subName = (row[0] ?? "").trim();
    if (!subName) continue;

    let sub = byNameLower.get(subName.toLowerCase());
    if (!sub) {
      sub = await api.addSubcontractor(project.id, subName);
      await api.bulkSetGridValues(sub.id, await newSubcontractorDefaults(project));
      byNameLower.set(subName.toLowerCase(), sub);
      created++;
    } else {
      updated++;
    }

    const rowObj: Record<string, string> = {};
    parsed.columns.forEach((col, i) => {
      rowObj[col] = row[i] ?? "";
    });

    // Contract Info answers are per-subcontractor grid columns now, so each
    // CSV row's answers land on that row (overriding the defaults it started with).
    const { grid, contractInfo } = applyCsvRow(rowObj);
    for (const [key, value] of Object.entries(contractInfo)) grid[ciGridKey(key)] = value;
    if (Object.keys(grid).length > 0) {
      await api.bulkSetGridValues(sub.id, grid);
      fieldsSet += Object.keys(grid).length;
    }
  }

  return { created, updated, fields_set: fieldsSet, unknown_columns: [] };
}
