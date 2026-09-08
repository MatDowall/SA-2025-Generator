// Renders a Trade Partner "Letter of Award" to PDF with pdf-lib: the Cook
// Brothers letterhead image as a full-page background, the (merged) editable
// body flowed and word-wrapped on top, the QS signature image dropped in at
// the {{Signature}} marker, and the branch-address footer along the bottom.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import letterheadUrl from "../assets/letterhead.jpg";
import { substituteBody, type LetterValues } from "./letterOfAward";

// A4 in points.
const PAGE_W = 595.28;
const PAGE_H = 841.89;

const MARGIN_L = 68;
const MARGIN_R = 68;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
// Start below the navy header band + chevron; stop above the footer block.
const CONTENT_TOP = PAGE_H - 100;
const CONTENT_BOTTOM = 92;

const FONT_SIZE = 10.5;
const LINE_HEIGHT = 13.5;
// A blank line in the template is a paragraph break - a compact gap, not a full
// empty text line, so the letter stays on a single page like the original.
const BLANK_GAP = 8;
const PARA_GAP = 7;
const SIGNATURE_HEIGHT = 44;

const NAVY = rgb(0.063, 0.153, 0.278);
const TEXT_COLOR = rgb(0.13, 0.13, 0.13);

// Branch addresses, from the template's Word footer.
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

// The Standard-14 fonts only encode WinAnsi; user-typed "smart" punctuation
// would otherwise throw at draw time. Fold the common offenders to ASCII.
function sanitize(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/\t/g, "    ");
}

// Greedily wrap a single logical line to fit `maxWidth` at the given font/size.
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

// Embed a base64 data-URL image (PNG or JPEG) into the document.
async function embedDataUrl(pdf: PDFDocument, dataUrl: string): Promise<PDFImage | null> {
  const match = /^data:(image\/(png|jpe?g));base64,(.*)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const isPng = match[2].toLowerCase() === "png";
  const bytes = Uint8Array.from(atob(match[3]), (c) => c.charCodeAt(0));
  return isPng ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
}

// Branch addresses spread across the full content width in equal slots with
// symmetric per-column alignment: first column left-justified (flush to the
// left margin), last column right-justified (flush to the right margin), middle
// columns centred in their slots.
function drawFooter(page: PDFPage, font: PDFFont, fontBold: PDFFont) {
  const n = FOOTER_BRANCHES.length;
  const slot = CONTENT_W / n;
  const right = PAGE_W - MARGIN_R;
  const topY = 64;
  const leading = 9.5;
  const size = 7.5;
  FOOTER_BRANCHES.forEach((lines, col) => {
    lines.forEach((line, i) => {
      const f = i === 0 ? fontBold : font;
      const w = f.widthOfTextAtSize(line, size);
      let x: number;
      if (col === 0) x = MARGIN_L;
      else if (col === n - 1) x = right - w;
      else x = MARGIN_L + (col + 0.5) * slot - w / 2;
      page.drawText(line, { x, y: topY - i * leading, size, font: f, color: NAVY });
    });
  });
}

/**
 * Render a letter to PDF bytes.
 * @param body   the (unmerged) body template - placeholders still present.
 * @param values resolved merge values for this subcontractor.
 */
export async function renderLetterOfAward(
  body: string,
  values: LetterValues,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const bg = await pdf.embedJpg(await loadLetterhead());

  const signature = values.signaturePng
    ? await embedDataUrl(pdf, values.signaturePng)
    : null;

  const newPage = (): PDFPage => {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    page.drawImage(bg, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
    drawFooter(page, font, fontBold);
    return page;
  };

  let page = newPage();
  let y = CONTENT_TOP;

  const ensureSpace = (needed: number) => {
    if (y - needed < CONTENT_BOTTOM) {
      page = newPage();
      y = CONTENT_TOP;
    }
  };

  const merged = sanitize(substituteBody(body, values));
  const logicalLines = merged.split("\n");

  for (const logical of logicalLines) {
    const trimmed = logical.trim();

    // The signature marker → drop the QS's signature image (or leave a gap).
    if (trimmed === "{{Signature}}") {
      if (signature) {
        const scale = SIGNATURE_HEIGHT / signature.height;
        const w = signature.width * scale;
        ensureSpace(SIGNATURE_HEIGHT);
        y -= SIGNATURE_HEIGHT;
        page.drawImage(signature, { x: MARGIN_L, y, width: w, height: SIGNATURE_HEIGHT });
        y -= PARA_GAP;
      } else {
        y -= SIGNATURE_HEIGHT; // preserve spacing where the signature would be
      }
      continue;
    }

    // Blank line → paragraph gap.
    if (trimmed === "") {
      y -= BLANK_GAP;
      continue;
    }

    // Fully justify each wrapped line except the last of a logical line (and
    // single-word lines), so paragraphs have flush left and right edges while
    // addresses, salutations and sign-offs stay naturally left-aligned.
    const wrapped = wrapLine(logical, font, FONT_SIZE, CONTENT_W);
    const spaceW = font.widthOfTextAtSize(" ", FONT_SIZE);
    wrapped.forEach((line, idx) => {
      ensureSpace(LINE_HEIGHT);
      y -= LINE_HEIGHT;
      const words = line.split(" ");
      const isLast = idx === wrapped.length - 1;
      if (!isLast && words.length > 1) {
        const naturalW = font.widthOfTextAtSize(line, FONT_SIZE);
        const extraPerGap = (CONTENT_W - naturalW) / (words.length - 1);
        let x = MARGIN_L;
        words.forEach((w, wi) => {
          page.drawText(w, { x, y, size: FONT_SIZE, font, color: TEXT_COLOR });
          x += font.widthOfTextAtSize(w, FONT_SIZE) + spaceW + (wi < words.length - 1 ? extraPerGap : 0);
        });
      } else {
        page.drawText(line, { x: MARGIN_L, y, size: FONT_SIZE, font, color: TEXT_COLOR });
      }
    });
  }

  return pdf.save();
}
