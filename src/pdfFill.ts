// Fills the template PDF's AcroForm with a subcontractor's values using pdf-lib.
// pdf-lib regenerates field appearance streams, so values render in every
// viewer; `flatten` bakes them in and removes the editable fields.
import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
} from "pdf-lib";

// Case-insensitive match against a field's option list → its canonical value
// (CSV imports may store e.g. "yes" where the PDF expects "Yes").
function canonical(options: string[], value: string): string | undefined {
  return options.find((o) => o.toLowerCase() === value.toLowerCase());
}

export async function fillTemplate(
  templateBytes: ArrayBuffer,
  values: Record<string, string>,
  flatten: boolean,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(templateBytes);
  const form = doc.getForm();
  const byName = new Map(form.getFields().map((f) => [f.getName(), f]));

  for (const [name, raw] of Object.entries(values)) {
    const field = byName.get(name);
    if (!field || raw == null || raw === "") continue;
    try {
      if (field instanceof PDFTextField) {
        field.setText(raw);
      } else if (field instanceof PDFCheckBox) {
        field.check();
      } else if (field instanceof PDFRadioGroup) {
        const m = canonical(field.getOptions(), raw);
        if (m) field.select(m);
      } else if (field instanceof PDFDropdown) {
        const m = canonical(field.getOptions(), raw);
        if (m) field.select(m);
      } else if (field instanceof PDFOptionList) {
        const m = canonical(field.getOptions(), raw);
        if (m) field.select(m);
      }
    } catch {
      // Skip any individual field that won't accept the value.
    }
  }

  if (flatten) {
    try {
      form.flatten();
    } catch {
      // If flattening fails, fall back to a filled-but-fillable document.
    }
  }

  return doc.save();
}
