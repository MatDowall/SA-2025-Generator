// Global, user-editable templates for the subject and body of the email draft
// produced by the "Email" buttons (Subcontract Agreement + Letter of Award).
// Stored as scalar settings (like the Letter of Award default body), rendered
// by substituting {{...}} placeholders at send time.
import { api } from "../api";

export const EMAIL_SUBJECT_KEY = "email_subject_template";
export const EMAIL_BODY_KEY = "email_body_template";

export const DEFAULT_EMAIL_SUBJECT =
  "{{Project_Number}} {{Project_Name}} - {{Document}} - {{Subcontractor}}";

export const DEFAULT_EMAIL_BODY =
  "Hi,\n\n" +
  "Please find attached the {{Document}} for {{Subcontractor}} on " +
  "{{Project_Name}} ({{Project_Number}}).\n\n" +
  "Kind regards";

// Clickable palette shown in the Settings editor.
export const EMAIL_PLACEHOLDERS: { token: string; label: string }[] = [
  { token: "{{Document}}", label: "Document type (Subcontract Agreement / Letter of Award)" },
  { token: "{{Subcontractor}}", label: "Subcontractor name" },
  { token: "{{Project_Name}}", label: "Project name" },
  { token: "{{Project_Number}}", label: "Project number" },
];

export interface EmailTokens {
  Document: string;
  Subcontractor: string;
  Project_Name: string;
  Project_Number: string;
}

/** Substitute {{...}} placeholders in a subject/body template. */
export function renderEmailTemplate(template: string, tokens: EmailTokens): string {
  return template.replace(
    /\{\{(Document|Subcontractor|Project_Name|Project_Number)\}\}/g,
    (_m, key: keyof EmailTokens) => tokens[key] ?? "",
  );
}

/** The effective subject/body templates (stored global values, or the built-in
 *  defaults when unset). */
export async function loadEmailTemplates(): Promise<{ subject: string; body: string }> {
  const s = await api.getSettings();
  return {
    subject: (s[EMAIL_SUBJECT_KEY] ?? "").trim() || DEFAULT_EMAIL_SUBJECT,
    body: (s[EMAIL_BODY_KEY] ?? "").trim() || DEFAULT_EMAIL_BODY,
  };
}
