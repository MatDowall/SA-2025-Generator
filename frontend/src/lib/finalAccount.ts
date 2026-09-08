// Final Account (Agreed Final Account Statement) - body template and settings
// keys. The statement is one document per subcontractor and reuses the exact
// same merge values, value resolution and PDF renderer as the Letter of Award
// (see ./letterOfAward.ts and ./loaPdf.ts); only the default body text and the
// Settings/Contract-Info keys differ.
import { LOA_PLACEHOLDERS, formatMoney } from "./letterOfAward";
import type { FinalAccountMoney } from "./finalAccountPdf";

/** Placeholders the Final Account body may contain. The same token set the
 *  Letter of Award uses, so the shared value resolver / substituter apply
 *  unchanged. `{{Signature}}` is replaced by the QS's signature image. */
export const FA_PLACEHOLDERS = LOA_PLACEHOLDERS;

/** The editable statement paragraphs (blank-line separated) shown between the
 *  fixed CONTRACT/BETWEEN/AND/FOR header and the value/signature blocks. Ported
 *  from the supplied "Final Account Letter 2026" Word template. The title,
 *  header, adjusted-value block and two-column signature grid are fixed
 *  structure drawn by the renderer (see ./finalAccountPdf.ts) and are NOT part
 *  of this editable text. Placeholders are supported but this default text has
 *  none. Used when neither the project override nor the global Settings
 *  template is set. */
export const DEFAULT_FA_BODY = `I/We being the subcontractor for the work and services described above, do hereby confirm that the statement below sets out the agreed final adjusted subcontract value, which represents the full and final settlement of all current and future claims against Cook Brothers Construction Limited in relation to this project, with the exception of any variations instructed and carried out after the date of this agreed final account statement.

We verify that all payments of wages and materials including any payments or liabilities to our subcontractors, together with all statutory and legal obligations, have been satisfied in full.

We hereby indemnify Cook Brothers Construction Limited for any claims, costs, losses, other charges or liabilities that may be incurred by Cook Brothers Construction Limited arising directly or indirectly out of or in connection with our work on the above contract.`;

/** Settings key holding the global default body template (empty ⇒ use
 *  DEFAULT_FA_BODY). */
export const FA_GLOBAL_BODY_KEY = "fa_body_template";
/** Contract Info key holding a project-specific body override (empty ⇒ fall
 *  back to the global template). */
export const FA_PROJECT_BODY_KEY = "fa_body_override";

/** Per-subcontractor grid key holding the user-entered "Plus Variations" total
 *  (a raw number string, e.g. "12500" or "12,500.00"). */
export const FA_VARIATIONS_KEY = "fa_plus_variations";

/** Parse a money-ish string ("12,500.50", "$12500") to a number, or 0. */
export function parseMoney(s: string): number {
  const v = parseFloat((s ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(v) ? v : 0;
}

/** Compute the value-block figures from the original contract sum (already
 *  formatted, e.g. "125,400.00") and the raw variations input. Final Adjusted =
 *  original + variations. `variations` is "" when the input is blank, leaving
 *  that PDF line empty. */
export function computeFinalAccountMoney(
  originalFormatted: string,
  variationsRaw: string,
): FinalAccountMoney {
  const original = parseMoney(originalFormatted);
  const hasVariations = (variationsRaw ?? "").trim() !== "";
  const variations = parseMoney(variationsRaw);
  return {
    original: formatMoney(original),
    variations: hasVariations ? formatMoney(variations) : "",
    finalAdjusted: formatMoney(original + (hasVariations ? variations : 0)),
  };
}
