// Faithful port of the legacy workbook's "SA2025 Template" tab — the
// computation layer that turns Contract Info + Subcontractor Details (+ TP
// Companies + the QS staff directory) into the 154 PDF field values. Ported
// column-by-column from the literal formula text extracted from the
// workbook (see conversation/extraction notes) — every conditional (Yes/No
// conversions, N/A blanking when a sibling radio is "No", hardcoded
// constants, document-attached checkboxes, XLOOKUPs) is preserved exactly.
//
// Simplification vs. the original: every formula there was wrapped in
// `IF('Subcontractor Details'!A2>"", <X>, "")` — a guard for "is this row a
// real subcontractor". Our Mapping sheet only ever has rows for actual
// subcontractors (built from `subs.map(...)`, never blank/spare rows), so
// that outer guard is always true here and has been dropped; the inner
// conditional logic is otherwise unchanged.
import { ciCell } from "./contractInfoCellMap";

export interface MappingContext {
  /** 1-based row number, shared by SubcontractorDetails and Mapping sheets. */
  row: number;
  tpRowCount: number;
  staffQsRowCount: number;
  companyName: string;
  companyAddress1: string;
  companyAddress2: string;
}

export interface MappingColumn {
  /** Mapping sheet column letter — same layout as the legacy Template tab. */
  letter: string;
  /** AcroForm field name (matches field-map.json). */
  fieldName: string;
  formula: (ctx: MappingContext) => string;
}

const sd = (col: string, ctx: MappingContext) => `SubcontractorDetails!${col}${ctx.row}`;
const ci = (key: string) => `ContractInfo!${ciCell(key)}`;
const self = (col: string, ctx: MappingContext) => `${col}${ctx.row}`;
const tpCol = (col: string, ctx: MappingContext) => `TPCompanies!${col}1:${col}${ctx.tpRowCount}`;
const staffCol = (col: string, ctx: MappingContext) => `StaffQS!${col}1:${col}${ctx.staffQsRowCount}`;
const lit = (s: string) => `"${s.replace(/"/g, '""')}"`;
// Boolean grid/contract-info cells are stored as the strings "true"/"false",
// but HyperFormula auto-coerces those into real booleans on load (confirmed:
// comparing the coerced boolean against the *string* "true" always returns
// false) — so comparisons must use the TRUE() function, not a string literal.
const isTrue = (ref: string) => `${ref}=TRUE()`;

