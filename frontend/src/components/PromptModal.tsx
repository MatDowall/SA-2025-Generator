import { useState } from "react";
import { Modal } from "./Modal";
import "./Forms.css";

export interface PromptField {
  key: string;
  label: string;
  initial?: string;
  placeholder?: string;
  required?: boolean;
}

interface PromptModalProps {
  title: string;
  fields: PromptField[];
  submitLabel?: string;
  onSubmit: (values: Record<string, string>) => Promise<void> | void;
  onClose: () => void;
}

// Generic text-input modal (one or more fields). Used for New/Rename Project
// and Add/Rename Subcontractor.
export function PromptModal({
  title,
  fields,
  submitLabel = "Save",
  onSubmit,
  onClose,
}: PromptModalProps) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, f.initial ?? ""])),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const missingRequired = fields.some(
    (f) => f.required && !values[f.key]?.trim(),
  );

  const submit = async () => {
    if (missingRequired || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      secondaryActions={[{ label: "Cancel", onClick: onClose }]}
      primaryActions={[
        {
          label: submitLabel,
          variant: "primary",
          onClick: submit,
          disabled: missingRequired || busy,
        },
      ]}
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {fields.map((f, i) => (
          <label className="form__row" key={f.key}>
            <span className="form__label">{f.label}</span>
            <input
              className="form__input"
              autoFocus={i === 0}
              value={values[f.key]}
              placeholder={f.placeholder}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: e.target.value }))
              }
            />
          </label>
        ))}
        {error && <p className="form__error">{error}</p>}
        {/* Allow Enter to submit. */}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
