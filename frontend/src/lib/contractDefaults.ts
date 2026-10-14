// The former global "Contract Info" answers now live per subcontractor
// (grid columns keyed `ci_<field_key>`). The grid's top "defaults" row is
// persisted in contract_info_values under the plain field_key and is
// broadcast into every row's cell; new subcontractors start from it.
import { api, type Project, type Subcontractor } from "../api";
import { CI_COLUMNS, ciGridKey } from "./gridColumns";

const MIGRATED_KEY = "_ci_migrated";

/** The defaults-row value for every Contract Info column, keyed by ciKey. */
export function effectiveDefaults(
  contractInfo: Record<string, string>,
  project: Project,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of CI_COLUMNS) {
    out[col.ciKey!] = contractInfo[col.ciKey!] ?? col.defaultValue ?? "";
  }
  // Same "show until overridden" fallback the old Contract Info form used.
  out.project_name = contractInfo.project_name || project.name || "";
  out.job_number = contractInfo.job_number || project.project_number || "";
  return out;
}

/** Grid-column values (keyed `ci_*`) a brand-new subcontractor should start with. */
export async function newSubcontractorDefaults(
  project: Project,
): Promise<Record<string, string>> {
  const defaults = effectiveDefaults(await api.getContractInfo(project.id), project);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(defaults)) if (v !== "") out[ciGridKey(k)] = v;
  return out;
}

const inFlight = new Map<number, Promise<void>>();

/**
 * One-time backfill for projects created before Contract Info moved into the
 * grid: copies the old global answers into each existing subcontractor that
 * has no value of its own yet.
 */
export function ensureContractInfoMigrated(
  project: Project,
  subs: Subcontractor[],
): Promise<void> {
  const pending = inFlight.get(project.id);
  if (pending) return pending;
  const run = (async () => {
    const contractInfo = await api.getContractInfo(project.id);
    if (contractInfo[MIGRATED_KEY]) return;
    const defaults = effectiveDefaults(contractInfo, project);
    const gridValues = await api.getGridValuesForProject(project.id);
    for (const sub of subs) {
      const have = gridValues[sub.id] ?? {};
      const fill: Record<string, string> = {};
      for (const [k, v] of Object.entries(defaults)) {
        if (v !== "" && have[ciGridKey(k)] === undefined) fill[ciGridKey(k)] = v;
      }
      if (Object.keys(fill).length > 0) await api.bulkSetGridValues(sub.id, fill);
    }
    await api.setContractInfoValue(project.id, MIGRATED_KEY, "1");
  })().finally(() => inFlight.delete(project.id));
  inFlight.set(project.id, run);
  return run;
}
