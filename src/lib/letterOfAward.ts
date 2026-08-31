// Letter of Award — value resolution and the editable body template.
//
// One letter per subcontractor. Merge values are drawn from the same data that
// drives the Subcontract Agreements: the subcontractor list, the Subcontractor
// Details grid, TP Companies, Contract Info, and the QS staff directory.
import type {
  Project,
  Subcontractor,
  TpCompany,
  StaffMember,
} from "../api";

/** Placeholders the editable body may contain. `{{Signature}}` is special —
 *  the PDF renderer replaces it with the QS's signature image, not text. */
export const LOA_PLACEHOLDERS = [
  { token: "{{Date}}", label: "Letter date" },
  { token: "{{Tradepartner}}", label: "Trade partner / subcontractor name" },
  { token: "{{TP_Address_1}}", label: "Address line 1" },
  { token: "{{TP_Address_2}}", label: "Address line 2" },
  { token: "{{TP_Address_3}}", label: "Address line 3" },
  { token: "{{TP_City}}", label: "City" },
  { token: "{{Project_Name}}", label: "Project name" },
  { token: "{{Trade}}", label: "Trade / work package" },
  { token: "{{Sum}}", label: "Contract sum ($)" },
  { token: "{{Sum_in_Words}}", label: "Contract sum in words" },
  { token: "{{QS_Name}}", label: "Quantity Surveyor name" },
  { token: "{{QS_Email}}", label: "Quantity Surveyor email" },
  { token: "{{QS_Mobile}}", label: "Quantity Surveyor mobile" },
  { token: "{{Signature}}", label: "QS signature image" },
] as const;

/** The default letter body (with {{placeholders}}), ported from the supplied
 *  "Trade Partner Letter of Award" template. Used when neither the project
 *  override nor the global Settings template has been customised. */
export const DEFAULT_LOA_BODY = `{{Date}}

{{Tradepartner}}
{{TP_Address_1}}
{{TP_Address_2}}
{{TP_Address_3}}
{{TP_City}}

Dear Sir/Madam,

{{Project_Name}}

This letter is to confirm that Cook Brothers Construction accepts your company to carry out the complete {{Trade}} package on the above noted project for the amount of \${{Sum}} ({{Sum_in_Words}}) plus GST.

This engagement is on the basis of the contract conditions as detailed in the Head Contract, Pre-Let Meeting Minutes, Trade Partner Specific Works, drawings and documents.

If any of the above is incorrect or requires clarification, please contact the undersigned as soon as possible.

The attached Trade Partner SSSP (Site Specific Safety Plan) Evaluation form must be completed and returned to our office with your completed SSSP prior to you commencing on site.

Please also take specific note to the following.

Do not undertake Variation works without a written order. Payment will not be made for Variations that are not accompanied by a CBC written order.

All communication with the client or client's representative must firstly go through Cook Brothers Construction's Build Team Manager or Project Manager.

All claims must be emailed to accounts@cookbrothers.co.nz & {{QS_Email}} to be received by the 26th of each month or they will be classed as late. Late claims will be processed the following month.

Yours faithfully,

{{Signature}}

{{QS_Name}}
Quantity Surveyor
Cook Brothers Construction Otago
M: {{QS_Mobile}}
@: {{QS_Email}}`;

/** Settings key holding the global default body template (empty ⇒ use
 *  DEFAULT_LOA_BODY). */
export const LOA_GLOBAL_BODY_KEY = "loa_body_template";
/** Contract Info key holding a project-specific body override (empty ⇒ fall
 *  back to the global template). */
export const LOA_PROJECT_BODY_KEY = "loa_body_override";

export type BodySource = "project" | "global" | "default";

/** Pick the effective body template: a project override wins over the global
 *  Settings template, which wins over the built-in default. */
export function resolveBodyTemplate(
  contractInfo: Record<string, string>,
  settings: Record<string, string>,
): { body: string; source: BodySource } {
  const projectOverride = (contractInfo[LOA_PROJECT_BODY_KEY] ?? "").trim();
  if (projectOverride) return { body: contractInfo[LOA_PROJECT_BODY_KEY], source: "project" };
  const global = (settings[LOA_GLOBAL_BODY_KEY] ?? "").trim();
  if (global) return { body: settings[LOA_GLOBAL_BODY_KEY], source: "global" };
  return { body: DEFAULT_LOA_BODY, source: "default" };
}

