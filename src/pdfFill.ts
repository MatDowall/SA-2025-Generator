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
  PDFFont,
  StandardFonts,
} from "pdf-lib";
import { NUMERIC_FIELD_NAMES, formatNumeric } from "./lib/numericFields";

// Case-insensitive match against a field's option list → its canonical value
// (CSV imports may store e.g. "yes" where the PDF expects "Yes").
function canonical(options: string[], value: string): string | undefined {
  return options.find((o) => o.toLowerCase() === value.toLowerCase());
}

const MAX_FONT_PT = 11;
const MIN_FONT_PT = 4;

// pdf-lib's own auto font-size (fontSize: 0) picks the *largest* size that
// fits the field's box — for a short value like "N/A" in a tall field that
// means it balloons to a huge, jarring size. Pick the largest size up to a
// sane cap that still fits (falling back to ever-smaller sizes only for
// genuinely long values), rather than letting it grow unbounded.
function fitFontSize(text: string, width: number, height: number, font: PDFFont): number {
  if (!text) return MAX_FONT_PT;
  for (let size = MAX_FONT_PT; size >= MIN_FONT_PT; size -= 0.5) {
    const lineHeight = font.heightAtSize(size) * 1.2;
    let lines = 0;
    for (const para of text.split("\n")) {
      if (para === "") {
        lines += 1;
        continue;
      }
      let line = "";
      for (const word of para.split(" ")) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && font.widthOfTextAtSize(candidate, size) > width) {
          lines += 1;
          line = word;
        } else {
          line = candidate;
        }
      }
      lines += 1;
    }
    if (lines * lineHeight <= height) return size;
  }
  return MIN_FONT_PT;
}

export async function fillTemplate(
  templateBytes: ArrayBuffer,
  values: Record<string, string>,
  flatten: boolean,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(templateBytes);
  const form = doc.getForm();
  const byName = new Map(form.getFields().map((f) => [f.getName(), f]));
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const [name, rawValue] of Object.entries(values)) {
    const field = byName.get(name);
    if (!field || rawValue == null || rawValue === "") continue;
    // Monetary/percentage fields are stored as plain numbers (e.g. from the
    // grid's SUBTOTAL formulas) and only get comma-thousands formatting in
    // the live overlay's display layer (FieldOverlay.tsx) — apply the same
    // formatting here so the exported PDF matches what was previewed.
    const raw = NUMERIC_FIELD_NAMES.has(name) ? formatNumeric(rawValue) : rawValue;
    try {
      if (field instanceof PDFTextField) {
        // The template doesn't flag these fields multiline, so pdf-lib's
        // single-line appearance clips any value wider than the field's
        // rect instead of wrapping (the stored value itself is unaffected —
        // this is purely an appearance-stream issue). Force multiline so
        // long values (e.g. "Specific Condition Data" free text) wrap
        // instead of clip, and pick a capped, shrink-as-needed font size
        // ourselves (see fitFontSize) instead of pdf-lib's unbounded auto.
        if (!field.isMultiline()) field.enableMultiline();
        const rect = field.acroField.getWidgets()[0]?.getRectangle();
        const w = Math.max(0, (rect?.width ?? 100) - 4);
        const h = Math.max(0, (rect?.height ?? 20) - 4);
        field.setFontSize(fitFontSize(raw, w, h, font));
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
