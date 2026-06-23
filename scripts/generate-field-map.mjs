// Generates src-tauri/resources/field-map.json from the SA-2025 template PDF.
// The template's AcroForm field names are the SINGLE SOURCE OF TRUTH for the app.
// Run: node scripts/generate-field-map.mjs
//
// Output schema:
// {
//   "generatedFrom": "SA-2025-Template.pdf",
//   "generatedAt": "<iso>",
//   "pageCount": 52,
//   "dataPageLimit": 10,          // only pages 1..10 carry data fields
//   "fields": [
//     { "name", "type": "text|checkbox|radio|dropdown|signature",
//       "page": <1-based>, "options"?: [...], "onState"?: "/On" }
//   ]
// }

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString } from "pdf-lib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TEMPLATE = resolve(ROOT, "src-tauri/resources/SA-2025-Template.pdf");
const OUT = resolve(ROOT, "src-tauri/resources/field-map.json");
const DATA_PAGE_LIMIT = 10;

function classify(field) {
  const t = field.constructor.name; // PDFTextField, PDFCheckBox, ...
  switch (t) {
    case "PDFTextField": return "text";
    case "PDFCheckBox": return "checkbox";
    case "PDFRadioGroup": return "radio";
    case "PDFDropdown": return "dropdown";
    case "PDFOptionList": return "dropdown";
    case "PDFSignature": return "signature";
    default: return "text";
  }
}

function decodeName(obj) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  return null;
}

// Resolve the fully-qualified field name of a widget dict by climbing /Parent
// and joining /T segments (matches AcroForm fully-qualified naming).
function widgetFieldName(dict) {
  const segments = [];
  let node = dict;
  const seen = new Set();
  while (node instanceof PDFDict) {
    const t = decodeName(node.lookupMaybe(PDFName.of("T"), PDFString, PDFHexString));
    if (t) segments.unshift(t);
    const parent = node.get(PDFName.of("Parent"));
    const parentObj = parent ? node.context.lookup(parent) : undefined;
    if (!(parentObj instanceof PDFDict) || seen.has(parentObj)) break;
    seen.add(parentObj);
    node = parentObj;
  }
  return segments.length ? segments.join(".") : null;
}

// Build name -> lowest 1-based page number, by scanning each page's widget
// annotations. A field may have widgets on many pages (repeated initials); we
// keep the lowest page it appears on.
function buildPageByName(pdfDoc) {
  const pageByName = new Map();
  pdfDoc.getPages().forEach((page, i) => {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) return;
    for (let a = 0; a < annots.size(); a++) {
      const dict = page.node.context.lookup(annots.get(a));
      if (!(dict instanceof PDFDict)) continue;
      const name = widgetFieldName(dict);
      if (!name) continue;
      const pg = i + 1;
      const prev = pageByName.get(name);
      if (prev === undefined || pg < prev) pageByName.set(name, pg);
    }
  });
  return pageByName;
}

async function main() {
  const bytes = await readFile(TEMPLATE);
  const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  const form = pdfDoc.getForm();
  const pageByName = buildPageByName(pdfDoc);

  const fields = [];
  for (const field of form.getFields()) {
    const name = field.getName();
    const type = classify(field);
    const page = pageByName.get(name) ?? null;
    const entry = { name, type, page };

    if (type === "dropdown" && typeof field.getOptions === "function") {
      entry.options = field.getOptions();
    }
    if (type === "checkbox" || type === "radio") {
      // On-state export value(s) for filling.
      try {
        const states = field.acroField
          .getOnValues()
          .map((s) => s.asString?.() ?? String(s));
        entry.onStates = states;
      } catch { /* ignore */ }
    }
    fields.push(entry);
  }

  fields.sort((a, b) => (a.page ?? 999) - (b.page ?? 999) || a.name.localeCompare(b.name));

  const out = {
    generatedFrom: "SA-2025-Template.pdf",
    generatedAt: new Date().toISOString(),
    pageCount: pdfDoc.getPageCount(),
    dataPageLimit: DATA_PAGE_LIMIT,
    fields,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");

  const dataFields = fields.filter((f) => f.page && f.page <= DATA_PAGE_LIMIT);
  console.log(`Wrote ${OUT}`);
  console.log(`Total fields: ${fields.length}, data fields (pages 1-${DATA_PAGE_LIMIT}): ${dataFields.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
