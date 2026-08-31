import { useRef } from "react";
import { LOA_PLACEHOLDERS } from "../lib/letterOfAward";
import "./LoaBodyEditor.css";

// Editable letter-body textarea with a clickable placeholder palette. Inserts
// tokens at the cursor. Persistence/reset are the parent's job.
export function LoaBodyEditor({
  value,
  onChange,
  onBlur,
  minHeight = 280,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  minHeight?: number;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  const insert = (token: string) => {
    const ta = taRef.current;
    if (!ta) {
      onChange(value + token);
      return;
    }
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    // Restore caret just after the inserted token.
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + token.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="loabody">
      <div className="loabody__palette">
        {LOA_PLACEHOLDERS.map((p) => (
          <button
            key={p.token}
            type="button"
            className="loabody__chip"
            title={`Insert ${p.label}`}
            onClick={() => insert(p.token)}
          >
            {p.token}
          </button>
        ))}
      </div>
      <textarea
        ref={taRef}
        className="form__input loabody__textarea"
        style={{ minHeight }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        spellCheck
      />
    </div>
  );
}
