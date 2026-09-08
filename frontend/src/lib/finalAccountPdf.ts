// Renders an "Agreed Final Account Statement" to PDF with pdf-lib, reproducing
// the Word template faithfully. The page is divided into four sections:
//   1. CONTRACT / BETWEEN / AND / FOR header - labels left, values right.
//   2. The editable statement paragraphs - fully justified.
//   3. The adjusted-value block (Original + Variations = Final Adjusted).
//   4. The two-column Subcontractor / Main Contractor signature grid.
// Section 4 floats to the bottom (above the footer); sections 1-3 are evenly
// distributed through the vertical space between the title and section 4.
//
// Only the section-2 paragraphs come from the editable body; everything else is
// fixed structure. Merge values are shared with the Letter of Award
// (see ./letterOfAward.ts).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import letterheadUrl from "../assets/letterhead.jpg";
import { substituteBody, type LetterValues } from "./letterOfAward";

// A4 in points.
const PAGE_W = 595.28;
const PAGE_H = 841.89;

const ML = 60;
const MR = 60;
const RIGHT = PAGE_W - MR;
const CONTENT_W = PAGE_W - ML - MR;

const NAVY = rgb(0.063, 0.153, 0.278);
const TEXT_COLOR = rgb(0.13, 0.13, 0.13);
const LINE_COLOR = rgb(0.5, 0.5, 0.5);

// Two-column signature grid geometry.
const COL_L = ML;
const COL_R = ML + CONTENT_W / 2 + 10;
const COL_W = CONTENT_W / 2 - 10;

// Vertical rhythm.
const TITLE_SIZE = 17;
const HEADER_SIZE = 10.5;
const HEADER_ADV = HEADER_SIZE + 6;
const PARA_SIZE = 10.5;
const PARA_ADV = PARA_SIZE + 3;
const PARA_GAP = 7;
const VALUE_SIZE = 10.5;
const VALUE_ADV = VALUE_SIZE + 6;
const GST_SIZE = 9;
const GRID_LABEL_SIZE = 10;
const GRID_ROW_ADV = GRID_LABEL_SIZE + 10;
// Extra room around the (first) signature row so a signature image isn't
// cramped against the header above or the name line below.
const SIG_GAP_BEFORE = 16;
const SIG_ROW_ADV = GRID_ROW_ADV + 16;
const SIG_IMG_H = 30;
// Lowest y the flowing content may occupy (keeps clear of the footer band).
const FOOTER_CLEARANCE = 96;

// Height of section 4, computed from the same advances used to draw it.
const SECTION4_HEIGHT =
  HEADER_SIZE + 12 + // "Signed for and on behalf of:"
  HEADER_SIZE + 10 + // column headers
  SIG_GAP_BEFORE + // extra space above the signature line
  SIG_ROW_ADV + // Signature row (taller)
  4 * GRID_ROW_ADV + // Name/Address/Title/Date rows
  4 + // gap before "Witnessed by:"
  HEADER_SIZE + 12 + // "Witnessed by:"
  2 * GRID_ROW_ADV; // Signature/Name rows

const FOOTER_BRANCHES: string[][] = [
  ["Auckland Central", "159 Nelson Street", "Auckland", "09 358 1850"],
  ["Canterbury", "475 Memorial Ave", "Christchurch", "03 385 0941"],
  ["Southern Lakes", "7/70 Glenda Drive", "Queenstown", "03 451 1123"],
  ["Otago", "6 Hanover Street", "Dunedin", "03 474 1736"],
];

let cachedLetterhead: ArrayBuffer | null = null;
async function loadLetterhead(): Promise<ArrayBuffer> {
  if (cachedLetterhead) return cachedLetterhead.slice(0);
  const buf = await fetch(letterheadUrl).then((r) => r.arrayBuffer());
  cachedLetterhead = buf;
  return buf.slice(0);
}

// The Standard-14 fonts only encode WinAnsi; fold common "smart" punctuation to
// ASCII so user-typed paragraphs don't throw at draw time.
function sanitize(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/\t/g, "    ");
}

