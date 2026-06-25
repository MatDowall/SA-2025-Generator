import { useState } from "react";
import { Modal } from "./Modal";
import type { NzbnSearchResult } from "../api";
import "./CompanyMatchModal.css";

export interface CompanyMatchModalProps {
  searchTerm: string;
  loading: boolean;
  error: string | null;
  results: NzbnSearchResult[];
  onSelect: (nzbn: string) => void;
  onClose: () => void;
}

// Shown whenever a Companies Register check can't auto-resolve to a single
// exact name match — lets the user pick the right entity from the candidates
// the NZBN API returned, or close without applying anything.
export function CompanyMatchModal({
  searchTerm,
  loading,
  error,
  results,
  onSelect,
  onClose,
}: CompanyMatchModalProps) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <Modal
      title="Check Companies Register"
      onClose={onClose}
      width={520}
      secondaryActions={[{ label: "Cancel", onClick: onClose }]}
      primaryActions={[
        {
          label: "Use Selected",
          variant: "primary",
          disabled: !selected,
          onClick: () => selected && onSelect(selected),
        },
      ]}
    >
      <p className="companymatch__searchterm">
        Searched for: <strong>{searchTerm}</strong>
      </p>
      {loading && <p className="companymatch__status">Searching the NZBN register…</p>}
      {error && <p className="companymatch__status companymatch__status--error">{error}</p>}
      {!loading && !error && results.length === 0 && (
        <p className="companymatch__status">No matching companies were found.</p>
      )}
      {!loading && !error && results.length > 0 && (
        <ul className="companymatch__list">
          {results.map((r) => (
            <li key={r.nzbn}>
              <label className="companymatch__option">
                <input
                  type="radio"
                  name="companymatch"
                  checked={selected === r.nzbn}
                  onChange={() => setSelected(r.nzbn)}
                />
                <span className="companymatch__name">{r.name}</span>
                <span className="companymatch__meta">
                  NZBN {r.nzbn}
                  {r.status ? ` · ${r.status}` : ""}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
