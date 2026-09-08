import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { api, type StaffMember, type StaffRole } from "../api";
import { fileToScaledPngDataUrl } from "../lib/imageResize";
import { LoaBodyEditor } from "./LoaBodyEditor";
import { FieldDefaultsSection } from "./FieldDefaultsSection";
import { DEFAULT_LOA_BODY, LOA_GLOBAL_BODY_KEY } from "../lib/letterOfAward";
import { DEFAULT_FA_BODY, FA_GLOBAL_BODY_KEY, FA_PLACEHOLDERS } from "../lib/finalAccount";
import {
  DEFAULT_EMAIL_BODY,
  DEFAULT_EMAIL_SUBJECT,
  EMAIL_BODY_KEY,
  EMAIL_PLACEHOLDERS,
  EMAIL_SUBJECT_KEY,
} from "../lib/emailTemplate";
import "./Forms.css";
import "./SettingsModal.css";

const LIST_FIELDS: { key: string; label: string }[] = [
  { key: "list_sub_trades", label: "Sub Trades" },
  { key: "list_retentions", label: "Retentions" },
  { key: "list_defect_period", label: "Defect Period" },
  { key: "list_misc", label: "Misc" },
  { key: "list_mats_off_site", label: "Materials Offsite Conditions" },
  { key: "list_head_contracts", label: "Head Contracts" },
];

const STAFF_ROLES: { role: StaffRole; label: string }[] = [
  { role: "PM", label: "Project Managers" },
  { role: "BTM", label: "Build Team Managers" },
  { role: "QS", label: "Quantity Surveyors" },
];

type SectionKey =
  | "company"
  | "staff"
  | "lists"
  | "defaults"
  | "loa"
  | "fa"
  | "email";

const NAV_SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "company", label: "Company Identity" },
  { key: "staff", label: "Staff Directory" },
  { key: "lists", label: "Reference Lists" },
  { key: "defaults", label: "Field Defaults" },
  { key: "loa", label: "Letter of Award" },
  { key: "fa", label: "Final Account" },
  { key: "email", label: "Email" },
];

