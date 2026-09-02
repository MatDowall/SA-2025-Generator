import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { loadFieldMap, dataFields, type FieldDef } from "../fieldMap";
import {
  SA_FIELD_DEFAULTS_KEY,
  MAPPED_FIELD_NAMES,
  humanizeFieldName,
  parseFieldDefaults,
} from "../lib/fieldDefaults";

// Field types a global default is offered for. Checkboxes are excluded because
// the template's field map doesn't record their on-state export value, so a
// stored default could render inconsistently between the live overlay and the
// exported PDF; signatures are intentionally never filled.
const ELIGIBLE_TYPES = new Set(["text", "dropdown", "radio"]);

/** Radio on-states in the field map are raw PDF names ("/Yes"); the stored
 *  value the fill/overlay expect is the bare export value ("Yes"). */
const radioChoices = (f: FieldDef): string[] =>
  (f.onStates ?? f.options ?? []).map((s) => s.replace(/^\//, ""));

// Settings section: global default values for SA-form fields. A default fills a
// field on every project's agreements only where the mapping pipeline (Contract
// Info / Subcontractor Details) leaves it blank — the computed value always
// wins when present. See fieldDefaults.ts / useMappingRecompute.
export function FieldDefaultsSection() {
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [map, settings] = await Promise.all([loadFieldMap(), api.getSettings()]);
      const eligible = dataFields(map)
        .filter((f) => ELIGIBLE_TYPES.has(f.type))
        .sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || a.name.localeCompare(b.name));
      setFields(eligible);
      setDefaults(parseFieldDefaults(settings[SA_FIELD_DEFAULTS_KEY]));
      setLoaded(true);
    })();
  }, []);

  // The fields that currently carry a default, in the eligible-field order.
  const chosen = useMemo(
    () => fields.filter((f) => f.name in defaults),
    [fields, defaults],
  );
  const available = useMemo(
    () => fields.filter((f) => !(f.name in defaults)),
    [fields, defaults],
  );

  // Persist the whole map, dropping blanks so an emptied default disappears.
  const persist = (next: Record<string, string>) => {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(next)) if (v.trim() !== "") clean[k] = v;
    setDefaults(next);
    void api.setSetting(SA_FIELD_DEFAULTS_KEY, JSON.stringify(clean));
  };

  const setValue = (name: string, value: string) =>
    setDefaults((prev) => ({ ...prev, [name]: value }));

  const commit = (name: string, value: string) =>
    persist({ ...defaults, [name]: value });

  const addField = (name: string) => {
    if (!name) return;
    setDefaults((prev) => ({ ...prev, [name]: "" }));
    setPicker("");
  };

  const removeField = (name: string) => {
    const next = { ...defaults };
    delete next[name];
    persist(next);
  };

  return (
    <div className="settings__section">
      <h4>SA Form — default field values</h4>
      <p className="settings__note">
        Global starting values applied to every project. A default only fills a
        field where nothing else provides a value — the Contract Info /
        Subcontractor Details data always wins when present. Fields marked
        <span className="fielddefaults__automark"> auto-filled</span> are normally
        computed, so their default shows only when that computation is blank.
      </p>

      {!loaded ? (
        <p className="settings__empty">Loading fields…</p>
      ) : (
        <div className="fielddefaults">
          {chosen.length === 0 && (
            <p className="settings__empty">No defaults set.</p>
          )}
          {chosen.map((f) => (
            <div className="fielddefaults__row" key={f.name}>
              <div className="fielddefaults__label">
                <span className="fielddefaults__name">
                  {humanizeFieldName(f.name)}
                </span>
                <span className="fielddefaults__meta">
                  p{f.page}
                  {MAPPED_FIELD_NAMES.has(f.name) && (
                    <span className="fielddefaults__automark"> · auto-filled</span>
                  )}
                </span>
              </div>
              <DefaultEditor
                field={f}
                value={defaults[f.name] ?? ""}
                onChange={(v) => setValue(f.name, v)}
                onCommit={(v) => commit(f.name, v)}
              />
              <button
                className="settings__staffdel"
                aria-label="Remove default"
                title="Remove default"
                onClick={() => removeField(f.name)}
              >
                ✕
              </button>
            </div>
          ))}

          <div className="fielddefaults__add">
            <select
              className="form__input"
              value={picker}
              onChange={(e) => addField(e.target.value)}
            >
              <option value="">Add a field default…</option>
              {available.map((f) => (
                <option key={f.name} value={f.name}>
                  {`p${f.page} — ${humanizeFieldName(f.name)}`}
                  {MAPPED_FIELD_NAMES.has(f.name) ? " (auto-filled)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

interface EditorProps {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
}

function DefaultEditor({ field, value, onChange, onCommit }: EditorProps) {
  if (field.type === "dropdown") {
    return (
      <select
        className="form__input fielddefaults__editor"
        value={value}
        onChange={(e) => onCommit(e.target.value)}
      >
        <option value="">(none)</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "radio") {
    return (
      <select
        className="form__input fielddefaults__editor"
        value={value}
        onChange={(e) => onCommit(e.target.value)}
      >
        <option value="">(none)</option>
        {radioChoices(field).map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      className="form__input fielddefaults__editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onCommit(e.target.value)}
      placeholder="Default value"
    />
  );
}
