import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./Modal.css";

export interface ModalAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Secondary actions render on the left (e.g. Cancel). */
  secondaryActions?: ModalAction[];
  /** Primary actions render on the right (e.g. Save, Delete). */
  primaryActions?: ModalAction[];
  width?: number;
}

// Standard app modal: movable (drag by header), with Header (title + X close),
// Body, and Footer (secondary actions left, primary actions right).
export function Modal({
  title,
  onClose,
  children,
  secondaryActions = [],
  primaryActions = [],
  width = 460,
}: ModalProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onHeaderMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Don't start a drag from the close button.
      if ((e.target as HTMLElement).closest(".modal__close")) return;
      const card = (e.currentTarget as HTMLElement).closest(
        ".modal__card",
      ) as HTMLElement;
      const rect = card.getBoundingClientRect();
      drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };

      const onMove = (ev: MouseEvent) => {
        if (!drag.current) return;
        const x = ev.clientX - drag.current.dx;
        const y = ev.clientY - drag.current.dy;
        // Keep the header on-screen.
        const maxX = window.innerWidth - 80;
        const maxY = window.innerHeight - 40;
        setPos({
          x: Math.min(Math.max(0, x), maxX),
          y: Math.min(Math.max(0, y), maxY),
        });
      };
      const onUp = () => {
        drag.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [],
  );

  const style: React.CSSProperties = pos
    ? { width, left: pos.x, top: pos.y, transform: "none" }
    : { width };

  return createPortal(
    <div className="modal__overlay" onMouseDown={onClose}>
      <div
        className="modal__card"
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal__header" onMouseDown={onHeaderMouseDown}>
          <h2 className="modal__title">{title}</h2>
          <button
            className="modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="modal__body">{children}</div>

        {(secondaryActions.length > 0 || primaryActions.length > 0) && (
          <footer className="modal__footer">
            <div className="modal__footer-left">
              {secondaryActions.map((a, i) => (
                <ModalButton key={i} action={a} />
              ))}
            </div>
            <div className="modal__footer-right">
              {primaryActions.map((a, i) => (
                <ModalButton key={i} action={a} />
              ))}
            </div>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ModalButton({ action }: { action: ModalAction }) {
  return (
    <button
      className={`btn btn--${action.variant ?? "secondary"}`}
      onClick={action.onClick}
      disabled={action.disabled}
    >
      {action.label}
    </button>
  );
}