/** Resolved merge values for one subcontractor's letter. */
export interface LetterValues {
  Date: string;
  Tradepartner: string;
  TP_Address_1: string;
  TP_Address_2: string;
  TP_Address_3: string;
  TP_City: string;
  Project_Name: string;
  Trade: string;
  Sum: string;
  Sum_in_Words: string;
  QS_Name: string;
  QS_Email: string;
  QS_Mobile: string;
  /** Base64 PNG data URL of the QS's signature, or null if none uploaded. */
  signaturePng: string | null;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Sum a subcontractor's grid numbers the way the grid's Contract Value column
 *  does: Original Tendered Price + Item 1 + Item 2 (SUBTOTAL of H, J, L). */
function contractValue(grid: Record<string, string>): number {
  const num = (k: string) => {
    const v = parseFloat((grid[k] ?? "").replace(/,/g, ""));
    return Number.isFinite(v) ? v : 0;
  };
  return num("H_original_tendered_price") + num("J_item1_value") + num("L_item2_value");
}

/** Format a number as a NZD money figure without the leading $ (e.g. 1234.5 →
 *  "1,234.50"). The template supplies the "$" before {{Sum}}. */
export function formatMoney(n: number): string {
  return n.toLocaleString("en-NZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty",
  "Ninety",
];
const SCALES = ["", "Thousand", "Million", "Billion"];

function threeDigitsToWords(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) {
    if (parts.length) parts.push("and");
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const t = TENS[Math.floor(rest / 10)];
      const o = rest % 10;
      parts.push(o ? `${t} ${ONES[o]}` : t);
    }
  }
  return parts.join(" ");
}

function integerToWords(n: number): string {
  if (n === 0) return "Zero";
  const groups: number[] = [];
  let remaining = n;
  while (remaining > 0) {
    groups.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    const chunk = threeDigitsToWords(groups[i]);
    words.push(SCALES[i] ? `${chunk} ${SCALES[i]}` : chunk);
  }
  return words.join(" ");
}

/** NZD amount → words, e.g. 123456.5 → "One Hundred and Twenty Three Thousand
 *  Four Hundred and Fifty Six Dollars and Fifty Cents". */
export function amountToWords(amount: number): string {
  const dollars = Math.floor(amount);
  const cents = Math.round((amount - dollars) * 100);
  const dollarWords = `${integerToWords(dollars)} ${dollars === 1 ? "Dollar" : "Dollars"}`;
  if (cents === 0) return dollarWords;
  const centWords = `${integerToWords(cents)} ${cents === 1 ? "Cent" : "Cents"}`;
  return `${dollarWords} and ${centWords}`;
}

/** Today's date formatted like the template's "28 June 2021". */
export function formatLetterDate(d = new Date()): string {
  return d.toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Resolve every merge value for one subcontractor's letter. */
export function resolveLetterValues({
  project,
  sub,
  grid,
  contractInfo,
  tpCompanies,
  qsStaff,
}: {
  project: Project;
  sub: Subcontractor;
  grid: Record<string, string>;
  contractInfo: Record<string, string>;
  tpCompanies: TpCompany[];
  qsStaff: StaffMember[];
}): LetterValues {
  // TP Companies is matched on the same key the grid uses: the subcontractor's
  // name against the company's `company` field.
  const tp = tpCompanies.find((c) => norm(c.company) === norm(sub.name)) ?? null;

  // The Contract Info "Quantity Surveyor" answer is a staff member's name;
  // look up their contact details + signature in the QS directory.
  const qsName = (contractInfo.quantity_surveyor ?? "").trim();
  const qs = qsStaff.find((m) => norm(m.name) === norm(qsName)) ?? null;

  const value = contractValue(grid);

  // The grid's per-sub "Letter of Award Date" (column F) wins if set; else today.
  const dateRaw = (grid.F_letter_of_award_date ?? "").trim();

  return {
    Date: dateRaw || formatLetterDate(),
    Tradepartner: sub.name,
    TP_Address_1: tp?.address_1 ?? "",
    TP_Address_2: tp?.address_2 ?? "",
    TP_Address_3: tp?.address_3 ?? "",
    TP_City: tp?.city ?? "",
    Project_Name: (contractInfo.project_name || project.name || "").trim(),
    Trade: (grid.A_trade ?? "").trim(),
    Sum: formatMoney(value),
    Sum_in_Words: amountToWords(value),
    QS_Name: qs?.name ?? qsName,
    QS_Email: qs?.email ?? "",
    QS_Mobile: qs?.mobile ?? "",
    signaturePng: qs?.signature_png ?? null,
  };
}

/** Substitute every {{placeholder}} in the body EXCEPT {{Signature}}, which the
 *  PDF renderer handles as an image. Returns the body with text merged in. */
export function substituteBody(template: string, values: LetterValues): string {
  const map: Record<string, string> = {
    "{{Date}}": values.Date,
    "{{Tradepartner}}": values.Tradepartner,
    "{{TP_Address_1}}": values.TP_Address_1,
    "{{TP_Address_2}}": values.TP_Address_2,
    "{{TP_Address_3}}": values.TP_Address_3,
    "{{TP_City}}": values.TP_City,
    "{{Project_Name}}": values.Project_Name,
    "{{Trade}}": values.Trade,
    "{{Sum}}": values.Sum,
    "{{Sum_in_Words}}": values.Sum_in_Words,
    "{{QS_Name}}": values.QS_Name,
    "{{QS_Email}}": values.QS_Email,
    "{{QS_Mobile}}": values.QS_Mobile,
  };
  return template.replace(
    /\{\{(Date|Tradepartner|TP_Address_1|TP_Address_2|TP_Address_3|TP_City|Project_Name|Trade|Sum|Sum_in_Words|QS_Name|QS_Email|QS_Mobile)\}\}/g,
    (m) => map[m] ?? m,
  );
}
