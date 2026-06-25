import { useCallback, useEffect, useRef } from "react";
import { api, type Project, type Subcontractor, type TpCompany } from "../api";
import {
  createEngine,
  loadTpCompanies,
  loadSubcontractorDetails,
  loadStaffQs,
  loadContractInfo,
  buildMapping,
} from "../lib/hyperformulaEngine";

/**
 * Owns the HyperFormula Mapping-sheet pipeline (see hyperformulaEngine.ts /
 * mappingFormulas.ts) and pushes its output into `field_values` — the thing
 * that actually drives the PDF tab. Both ContractInfoForm and
 * SubcontractorDetailsGrid call `recompute()` (debounced) after any edit,
 * since a Contract Info change affects every subcontractor's row and a grid
 * edit affects its own row; recomputing everyone each time is simpler and
 * cheap enough for an in-memory engine, matching the approach already used
 * for D/E/M in SubcontractorDetailsGrid itself.
 */
export function useMappingRecompute(project: Project | null, subs: Subcontractor[]) {
  const engineRef = useRef(createEngine());
  const timerRef = useRef<number | null>(null);
  const subsRef = useRef(subs);
  subsRef.current = subs;

  const recomputeNow = useCallback(async () => {
    if (!project) return;
    const [gridValues, companies, settings, contractInfo, staffQs] = await Promise.all([
      api.getGridValuesForProject(project.id),
      api.listTpCompanies(),
      api.getSettings(),
      api.getContractInfo(project.id),
      api.listStaff("QS"),
    ]);

    const engine = engineRef.current;
    const tpRowCount = loadTpCompanies(engine, companies as TpCompany[]);
    const currentSubs = subsRef.current;
    loadSubcontractorDetails(
      engine,
      currentSubs.map((s) => ({ id: s.id, name: s.name })),
      gridValues,
      tpRowCount,
    );
    const staffQsRowCount = loadStaffQs(
      engine,
      staffQs.map((s) => ({ name: s.name, email: s.email })),
    );
    loadContractInfo(engine, contractInfo);

    const mapped = buildMapping(engine, currentSubs, tpRowCount, staffQsRowCount, {
      companyName: settings.company_name ?? "",
      companyAddress1: settings.company_address_1 ?? "",
      companyAddress2: settings.company_address_2 ?? "",
    });

    await Promise.all(
      currentSubs.map((sub) =>
        api.bulkSetFieldValues(sub.id, mapped[sub.id] ?? {}).catch((e) =>
          console.error(`recompute push failed for subcontractor ${sub.id}`, e),
        ),
      ),
    );
  }, [project]);

  const recompute = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void recomputeNow();
    }, 600);
  }, [recomputeNow]);

  // Push once whenever the project (or its subcontractor list) changes, so
  // the PDF tab reflects whatever's already in the DB even if the user
  // never touches Contract Info / Subcontractor Details this session.
  useEffect(() => {
    if (!project) return;
    void recomputeNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, subs.length]);

  // `recompute` (debounced, fire-and-forget) suits routine field edits.
  // `recomputeNow` (awaitable, immediate) is for callers like CSV import
  // that need to keep a busy indicator up until the actual computation —
  // which rebuilds the whole HyperFormula engine and can take real time
  // for 20+ subcontractors — has genuinely finished, not just been scheduled.
  return { recompute, recomputeNow };
}
