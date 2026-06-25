// Field schema for the "Contract Info" tab — a native replacement for the
// legacy workbook's "Contract Info" sheet. field_key values are the
// persistence keys (contract_info_values.field_key), not AcroForm field
// names (those only exist downstream, in the future Mapping-sheet output).
export type ContractInfoFieldType =
  | "text"
  | "number"
  | "checkbox"
  | "radio"
  | "select"
  | "percent-value"
  | "text-select"
  /** Not a field in the PDF — a sub-heading label above the fields that follow it. */
  | "heading";

export interface ContractInfoField {
  /** Persistence key for all types except "percent-value"/"text-select". */
  key: string;
  label: string;
  type: ContractInfoFieldType;
  options?: { value: string; label: string }[];
  default?: string;
  /** Only rendered when the named field currently equals the given value. */
  showIf?: { key: string; equals: string };
  /** Always rendered, but disabled (greyed out, not editable) unless the named field equals the given value. */
  enableIf?: { key: string; equals: string };
  /** Used only when type is "percent-value": a side-by-side %/$ pair. */
  pctKey?: string;
  valueKey?: string;
  /** Used only when type is "text-select": a side-by-side text + dropdown pair. */
  textKey?: string;
  selectKey?: string;
}

/** Shared "Month / Week / Day / -" dropdown, matching the PDF's fixed AcroForm options. */
const FREQUENCY_OPTIONS = [
  { value: "Month", label: "Month" },
  { value: "Week", label: "Week" },
  { value: "Day", label: "Day" },
  { value: "-", label: "-" },
];

export interface ContractInfoSection {
  title: string;
  fields: ContractInfoField[];
}

export const CONTRACT_INFO_LEFT: ContractInfoSection[] = [
  {
    title: "1. Contract Details",
    fields: [
      { key: "job_number", label: "Job Number", type: "text" },
      { key: "project_name", label: "Project Name", type: "text" },
      { key: "principal", label: "Principal", type: "text" },
      { key: "site_address", label: "Site Address", type: "text" },
      { key: "head_contract", label: "Head Contract", type: "text" },
    ],
  },
  {
    title: "3. Subcontractor Bonds & Guarantees",
    fields: [
      { key: "performance_bond", label: "3.1.1 Performance Bond", type: "checkbox" },
      {
        key: "performance_bond_value",
        label: "3.1.1 Performance Bond Value $",
        type: "number",
        enableIf: { key: "performance_bond", equals: "true" },
      },
      { key: "bonds_in_lieu_of_retentions", label: "3.2 Bonds in Lieu of Retentions", type: "checkbox" },
      {
        key: "bonds_in_lieu_value",
        label: "3.2.1 Bonds in Lieu of Retentions Value $",
        type: "number",
        enableIf: { key: "bonds_in_lieu_of_retentions", equals: "true" },
      },
      {
        key: "bonds_dlp",
        label: "3.2.1 Bonds Defect Liability Period",
        type: "text",
        enableIf: { key: "bonds_in_lieu_of_retentions", equals: "true" },
      },
    ],
  },
  {
    title: "8. Insurance Details",
    fields: [
      {
        key: "contract_works_ins_by",
        label: "8.1.1 Contract Works Ins by",
        type: "radio",
        options: [
          { value: "main_contractor", label: "Main Contractor" },
          { value: "principal", label: "Principal" },
        ],
        default: "principal",
      },
      { key: "contract_works_deductible", label: "8.1.1 Contract Works Ins Deductible", type: "text" },
      { key: "ins_of_subcontract_works_by_sub", label: "8.2.2 Ins of Subcontract Works by Sub", type: "checkbox" },
      {
        key: "value_of_subcontract_works_ins",
        label: "8.2.3 Value of Subcontract Works Ins by Sub",
        type: "text",
        showIf: { key: "ins_of_subcontract_works_by_sub", equals: "true" },
      },
      {
        key: "allowance_demo_removal",
        label: "8.2.3 Allowance for: Demo & removal of debris",
        type: "percent-value",
        pctKey: "allowance_demo_removal_pct",
        valueKey: "allowance_demo_removal_value",
        showIf: { key: "ins_of_subcontract_works_by_sub", equals: "true" },
      },
      {
        key: "allowance_fees",
        label: "8.2.3 Allowance for: Fees",
        type: "percent-value",
        pctKey: "allowance_fees_pct",
        valueKey: "allowance_fees_value",
        showIf: { key: "ins_of_subcontract_works_by_sub", equals: "true" },
      },
      {
        key: "allowance_increase_fees",
        label: "8.2.3 Allowance for: Increase in costs: Fees",
        type: "percent-value",
        pctKey: "allowance_increase_fees_pct",
        valueKey: "allowance_increase_fees_value",
        showIf: { key: "ins_of_subcontract_works_by_sub", equals: "true" },
      },
      {
        key: "allowance_variations",
        label: "8.2.3 Allowance for: Variations",
        type: "percent-value",
        pctKey: "allowance_variations_pct",
        valueKey: "allowance_variations_value",
        showIf: { key: "ins_of_subcontract_works_by_sub", equals: "true" },
      },
      {
        key: "total_value_to_be_insured",
        label: "8.2.3 Total Value to be Insured",
        type: "text",
        showIf: { key: "ins_of_subcontract_works_by_sub", equals: "true" },
      },
      {
        key: "required_until_pc_head_contract",
        label: "Required by Sub Until: Practical Completion of the Head Contract Works",
        type: "checkbox",
        showIf: { key: "ins_of_subcontract_works_by_sub", equals: "true" },
      },
      {
        key: "required_until_pc_subcontract",
        label: "Required by Sub Until: Practical Completion of the Subcontract Works",
        type: "checkbox",
        showIf: { key: "ins_of_subcontract_works_by_sub", equals: "true" },
      },
      {
        key: "required_until_other",
        label: "Required by Sub Until: Other",
        type: "text",
        showIf: { key: "ins_of_subcontract_works_by_sub", equals: "true" },
      },
      { key: "plant_equipment_insurance", label: "8.3 Plant & Equipment Insurance", type: "text" },
      { key: "public_liability_insurance", label: "8.4.2 Public Liability Insurance", type: "text" },
      { key: "aircraft_watercraft_value", label: "8.4.4 Aircraft or Watercraft to be Insured", type: "text" },
      { key: "vibration_removal_support_ins", label: "8.4.5 Vibration Removal of Support Ins", type: "text" },
      { key: "motor_vehicle_insurance", label: "8.5.2 Motor Vehicle Insurance", type: "text" },
      { key: "mv_special_extension", label: "8.5.2 Motor Vehicle Ins Special Extension", type: "checkbox" },
      { key: "professional_indemnity_insurance", label: "8.6.2 Professional Indemnity Insurance", type: "checkbox" },
      {
        key: "professional_indemnity_amount",
        label: "8.6.2 Professional Indemnity Amount",
        type: "text",
        showIf: { key: "professional_indemnity_insurance", equals: "true" },
      },
    ],
  },
];

