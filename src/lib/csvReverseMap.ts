// Reverse-mapping from CSV columns (AcroForm field names, matching the
// legacy "SA2025 Template" export) back into subcontractor_grid_values /
// contract_info_values — the grid + Contract Info are the single source of
// truth field_values is computed from (see useMappingRecompute), so CSV
// import fills *those* in rather than writing field_values directly.
//
// Derived mechanically from mappingFormulas.ts: each of the 138 mapped
// fields was classified by which exact formula shape it has (see the
// analysis that produced this file) — only fields with an unambiguous,
// lossless reverse mapping are listed. Fields the legacy formulas only ever
// *derive* (XLOOKUPs, hardcoded constants, date-of-generation, "document
// attached" checkboxes driven by a sibling field's non-emptiness, computed
// subtotals) are intentionally absent — re-importing them would just be
// reconstructing values the recompute pipeline already derives on its own.
import { GRID_COLUMNS } from "./gridColumns";

export type ReverseMapKind =
  | "grid-direct"
  | "grid-bool-yesno"
  | "grid-bool-on"
  | "grid-na-gated"
  | "ci-direct"
  | "ci-bool-yesno"
  | "ci-bool-on"
  | "ci-na-gated"
  | "ci-radio";

export interface ReverseMapEntry {
  kind: ReverseMapKind;
  target: string;
  /** Only for "ci-radio": maps the CSV's exact display text to our stored value. */
  radioMap?: Record<string, string>;
}

