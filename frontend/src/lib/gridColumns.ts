import {
  CONTRACT_INFO_LEFT,
  CONTRACT_INFO_RIGHT,
  type ContractInfoField,
} from "./contractInfoFields";

// Column schema for the "Subcontractor Details" grid - ported verbatim
// (headers, ordering, column letters A–BR) from the legacy workbook's
// "Subcontractor Details" tab. column_key is the persistence key
// (subcontractor_grid_values.column_key) and is prefixed with the original
// spreadsheet column letter so the HyperFormula port and any future
// cross-referencing stay unambiguous.
export type GridColumnType =
  | "text"
  | "number"
  | "checkbox"
  | "dropdown"
  /** Read-only, mirrors the subcontractor's name (not stored in grid_values). */
  | "name-mirror"
  /** Read-only, computed live by HyperFormula (TP Address/Email, Contract Value). */
  | "computed"
  /** Read-only, auto-built from the Trade column + Settings sub-trade codes + Contract Info job number. */
  | "cost-code";

export interface GridColumn {
  letter: string;
  key: string;
  title: string;
  type: GridColumnType;
  /**
   * Set on columns that were formerly global "Contract Info" answers: the
   * Contract Info field_key this column holds. The top "defaults" row of the
   * grid broadcasts a value to every row's cell in such a column; each row's
   * cell can then be overridden individually.
   */
  ciKey?: string;
  /** Static dropdown options (Contract Info select/radio fields). */
  options?: string[];
  /** Dropdown sourced from the staff directory for this role. */
  staffRole?: "PM" | "BTM" | "QS";
  /** Value a defaults-row cell shows until the user sets one. */
  defaultValue?: string;
  /** Only for type "dropdown": the Settings reference-list key (settings.<key>) it sources options from. */
  settingsListKey?: string;
}