// Greedily wrap a single logical line to fit `maxWidth`.
function wrapLine(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (text === "") return [""];
  const words = text.split(/ /);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || current === "") {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function embedDataUrl(pdf: PDFDocument, dataUrl: string): Promise<PDFImage | null> {
  const match = /^data:(image\/(png|jpe?g));base64,(.*)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const isPng = match[2].toLowerCase() === "png";
  const bytes = Uint8Array.from(atob(match[3]), (c) => c.charCodeAt(0));
  return isPng ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
}

/** Resolved money figures for the value block (already formatted, no "$"). */
export interface FinalAccountMoney {
  /** Original contract value (grid subtotal). */
  original: string;
  /** User-entered variations total; "" leaves the line blank. */
  variations: string;
  /** Original + variations. */
  finalAdjusted: string;
}

/**
 * Render a Final Account statement to PDF bytes.
 * @param body   the editable statement paragraphs (blank-line separated). May
 *               contain {{placeholders}} (merged, except {{Signature}}).
 * @param values resolved merge values for this subcontractor.
 * @param money  the value-block figures (original / variations / final).
 */
export async function renderFinalAccount(
  body: string,
  values: LetterValues,
  money: FinalAccountMoney,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ital = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const bg = await pdf.embedJpg(await loadLetterhead());
  const signature = values.signaturePng ? await embedDataUrl(pdf, values.signaturePng) : null;

  const page = pdf.addPage([PAGE_W, PAGE_H]);
  page.drawImage(bg, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });

  // Footer branch addresses (from the template's Word footer), spread across the
  // full content width in equal slots with symmetric per-column alignment: the
  // first column left-justified (flush to the left margin), the last column
  // right-justified (flush to the right margin), and the middle columns centred
  // in their slots.
  const footSize = 7.5;
  const footN = FOOTER_BRANCHES.length;
  const footSlot = CONTENT_W / footN;
  FOOTER_BRANCHES.forEach((lines, col) => {
    lines.forEach((line, i) => {
      const f = i === 0 ? bold : font;
      const w = f.widthOfTextAtSize(line, footSize);
      let x: number;
      if (col === 0) x = ML; // left-justified
      else if (col === footN - 1) x = RIGHT - w; // right-justified
      else x = ML + (col + 0.5) * footSlot - w / 2; // centred
      page.drawText(line, { x, y: 64 - i * 9.5, size: footSize, font: f, color: NAVY });
    });
  });

  let y = PAGE_H - 96;

  // --- Title (centred, two lines) ---
  for (const t of ["SUBCONTRACTOR", "AGREED FINAL ACCOUNT STATEMENT"]) {
    page.drawText(t, {
      x: (PAGE_W - bold.widthOfTextAtSize(t, TITLE_SIZE)) / 2,
      y,
      size: TITLE_SIZE,
      font: bold,
      color: NAVY,
    });
    y -= TITLE_SIZE + 3;
  }
  y -= 12;
  const titleBottom = y;

  // ---- Pre-wrap section 2 so we can measure its height for distribution ----
  const merged = sanitize(substituteBody(body, values));
  const paragraphs = merged
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
  const wrapped = paragraphs.map((p) => wrapLine(p, font, PARA_SIZE, CONTENT_W));

  // Section heights.
  const h1 = 4 * HEADER_ADV + 2; // 4 header rows + the small gap after CONTRACT
  const h2 =
    wrapped.reduce((sum, lines) => sum + lines.length * PARA_ADV, 0) +
    Math.max(0, wrapped.length - 1) * PARA_GAP;
  const h3 = 3 * VALUE_ADV + GST_SIZE; // 3 value rows + "All figures exclude GST"

  // Section 4 floats at the bottom; its first baseline sits SECTION4_HEIGHT
  // above the footer clearance line.
  const section4Top = FOOTER_CLEARANCE + SECTION4_HEIGHT;
  // Even gaps: before S1, between S1-S2, between S2-S3, after S3 (→ section 4).
  const span = titleBottom - section4Top;
  const gap = Math.max(6, (span - (h1 + h2 + h3)) / 4);

  // --- Section 1: header rows (label left, value right-justified) ---
  y = titleBottom - gap;
  const headerRow = (label: string, value: string, suffix?: string) => {
    page.drawText(label, { x: ML, y, size: HEADER_SIZE, font: bold, color: TEXT_COLOR });
    const v = sanitize(value);
    const vW = font.widthOfTextAtSize(v, HEADER_SIZE);
    if (suffix) {
      const iW = ital.widthOfTextAtSize(suffix, HEADER_SIZE);
      const startX = RIGHT - (vW + 6 + iW);
      page.drawText(v, { x: startX, y, size: HEADER_SIZE, font, color: TEXT_COLOR });
      page.drawText(suffix, { x: startX + vW + 6, y, size: HEADER_SIZE, font: ital, color: TEXT_COLOR });
    } else {
      page.drawText(v, { x: RIGHT - vW, y, size: HEADER_SIZE, font, color: TEXT_COLOR });
    }
    y -= HEADER_ADV;
  };
  headerRow("CONTRACT:", values.Project_Name);
  y -= 2;
  headerRow("BETWEEN:", "Cook Brothers Construction Limited", "(Main Contractor)");
  headerRow("AND:", values.Tradepartner, "(Sub Contractor)");
  headerRow("FOR:", values.Trade);

  // --- Section 2: statement paragraphs, fully justified ---
  y = titleBottom - gap - h1 - gap;
  const spaceW = font.widthOfTextAtSize(" ", PARA_SIZE);
  wrapped.forEach((lines, pi) => {
    lines.forEach((line, li) => {
      const isLast = li === lines.length - 1;
      const words = line.split(" ");
      if (isLast || words.length < 2) {
        page.drawText(line, { x: ML, y, size: PARA_SIZE, font, color: TEXT_COLOR });
      } else {
        const naturalW = font.widthOfTextAtSize(line, PARA_SIZE);
        const extraPerGap = (CONTENT_W - naturalW) / (words.length - 1);
        let x = ML;
        words.forEach((w, wi) => {
          page.drawText(w, { x, y, size: PARA_SIZE, font, color: TEXT_COLOR });
          x += font.widthOfTextAtSize(w, PARA_SIZE) + spaceW + (wi < words.length - 1 ? extraPerGap : 0);
        });
      }
      y -= PARA_ADV;
    });
    if (pi < wrapped.length - 1) y -= PARA_GAP;
  });

  // --- Section 3: adjusted-value block ---
  y = titleBottom - gap - h1 - gap - h2 - gap;
  const valueRow = (label: string, value: string, isBold = false) => {
    const f = isBold ? bold : font;
    page.drawText(label, { x: ML, y, size: VALUE_SIZE, font: f, color: TEXT_COLOR });
    const v = sanitize(value);
    const vx = RIGHT - font.widthOfTextAtSize(v, VALUE_SIZE);
    const startX = ML + f.widthOfTextAtSize(label, VALUE_SIZE) + 6;
    const endX = vx - 6;
    const dotW = font.widthOfTextAtSize(".", VALUE_SIZE);
    if (endX > startX && dotW > 0) {
      page.drawText(".".repeat(Math.floor((endX - startX) / dotW)), {
        x: startX,
        y,
        size: VALUE_SIZE,
        font,
        color: LINE_COLOR,
      });
    }
    page.drawText(v, { x: vx, y, size: VALUE_SIZE, font: f, color: TEXT_COLOR });
    y -= VALUE_ADV;
  };
  valueRow("Original Contract Value:", `$${money.original}`);
  valueRow("Plus Variations:", money.variations ? `$${money.variations}` : "$");
  valueRow("FINAL ADJUSTED CONTRACT VALUE:", `$${money.finalAdjusted}`, true);
  page.drawText("All figures exclude GST", { x: ML, y, size: GST_SIZE, font: ital, color: TEXT_COLOR });

  // --- Section 4: signature grid, floated to the bottom ---
  y = section4Top;
  page.drawText("Signed for and on behalf of:", { x: ML, y, size: HEADER_SIZE, font: ital, color: TEXT_COLOR });
  y -= HEADER_SIZE + 12;

  const twoColHeader = (l: string, r: string) => {
    page.drawText(l, { x: COL_L, y, size: HEADER_SIZE, font: bold, color: TEXT_COLOR });
    page.drawText(r, { x: COL_R, y, size: HEADER_SIZE, font: bold, color: TEXT_COLOR });
    y -= HEADER_SIZE + 10;
  };
  const fieldLine = (
    x: number,
    label: string,
    value?: string,
    sigImage?: PDFImage | null,
    sigHeight = SIG_IMG_H,
  ) => {
    const s = GRID_LABEL_SIZE;
    page.drawText(label, { x, y, size: s, font, color: TEXT_COLOR });
    const lx = x + font.widthOfTextAtSize(label, s) + 4;
    const endX = x + COL_W;
    page.drawLine({ start: { x: lx, y: y - 1 }, end: { x: endX, y: y - 1 }, thickness: 0.5, color: LINE_COLOR });
    if (sigImage) {
      const w = Math.min(sigImage.width * (sigHeight / sigImage.height), endX - lx - 4);
      page.drawImage(sigImage, { x: lx + 2, y: y + 1, width: w, height: sigHeight });
    } else if (value) {
      page.drawText(sanitize(value), { x: lx + 2, y: y + 1, size: s, font, color: TEXT_COLOR });
    }
  };
  const twoColRow = (
    lLabel: string,
    rLabel: string,
    opts: { lVal?: string; rVal?: string } = {},
  ) => {
    if (lLabel) fieldLine(COL_L, lLabel, opts.lVal);
    if (rLabel) fieldLine(COL_R, rLabel, opts.rVal);
    y -= GRID_ROW_ADV;
  };

  twoColHeader("Subcontractor:", "Main Contractor:");
  // Signature row, given extra vertical space for a signature image.
  y -= SIG_GAP_BEFORE;
  fieldLine(COL_L, "Signature:");
  fieldLine(COL_R, "Signature:", undefined, signature);
  y -= SIG_ROW_ADV;
  twoColRow("Name:", "Name:", { rVal: values.QS_Name });
  twoColRow("Address:", "Title:", { rVal: "Quantity Surveyor" });
  twoColRow("Title:", "Date:", { rVal: values.Date });
  twoColRow("Date:", "");
  y -= 4;

  page.drawText("Witnessed by:", { x: ML, y, size: HEADER_SIZE, font: ital, color: TEXT_COLOR });
  y -= HEADER_SIZE + 12;
  twoColRow("Signature:", "Signature:");
  twoColRow("Name:", "Name:");

  return pdf.save();
}
