import { useEffect, useMemo, useState } from "react";
import { useDebouncedFieldSave } from "../hooks/useDebouncedFieldSave";
import { api, type Project } from "../api";
import {
  CONTRACT_INFO_LEFT,
  CONTRACT_INFO_RIGHT,
  type ContractInfoField,
  type ContractInfoSection,
} from "../lib/contractInfoFields";
import "./Forms.css";
import "./ContractInfoForm.css";

function PercentValueControl({
  field,
  values,
  disabled,
  onFieldChange,
}: {
  field: ContractInfoField;
  values: Record<string, string>;
  disabled: boolean;
  onFieldChange: (key: string, value: string) => void;
}) {
  const pctKey = field.pctKey!;
  const valueKey = field.valueKey!;
  return (
    <div className="form__row">
      <label className="form__label">{field.label}</label>
      <div className="contractinfo__pair">
        <input
          className="form__input contractinfo__pair-narrow"
          type="number"
          placeholder="%"
          disabled={disabled}
          value={values[pctKey] ?? ""}
          onChange={(e) => onFieldChange(pctKey, e.target.value)}
        />
        <input
          className="form__input contractinfo__pair-wide"
          type="number"
          placeholder="$"
          disabled={disabled}
          value={values[valueKey] ?? ""}
          onChange={(e) => onFieldChange(valueKey, e.target.value)}
        />
      </div>
    </div>
  );
}

function TextSelectControl({
  field,
  values,
  disabled,
  onFieldChange,
}: {
  field: ContractInfoField;
  values: Record<string, string>;
  disabled: boolean;
  onFieldChange: (key: string, value: string) => void;
}) {
  const textKey = field.textKey!;
  const selectKey = field.selectKey!;
  return (
    <div className="form__row">
      <label className="form__label">{field.label}</label>
      <div className="contractinfo__pair">
        <input
          className="form__input contractinfo__pair-wide"
          type="text"
          disabled={disabled}
          value={values[textKey] ?? field.default ?? ""}
          onChange={(e) => onFieldChange(textKey, e.target.value)}
        />
        <select
          className="form__input contractinfo__pair-narrow"
          disabled={disabled}
          value={values[selectKey] ?? ""}
          onChange={(e) => onFieldChange(selectKey, e.target.value)}
        >
          <option value="" />
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function FieldControl({
  field,
  value,
  disabled,
  dynamicOptions,
  onChange,
}: {
  field: ContractInfoField;
  value: string;
  disabled: boolean;
  dynamicOptions?: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  if (field.type === "checkbox") {
    return (
      <label className="contractinfo__checkbox">
        <input
          type="checkbox"
          disabled={disabled}
          checked={value === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
        />
        {field.label}
      </label>
    );
  }

  if (field.type === "radio") {
    return (
      <fieldset className="radioset">
        <legend>{field.label}</legend>
        {field.options?.map((opt) => (
          <label className="radioset__opt" key={opt.value}>
            <input
              type="radio"
              name={field.key}
              disabled={disabled}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
            />
            {opt.label}
          </label>
        ))}
      </fieldset>
    );
  }

  if (field.type === "select") {
    const options = dynamicOptions ?? field.options ?? [];
    return (
      <div className="form__row">
        <label className="form__label">{field.label}</label>
        <select
          className="form__input"
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="" />
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="form__row">
      <label className="form__label">{field.label}</label>
      <input
        className="form__input"
        disabled={disabled}
        type={field.type === "number" ? "number" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function SectionBlock({
  section,
  values,
  dynamicOptionsByKey,
  onFieldChange,
}: {
  section: ContractInfoSection;
  values: Record<string, string>;
  dynamicOptionsByKey?: Record<string, { value: string; label: string }[]>;
  onFieldChange: (key: string, value: string) => void;
}) {
  return (
    <div className="contractinfo__section">
      <h3 className="contractinfo__sectiontitle">{section.title}</h3>
      <div className="form">
        {section.fields.map((field) => {
          if (
            field.showIf &&
            (values[field.showIf.key] ?? "") !== field.showIf.equals
          ) {
            return null;
          }
          if (field.type === "heading") {
            return (
              <h4 className="contractinfo__subheading" key={field.key}>
                {field.label}
              </h4>
            );
          }
          const disabled = Boolean(
            field.enableIf &&
              (values[field.enableIf.key] ?? "") !== field.enableIf.equals,
          );
          if (field.type === "percent-value") {
            return (
              <PercentValueControl
                key={field.label}
                field={field}
                values={values}
                disabled={disabled}
                onFieldChange={onFieldChange}
              />
            );
          }
          if (field.type === "text-select") {
            return (
              <TextSelectControl
                key={field.label}
                field={field}
                values={values}
                disabled={disabled}
                onFieldChange={onFieldChange}
              />
            );
          }
          const value = values[field.key] ?? field.default ?? "";
          return (
            <FieldControl
              key={field.key}
              field={field}
              value={value}
              disabled={disabled}
              dynamicOptions={dynamicOptionsByKey?.[field.key]}
              onChange={(v) => onFieldChange(field.key, v)}
            />
          );
        })}
      </div>
    </div>
  );
}

export function ContractInfoForm({
  project,
  onChanged,
}: {
  project: Project | null;
  onChanged: () => void;
}) {
  const { values, onFieldChange: saveField } = useDebouncedFieldSave(
    project?.id ?? null,
    api.getContractInfo,
    api.setContractInfoValue,
  );
  const onFieldChange = (key: string, value: string) => {
    saveField(key, value);
    onChanged();
  };

  const [dynamicOptionsByKey, setDynamicOptionsByKey] = useState<
    Record<string, { value: string; label: string }[]>
  >({});

  useEffect(() => {
    (async () => {
      const [pm, btm, qs] = await Promise.all([
        api.listStaff("PM"),
        api.listStaff("BTM"),
        api.listStaff("QS"),
      ]);
      setDynamicOptionsByKey({
        project_manager: pm.map((m) => ({ value: m.name, label: m.name })),
        site_manager: btm.map((m) => ({ value: m.name, label: m.name })),
        quantity_surveyor: qs.map((m) => ({ value: m.name, label: m.name })),
      });
    })();
  }, []);

  // Prefill Job Number/Project Name from the project's own identity (set at
  // creation time) until the user edits them here — same "show until
  // overridden" behavior as a field's static default, just sourced from the
  // project instead of a fixed string.
  const displayValues = useMemo(() => {
    if (!project) return values;
    return {
      ...values,
      job_number: values.job_number || project.project_number,
      project_name: values.project_name || project.name,
    };
  }, [values, project]);

  if (!project) {
    return <p className="contractinfo__empty">Open a project to enter Contract Info.</p>;
  }

  return (
    <div className="contractinfo">
      <div className="contractinfo__column">
        {CONTRACT_INFO_LEFT.map((section) => (
          <SectionBlock
            key={section.title}
            section={section}
            values={displayValues}
            onFieldChange={onFieldChange}
          />
        ))}
      </div>
      <div className="contractinfo__column">
        {CONTRACT_INFO_RIGHT.map((section) => (
          <SectionBlock
            key={section.title}
            section={section}
            values={displayValues}
            dynamicOptionsByKey={dynamicOptionsByKey}
            onFieldChange={onFieldChange}
          />
        ))}
      </div>
    </div>
  );
}
