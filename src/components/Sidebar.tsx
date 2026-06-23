import type { Project, Subcontractor } from "../api";
import "./Sidebar.css";

interface SidebarProps {
  project: Project | null;
  subcontractors: Subcontractor[];
  activeId: number | null;
  onNewProject: () => void;
  onOpenProject: () => void;
  onRenameProject: () => void;
  onSelect: (id: number) => void;
  onAddSubcontractor: () => void;
  onRenameSubcontractor: (s: Subcontractor) => void;
  onDeleteSubcontractor: (s: Subcontractor) => void;
}

// Left-hand navigation pane: open-project header + subcontractor agreement list.
export function Sidebar({
  project,
  subcontractors,
  activeId,
  onNewProject,
  onOpenProject,
  onRenameProject,
  onSelect,
  onAddSubcontractor,
  onRenameSubcontractor,
  onDeleteSubcontractor,
}: SidebarProps) {
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
            >
              <span className="sublist__name">{s.name}</span>
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
    </aside>
  );
}
