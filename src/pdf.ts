// pdf.js setup + template loading. The worker is bundled by Vite via the
// ?url import so it works in both dev and the packaged Tauri app.
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { invoke } from "@tauri-apps/api/core";
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
} from "pdfjs-dist";
import { LOCKED_PDF_FIELDS } from "./lib/csvReverseMap";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
export type { PDFDocumentProxy, PDFDocumentLoadingTask };

/**
 * Loads the bundled blank template PDF. Returns the loading task so the caller
 * can both await `.promise` and `.destroy()` it on cleanup.
 */
export async function loadTemplateDocument(): Promise<PDFDocumentLoadingTask> {
  const buf = await invoke<ArrayBuffer>("get_template_pdf");
  // pdf.js takes ownership of the buffer, so hand it a fresh Uint8Array.
  const data = new Uint8Array(buf);
  return pdfjsLib.getDocument({ data });
}

export type FieldKind = "text" | "checkbox" | "radio" | "dropdown" | "signature";

// A form field's position (in scale-1 / point space, top-left origin) and the
// metadata the overlay needs to render an editable control.
export interface FieldBox {
  id: string;
  name: string;
  kind: FieldKind;
  left: number;
  top: number;
  width: number;
  height: number;
  readOnly: boolean;
  multiline?: boolean;
  options?: { value: string; label: string }[];
  exportValue?: string; // checkbox/radio on-state
  /** Font size (pt) from the field's default appearance, as set in the template. */
  fontSize?: number;
}

export interface PageLayout {
  /** Page sizes at scale 1, indexed by page number - 1. */
  sizes: { w: number; h: number }[];
  /** Editable field boxes per page number (data pages only). */
  boxesByPage: Map<number, FieldBox[]>;
}

function kindOf(a: any): FieldKind {
  if (a.fieldType === "Tx") return "text";
  if (a.fieldType === "Ch") return "dropdown";
  if (a.fieldType === "Sig") return "signature";
  if (a.fieldType === "Btn") return a.radioButton ? "radio" : "checkbox";
  return "text";
}

/**
 * Reads page sizes (all pages) and editable field boxes (pages 1..maxDataPage).
 */
export async function getPageLayout(
  doc: PDFDocumentProxy,
  maxDataPage: number,
): Promise<PageLayout> {
  const sizes: { w: number; h: number }[] = [];
  const boxesByPage = new Map<number, FieldBox[]>();

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    sizes.push({ w: vp.width, h: vp.height });

    if (n > maxDataPage) continue;

    const annots = await page.getAnnotations({ intent: "display" });
    const boxes: FieldBox[] = [];
    for (const a of annots) {
      if (a.subtype !== "Widget" || !a.fieldName) continue;
      const kind = kindOf(a);
      if (kind === "signature") continue; // left blank by design

      const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
      boxes.push({
        id: a.id,
        name: a.fieldName,
        kind,
        left: Math.min(x1, x2),
        top: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
        // Fields that mirror a grid dropdown/Subcontractor-name column can
        // only be edited through that constrained control on the
        // Subcontractor Details grid — see LOCKED_PDF_FIELDS.
        readOnly: !!a.readOnly || LOCKED_PDF_FIELDS.has(a.fieldName),
        // The template doesn't flag every long-content field multiline
        // (e.g. "Specific Condition Data" date/notes fields) — treat all
        // text fields as multiline in the overlay too, matching the PDF
        // export fix in pdfFill.ts, so long values wrap and shrink to fit
        // instead of clipping in a single-line input.
        multiline: kind === "text",
        fontSize: a.defaultAppearanceData?.fontSize || undefined,
        options: a.options?.map((o: any) => ({
          value: o.exportValue ?? o.displayValue ?? "",
          label: o.displayValue ?? o.exportValue ?? "",
        })),
        // Checkboxes expose their on-state as `exportValue`; radio widgets use
        // `buttonValue` (each option in the group has its own).
        exportValue: a.exportValue ?? a.buttonValue,
      });
    }
    boxesByPage.set(n, boxes);
  }

  return { sizes, boxesByPage };
}