export const CONTRACT_INFO_RIGHT: ContractInfoSection[] = [
  {
    title: "9. Variations",
    fields: [
      { key: "time_notify_intention_to_claim", label: "9.1.3 Time for notification of intention to claim", type: "text" },
      { key: "time_submission_price_details", label: "9.2.2 Time for submission of price & details", type: "text" },
    ],
  },
  {
    title: "10. Time",
    fields: [
      { key: "due_dates_pc_head_contract", label: "10.1.1 Due dates for practical completion of Head Contract", type: "text" },
      { key: "due_dates_pc_head_contract_separable", label: "10.1.1 Due dates for PC of Head Contract — separable portions", type: "text" },
      { key: "liquidated_damages_heading", label: "10.4.1 Liquidated damages", type: "heading" },
      {
        key: "lds_applicable_head_contract",
        label: "10.5.1 Liquidated Damages applicable under the Head Contract",
        type: "text-select",
        textKey: "lds_applicable_head_contract_value",
        selectKey: "lds_applicable_head_contract_unit",
        options: FREQUENCY_OPTIONS,
      },
      {
        key: "lds_applicable_head_contract_separable",
        label: "10.5.1 LDs applicable under Head Contract — separable portions",
        type: "text-select",
        textKey: "lds_applicable_head_contract_separable_value",
        selectKey: "lds_applicable_head_contract_separable_unit",
        options: FREQUENCY_OPTIONS,
      },
    ],
  },
  {
    title: "11. Defects",
    fields: [
      {
        key: "defects_liability_period",
        label: "11.1.2 Defects liability period",
        type: "text-select",
        textKey: "defects_liability_period_value",
        selectKey: "defects_liability_period_unit",
        options: FREQUENCY_OPTIONS,
      },
      {
        key: "defects_liability_period_separable",
        label: "11.1.2 Defects Liability Period - Separate Portions",
        type: "text-select",
        textKey: "defects_liability_period_separable_value",
        selectKey: "defects_liability_period_separable_unit",
        options: FREQUENCY_OPTIONS,
      },
    ],
  },
  {
    title: "12. Payments",
    fields: [
      {
        key: "claim_frequency",
        label: "12.1.1 Claim Frequency",
        type: "select",
        options: FREQUENCY_OPTIONS,
      },
      { key: "interim_final_account_process", label: "12.3.2 Does the head contract have an interim final account process", type: "checkbox" },
      {
        key: "interim_final_account_due",
        label: "12.3.2 If yes, when is the Head Contract interim final account due?",
        type: "text",
        showIf: { key: "interim_final_account_process", equals: "true" },
      },
    ],
  },
  {
    title: "Additional Documents",
    fields: [
      { key: "itt_dated", label: "Invitation to Tender Dated", type: "text" },
      { key: "notice_to_tenderers_numbers", label: "Notice to Tenderers numbers", type: "text" },
      { key: "programme_title", label: "Programme Title", type: "text" },
      { key: "contract_programme_dated", label: "Contract Programme dated", type: "text" },
      { key: "contract_programme_reference", label: "Contract Programme reference", type: "text" },
    ],
  },
  {
    title: "Project Contact Details",
    fields: [
      // Options are populated at render time from the staff_directory (PM/BTM/QS
      // roles, managed via Settings) — see ContractInfoForm's dynamicOptions.
      { key: "project_manager", label: "Project Manager", type: "select", options: [] },
      { key: "site_manager", label: "Site Manager", type: "select", options: [] },
      { key: "quantity_surveyor", label: "Quantity Surveyor", type: "select", options: [] },
      {
        key: "email_to_serve_notices",
        label: "16.1.1 Email to Serve Notices",
        type: "radio",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
        default: "yes",
      },
    ],
  },
];
