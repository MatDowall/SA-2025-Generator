// Stable column order for the hidden "ContractInfo" HyperFormula sheet used
// by the Mapping sheet (see hyperformulaEngine.ts / mappingFormulas.ts).
// Only field_keys actually referenced by the legacy workbook's "SA2025
// Template" tab formulas are included here — e.g. Job Number, Site Address,
// and the Contract Info "3. Subcontractor Bonds & Guarantees" section
// (Performance Bond / Bonds in Lieu) are real Contract Info fields but were
// never wired into the original PDF mapping either (those are per-subcontractor
// concerns living in Subcontractor Details U–Y instead), so they're
// deliberately omitted here to match the original's actual behavior.
// "email_to_serve_notices" is the one deliberate exception: the legacy
// workbook's Email_to_Serve_Notices field was hardcoded to always output the
// literal text "TRUE" (a bug in the source workbook, not a real Yes/No
// answer) — it's now a real radio field here instead of perpetuating that.
export const CONTRACT_INFO_CELL_ORDER: string[] = [
  "project_name",
  "principal",
  "head_contract",
  "contract_works_ins_by",
  "contract_works_deductible",
  "ins_of_subcontract_works_by_sub",
  "value_of_subcontract_works_ins",
  "allowance_demo_removal_pct",
  "allowance_demo_removal_value",
  "allowance_fees_pct",
  "allowance_fees_value",
  "allowance_increase_fees_pct",
  "allowance_increase_fees_value",
  "allowance_variations_pct",
  "allowance_variations_value",
  "total_value_to_be_insured",
  "required_until_pc_head_contract",
  "required_until_pc_subcontract",
  "required_until_other",
  "plant_equipment_insurance",
  "public_liability_insurance",
  "aircraft_watercraft_value",
  "vibration_removal_support_ins",
  "motor_vehicle_insurance",
  "mv_special_extension",
  "professional_indemnity_insurance",
  "professional_indemnity_amount",
  "time_notify_intention_to_claim",
  "time_submission_price_details",
  "due_dates_pc_head_contract",
  "due_dates_pc_head_contract_separable",
  "lds_applicable_head_contract_value",
  "lds_applicable_head_contract_unit",
  "lds_applicable_head_contract_separable_value",
  "lds_applicable_head_contract_separable_unit",
  "defects_liability_period_value",
  "defects_liability_period_unit",
  "defects_liability_period_separable_value",
  "defects_liability_period_separable_unit",
  "claim_frequency",
  "interim_final_account_process",
  "interim_final_account_due",
  "itt_dated",
  "notice_to_tenderers_numbers",
  "programme_title",
  "contract_programme_dated",
  "contract_programme_reference",
  "quantity_surveyor",
  "email_to_serve_notices",
];

const INDEX_BY_KEY = new Map(CONTRACT_INFO_CELL_ORDER.map((k, i) => [k, i]));

function colLetterForIndex(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** The ContractInfo sheet's A1-style column letter for a given field_key (row 1 always). */
export function ciCell(fieldKey: string): string {
  const idx = INDEX_BY_KEY.get(fieldKey);
  if (idx === undefined) {
    throw new Error(`contractInfoCellMap: unknown field_key "${fieldKey}"`);
  }
  return `${colLetterForIndex(idx)}1`;
}
