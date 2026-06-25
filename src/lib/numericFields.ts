// Fields (by AcroForm field name) that hold a dollar amount or percentage and
// should display thousands-separated with two decimal places — shared by the
// live PDF overlay (FieldOverlay.tsx) and the PDF export fill (pdfFill.ts)
// so the two stay in sync.
export const NUMERIC_FIELD_NAMES = new Set([
  "Subcontract_Value",
  "Bond_In_Lieu_Val_DLP",
  "Perf_Bond_Val",
  "Aircraft_Watercraft_val",
  "Contract_Works_Deductible",
  "Demo_Pct",
  "Demo_Value",
  "Fees_Pct",
  "Fees_Value",
  "Inc_Pct",
  "Increase_Cost_Value",
  "MV_Val",
  "PI_Val",
  "PL_Insur_Value",
  "Plant_Equp_Value",
  "Subcontract_Works_Insurance_Value",
  "Total_Insur_Value",
  "Var_Pct",
  "Variations_Value",
  "Vibration_Support_Val",
  "LD_Sep_Por_Value",
  "LD_Val",
  "Ret_First_Pct",
  "Ret_First_Val",
  "Ret_Next_Pct",
  "Ret_Next_Val",
  "Ret_Rem_Pct",
  "DLP_Pct",
  "Additional_Price_Item_1_Value",
  "Additional_Price_Item_2_Value",
  "Original_Tender_Price",
  "Total_Subcontract_Sum",
]);

// Formats a numeric string as thousands-separated with two decimal places.
// Non-numeric or incomplete input (e.g. "", "-") is returned unchanged so the
// user can keep typing.
export function formatNumeric(raw: string): string {
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return raw;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString("en-NZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