const BASE_GRID_COLUMNS: GridColumn[] = [
  { letter: "A", key: "A_trade", title: "Trade", type: "dropdown", settingsListKey: "list_sub_trades" },
  { letter: "B", key: "B_subcontractor", title: "Subcontractor", type: "name-mirror" },
  { letter: "C", key: "C_cost_code", title: "Code", type: "cost-code" },
  { letter: "D", key: "D_tp_address", title: "TP Address", type: "computed" },
  { letter: "E", key: "E_tp_email", title: "TP Email", type: "computed" },
  { letter: "F", key: "F_letter_of_award_date", title: "Letter of Award Date", type: "text" },
  { letter: "G", key: "G_tradepartner_agreement_date", title: "Tradepartner Agreement Date", type: "text" },
  { letter: "H", key: "H_original_tendered_price", title: "Original Tendered Price", type: "number" },
  { letter: "I", key: "I_item1_description", title: "Item#1\nAdd/Omiss\nDescription", type: "text" },
  { letter: "J", key: "J_item1_value", title: "Item#1\nAdd/Omiss\nValue", type: "number" },
  { letter: "K", key: "K_item2_description", title: "Item#2\nAdd/Omiss\nDescription", type: "text" },
  { letter: "L", key: "L_item2_value", title: "Item#2\nAdd/Omiss\nValue", type: "number" },
  { letter: "M", key: "M_contract_value", title: "Contract Value", type: "computed" },
  { letter: "N", key: "N_retentions", title: "12.4.1 Retentions", type: "checkbox" },
  { letter: "O", key: "O_retention_pct_first", title: "12.4.1 Retention % on first", type: "number" },
  { letter: "P", key: "P_retention_value_first", title: "12.4.1 Retention first value", type: "number" },
  { letter: "Q", key: "Q_retention_pct_next", title: "12.4.1 Retention % on next", type: "number" },
  { letter: "R", key: "R_retention_value_next", title: "12.4.1 Retention next value", type: "number" },
  { letter: "S", key: "S_retention_pct_remainder", title: "12.4.1 Retention % on remainder", type: "number" },
  { letter: "T", key: "T_dlp_percentage", title: "12.4.2 Percentage for Defects liability period", type: "number" },
  { letter: "U", key: "U_performance_bond", title: "3.1.1\nPerformance Bond", type: "checkbox" },
  { letter: "V", key: "V_performance_bond_value", title: "3.1.1\nValue of Performance Bond", type: "number" },
  { letter: "W", key: "W_bond_in_lieu", title: "3.2.0\n Bond in Lieu of Retentions", type: "checkbox" },
  { letter: "X", key: "X_bond_in_lieu_value_period", title: "3.2.1\nValue of bond in lieu of retentions for Subcontract period", type: "number" },
  { letter: "Y", key: "Y_bond_in_lieu_value_dlp", title: "3.2.1\nValue of bond in lieu of retentions for defects liability period", type: "number" },
  { letter: "Z", key: "Z_warranty_required", title: "Warranty Required", type: "checkbox" },
  { letter: "AA", key: "AA_warranty_when_required", title: "When Required", type: "text" },
  { letter: "AB", key: "AB_warranty_period", title: "Period", type: "text" },
  { letter: "AC", key: "AC_warranty_copy_attached", title: "Copy Attached", type: "checkbox" },
  { letter: "AD", key: "AD_continuity_guarantee_required", title: "Continuity Guarantee Required", type: "checkbox" },
  { letter: "AE", key: "AE_continuity_copy_attached", title: "Copy Attached", type: "checkbox" },
  { letter: "AF", key: "AF_design_responsibilities", title: "5.2.1\nSubcontractor Design Responsibilities", type: "checkbox" },
  { letter: "AG", key: "AG_design_responsibilities_detail", title: "5.2.1\nif yes, the subcontractors design responsibilities are:", type: "text" },
  { letter: "AH", key: "AH_building_consent_required", title: "5.2.2\nSubcontractor is required to obtain building consent for Subcontract works", type: "checkbox" },
  { letter: "AI", key: "ci_required_until_pc_head_contract", title: "8.2.3\nSubcontract Works insurance required by PC of Head Contract Works", type: "checkbox", ciKey: "required_until_pc_head_contract" },
  { letter: "AJ", key: "ci_required_until_pc_subcontract", title: "8.2.3\nSubcontract Works insurance required by PC of Subcontract Works", type: "checkbox", ciKey: "required_until_pc_subcontract" },
  { letter: "AK", key: "ci_required_until_other", title: "8.2.3\nOther", type: "text", ciKey: "required_until_other" },
  { letter: "AL", key: "AL_shop_drawings", title: "Shop Drawings", type: "checkbox" },
  { letter: "AM", key: "AM_shop_drawings_review_period", title: "Shop Drawings Review Period", type: "text" },
  { letter: "AN", key: "AN_as_builts", title: "As-Builts", type: "checkbox" },
  { letter: "AO", key: "AO_as_builts_days_before_pc", title: "As-Builts Due No. of days before PC", type: "number" },
  { letter: "AP", key: "AP_om_manuals", title: "O & M Manuals", type: "checkbox" },
  { letter: "AQ", key: "AQ_om_days_before_pc", title: "O & M Due No. of days before PC", type: "number" },
  { letter: "AR", key: "AR_ps1", title: "PS1", type: "checkbox" },
  { letter: "AS", key: "AS_ps2", title: "PS2", type: "checkbox" },
  { letter: "AT", key: "AT_ps3", title: "PS3", type: "checkbox" },
  { letter: "AU", key: "AU_ps4", title: "PS4", type: "checkbox" },
  { letter: "AV", key: "AV_materials_offsite", title: "12.5.1 Materials Offsite", type: "checkbox" },
  { letter: "AW", key: "AW_materials_offsite_conditions", title: "12.5.1 Materials Offsite Conditions", type: "dropdown", settingsListKey: "list_mats_off_site" },
  { letter: "AX", key: "AX_cost_fluctuations", title: "12.8\nCost Fluctuations", type: "checkbox" },
  { letter: "AY", key: "AY_supply_only", title: "Appendix A: Supply only Subcontract", type: "checkbox" },
  { letter: "AZ", key: "AZ_subject_to_remeasure", title: "Sub Sum Subject to Remeasure", type: "checkbox" },
  { letter: "BA", key: "BA_pre_let_meeting_held", title: "Appendix D: Pre-let meeting held Y/N", type: "checkbox" },
  { letter: "BB", key: "BB_other_special_conditions", title: "Other Special Conditions", type: "text" },
  { letter: "BC", key: "BC_other_misc", title: "Other Misc", type: "text" },
  { letter: "BD", key: "BD_email_dated", title: "(D) Email Dated", type: "text" },
  { letter: "BE", key: "BE_email_from", title: "(D) Email From", type: "text" },
  { letter: "BF", key: "BF_letter_dated", title: "(E) Letter Dated", type: "text" },
  { letter: "BG", key: "BG_letter_from", title: "(E) Letter From", type: "text" },
  { letter: "BH", key: "BH_prelet_date_day", title: "(F) Minutes of Subcontract Pre-let meeting DATE DAY", type: "text" },
  { letter: "BI", key: "BI_prelet_date_month", title: "(F) Minutes of Subcontract Pre-let meeting DATE MONTH", type: "text" },
  { letter: "BJ", key: "BJ_prelet_date_year", title: "(F) Minutes of Subcontract Pre-let meeting DATE YEAR", type: "text" },
  { letter: "BK", key: "BK_site_safety_plan", title: "Subcontractor Site Specific Safety Plan", type: "checkbox" },
  { letter: "BL", key: "BL_schedule_of_quantities", title: "Schedule of Quantities (if applicable)", type: "checkbox" },
  { letter: "BM", key: "BM_additional_doc_l", title: "(L) Additional Document", type: "text" },
  { letter: "BN", key: "BN_additional_doc_m", title: "(M) Additional Document", type: "text" },
  { letter: "BO", key: "BO_additional_doc_n", title: "(N) Additional Document", type: "text" },
  { letter: "BP", key: "BP_additional_doc_o1", title: "(O) Additional Document", type: "text" },
  { letter: "BQ", key: "BQ_additional_doc_o2", title: "(O) Additional Document", type: "text" },
  { letter: "BR", key: "BR_special_conditions_in_tender", title: "Special Conditions in\n Subs Tender", type: "text" },
];

