import { useState } from "react";
import { Modal } from "./Modal";
import type { Audit } from "../api";
import "./AuditLogModal.css";

interface AuditLogModalProps {
  subName: string;
  audit: Audit;
  onSave: (audit: Audit) => void;
  onClose: () => void;
}

/** Local date as YYYY-MM-DD (native <input type="date"> value format). */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Per-subcontractor audit log: when the Letter of Award and Subcontract
// Agreement were sent to the trade partner and when the signed copies came
// back, plus free-form notes. Sent dates auto-populate when the app's Email
// button is used (with a confirm prompt), but every field is editable here so
// documents sent outside the app can be recorded too.
export function AuditLogModal({ subName, audit, onSave, onClose }: AuditLogModalProps) {
  const [loaSent, setLoaSent] = useState(audit.loa_sent_date ?? "");
  const [saSent, setSaSent] = useState(audit.sa_sent_date ?? "");
  const [saReturned, setSaReturned] = useState(audit.sa_returned_date ?? "");
  const [notes, setNotes] = useState(audit.notes ?? "");

  const save = () => {
    onSave({
      subcontractor_id: audit.subcontractor_id,
      loa_sent_date: loaSent || null,
      sa_sent_date: saSent || null,
      sa_returned_date: saReturned || null,
      notes: notes.trim() || null,
    });
  };

  return (
    <Modal
      title={`Audit Log — ${subName}`}
      onClose={onClose}
      width={460}
      secondaryActions={[{ label: "Cancel", onClick: onClose }]}
      primaryActions={[{ label: "Save", variant: "primary", onClick: save }]}
    >
      <div className="audit">
        <fieldset className="audit__doc">
          <legend className="audit__doc-title">Letter of Award</legend>
          <DateField label="Sent" value={loaSent} onChange={setLoaSent} />
        </fieldset>
        <DocSection
          heading="Subcontract Agreement"
          sent={saSent}
          returned={saReturned}
          onSent={setSaSent}
          onReturned={setSaReturned}
        />
        <label className="audit__notes">
          <span className="audit__label">Notes</span>
          <textarea
            className="audit__textarea"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Comments, follow-ups, or context…"
          />
        </label>
      </div>
    </Modal>
  );
}

interface DocSectionProps {
  heading: string;
  sent: string;
  returned: string;
  onSent: (v: string) => void;
  onReturned: (v: string) => void;
}

function DocSection({ heading, sent, returned, onSent, onReturned }: DocSectionProps) {
  return (
    <fieldset className="audit__doc">
      <legend className="audit__doc-title">{heading}</legend>
      <DateField label="Sent" value={sent} onChange={onSent} />
      <DateField label="Returned" value={returned} onChange={onReturned} />
    </fieldset>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="audit__field">
      <span className="audit__label">{label}</span>
      <span className="audit__date-row">
        <input
          type="date"
          className="audit__date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="audit__today"
          title="Set to today"
          onClick={() => onChange(todayIso())}
        >
          Today
        </button>
        {value && (
          <button
            type="button"
            className="audit__clear"
            title="Clear date"
            onClick={() => onChange("")}
          >
            ✕
          </button>
        )}
      </span>
    </label>
  );
}