export const REVERSE_MAP: Record<string, ReverseMapEntry> = {
  // --- direct grid passthroughs ---
  Subcontractor_Reference: { kind: "grid-direct", target: "C_cost_code" },
  Trade_Desc: { kind: "grid-direct", target: "A_trade" },
  DLP_Pct: { kind: "grid-direct", target: "T_dlp_percentage" },
  Misc_Other: { kind: "grid-direct", target: "BC_other_misc" },
  Additional_Docs_L: { kind: "grid-direct", target: "BM_additional_doc_l" },
  Additional_Docs_M: { kind: "grid-direct", target: "BN_additional_doc_m" },
  Additional_Docs_N: { kind: "grid-direct", target: "BO_additional_doc_n" },
  Additional_Docs_O: { kind: "grid-direct", target: "BP_additional_doc_o1" },
  Additional_Price_Item_1: { kind: "grid-direct", target: "I_item1_description" },
  Additional_Price_Item_1_Value: { kind: "grid-direct", target: "J_item1_value" },
  Additional_Price_Item_2: { kind: "grid-direct", target: "K_item2_description" },
  Additional_Price_Item_2_Value: { kind: "grid-direct", target: "L_item2_value" },
  Email_Date: { kind: "grid-direct", target: "BD_email_dated" },
  Email_From: { kind: "grid-direct", target: "BE_email_from" },
  Letter_Date: { kind: "grid-direct", target: "BF_letter_dated" },
  Letter_From: { kind: "grid-direct", target: "BG_letter_from" },
  LOA_Date: { kind: "grid-direct", target: "F_letter_of_award_date" },
  Original_Tender_Price: { kind: "grid-direct", target: "H_original_tendered_price" },
  Other_Specials: { kind: "grid-direct", target: "BB_other_special_conditions" },
  Prelet_Day: { kind: "grid-direct", target: "BH_prelet_date_day" },
  Prelet_Month: { kind: "grid-direct", target: "BI_prelet_date_month" },
  Prelet_Year: { kind: "grid-direct", target: "BJ_prelet_date_year" },
  Special_Conditions: { kind: "grid-direct", target: "BR_special_conditions_in_tender" },

  // --- grid boolean mirrors ("Yes"/"No" -> "true"/"false") ---
  Asbuilts_Req: { kind: "grid-bool-yesno", target: "AN_as_builts" },
  Bonds_In_Lieu_of_Retentions: { kind: "grid-bool-yesno", target: "W_bond_in_lieu" },
  Continuity_Attached: { kind: "grid-bool-yesno", target: "AE_continuity_copy_attached" },
  Continuity_Guarantee_Required: { kind: "grid-bool-yesno", target: "AD_continuity_guarantee_required" },
  Guarantees_Copies_Attached: { kind: "grid-bool-yesno", target: "AC_warranty_copy_attached" },
  Operating_Instruction_and_Maintenance_Manuals: { kind: "grid-bool-yesno", target: "AP_om_manuals" },
  Perf_Bond: { kind: "grid-bool-yesno", target: "U_performance_bond" },
  PS1_Req: { kind: "grid-bool-yesno", target: "AR_ps1" },
  PS2_Req: { kind: "grid-bool-yesno", target: "AS_ps2" },
  PS3_Req: { kind: "grid-bool-yesno", target: "AT_ps3" },
  PS4_Req: { kind: "grid-bool-yesno", target: "AU_ps4" },
  Shop_Drawings_Req: { kind: "grid-bool-yesno", target: "AL_shop_drawings" },
  Subcontractor_Design_Responsibilities: { kind: "grid-bool-yesno", target: "AF_design_responsibilities" },
  Subcontractor_Obtained_Building_Consent: { kind: "grid-bool-yesno", target: "AH_building_consent_required" },
  Trade_Guarantees: { kind: "grid-bool-yesno", target: "Z_warranty_required" },
  Cost_Fluctuations: { kind: "grid-bool-yesno", target: "AX_cost_fluctuations" },
  Materials_Offsite: { kind: "grid-bool-yesno", target: "AV_materials_offsite" },
  "Pre-Let_Held": { kind: "grid-bool-yesno", target: "BA_pre_let_meeting_held" },
  Subject_to_Remeasure: { kind: "grid-bool-yesno", target: "AZ_subject_to_remeasure" },
  Supply_Only_Subcontract: { kind: "grid-bool-yesno", target: "AY_supply_only" },

  // --- grid boolean mirrors ("On"/"" -> "true"/"false") ---
  "Schedule of quantities if applicable": { kind: "grid-bool-on", target: "BL_schedule_of_quantities" },
  "Subcontractor site specific safety plan": { kind: "grid-bool-on", target: "BK_site_safety_plan" },

  // --- grid values gated by a sibling boolean (skip if CSV value is "N/A") ---
  Bond_In_Lieu_Val_DLP: { kind: "grid-na-gated", target: "Y_bond_in_lieu_value_dlp" },
  Bond_In_Lieu_Val_Period: { kind: "grid-na-gated", target: "X_bond_in_lieu_value_period" },
  Perf_Bond_Val: { kind: "grid-na-gated", target: "V_performance_bond_value" },
  Subcontract_Design_Responsibilities: { kind: "grid-na-gated", target: "AG_design_responsibilities_detail" },
  Trade_Guarantee_Duration: { kind: "grid-na-gated", target: "AB_warranty_period" },
  Trade_Guarantee_When_Required: { kind: "grid-na-gated", target: "AA_warranty_when_required" },

  // --- direct Contract Info passthroughs ---
  Project_Name: { kind: "ci-direct", target: "project_name" },
  Principal_Name: { kind: "ci-direct", target: "principal" },
  Head_Contract_Type: { kind: "ci-direct", target: "head_contract" },
  Contract_Works_Deductible: { kind: "ci-direct", target: "contract_works_deductible" },
  MV_Val: { kind: "ci-direct", target: "motor_vehicle_insurance" },
  PC_Due_Date: { kind: "ci-direct", target: "due_dates_pc_head_contract" },
  PL_Insur_Value: { kind: "ci-direct", target: "public_liability_insurance" },
  Plant_Equp_Value: { kind: "ci-direct", target: "plant_equipment_insurance" },
  Var_Intention_Timeframe: { kind: "ci-direct", target: "time_notify_intention_to_claim" },
  Var_Submission_Timeframe: { kind: "ci-direct", target: "time_submission_price_details" },
  Clain_Frequency: { kind: "ci-direct", target: "claim_frequency" },
  DLP_Per: { kind: "ci-direct", target: "defects_liability_period_unit" },
  DLP_Period: { kind: "ci-direct", target: "defects_liability_period_value" },
  DLP_Period_Separable_Portions: { kind: "ci-direct", target: "defects_liability_period_separable_value" },
  DLP_Sep_Por_Per: { kind: "ci-direct", target: "defects_liability_period_separable_unit" },
  LD_Per: { kind: "ci-direct", target: "lds_applicable_head_contract_unit" },
  LD_Sep_Por_Per: { kind: "ci-direct", target: "lds_applicable_head_contract_separable_unit" },
  LD_Sep_Por_Value: { kind: "ci-direct", target: "lds_applicable_head_contract_separable_value" },
  LD_Val: { kind: "ci-direct", target: "lds_applicable_head_contract_value" },
  PC_Separable_Portions_Date: { kind: "ci-direct", target: "due_dates_pc_head_contract_separable" },
  Contract_Programme: { kind: "ci-direct", target: "programme_title" },
  Contract_Programme_Date: { kind: "ci-direct", target: "contract_programme_dated" },
  Contract_Programme_Ref: { kind: "ci-direct", target: "contract_programme_reference" },
  Invite_Tender_Date: { kind: "ci-direct", target: "itt_dated" },
  NTT_Qty: { kind: "ci-direct", target: "notice_to_tenderers_numbers" },
  // Both of these were just mirrors of the same Contract Info answer in the
  // legacy workbook (per-row AK and global BD echoed the same B31 cell) —
  // either populates the same field; harmless if both are present.
  "8.2.3_Other": { kind: "ci-direct", target: "required_until_other" },
  Other: { kind: "ci-direct", target: "required_until_other" },

  // --- Contract Info boolean mirrors ("Yes"/"No" -> "true"/"false") ---
  Insurance_of_Contract_Works_by_Subcontractor: { kind: "ci-bool-yesno", target: "ins_of_subcontract_works_by_sub" },
  PI_Insurance_Req: { kind: "ci-bool-yesno", target: "professional_indemnity_insurance" },
  Special_Extension_Req_for_Airside: { kind: "ci-bool-yesno", target: "mv_special_extension" },
  Interim_Final_Account_Process: { kind: "ci-bool-yesno", target: "interim_final_account_process" },

  // --- Contract Info boolean mirrors ("On"/"" -> "true"/"false") ---
  "Practical completion of Head Contract": { kind: "ci-bool-on", target: "required_until_pc_head_contract" },
  // Same underlying answer as Insurance_of_Contract_Works_by_Subcontractor above,
  // just the legacy workbook's alternate "On" rendering of it — redundant but harmless.
  "Completion of the Subcontract Works": { kind: "ci-bool-on", target: "ins_of_subcontract_works_by_sub" },

  // --- Contract Info values gated by a sibling boolean (skip if "N/A") ---
  Aircraft_Watercraft_val: { kind: "ci-na-gated", target: "aircraft_watercraft_value" },
  Demo_Pct: { kind: "ci-na-gated", target: "allowance_demo_removal_pct" },
  Demo_Value: { kind: "ci-na-gated", target: "allowance_demo_removal_value" },
  Fees_Pct: { kind: "ci-na-gated", target: "allowance_fees_pct" },
  Fees_Value: { kind: "ci-na-gated", target: "allowance_fees_value" },
  Inc_Pct: { kind: "ci-na-gated", target: "allowance_increase_fees_pct" },
  Increase_Cost_Value: { kind: "ci-na-gated", target: "allowance_increase_fees_value" },
  PI_Val: { kind: "ci-na-gated", target: "professional_indemnity_amount" },
  Subcontract_Works_Insurance_Value: { kind: "ci-na-gated", target: "value_of_subcontract_works_ins" },
  Total_Insur_Value: { kind: "ci-na-gated", target: "total_value_to_be_insured" },
  Var_Pct: { kind: "ci-na-gated", target: "allowance_variations_pct" },
  Variations_Value: { kind: "ci-na-gated", target: "allowance_variations_value" },
  Vibration_Support_Val: { kind: "ci-na-gated", target: "vibration_removal_support_ins" },
  Interim_Final_Account_Due_Date: { kind: "ci-na-gated", target: "interim_final_account_due" },

  // --- Contract Info radio fields (custom value-mapping, not boolean) ---
  CW_Insurance_by: {
    kind: "ci-radio",
    target: "contract_works_ins_by",
    radioMap: { "Main Contractor": "main_contractor", Principal: "principal" },
  },
  Email_to_Serve_Notices: {
    kind: "ci-radio",
    target: "email_to_serve_notices",
    radioMap: { Yes: "yes", No: "no" },
  },
};