/** Persistence key (subcontractor_grid_values.column_key) for a Contract Info field's per-row value. */
export const ciGridKey = (fieldKey: string) => `ci_${fieldKey}`;

function colLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const STAFF_ROLE_BY_KEY: Record<string, GridColumn["staffRole"]> = {
  project_manager: "PM",
  site_manager: "BTM",
  quantity_surveyor: "QS",
};

// Section 3 (Bonds & Guarantees) duplicated columns U-Y, which were already
// per-subcontractor, and was never wired into the PDF mapping - so it is not
// carried over as separate columns.
const SKIPPED_CI_SECTIONS = new Set(["3. Subcontractor Bonds & Guarantees"]);

function ciColumnsFor(field: ContractInfoField): Omit<GridColumn, "letter">[] {
  const opts = field.options?.map((o) => o.value);
  const dflt = field.default;
  switch (field.type) {
    case "heading":
      return [];
    case "percent-value":
      return [
        { key: ciGridKey(field.pctKey!), ciKey: field.pctKey!, title: `${field.label} %`, type: "number" },
        { key: ciGridKey(field.valueKey!), ciKey: field.valueKey!, title: `${field.label} $`, type: "number" },
      ];
    case "text-select":
      return [
        { key: ciGridKey(field.textKey!), ciKey: field.textKey!, title: `${field.label}\nvalue`, type: "text" },
        { key: ciGridKey(field.selectKey!), ciKey: field.selectKey!, title: `${field.label}\nper`, type: "dropdown", options: opts },
      ];
    case "checkbox":
      return [{ key: ciGridKey(field.key), ciKey: field.key, title: field.label, type: "checkbox" }];
    case "number":
      return [{ key: ciGridKey(field.key), ciKey: field.key, title: field.label, type: "number" }];
    case "radio":
    case "select":
      return [
        {
          key: ciGridKey(field.key),
          ciKey: field.key,
          title: field.label,
          type: "dropdown",
          options: opts && opts.length ? opts : undefined,
          staffRole: STAFF_ROLE_BY_KEY[field.key],
          defaultValue: dflt,
        },
      ];
    default:
      return [{ key: ciGridKey(field.key), ciKey: field.key, title: field.label, type: "text", defaultValue: dflt }];
  }
}

const placedCiKeys = new Set(BASE_GRID_COLUMNS.map((c) => c.ciKey).filter(Boolean) as string[]);

const APPENDED_CI_COLUMNS: GridColumn[] = [...CONTRACT_INFO_LEFT, ...CONTRACT_INFO_RIGHT]
  .filter((section) => !SKIPPED_CI_SECTIONS.has(section.title))
  .flatMap((section) => section.fields.flatMap(ciColumnsFor))
  .filter((c) => !placedCiKeys.has(c.ciKey!))
  .map((c, i) => ({ ...c, letter: colLetter(BASE_GRID_COLUMNS.length + i) }));

// Original workbook columns keep their letters/positions (the mapping
// formulas address them by letter); the former Contract Info fields follow.
export const GRID_COLUMNS: GridColumn[] = [...BASE_GRID_COLUMNS, ...APPENDED_CI_COLUMNS];

/** Every column that is a former Contract Info field (has a defaults-row cell). */
export const CI_COLUMNS = GRID_COLUMNS.filter((c) => c.ciKey);

export const CHECKBOX_COLUMN_KEYS = new Set(
  GRID_COLUMNS.filter((c) => c.type === "checkbox").map((c) => c.key),
);

export const COMPUTED_COLUMN_KEYS = new Set(
  GRID_COLUMNS.filter((c) => c.type === "computed").map((c) => c.key),
);
