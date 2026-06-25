import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { api, type StaffMember, type StaffRole } from "../api";
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

  const addRow = async () => {
    const saved = await api.upsertStaff({
      id: 0,
      role,
      name: "New person",
      mobile: null,
      email: null,
      ordering: members.length,
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
          <div className="settings__staffrow" key={m.id}>
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
        ))}
        {members.length === 0 && (
          <p className="settings__empty">No one added yet.</p>
        )}
      </div>
    </div>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [companyAddr1, setCompanyAddr1] = useState("");
  const [companyAddr2, setCompanyAddr2] = useState("");
  const [lists, setLists] = useState<Record<string, string>>({});

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
      width={680}
      primaryActions={[{ label: "Close", variant: "primary", onClick: onClose }]}
    >
      {!loaded ? (
        <p>Loading…</p>
      ) : (
        <div className="settings">
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

          {STAFF_ROLES.map(({ role, label }) => (
            <StaffSection key={role} role={role} label={label} />
          ))}

          <div className="settings__section">
            <h4>Reference Lists</h4>
            <p className="settings__note">
              One option per line. These feed the Subcontract Info dropdowns.
            </p>
            <div className="settings__lists">
              {LIST_FIELDS.map(({ key, label }) => (
                <div className="form__row" key={key}>
                  <label className="form__label">{label}</label>
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
        </div>
      )}
    </Modal>
  );
}