// Retentions (CG–CK in the legacy Template) have no independent AcroForm
// field representing the grid's own "Retentions" checkbox — only their
// already-gated downstream values are real PDF fields. So importing real
// (non-"N/A") retention figures must also infer the gating checkbox.
export const RETENTION_FIELD_TARGETS: Record<string, string> = {
  Ret_First_Pct: "O_retention_pct_first",
  Ret_First_Val: "P_retention_value_first",
  Ret_Next_Pct: "Q_retention_pct_next",
  Ret_Next_Val: "R_retention_value_next",
  Ret_Rem_Pct: "S_retention_pct_remainder",
};
export const RETENTION_GATE_GRID_KEY = "N_retentions";

export interface ReverseMappedRow {
  grid: Record<string, string>;
  contractInfo: Record<string, string>;
}

/**
 * Applies the reverse-map to a single field edit (e.g. a PDF overlay edit,
 * or one CSV cell). Writes go into whichever of `grid`/`contractInfo` is
 * passed in, so a caller processing many fields for the same row/CSV line
 * can share one pair of accumulator objects (see applyCsvRow).
 *
 * `allowEmpty` distinguishes "this CSV column had no data for this row" (the
 * default — skip entirely, don't clobber an existing answer with nothing)
 * from "the user deliberately cleared this field" (set by live PDF edits via
 * applyFieldEdit's caller in App.tsx) — in the latter case an empty value
 * must propagate as clearing the underlying grid/Contract Info value too,
 * otherwise the next recompute just re-pushes the still-stored old value
 * back into the PDF, making the deletion look like it didn't take.
 */