function parseList(json: string | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function StaffSection({ role, label }: { role: StaffRole; label: string }) {
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [sigError, setSigError] = useState<string>("");
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});

  useEffect(() => {
    api.listStaff(role).then(setMembers);
  }, [role]);

  const update = (id: number, patch: Partial<StaffMember>) => {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const save = async (member: StaffMember) => {
    const saved = await api.upsertStaff(member);
    setMembers((prev) => prev.map((m) => (m.id === member.id ? saved : m)));
  };

  // Save an explicit signature change directly (don't rely on the possibly
  // stale `members` snapshot, the way the onBlur text saves do).
  const saveSignature = async (member: StaffMember, signature_png: string | null) => {
    const next = { ...member, signature_png };
    update(member.id, { signature_png });
    await api.upsertStaff(next);
  };

  const onPickSignature = async (member: StaffMember, file: File | undefined) => {
    if (!file) return;
    setSigError("");
    try {
      const dataUrl = await fileToScaledPngDataUrl(file);
      await saveSignature(member, dataUrl);
    } catch (e) {
      setSigError(e instanceof Error ? e.message : String(e));
    }
  };

  const addRow = async () => {
    const saved = await api.upsertStaff({
      id: 0,
      role,
      name: "New person",
      mobile: null,
      email: null,
      ordering: members.length,
      signature_png: null,
    });
    setMembers((prev) => [...prev, saved]);
  };

  const removeRow = async (id: number) => {
    await api.deleteStaff(id);
    setMembers((prev) => prev.filter((m) => m.id !== id));
  };

  return (
    <div className="settings__section">
      <div className="settings__sectionhead">
        <h4>{label}</h4>
        <button className="btn btn--secondary" onClick={addRow}>
          Add
        </button>
      </div>
      <div className="settings__stafflist">
        {members.map((m) => (
          <div className="settings__staffmember" key={m.id}>
            <div className="settings__staffrow">
              <input
                className="form__input"
                value={m.name}
                onChange={(e) => update(m.id, { name: e.target.value })}
                onBlur={() => save(members.find((x) => x.id === m.id)!)}
                placeholder="Name"
              />
              <input
                className="form__input"
                value={m.mobile ?? ""}
                onChange={(e) => update(m.id, { mobile: e.target.value })}
                onBlur={() => save(members.find((x) => x.id === m.id)!)}
                placeholder="Mobile"
              />
              <input
                className="form__input"
                value={m.email ?? ""}
                onChange={(e) => update(m.id, { email: e.target.value })}
                onBlur={() => save(members.find((x) => x.id === m.id)!)}
                placeholder="Email"
              />
              <button
                className="settings__staffdel"
                aria-label="Remove"
                onClick={() => removeRow(m.id)}
              >
                ✕
              </button>
            </div>
            {role === "QS" && (
              <div className="settings__sigrow">
                <span className="settings__siglabel">Signature</span>
                {m.signature_png ? (
                  <img
                    className="settings__sigpreview"
                    src={m.signature_png}
                    alt={`${m.name} signature`}
                  />
                ) : (
                  <span className="settings__signone">None uploaded</span>
                )}
                <input
                  ref={(el) => {
                    fileInputs.current[m.id] = el;
                  }}
                  type="file"
                  accept="image/png,image/jpeg"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    void onPickSignature(m, e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <button
                  className="btn btn--secondary"
                  onClick={() => fileInputs.current[m.id]?.click()}
                >
                  {m.signature_png ? "Replace" : "Upload"}
                </button>
                {m.signature_png && (
                  <button
                    className="btn btn--secondary"
                    onClick={() => void saveSignature(m, null)}
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {members.length === 0 && (
          <p className="settings__empty">No one added yet.</p>
        )}
        {role === "QS" && sigError && (
          <p className="settings__empty" style={{ color: "var(--danger)" }}>
            {sigError}
          </p>
        )}
        {role === "QS" && (
          <p className="settings__note">
            A transparent PNG works best. The assigned QS's signature is placed on
            their Letters of Award automatically.
          </p>
        )}
      </div>
    </div>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [section, setSection] = useState<SectionKey>("company");
  const [companyName, setCompanyName] = useState("");
  const [companyAddr1, setCompanyAddr1] = useState("");
  const [companyAddr2, setCompanyAddr2] = useState("");
  const [lists, setLists] = useState<Record<string, string>>({});
  const [loaBody, setLoaBody] = useState("");
  const [faBody, setFaBody] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  useEffect(() => {
    (async () => {
      const s = await api.getSettings();
      setCompanyName(s.company_name ?? "");
      setCompanyAddr1(s.company_address_1 ?? "");
      setCompanyAddr2(s.company_address_2 ?? "");
      const listText: Record<string, string> = {};
      for (const { key } of LIST_FIELDS) {
        listText[key] = parseList(s[key]).join("\n");
      }
      setLists(listText);
      setLoaBody((s[LOA_GLOBAL_BODY_KEY] ?? "").trim() || DEFAULT_LOA_BODY);
      setFaBody((s[FA_GLOBAL_BODY_KEY] ?? "").trim() || DEFAULT_FA_BODY);
      setEmailSubject((s[EMAIL_SUBJECT_KEY] ?? "").trim() || DEFAULT_EMAIL_SUBJECT);
      setEmailBody((s[EMAIL_BODY_KEY] ?? "").trim() || DEFAULT_EMAIL_BODY);
      setLoaded(true);
    })();
  }, []);

  const saveScalar = (key: string, value: string) => {
    void api.setSetting(key, value);
  };

  const saveList = (key: string, text: string) => {
    const items = text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    void api.setSetting(key, JSON.stringify(items));
  };

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      width={820}
      primaryActions={[{ label: "Close", variant: "primary", onClick: onClose }]}
    >
      {!loaded ? (
        <p>Loading…</p>
      ) : (
        <div className="settings2">
          <nav className="settings2__nav">
            {NAV_SECTIONS.map(({ key, label }) => (
              <button
                key={key}
                className={`settings2__navitem ${section === key ? "is-active" : ""}`}
                onClick={() => setSection(key)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="settings2__content">
          {section === "company" && (
          <div className="settings__section">
            <h4>Company Identity</h4>
            <div className="form">
              <div className="form__row">
                <label className="form__label">Company name</label>
                <input
                  className="form__input"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  onBlur={(e) => saveScalar("company_name", e.target.value)}
                />
              </div>
              <div className="form__row">
                <label className="form__label">Address line 1</label>
                <input
                  className="form__input"
                  value={companyAddr1}
                  onChange={(e) => setCompanyAddr1(e.target.value)}
                  onBlur={(e) => saveScalar("company_address_1", e.target.value)}
                />
              </div>
              <div className="form__row">
                <label className="form__label">Address line 2</label>
                <input
                  className="form__input"
                  value={companyAddr2}
                  onChange={(e) => setCompanyAddr2(e.target.value)}
                  onBlur={(e) => saveScalar("company_address_2", e.target.value)}
                />
              </div>
            </div>
          </div>
          )}

          {section === "staff" &&
            STAFF_ROLES.map(({ role, label }) => (
              <StaffSection key={role} role={role} label={label} />
            ))}

          {section === "lists" && (
          <div className="settings__section">
            <h4>Reference Lists</h4>
            <p className="settings__note">
              One option per line. These feed the Subcontract Info dropdowns.
            </p>
            <div className="settings__lists">
              {LIST_FIELDS.map(({ key, label }) => (
                <div className="form__row" key={key}>
                  <label className="form__label">{label}</label>
                  {key === "list_sub_trades" && (
                    <p className="settings__note">
                      One trade per line, as <code>Trade,Cost Code</code> (e.g.{" "}
                      <code>Plumbing,623</code>) - the cost code builds the grid's
                      auto-generated Code column.
                    </p>
                  )}
                  <textarea
                    className="form__input settings__listarea"
                    value={lists[key] ?? ""}
                    onChange={(e) =>
                      setLists((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    onBlur={(e) => saveList(key, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
          )}

          {section === "defaults" && <FieldDefaultsSection />}

          {section === "loa" && (
          <div className="settings__section">
            <div className="settings__sectionhead">
              <h4>Letter of Award - default body</h4>
              <button
                className="btn btn--secondary"
                onClick={() => {
                  setLoaBody(DEFAULT_LOA_BODY);
                  saveScalar(LOA_GLOBAL_BODY_KEY, DEFAULT_LOA_BODY);
                }}
              >
                Reset to default
              </button>
            </div>
            <p className="settings__note">
              The default letter body used for every project. Click a placeholder
              to insert it; each project can override this under the Letter of
              Award tab.
            </p>
            <LoaBodyEditor
              value={loaBody}
              onChange={setLoaBody}
              onBlur={() => saveScalar(LOA_GLOBAL_BODY_KEY, loaBody)}
            />
          </div>
          )}

          {section === "fa" && (
          <div className="settings__section">
            <div className="settings__sectionhead">
              <h4>Final Account - default body</h4>
              <button
                className="btn btn--secondary"
                onClick={() => {
                  setFaBody(DEFAULT_FA_BODY);
                  saveScalar(FA_GLOBAL_BODY_KEY, DEFAULT_FA_BODY);
                }}
              >
                Reset to default
              </button>
            </div>
            <p className="settings__note">
              The default statement paragraphs (the “I/We being the
              subcontractor…”, verification and indemnity text) used for every
              project. The title, contract header, adjusted-value block and
              signature grid are fixed and drawn automatically. Click a
              placeholder to insert it; each project can override this text under
              the Final Account tab.
            </p>
            <LoaBodyEditor
              value={faBody}
              onChange={setFaBody}
              onBlur={() => saveScalar(FA_GLOBAL_BODY_KEY, faBody)}
              placeholders={FA_PLACEHOLDERS}
            />
          </div>
          )}

          {section === "email" && (
          <div className="settings__section">
            <div className="settings__sectionhead">
              <h4>Email - subject &amp; body</h4>
              <button
                className="btn btn--secondary"
                onClick={() => {
                  setEmailSubject(DEFAULT_EMAIL_SUBJECT);
                  setEmailBody(DEFAULT_EMAIL_BODY);
                  saveScalar(EMAIL_SUBJECT_KEY, DEFAULT_EMAIL_SUBJECT);
                  saveScalar(EMAIL_BODY_KEY, DEFAULT_EMAIL_BODY);
                }}
              >
                Reset to default
              </button>
            </div>
            <p className="settings__note">
              Used for the draft opened by the Email buttons on the Subcontract
              Agreement, Letter of Award and Final Account tabs. Placeholders{" "}
              <code>{"{{Document}}"}</code>, <code>{"{{Subcontractor}}"}</code>,{" "}
              <code>{"{{Project_Name}}"}</code> and <code>{"{{Project_Number}}"}</code>{" "}
              are filled in automatically - <code>{"{{Document}}"}</code> becomes
              “Subcontract Agreement”, “Letter of Award” or “Final Account”. You can
              type placeholders into the subject too.
            </p>
            <div className="form__row">
              <label className="form__label">Subject</label>
              <input
                className="form__input"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                onBlur={(e) => saveScalar(EMAIL_SUBJECT_KEY, e.target.value)}
              />
            </div>
            <div className="form__row">
              <label className="form__label">Body</label>
              <LoaBodyEditor
                value={emailBody}
                onChange={setEmailBody}
                onBlur={() => saveScalar(EMAIL_BODY_KEY, emailBody)}
                placeholders={EMAIL_PLACEHOLDERS}
                minHeight={160}
              />
            </div>
          </div>
          )}
          </div>
        </div>
      )}
    </Modal>
  );
}
