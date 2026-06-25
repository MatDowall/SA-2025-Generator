import { useEffect, useState } from "react";
import type { FieldBox } from "../pdf";
import { NUMERIC_FIELD_NAMES, formatNumeric } from "../lib/numericFields";
import "./FieldOverlay.css";

interface NumericInputProps {
  name: string;
  style: React.CSSProperties;
  value: string;
  disabled: boolean;
  onChange: (name: string, value: string) => void;
}

// Shows the raw value while focused (so the user can freely edit) and the
// thousands-separated, two-decimal form once the field is blurred.
function NumericInput({ name, style, value, disabled, onChange }: NumericInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  return (
    <input
      type="text"
      className="overlay__input"
      style={style}
      value={focused ? draft : formatNumeric(value)}
      disabled={disabled}
      onFocus={() => {
        setFocused(true);
        setDraft(value);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const formatted = formatNumeric(draft);
        if (formatted !== value) onChange(name, formatted);
      }}
    />
  );
}

interface FieldOverlayProps {
  boxes: FieldBox[];
  zoom: number;
  values: Record<string, string>;
  editable: boolean;
  onChange: (name: string, value: string) => void;
}

const FONT_FAMILY = "Arial, Helvetica, sans-serif";
const MIN_FONT_PT = 6;
const DEFAULT_MAX_FONT_PT = 12;
const LINE_HEIGHT = 1.15;

const measureCtx = document.createElement("canvas").getContext("2d");

function textWidth(text: string, fontPx: number): number {
  if (!measureCtx) return text.length * fontPx * 0.55;
  measureCtx.font = `${fontPx}px ${FONT_FAMILY}`;
  return measureCtx.measureText(text).width;
}

// Greedy word-wrap line count at a given font size, mirroring how a textarea
// would wrap the text within maxWidth.
function wrappedLineCount(text: string, fontPx: number, maxWidth: number): number {
  let lines = 0;
  for (const para of text.split("\n")) {
    if (para === "") {
      lines += 1;
      continue;
    }
    let line = "";
    for (const word of para.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && textWidth(candidate, fontPx) > maxWidth) {
        lines += 1;
        line = word;
      } else {
        line = candidate;
      }
    }
    lines += 1;
  }
  return lines;
}

// Picks the largest font size (up to the field's own DA size, or a sane
// default) at which `text` still fits inside the box, shrinking as needed so
// long content never gets clipped.
function fitFontSize(
  text: string,
  widthPx: number,
  heightPx: number,
  multiline: boolean,
  basePt: number | undefined,
  zoom: number,
): number {
  const maxPt = basePt && basePt > 0 ? basePt : DEFAULT_MAX_FONT_PT;
  const maxPx = maxPt * zoom;
  const minPx = MIN_FONT_PT * zoom;
  if (!text) return maxPx;

  const innerWidth = Math.max(0, widthPx - 4);

  if (!multiline) {
    let size = maxPx;
    while (size > minPx && textWidth(text, size) > innerWidth) {
      size -= 0.5;
    }
    return size;
  }

  let size = maxPx;
  while (size > minPx) {
    const lines = wrappedLineCount(text, size, innerWidth);
    if (lines * size * LINE_HEIGHT <= heightPx) break;
    size -= 0.5;
  }
  return size;
}

// Renders editable HTML form controls positioned over a single PDF page,
// driven by the active subcontractor's field values.
export function FieldOverlay({
  boxes,
  zoom,
  values,
  editable,
  onChange,
}: FieldOverlayProps) {
  return (
    <div className="overlay">
      {boxes.map((b) => {
        const boxW = b.width * zoom;
        const boxH = b.height * zoom;
        const style: React.CSSProperties = {
          left: b.left * zoom,
          top: b.top * zoom,
          width: boxW,
          height: boxH,
          fontSize: Math.max(8, Math.min(boxH * 0.62, 18) * zoom),
        };
        const disabled = !editable || b.readOnly;
        const val = values[b.name] ?? "";

        // Stored values may differ in case from the field's canonical on-state
        // (e.g. CSV-imported "yes" vs the form's "Yes"), so match case-insensitively.
        const eq = (a: string, b2: string) =>
          a.toLowerCase() === b2.toLowerCase();

        if (b.kind === "checkbox") {
          const on = b.exportValue || "On";
          return (
            <input
              key={b.id}
              type="checkbox"
              className="overlay__check"
              style={style}
              checked={val !== "" && eq(val, on)}
              disabled={disabled}
              onChange={(e) => onChange(b.name, e.target.checked ? on : "")}
            />
          );
        }

        if (b.kind === "radio") {
          const ev = b.exportValue ?? "";
          return (
            <input
              key={b.id}
              type="radio"
              className="overlay__check"
              style={style}
              name={b.name}
              checked={val !== "" && eq(val, ev)}
              disabled={disabled}
              onChange={() => onChange(b.name, ev)}
            />
          );
        }

        if (b.kind === "dropdown") {
          // Show the canonical option even if the stored value differs in case.
          const matchedOption = b.options?.find((o) => eq(o.value, val));
          const matched = matchedOption?.value ?? "";
          const selectStyle: React.CSSProperties = {
            ...style,
            fontSize: fitFontSize(
              matchedOption?.label ?? "",
              boxW,
              boxH,
              false,
              b.fontSize,
              zoom,
            ),
          };
          return (
            <select
              key={b.id}
              className="overlay__input overlay__select"
              style={selectStyle}
              value={matched}
              disabled={disabled}
              onChange={(e) => onChange(b.name, e.target.value)}
            >
              <option value="" />
              {b.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          );
        }

        // text - shrink the font so the current value always fits the box,
        // rather than rendering at a fixed size and letting it clip/scroll.
        const textStyle: React.CSSProperties = {
          ...style,
          fontSize: fitFontSize(val, boxW, boxH, !!b.multiline, b.fontSize, zoom),
        };

        // Numeric/monetary fields are always short single-line values —
        // check this before the multiline textarea branch below, since
        // every text field is now treated as multiline-capable (for long
        // free-text fields) but that must not bypass comma formatting here.
        if (NUMERIC_FIELD_NAMES.has(b.name)) {
          return (
            <NumericInput
              key={b.id}
              name={b.name}
              style={textStyle}
              value={val}
              disabled={disabled}
              onChange={onChange}
            />
          );
        }
        if (b.multiline) {
          return (
            <textarea
              key={b.id}
              className="overlay__input overlay__textarea"
              style={textStyle}
              value={val}
              disabled={disabled}
              onChange={(e) => onChange(b.name, e.target.value)}
            />
          );
        }
        return (
          <input
            key={b.id}
            type="text"
            className="overlay__input"
            style={textStyle}
            value={val}
            disabled={disabled}
            onChange={(e) => onChange(b.name, e.target.value)}
          />
        );
      })}
    </div>
  );
}
