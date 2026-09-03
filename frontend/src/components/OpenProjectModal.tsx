import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { api, type Project } from "../api";
import "./Forms.css";

interface OpenProjectModalProps {
  onOpen: (project: Project) => void;
  onRequestDelete: (project: Project) => void;
  onClose: () => void;
}

// Lists existing projects so the user can open or delete one.
export function OpenProjectModal({
  onOpen,
  onRequestDelete,
  onClose,
}: OpenProjectModalProps) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  const selectedProject = projects?.find((p) => p.id === selected) ?? null;

  return (
    <Modal
      title="Open Project"
      onClose={onClose}
      width={520}
      secondaryActions={[{ label: "Cancel", onClick: onClose }]}
      primaryActions={[
        {
          label: "Open",
          variant: "primary",
          disabled: !selectedProject,
          onClick: () => selectedProject && onOpen(selectedProject),
        },
      ]}
    >
      {projects === null ? (
        <p>Loading…</p>
      ) : projects.length === 0 ? (
        <p style={{ margin: 0, color: "var(--text-muted)" }}>
          No projects yet. Create one with File → New Project.
        </p>
      ) : (
        <ul className="picklist">
          {projects.map((p) => (
            <li
              key={p.id}
              className={`picklist__row ${selected === p.id ? "is-selected" : ""}`}
              onClick={() => setSelected(p.id)}
              onDoubleClick={() => onOpen(p)}
            >
              <div className="picklist__main">
                <span className="picklist__title">{p.name}</span>
                <span className="picklist__sub">#{p.project_number}</span>
              </div>
              <button
                className="picklist__del"
                title="Delete project"
                onClick={(e) => {
                  e.stopPropagation();
                  onRequestDelete(p);
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
