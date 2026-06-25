// Typed wrappers around the Rust project/subcontractor commands.
import { invoke } from "@tauri-apps/api/core";

export interface Project {
  id: number;
  name: string;
  project_number: string;
}

export interface Subcontractor {
  id: number;
  project_id: number;
  name: string;
  ordering: number;
}

export const api = {
  createProject: (name: string, projectNumber: string) =>
    invoke<Project>("create_project", { name, projectNumber }),
  listProjects: () => invoke<Project[]>("list_projects"),
  renameProject: (id: number, name: string, projectNumber: string) =>
    invoke<void>("rename_project", { id, name, projectNumber }),
  deleteProject: (id: number) => invoke<void>("delete_project", { id }),

  addSubcontractor: (projectId: number, name: string) =>
    invoke<Subcontractor>("add_subcontractor", { projectId, name }),
  listSubcontractors: (projectId: number) =>
    invoke<Subcontractor[]>("list_subcontractors", { projectId }),
  renameSubcontractor: (id: number, name: string) =>
    invoke<void>("rename_subcontractor", { id, name }),
  deleteSubcontractor: (id: number) =>
    invoke<void>("delete_subcontractor", { id }),

  setLastProject: (id: number | null) =>
    invoke<void>("set_last_project", { id }),
  getLastProject: () => invoke<number | null>("get_last_project"),

  getCsvSelection: (projectId: number) =>
    invoke<string[] | null>("get_csv_selection", { projectId }),
  setCsvSelection: (projectId: number, fields: string[]) =>
    invoke<void>("set_csv_selection", { projectId, fields }),
  exportProjectCsv: (projectId: number, fields: string[], path: string) =>
    invoke<number>("export_project_csv", { projectId, fields, path }),

  getFieldValues: (subcontractorId: number) =>
    invoke<Record<string, string>>("get_field_values", { subcontractorId }),
  setFieldValue: (subcontractorId: number, fieldName: string, value: string) =>
    invoke<void>("set_field_value", { subcontractorId, fieldName, value }),

  analyzeImportCsv: (path: string) =>
    invoke<ImportReport>("analyze_import_csv", { path }),
  parseImportCsv: (path: string) => invoke<ParsedCsv>("parse_import_csv", { path }),

  getTemplatePdf: () => invoke<ArrayBuffer>("get_template_pdf"),
  writeBinaryFile: (path: string, contents: number[]) =>
    invoke<void>("write_binary_file", { path, contents }),

  exportProjectFile: (projectId: number, path: string) =>
    invoke<void>("export_project_file", { projectId, path }),
  importProjectFile: (path: string) =>
    invoke<Project>("import_project_file", { path }),
  getLaunchFile: () => invoke<string | null>("get_launch_file"),

  getContractInfo: (projectId: number) =>
    invoke<Record<string, string>>("get_contract_info", { projectId }),
  setContractInfoValue: (projectId: number, fieldKey: string, value: string) =>
    invoke<void>("set_contract_info_value", { projectId, fieldKey, value }),
  setContractInfoBulk: (projectId: number, values: Record<string, string>) =>
    invoke<void>("set_contract_info_bulk", { projectId, values }),

  getSettings: () => invoke<Record<string, string>>("get_settings"),
  setSetting: (key: string, value: string) =>
    invoke<void>("set_setting", { key, value }),
  listStaff: (role: StaffRole) => invoke<StaffMember[]>("list_staff", { role }),
  upsertStaff: (member: StaffMember) =>
    invoke<StaffMember>("upsert_staff", { member }),
  deleteStaff: (id: number) => invoke<void>("delete_staff", { id }),

  listTpCompanies: () => invoke<TpCompany[]>("list_tp_companies"),
  upsertTpCompany: (company: TpCompany) =>
    invoke<TpCompany>("upsert_tp_company", { company }),
  deleteTpCompany: (id: number) => invoke<void>("delete_tp_company", { id }),
  reorderTpCompanies: (orderedIds: number[]) =>
    invoke<void>("reorder_tp_companies", { orderedIds }),

  getGridValues: (subcontractorId: number) =>
    invoke<Record<string, string>>("get_grid_values", { subcontractorId }),
  setGridValue: (subcontractorId: number, columnKey: string, value: string) =>
    invoke<void>("set_grid_value", { subcontractorId, columnKey, value }),
  getGridValuesForProject: (projectId: number) =>
    invoke<Record<number, Record<string, string>>>("get_grid_values_for_project", {
      projectId,
    }),
  bulkSetGridValues: (subcontractorId: number, values: Record<string, string>) =>
    invoke<void>("bulk_set_grid_values", { subcontractorId, values }),

  bulkSetFieldValues: (subcontractorId: number, values: Record<string, string>) =>
    invoke<void>("bulk_set_field_values", { subcontractorId, values }),
};

export interface TpCompany {
  id: number;
  company: string;
  legal_name_register: string | null;
  nzbn: string | null;
  legal_name_nzbn: string | null;
  address_1: string | null;
  address_2: string | null;
  address_3: string | null;
  city: string | null;
  zip: string | null;
  full_address: string | null;
  business_phone: string | null;
  email: string | null;
  directors: string | null;
  trades: string | null;
  standard_cost_code: string | null;
  ordering: number;
}

export type StaffRole = "PM" | "BTM" | "QS";

export interface StaffMember {
  id: number;
  role: StaffRole;
  name: string;
  mobile: string | null;
  email: string | null;
  ordering: number;
}

export interface ImportReport {
  columns: string[];
  recognised: string[];
  unknown: string[];
  has_id_column: boolean;
  row_count: number;
}

export interface ParsedCsv {
  columns: string[];
  rows: string[][];
}

export interface ImportResult {
  created: number;
  updated: number;
  fields_set: number;
  unknown_columns: string[];
}
