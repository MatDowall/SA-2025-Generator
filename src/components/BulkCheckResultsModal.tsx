import { Modal } from "./Modal";
import type { BulkCheckResult } from "../api";
import "./BulkCheckResultsModal.css";

const OUTCOME_LABEL: Record<BulkCheckResult["outcome"], string> = {
  matched: "Matched",
  ambiguous: "Needs your choice",
  not_found: "Not found",
  error: "Error",
};

export interface BulkCheckResultsModalProps {
  results: BulkCheckResult[];
  matchedCount: number;
  onResolve: (result: BulkCheckResult) => void;
  onClose: () => void;
}

// Shown after a bulk Companies Register check. `results` is pre-filtered to
// only the rows that need attention (ambiguous/not_found/error) — clean
// exact matches were already applied silently, `matchedCount` just reports
// how many.
export function BulkCheckResultsModal({
  results,
  matchedCount,
  onResolve,
  onClose,
}: BulkCheckResultsModalProps) {
  return (
    <Modal
      title="Companies Register Check Results"
      onClose={onClose}
      width={560}
      primaryActions={[{ label: "Close", variant: "primary", onClick: onClose }]}
    >
      <p className="bulkcheck__summary">
        {matchedCount} {matchedCount === 1 ? "company" : "companies"} matched and updated
        automatically.{" "}
        {results.length > 0
          ? `${results.length} ${results.length === 1 ? "needs" : "need"} your attention:`
          : "Everything else matched cleanly."}
      </p>
      {results.length > 0 && (
        <ul className="bulkcheck__list">
          {results.map((r) => (
            <li key={r.id} className={`bulkcheck__item bulkcheck__item--${r.outcome}`}>
              <div className="bulkcheck__item-main">
                <span className="bulkcheck__name">{r.company}</span>
                <span className="bulkcheck__badge">{OUTCOME_LABEL[r.outcome]}</span>
              </div>
              {r.message && <p className="bulkcheck__message">{r.message}</p>}
              {r.outcome === "ambiguous" && (
                <button className="btn btn--secondary" onClick={() => onResolve(r)}>
                  Resolve
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
