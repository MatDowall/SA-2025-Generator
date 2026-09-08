import { useEffect, useState } from "react";
import type { Audit, Project, Subcontractor } from "../api";
import "./Sidebar.css";

interface SidebarProps {
  project: Project | null;
  subcontractors: Subcontractor[];
  activeId: number | null;
  /** Audit records keyed by subcontractor id (missing = nothing logged yet). */
  audits: Record<number, Audit>;
  onNewProject: () => void;
  onOpenProject: () => void;
  onRenameProject: () => void;
  onSelect: (id: number) => void;
  onAddSubcontractor: () => void;
  onRenameSubcontractor: (s: Subcontractor) => void;
  onDeleteSubcontractor: (s: Subcontractor) => void;
  onShowAuditLog: (s: Subcontractor) => void;
}

// Left-hand navigation pane: open-project header + subcontractor agreement list.
export function Sidebar({
  project,
  subcontractors,
  activeId,
  audits,
  onNewProject,
  onOpenProject,
  onRenameProject,
  onSelect,
  onAddSubcontractor,
  onRenameSubcontractor,
  onDeleteSubcontractor,
  onShowAuditLog,
}: SidebarProps) {
  // Right-click context menu anchored to the pointer.
  const [menu, setMenu] = useState<{ x: number; y: number; sub: Subcontractor } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (!project) {
    return (
      <aside className="sidebar">
        <div className="sidebar__empty">
          <p>No project open.</p>
          <div className="sidebar__empty-actions">
            <button className="btn btn--primary" onClick={onNewProject}>
              New Project
            </button>
            <button className="btn" onClick={onOpenProject}>
              Open Project
            </button>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__project" title="Rename project" onDoubleClick={onRenameProject}>
        <div className="sidebar__project-main">
          <span className="sidebar__project-name">{project.name}</span>
          <span className="sidebar__project-num">#{project.project_number}</span>
        </div>
        <button
          className="sidebar__switch"
          title="Open another project"
          onClick={onOpenProject}
        >
          ⇆
        </button>
      </div>

      <div className="sidebar__head">
        <span className="sidebar__title">
          Subcontractors ({subcontractors.length})
        </span>
        <button
          className="sidebar__add"
          title="Add subcontractor"
          onClick={onAddSubcontractor}
        >
          +
        </button>
      </div>

      {subcontractors.length === 0 ? (
        <div className="sidebar__empty">
          <p className="sidebar__hint">
            No subcontractor agreements yet. Add one with the + button (or import
            a CSV in a later step).
          </p>
        </div>
      ) : (
        <ul className="sublist">
          {subcontractors.map((s) => (
            <li
              key={s.id}
              className={`sublist__row ${activeId === s.id ? "is-active" : ""}`}
              onClick={() => onSelect(s.id)}
              onDoubleClick={() => onRenameSubcontractor(s)}
              onContextMenu={(e) => {
                e.preventDefault();
                onSelect(s.id);
                setMenu({ x: e.clientX, y: e.clientY, sub: s });
              }}
            >
              <span className="sublist__name">{s.name}</span>
              <AuditBadge audit={audits[s.id]} />
              <span className="sublist__actions">
                <button
                  className="sublist__btn"
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRenameSubcontractor(s);
                  }}
                >
                  ✎
                </button>
                <button
                  className="sublist__btn sublist__btn--del"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSubcontractor(s);
                  }}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {menu && (
        <div
          className="ctxmenu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="ctxmenu__item"
            onClick={() => {
              onShowAuditLog(menu.sub);
              setMenu(null);
            }}
          >
            Show audit log
          </button>
        </div>
      )}
    </aside>
  );
}

// Up-to-three status pills per row: Letter of Award and Final Account (both
// send-only, one-way documents), plus the Subcontract Agreement. Amber "Sent" = awaiting
// the signed return, green "Returned" = signed copy back; a document with no
// activity shows no pill. Hover reveals the dates.
function AuditBadge({ audit }: { audit?: Audit }) {
  if (!audit) return null;
  const pills = [
    // LOA "Sent" is informative (the one-way document is done), so a neutral
    // blue - not the amber SA "Sent" uses to flag an outstanding return.
    docPill("LOA", "Letter of Award", audit.loa_sent_date, null, "info"),
    docPill("FA", "Final Account", audit.fa_sent_date, null, "info"),
    docPill("SA", "Subcontract Agreement", audit.sa_sent_date, audit.sa_returned_date, "await"),
  ].filter((p): p is DocPill => p !== null);
  if (pills.length === 0) return null;
  return (
    <span className="sublist__badge">
      {pills.map((p, i) => (
        <span key={i} className={p.className} title={p.title}>
          {p.text}
        </span>
      ))}
    </span>
  );
}

interface DocPill {
  className: string;
  title: string;
  text: string;
}

function docPill(
  abbr: string,
  label: string,
  sent: string | null,
  returned: string | null,
  // How a "Sent" (not-yet-returned) state reads: "info" = neutral/done,
  // "await" = flagged as awaiting the signed return.
  sentTone: "info" | "await",
): DocPill | null {
  if (returned) {
    return {
      className: "audit-pill audit-pill--returned",
      title: `${label}: returned ${returned}${sent ? ` (sent ${sent})` : ""}`,
      text: `${abbr} Returned`,
    };
  }
  if (sent) {
    return {
      className: `audit-pill audit-pill--${sentTone === "await" ? "await" : "info"}`,
      title:
        sentTone === "await"
          ? `${label}: sent ${sent} - awaiting return`
          : `${label}: sent ${sent}`,
      text: `${abbr} Sent`,
    };
  }
  return null;
}
