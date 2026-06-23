// Typed access to the generated field-map.json (the template AcroForm field
// names are the single source of truth). Loaded from the Rust backend, which
// reads the bundled resource.
import { invoke } from "@tauri-apps/api/core";

export type FieldType =
  | "text"
  | "checkbox"
  | "radio"
  | "dropdown"
  | "signature";

export interface FieldDef {
  name: string;
  type: FieldType;
  page: number | null;
  options?: string[];
  onStates?: string[];
}

export interface FieldMap {
  generatedFrom: string;
  generatedAt: string;
  pageCount: number;
  dataPageLimit: number;
  fields: FieldDef[];
}

let cache: FieldMap | null = null;

export async function loadFieldMap(): Promise<FieldMap> {
  if (cache) return cache;
  const raw = await invoke<string>("get_field_map");
  cache = JSON.parse(raw) as FieldMap;
  return cache;
}

/** Fields that actually carry data — pages 1..dataPageLimit only. */
export function dataFields(map: FieldMap): FieldDef[] {
  return map.fields.filter((f) => f.page != null && f.page <= map.dataPageLimit);
}
