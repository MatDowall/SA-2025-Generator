// Global default values for SA-2025 form fields, set in Settings and applied to
// every project. Stored as a single settings row (a JSON object keyed by
// AcroForm field name). Defaults act as a *fallback*: the mapping pipeline's
// computed value (from Contract Info / Subcontractor Details) always wins when
// it produces something; the default only fills a field the project leaves
// blank. See useMappingRecompute, which injects these after buildMapping.
import { MAPPING_COLUMNS } from "./mappingFormulas";

export const SA_FIELD_DEFAULTS_KEY = "sa_field_defaults";

/** Field names the mapping pipeline computes (and therefore overrides a default
 *  for whenever it yields a non-empty value). */
export const MAPPED_FIELD_NAMES: ReadonlySet<string> = new Set(
  MAPPING_COLUMNS.map((c) => c.fieldName),
);

/** Parse the stored JSON map, tolerating absent/corrupt values. Blank entries
 *  are dropped so an emptied default doesn't linger. */
export function parseFieldDefaults(json: string | undefined): Record<string, string> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    if (!v || typeof v !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const s = val == null ? "" : String(val);
      if (s !== "") out[k] = s;
    }
    return out;
  } catch {
    return {};
  }
}

/** Merge global defaults into one subcontractor's computed field map, filling
 *  only fields the mapping left empty/absent. Returns a new object. */
export function applyFieldDefaults(
  mapped: Record<string, string>,
  defaults: Record<string, string>,
): Record<string, string> {
  const out = { ...mapped };
  for (const [field, value] of Object.entries(defaults)) {
    if (value && !out[field]) out[field] = value;
  }
  return out;
}

/** Turn an AcroForm field name into a human label ("Contractor_Address_1" →
 *  "Contractor Address 1"). */
export function humanizeFieldName(name: string): string {
  return name.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}