export function applyFieldEdit(
  fieldName: string,
  raw: string,
  grid: Record<string, string>,
  contractInfo: Record<string, string>,
  allowEmpty = false,
): void {
  const value = raw?.trim() ?? "";
  if (value === "#N/A") return;
  if (!value && !allowEmpty) return;

  const entry = REVERSE_MAP[fieldName];
  if (entry) {
    const dest = entry.kind.startsWith("grid") ? grid : contractInfo;
    switch (entry.kind) {
      case "grid-direct":
      case "ci-direct":
        dest[entry.target] = value;
        break;
      case "grid-bool-yesno":
      case "ci-bool-yesno":
        if (value === "Yes" || value === "No") dest[entry.target] = value === "Yes" ? "true" : "false";
        else if (allowEmpty && !value) dest[entry.target] = "";
        break;
      case "grid-bool-on":
      case "ci-bool-on":
        if (value === "On") dest[entry.target] = "true";
        else if (allowEmpty && !value) dest[entry.target] = "";
        else dest[entry.target] = "false";
        break;
      case "grid-na-gated":
      case "ci-na-gated":
        if (value !== "N/A") dest[entry.target] = value;
        break;
      case "ci-radio": {
        const mapped = entry.radioMap?.[value];
        if (mapped) dest[entry.target] = mapped;
        else if (allowEmpty && !value) dest[entry.target] = "";
        break;
      }
    }
    return;
  }

  if (fieldName in RETENTION_FIELD_TARGETS) {
    if (value !== "N/A" && value !== "") {
      grid[RETENTION_FIELD_TARGETS[fieldName]] = value;
      grid[RETENTION_GATE_GRID_KEY] = "true";
    } else if (allowEmpty && !value) {
      // Clearing a retention figure clears just that figure, not the
      // "Retentions apply" gate — the other retention fields may still hold
      // real values that should keep showing.
      grid[RETENTION_FIELD_TARGETS[fieldName]] = "";
    }
  }
}

/** Applies the reverse-map to one CSV data row (column name -> raw value). */
export function applyCsvRow(row: Record<string, string>): ReverseMappedRow {
  const grid: Record<string, string> = {};
  const contractInfo: Record<string, string> = {};
  for (const [fieldName, raw] of Object.entries(row)) {
    applyFieldEdit(fieldName, raw, grid, contractInfo);
  }
  return { grid, contractInfo };
}

/**
 * PDF fields that mirror a Subcontractor Details grid column the user can
 * only set through a constrained control there (a dropdown, or the
 * Subcontractor name — which also drives the TP Companies lookup and
 * requires the proper rename flow, not a bare value write). Editing the
 * underlying answer for these must happen on the grid; the PDF overlay
 * renders them read-only instead of allowing a value that could disagree
 * with — or silently bypass — that constraint.
 */
export const LOCKED_PDF_FIELDS: ReadonlySet<string> = new Set([
  ...Object.entries(REVERSE_MAP)
    .filter(([, entry]) => entry.kind.startsWith("grid"))
    .filter(([, entry]) => {
      const col = GRID_COLUMNS.find((c) => c.key === entry.target);
      return col?.type === "dropdown" || col?.type === "name-mirror";
    })
    .map(([fieldName]) => fieldName),
  // Subcontractor_Name is deliberately absent from REVERSE_MAP above (it
  // needs the create/rename flow, not a bare grid value write) but is the
  // canonical "must edit via the grid" example, so it's added explicitly.
  "Subcontractor_Name",
  // Pure sums (SUBTOTAL(H,J,L), same as the grid's own Contract Value
  // column) — editing these directly is always a no-op-that-looks-like-it-
  // worked: the typed value sits in field_values until some *other* mapped
  // field's edit happens to trigger a recompute, which then silently
  // overwrites it. Lock them so the real inputs (Original Tendered Price,
  // the two Add/Omit values) are what gets edited instead.
  "Subcontract_Value",
  "Total_Subcontract_Sum",
]);
