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
  importProjectCsv: (projectId: number, path: string) =>
    invoke<ImportResult>("import_project_csv", { projectId, path }),

  getTemplatePdf: () => invoke<ArrayBuffer>("get_template_pdf"),
  writeBinaryFile: (path: string, contents: number[]) =>
    invoke<void>("write_binary_file", { path, contents }),

  exportProjectFile: (projectId: number, path: string) =>
    invoke<void>("export_project_file", { projectId, path }),
  importProjectFile: (path: string) =>
    invoke<Project>("import_project_file", { path }),
  getLaunchFile: () => invoke<string | null>("get_launch_file"),
};

export interface ImportReport {
  columns: string[];
  recognised: string[];
  unknown: string[];
  has_id_column: boolean;
  row_count: number;
}

export interface ImportResult {
  created: number;
  updated: number;
  fields_set: number;
  unknown_columns: string[];
}
