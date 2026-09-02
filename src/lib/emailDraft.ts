// Opens the OS default mail client with a ready-to-review *draft* that already
// has the given PDF attached and (where known) the recipient filled in.
//
// There's no SMTP/mail integration in the app - instead we generate an RFC 822
// `.eml` file with the PDF as a base64 MIME attachment and open it with the
// platform's default `.eml` handler (Outlook / Windows Mail). The `X-Unsent: 1`
// header tells Outlook to open it as an unsent, editable draft rather than a
// received message, so the user reviews it and hits Send themselves - the app
// never sends anything on its own.
import { tempDir, join } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { api, type TpCompany } from "../api";

/** The trade partner's email for a subcontractor, matched by name against TP
 *  Companies - the same key the grid's D/E XLOOKUP uses (the `company` /
 *  trading-name column). Returns "" when there's no match or no email on file,
 *  leaving the draft's recipient blank for the user to fill in. */
export function recipientEmailForSub(subName: string, tpCompanies: TpCompany[]): string {
  const key = subName.trim().toLowerCase();
  const match = tpCompanies.find((c) => c.company.trim().toLowerCase() === key);
  return (match?.email ?? "").trim();
}

const sanitizeFileStem = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").trim();

/** base64-encode bytes and hard-wrap to 76-char lines (RFC 2045). */
function base64Wrapped(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000; // build the binary string in chunks to avoid arg limits
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const b64 = btoa(binary);
  return b64.replace(/(.{76})/g, "$1\r\n");
}

/** RFC 2047 encode a header value if it contains non-ASCII, so accented
 *  project/subcontractor names survive in the Subject line. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(value)));
  return `=?UTF-8?B?${b64}?=`;
}

export interface EmailDraftOptions {
  /** Recipient address; "" leaves the To: field blank. */
  to: string;
  subject: string;
  /** Plain-text body. */
  body: string;
  /** Attachment filename (should end in .pdf). */
  attachmentName: string;
  pdfBytes: Uint8Array;
}

/** Build the `.eml`, drop it in the temp dir, and open it in the default mail
 *  client as an editable draft. Throws if writing or opening fails. */
export async function openEmailDraftWithPdf(opts: EmailDraftOptions): Promise<void> {
  const boundary = `=_sa2025_${Date.now().toString(36)}`;
  const crlf = "\r\n";
  const headers = [
    ...(opts.to ? [`To: ${opts.to}`] : []),
    `Subject: ${encodeHeader(opts.subject)}`,
    "X-Unsent: 1",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].join(crlf);

  // The plain-text part is base64-encoded too, so a body with non-ASCII or
  // long lines can't corrupt the MIME structure.
  const bodyB64 = base64Wrapped(new TextEncoder().encode(opts.body));

  const eml =
    headers +
    crlf +
    crlf +
    `--${boundary}` +
    crlf +
    'Content-Type: text/plain; charset="UTF-8"' +
    crlf +
    "Content-Transfer-Encoding: base64" +
    crlf +
    crlf +
    bodyB64 +
    crlf +
    crlf +
    `--${boundary}` +
    crlf +
    `Content-Type: application/pdf; name="${opts.attachmentName}"` +
    crlf +
    "Content-Transfer-Encoding: base64" +
    crlf +
    `Content-Disposition: attachment; filename="${opts.attachmentName}"` +
    crlf +
    crlf +
    base64Wrapped(opts.pdfBytes) +
    crlf +
    crlf +
    `--${boundary}--` +
    crlf;

  const dir = await tempDir();
  const stem = sanitizeFileStem(opts.attachmentName.replace(/\.pdf$/i, "")) || "draft";
  const path = await join(dir, `${stem}.eml`);
  await api.writeBinaryFile(path, Array.from(new TextEncoder().encode(eml)));
  await openPath(path);
}