export const MAPPING_COLUMNS: MappingColumn[] = [
  // B: Project_Name
  { letter: "B", fieldName: "Project_Name", formula: () => `=${ci("project_name")}` },
  // C: Subcontractor_Name
  { letter: "C", fieldName: "Subcontractor_Name", formula: (ctx) => `=${sd("B", ctx)}` },
  // D: Subcontractor_Reference
  { letter: "D", fieldName: "Subcontractor_Reference", formula: (ctx) => `=${sd("C", ctx)}` },
  // E: Trade_Desc
  { letter: "E", fieldName: "Trade_Desc", formula: (ctx) => `=${sd("A", ctx)}` },
  // F: Contractor_Address_1 (hardcoded in legacy; now Settings-driven)
  { letter: "F", fieldName: "Contractor_Address_1", formula: (ctx) => `=${lit(ctx.companyAddress1)}` },
  // G: Contractor_address_2
  { letter: "G", fieldName: "Contractor_address_2", formula: (ctx) => `=${lit(ctx.companyAddress2)}` },
  // H: Contractor_Email — XLOOKUP the selected QS's name against the staff list
  {
    letter: "H",
    fieldName: "Contractor_Email",
    formula: (ctx) =>
      `=IFERROR(XLOOKUP(${ci("quantity_surveyor")},${staffCol("A", ctx)},${staffCol("B", ctx)}),"")`,
  },
  // I: Contractor_Fax (always "-" in legacy)
  { letter: "I", fieldName: "Contractor_Fax", formula: () => `=${lit("-")}` },
  // J: Contractor_Name (hardcoded in legacy; now Settings-driven)
  { letter: "J", fieldName: "Contractor_Name", formula: (ctx) => `=${lit(ctx.companyName)}` },
  // K/L/M: Date_Day/Month/Year — date of PDF generation, not a stored date.
  // Computed directly in JS (not a HyperFormula formula): HyperFormula's
  // TEXT() doesn't support the "mmmm" month-name format token at all (it
  // silently returns garbage), and these three never depend on any other
  // cell anyway, so there's no reason to route them through the engine.
  { letter: "K", fieldName: "Date_Day", formula: () => String(new Date().getDate()) },
  {
    letter: "L",
    fieldName: "Date_Month",
    formula: () =>
      [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ][new Date().getMonth()],
  },
  { letter: "M", fieldName: "Date_Year", formula: () => String(new Date().getFullYear()).slice(-2) },
  // N: Principal_Name
  { letter: "N", fieldName: "Principal_Name", formula: () => `=${ci("principal")}` },
  // O: Subcontract_Value
  { letter: "O", fieldName: "Subcontract_Value", formula: (ctx) => `=${sd("M", ctx)}` },
  // P: Subcontractor_Address_1 — TP Companies address_1 (col E) + ","
  {
    letter: "P",
    fieldName: "Subcontractor_Address_1",
    formula: (ctx) =>
      `=IFERROR(XLOOKUP(${sd("B", ctx)},${tpCol("A", ctx)},${tpCol("E", ctx)})&",","")`,
  },
  // Q: Subcontractor_Address_2 — TP Companies address_2/city/zip (cols F/H/I)
  {
    letter: "Q",
    fieldName: "Subcontractor_Address_2",
    formula: (ctx) =>
      `=IFERROR(XLOOKUP(${sd("B", ctx)},${tpCol("A", ctx)},${tpCol("F", ctx)})&", "&XLOOKUP(${sd("B", ctx)},${tpCol("A", ctx)},${tpCol("H", ctx)})&", "&XLOOKUP(${sd("B", ctx)},${tpCol("A", ctx)},${tpCol("I", ctx)}),"")`,
  },
  // R: Subcontractor_Email
  {
    letter: "R",
    fieldName: "Subcontractor_Email",
    formula: (ctx) => `=IFERROR(XLOOKUP(${sd("B", ctx)},${tpCol("A", ctx)},${tpCol("L", ctx)}),"")`,
  },
  // S/T: Subcontractor_Fax/GST (always "-")
  { letter: "S", fieldName: "Subcontractor_Fax", formula: () => `=${lit("-")}` },
  { letter: "T", fieldName: "Subcontractor_GST", formula: () => `=${lit("-")}` },
  // U: Asbuilts_Req — radio, Yes/No from Subcontractor Details!AN (As-Builts)
  { letter: "U", fieldName: "Asbuilts_Req", formula: (ctx) => `=IF(${isTrue(sd("AN", ctx))},"Yes","No")` },
  // V: Bond_In_Lieu_Val_DLP — N/A unless Bonds in Lieu (col X, same row) = "Yes"
  {
    letter: "V",
    fieldName: "Bond_In_Lieu_Val_DLP",
    formula: (ctx) => `=IF(${self("X", ctx)}="No","N/A",${sd("Y", ctx)})`,
  },
  // W: Bond_In_Lieu_Val_Period
  {
    letter: "W",
    fieldName: "Bond_In_Lieu_Val_Period",
    formula: (ctx) => `=IF(${self("X", ctx)}="No","N/A",${sd("X", ctx)})`,
  },
  // X: Bonds_In_Lieu_of_Retentions — radio, from Subcontractor Details!W
  { letter: "X", fieldName: "Bonds_In_Lieu_of_Retentions", formula: (ctx) => `=IF(${isTrue(sd("W", ctx))},"Yes","No")` },
  // Y: Continuity_Attached — from AE
  { letter: "Y", fieldName: "Continuity_Attached", formula: (ctx) => `=IF(${isTrue(sd("AE", ctx))},"Yes","No")` },
  // Z: Continuity_Guarantee_Required — from AD
  { letter: "Z", fieldName: "Continuity_Guarantee_Required", formula: (ctx) => `=IF(${isTrue(sd("AD", ctx))},"Yes","No")` },
  // AA: Guarantees_Copies_Attached — from AC
  { letter: "AA", fieldName: "Guarantees_Copies_Attached", formula: (ctx) => `=IF(${isTrue(sd("AC", ctx))},"Yes","No")` },
  // AB: Head_Contract_Type
  { letter: "AB", fieldName: "Head_Contract_Type", formula: () => `=${ci("head_contract")}` },
  // AC: Operating_Instruction_and_Maintenance_Manuals — from AP
  { letter: "AC", fieldName: "Operating_Instruction_and_Maintenance_Manuals", formula: (ctx) => `=IF(${isTrue(sd("AP", ctx))},"Yes","No")` },
  // AD: Perf_Bond — from U
  { letter: "AD", fieldName: "Perf_Bond", formula: (ctx) => `=IF(${isTrue(sd("U", ctx))},"Yes","No")` },
  // AE: Perf_Bond_Val — N/A unless Perf Bond (col AD, same row) = "Yes"
  {
    letter: "AE",
    fieldName: "Perf_Bond_Val",
    formula: (ctx) => `=IF(${self("AD", ctx)}="No","N/A",${sd("V", ctx)})`,
  },
  // AF–AI: PS1–PS4_Req — from AR/AS/AT/AU
  { letter: "AF", fieldName: "PS1_Req", formula: (ctx) => `=IF(${isTrue(sd("AR", ctx))},"Yes","No")` },
  { letter: "AG", fieldName: "PS2_Req", formula: (ctx) => `=IF(${isTrue(sd("AS", ctx))},"Yes","No")` },
  { letter: "AH", fieldName: "PS3_Req", formula: (ctx) => `=IF(${isTrue(sd("AT", ctx))},"Yes","No")` },
  { letter: "AI", fieldName: "PS4_Req", formula: (ctx) => `=IF(${isTrue(sd("AU", ctx))},"Yes","No")` },
  // AJ: Shop_Drawings_Req — from AL
  { letter: "AJ", fieldName: "Shop_Drawings_Req", formula: (ctx) => `=IF(${isTrue(sd("AL", ctx))},"Yes","No")` },
  // AK: Subcontract_Design_Responsibilities (text) — N/A unless AL (same row) = "Yes"
  {
    letter: "AK",
    fieldName: "Subcontract_Design_Responsibilities",
    formula: (ctx) => `=IF(${self("AL", ctx)}="No","N/A",${sd("AG", ctx)})`,
  },
  // AL: Subcontractor_Design_Responsibilities (radio) — from AF
  { letter: "AL", fieldName: "Subcontractor_Design_Responsibilities", formula: (ctx) => `=IF(${isTrue(sd("AF", ctx))},"Yes","No")` },
  // AM: Subcontractor_Obtained_Building_Consent — from AH
  { letter: "AM", fieldName: "Subcontractor_Obtained_Building_Consent", formula: (ctx) => `=IF(${isTrue(sd("AH", ctx))},"Yes","No")` },
  // AN: Trade_Guarantee_Duration (text) — N/A unless AP (same row) = "Yes"
  {
    letter: "AN",
    fieldName: "Trade_Guarantee_Duration",
    formula: (ctx) => `=IF(${self("AP", ctx)}="No","N/A",${sd("AB", ctx)})`,
  },
  // AO: Trade_Guarantee_When_Required
  {
    letter: "AO",
    fieldName: "Trade_Guarantee_When_Required",
    formula: (ctx) => `=IF(${self("AP", ctx)}="No","N/A",${sd("AA", ctx)})`,
  },
  // AP: Trade_Guarantees (radio) — from Z
  { letter: "AP", fieldName: "Trade_Guarantees", formula: (ctx) => `=IF(${isTrue(sd("Z", ctx))},"Yes","No")` },
  // AQ: 8.2.3_Other
  { letter: "AQ", fieldName: "8.2.3_Other", formula: (ctx) => `=${sd("AK", ctx)}` },
  // AR: Aircraft_Watercraft_val — N/A unless BN (same row) = "Yes"
  {
    letter: "AR",
    fieldName: "Aircraft_Watercraft_val",
    formula: (ctx) => `=IF(${self("BN", ctx)}="No","N/A",${ci("aircraft_watercraft_value")})`,
  },
  // AS: Completion of the Subcontract Works (checkbox) — On if Ins of Subcontract Works by Sub
  {
    letter: "AS",
    fieldName: "Completion of the Subcontract Works",
    formula: () => `=IF(${isTrue(ci("ins_of_subcontract_works_by_sub"))},"On","")`,
  },
  // AT: Contract_Works_Deductible
  { letter: "AT", fieldName: "Contract_Works_Deductible", formula: () => `=${ci("contract_works_deductible")}` },
  // AU: CW_Insurance_by (radio) — display text "Main Contractor"/"Principal"
  {
    letter: "AU",
    fieldName: "CW_Insurance_by",
    formula: () =>
      `=IF(${ci("contract_works_ins_by")}="main_contractor","Main Contractor","Principal")`,
  },
  // AV/AW: Demo_Pct/Demo_Value — N/A unless BB (same row) = "Yes"
  { letter: "AV", fieldName: "Demo_Pct", formula: (ctx) => `=IF(${self("BB", ctx)}="No","N/A",${ci("allowance_demo_removal_pct")})` },
  { letter: "AW", fieldName: "Demo_Value", formula: (ctx) => `=IF(${self("BB", ctx)}="No","N/A",${ci("allowance_demo_removal_value")})` },
  // AX/AY: Fees_Pct/Fees_Value
  { letter: "AX", fieldName: "Fees_Pct", formula: (ctx) => `=IF(${self("BB", ctx)}="No","N/A",${ci("allowance_fees_pct")})` },
  { letter: "AY", fieldName: "Fees_Value", formula: (ctx) => `=IF(${self("BB", ctx)}="No","N/A",${ci("allowance_fees_value")})` },
  // AZ/BA: Inc_Pct/Increase_Cost_Value
  { letter: "AZ", fieldName: "Inc_Pct", formula: (ctx) => `=IF(${self("BB", ctx)}="No","N/A",${ci("allowance_increase_fees_pct")})` },
  { letter: "BA", fieldName: "Increase_Cost_Value", formula: (ctx) => `=IF(${self("BB", ctx)}="No","N/A",${ci("allowance_increase_fees_value")})` },
  // BB: Insurance_of_Contract_Works_by_Subcontractor (radio)
  {
    letter: "BB",
    fieldName: "Insurance_of_Contract_Works_by_Subcontractor",
    formula: () => `=IF(${isTrue(ci("ins_of_subcontract_works_by_sub"))},"Yes","No")`,
  },
  // BC: MV_Val
  { letter: "BC", fieldName: "MV_Val", formula: () => `=${ci("motor_vehicle_insurance")}` },
  // BD: Other (checkbox carrying literal text)
  {
    letter: "BD",
    fieldName: "Other",
    formula: () => `=IF(${ci("required_until_other")}>"",${ci("required_until_other")},"")`,
  },
  // BE: PC_Due_Date
  { letter: "BE", fieldName: "PC_Due_Date", formula: () => `=${ci("due_dates_pc_head_contract")}` },
  // BF: PI_Insurance_Req (radio)
  { letter: "BF", fieldName: "PI_Insurance_Req", formula: () => `=IF(${isTrue(ci("professional_indemnity_insurance"))},"Yes","No")` },
  // BG: PI_Val — N/A unless BF (same row) = "Yes"
  { letter: "BG", fieldName: "PI_Val", formula: (ctx) => `=IF(${self("BF", ctx)}="No","N/A",${ci("professional_indemnity_amount")})` },
  // BH: PL_Insur_Value
  { letter: "BH", fieldName: "PL_Insur_Value", formula: () => `=${ci("public_liability_insurance")}` },
  // BI: Plant_Equp_Value
  { letter: "BI", fieldName: "Plant_Equp_Value", formula: () => `=${ci("plant_equipment_insurance")}` },
  // BJ: Practical completion of Head Contract (checkbox)
  {
    letter: "BJ",
    fieldName: "Practical completion of Head Contract",
    formula: () => `=IF(${isTrue(ci("required_until_pc_head_contract"))},"On","")`,
  },
  // BK: Special_Extension_Req_for_Airside (radio)
  { letter: "BK", fieldName: "Special_Extension_Req_for_Airside", formula: () => `=IF(${isTrue(ci("mv_special_extension"))},"Yes","No")` },
  // BL: Subcontract_Works_Insurance_Value
  { letter: "BL", fieldName: "Subcontract_Works_Insurance_Value", formula: (ctx) => `=IF(${self("BB", ctx)}="No","N/A",${ci("value_of_subcontract_works_ins")})` },
  // BM: Total_Insur_Value
  { letter: "BM", fieldName: "Total_Insur_Value", formula: (ctx) => `=IF(${self("BB", ctx)}="No","N/A",${ci("total_value_to_be_insured")})` },
  // BN: Use_of_Aircraft_or_Watercraft (radio) — Yes if value > 0
  {
    letter: "BN",
    fieldName: "Use_of_Aircraft_or_Watercraft",
    formula: () => `=IF(N(${ci("aircraft_watercraft_value")})>0,"Yes","No")`,
  },
  // BO: Var_Intention_Timeframe
  { letter: "BO", fieldName: "Var_Intention_Timeframe", formula: () => `=${ci("time_notify_intention_to_claim")}` },
  // BP: Var_Pct
  { letter: "BP", fieldName: "Var_Pct", formula: (ctx) => `=IF(${self("BB", ctx)}="No","N/A",${ci("allowance_variations_pct")})` },
  // BQ: Var_Submission_Timeframe
  { letter: "BQ", fieldName: "Var_Submission_Timeframe", formula: () => `=${ci("time_submission_price_details")}` },
  // BR: Variations_Value
  { letter: "BR", fieldName: "Variations_Value", formula: (ctx) => `=IF(${self("BB", ctx)}="No","N/A",${ci("allowance_variations_value")})` },
  // BS: Vibration_Support_Removal (radio) — Yes if value > 0
  {
    letter: "BS",
    fieldName: "Vibration_Support_Removal",
    formula: () => `=IF(N(${ci("vibration_removal_support_ins")})>0,"Yes","No")`,
  },
  // BT: Vibration_Support_Val
  { letter: "BT", fieldName: "Vibration_Support_Val", formula: (ctx) => `=IF(${self("BS", ctx)}="No","N/A",${ci("vibration_removal_support_ins")})` },
  // BU: Clain_Frequency [sic — typo preserved from the original AcroForm field name]
  { letter: "BU", fieldName: "Clain_Frequency", formula: () => `=${ci("claim_frequency")}` },
  // BV: DLP_Per (dropdown) — defects liability period unit
  { letter: "BV", fieldName: "DLP_Per", formula: () => `=${ci("defects_liability_period_unit")}` },
  // BW/BX: DLP_Period / DLP_Period_Separable_Portions
  { letter: "BW", fieldName: "DLP_Period", formula: () => `=${ci("defects_liability_period_value")}` },
  { letter: "BX", fieldName: "DLP_Period_Separable_Portions", formula: () => `=${ci("defects_liability_period_separable_value")}` },
  // BY: DLP_Sep_Por_Per
  { letter: "BY", fieldName: "DLP_Sep_Por_Per", formula: () => `=${ci("defects_liability_period_separable_unit")}` },
  // BZ: Interim_Final_Account_Due_Date — N/A unless CA (same row) = "Yes"
  { letter: "BZ", fieldName: "Interim_Final_Account_Due_Date", formula: (ctx) => `=IF(${self("CA", ctx)}="No","N/A",${ci("interim_final_account_due")})` },
  // CA: Interim_Final_Account_Process (radio)
  { letter: "CA", fieldName: "Interim_Final_Account_Process", formula: () => `=IF(${isTrue(ci("interim_final_account_process"))},"Yes","No")` },
  // CB/CC: LD_Per / LD_Sep_Por_Per
  { letter: "CB", fieldName: "LD_Per", formula: () => `=${ci("lds_applicable_head_contract_unit")}` },
  { letter: "CC", fieldName: "LD_Sep_Por_Per", formula: () => `=${ci("lds_applicable_head_contract_separable_unit")}` },
  // CD/CE: LD_Sep_Por_Value / LD_Val
  { letter: "CD", fieldName: "LD_Sep_Por_Value", formula: () => `=${ci("lds_applicable_head_contract_separable_value")}` },
  { letter: "CE", fieldName: "LD_Val", formula: () => `=${ci("lds_applicable_head_contract_value")}` },
  // CF: PC_Separable_Portions_Date
  { letter: "CF", fieldName: "PC_Separable_Portions_Date", formula: () => `=${ci("due_dates_pc_head_contract_separable")}` },
  // CG–CK: Retention %/values — N/A unless Subcontractor Details!N (Retentions, same row) = "true"
  { letter: "CG", fieldName: "Ret_First_Pct", formula: (ctx) => `=IF(${sd("N", ctx)}<>TRUE(),"N/A",${sd("O", ctx)})` },
  { letter: "CH", fieldName: "Ret_First_Val", formula: (ctx) => `=IF(${sd("N", ctx)}<>TRUE(),"N/A",${sd("P", ctx)})` },
  { letter: "CI", fieldName: "Ret_Next_Pct", formula: (ctx) => `=IF(${sd("N", ctx)}<>TRUE(),"N/A",${sd("Q", ctx)})` },
  { letter: "CJ", fieldName: "Ret_Next_Val", formula: (ctx) => `=IF(${sd("N", ctx)}<>TRUE(),"N/A",${sd("R", ctx)})` },
  { letter: "CK", fieldName: "Ret_Rem_Pct", formula: (ctx) => `=IF(${sd("N", ctx)}<>TRUE(),"N/A",${sd("S", ctx)})` },
  // CL: Cost_Fluctuations (radio) — from AX
  { letter: "CL", fieldName: "Cost_Fluctuations", formula: (ctx) => `=IF(${isTrue(sd("AX", ctx))},"Yes","No")` },
  // CM: DLP_Pct
  { letter: "CM", fieldName: "DLP_Pct", formula: (ctx) => `=${sd("T", ctx)}` },
  // CN: Email_to_Serve_Notices — the legacy workbook hardcoded this to the
  // literal text "TRUE" (a source-workbook bug, not a real answer); now a
  // real Yes/No radio in Contract Info instead.
  {
    letter: "CN",
    fieldName: "Email_to_Serve_Notices",
    formula: () => `=IF(${ci("email_to_serve_notices")}="yes","Yes","No")`,
  },
  // CO: Materials_Offsite (radio) — from AV
  { letter: "CO", fieldName: "Materials_Offsite", formula: (ctx) => `=IF(${isTrue(sd("AV", ctx))},"Yes","No")` },
  // CP: Misc_Other
  { letter: "CP", fieldName: "Misc_Other", formula: (ctx) => `=${sd("BC", ctx)}` },
  // CQ: Pre-Let_Held (radio) — from BA
  { letter: "CQ", fieldName: "Pre-Let_Held", formula: (ctx) => `=IF(${isTrue(sd("BA", ctx))},"Yes","No")` },
  // CR: Subject_to_Remeasure — from AZ
  { letter: "CR", fieldName: "Subject_to_Remeasure", formula: (ctx) => `=IF(${isTrue(sd("AZ", ctx))},"Yes","No")` },
  // CS: Supply_Only_Subcontract — from AY
  { letter: "CS", fieldName: "Supply_Only_Subcontract", formula: (ctx) => `=IF(${isTrue(sd("AY", ctx))},"Yes","No")` },
  // CT–CW: Additional_Docs_L..O
  { letter: "CT", fieldName: "Additional_Docs_L", formula: (ctx) => `=${sd("BM", ctx)}` },
  { letter: "CU", fieldName: "Additional_Docs_M", formula: (ctx) => `=${sd("BN", ctx)}` },
  { letter: "CV", fieldName: "Additional_Docs_N", formula: (ctx) => `=${sd("BO", ctx)}` },
  { letter: "CW", fieldName: "Additional_Docs_O", formula: (ctx) => `=${sd("BP", ctx)}` },
  // CX–DA: Additional_Price_Item_1/2 + values
  { letter: "CX", fieldName: "Additional_Price_Item_1", formula: (ctx) => `=${sd("I", ctx)}` },
  { letter: "CY", fieldName: "Additional_Price_Item_1_Value", formula: (ctx) => `=${sd("J", ctx)}` },
  { letter: "CZ", fieldName: "Additional_Price_Item_2", formula: (ctx) => `=${sd("K", ctx)}` },
  { letter: "DA", fieldName: "Additional_Price_Item_2_Value", formula: (ctx) => `=${sd("L", ctx)}` },
  // DB: Contract Programme (checkbox) — On if DC (same row) is non-empty
  { letter: "DB", fieldName: "Contract Programme", formula: (ctx) => `=IF(${self("DC", ctx)}>" ","On","")` },
  // DC–DE: Contract_Programme / Date / Ref
  { letter: "DC", fieldName: "Contract_Programme", formula: () => `=${ci("programme_title")}` },
  { letter: "DD", fieldName: "Contract_Programme_Date", formula: () => `=${ci("contract_programme_dated")}` },
  { letter: "DE", fieldName: "Contract_Programme_Ref", formula: () => `=${ci("contract_programme_reference")}` },
  // DF: Email dated (checkbox) — On if DG (same row) is non-empty
  { letter: "DF", fieldName: "Email dated", formula: (ctx) => `=IF(${self("DG", ctx)}>" ","On","")` },
  // DG/DH: Email_Date / Email_From
  { letter: "DG", fieldName: "Email_Date", formula: (ctx) => `=${sd("BD", ctx)}` },
  { letter: "DH", fieldName: "Email_From", formula: (ctx) => `=${sd("BE", ctx)}` },
  // DI: Fax dated (checkbox) — On if DJ (same row) is non-empty
  { letter: "DI", fieldName: "Fax dated", formula: (ctx) => `=IF(${self("DJ", ctx)}>" ","On","")` },
  // DJ/DK: Fax_Date/Fax_From (always "-")
  { letter: "DJ", fieldName: "Fax_Date", formula: () => `=${lit("-")}` },
  { letter: "DK", fieldName: "Fax_From", formula: () => `=${lit("-")}` },
  // DL: Invitation to tender dated (checkbox) — On if DM (same row) is non-empty
  { letter: "DL", fieldName: "Invitation to tender dated", formula: (ctx) => `=IF(${self("DM", ctx)}>" ","On","")` },
  // DM: Invite_Tender_Date
  { letter: "DM", fieldName: "Invite_Tender_Date", formula: () => `=${ci("itt_dated")}` },
  // DN: Letter dated (checkbox) — On if DP (same row) is non-empty
  { letter: "DN", fieldName: "Letter dated", formula: (ctx) => `=IF(${self("DP", ctx)}>" ","On","")` },
  // DO: Letter of Award dated (checkbox) — On if DR (same row) is non-empty
  { letter: "DO", fieldName: "Letter of Award dated", formula: (ctx) => `=IF(${self("DR", ctx)}>" ","On","")` },
  // DP/DQ: Letter_Date / Letter_From
  { letter: "DP", fieldName: "Letter_Date", formula: (ctx) => `=${sd("BF", ctx)}` },
  { letter: "DQ", fieldName: "Letter_From", formula: (ctx) => `=${sd("BG", ctx)}` },
  // DR: LOA_Date
  { letter: "DR", fieldName: "LOA_Date", formula: (ctx) => `=${sd("F", ctx)}` },
  // DS: Minutes of Subcontract preletting meetings (checkbox) — On if DX (same row) is non-empty
  { letter: "DS", fieldName: "Minutes of Subcontract preletting meetings", formula: (ctx) => `=IF(${self("DX", ctx)}>" ","On","")` },
  // DT: Notices to tenderers numbers (checkbox) — On if DU (same row) is non-empty
  { letter: "DT", fieldName: "Notices to tenderers numbers", formula: (ctx) => `=IF(${self("DU", ctx)}>" ","On","")` },
  // DU: NTT_Qty
  { letter: "DU", fieldName: "NTT_Qty", formula: () => `=${ci("notice_to_tenderers_numbers")}` },
  // DV: Original_Tender_Price
  { letter: "DV", fieldName: "Original_Tender_Price", formula: (ctx) => `=${sd("H", ctx)}` },
  // DW: Other_Specials
  { letter: "DW", fieldName: "Other_Specials", formula: (ctx) => `=${sd("BB", ctx)}` },
  // DX–DZ: Prelet_Day/Month/Year
  { letter: "DX", fieldName: "Prelet_Day", formula: (ctx) => `=${sd("BH", ctx)}` },
  { letter: "DY", fieldName: "Prelet_Month", formula: (ctx) => `=${sd("BI", ctx)}` },
  { letter: "DZ", fieldName: "Prelet_Year", formula: (ctx) => `=${sd("BJ", ctx)}` },
  // EA: Schedule of quantities if applicable (checkbox) — from Subcontractor Details!BL
  { letter: "EA", fieldName: "Schedule of quantities if applicable", formula: (ctx) => `=IF(${isTrue(sd("BL", ctx))},"On","")` },
  // EB: Special_Conditions
  { letter: "EB", fieldName: "Special_Conditions", formula: (ctx) => `=${sd("BR", ctx)}` },
  // EC: Subcontractor site specific safety plan (checkbox) — from Subcontractor Details!BK
  { letter: "EC", fieldName: "Subcontractor site specific safety plan", formula: (ctx) => `=IF(${isTrue(sd("BK", ctx))},"On","")` },
  // ED: Summary of Subcontract Sum (checkbox) — On if any of I:L (same row) is non-empty
  {
    letter: "ED",
    fieldName: "Summary of Subcontract Sum",
    formula: (ctx) =>
      `=IF(COUNTA(SubcontractorDetails!I${ctx.row}:L${ctx.row})>0,"On","")`,
  },
  // EE–EH: Summary of Subcontract Sum_02..05 (checkboxes) — On if BM/BN/BO/BP non-empty
  { letter: "EE", fieldName: "Summary of Subcontract Sum_02", formula: (ctx) => `=IF(${sd("BM", ctx)}>"","On","")` },
  { letter: "EF", fieldName: "Summary of Subcontract Sum_03", formula: (ctx) => `=IF(${sd("BN", ctx)}>"","On","")` },
  { letter: "EG", fieldName: "Summary of Subcontract Sum_04", formula: (ctx) => `=IF(${sd("BO", ctx)}>"","On","")` },
  { letter: "EH", fieldName: "Summary of Subcontract Sum_05", formula: (ctx) => `=IF(${sd("BP", ctx)}>"","On","")` },
  // EI: Total_Subcontract_Sum
  { letter: "EI", fieldName: "Total_Subcontract_Sum", formula: (ctx) => `=${sd("M", ctx)}` },
];
