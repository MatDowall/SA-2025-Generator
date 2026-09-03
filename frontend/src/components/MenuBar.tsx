import { useEffect, useRef, useState } from "react";
import "./MenuBar.css";

export interface MenuItem {
  label: string;
  action?: () => void;
  disabled?: boolean;
  separatorAfter?: boolean;
  shortcut?: string;
}

export interface MenuDef {
  label: string;
  items: MenuItem[];
}

export function MenuBar({ menus }: { menus: MenuDef[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (open === null) return;
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menubar" ref={barRef}>
      {menus.map((menu, i) => (
        <div className="menubar__menu" key={menu.label}>
          <button
            className={`menubar__top ${open === i ? "is-open" : ""}`}
            onClick={() => setOpen(open === i ? null : i)}
            onMouseEnter={() => open !== null && setOpen(i)}
          >
            {menu.label}
          </button>

          {open === i && (
            <div className="menubar__dropdown" role="menu">
              {menu.items.map((item, j) => (
                <div key={j}>
                  <button
                    className="menubar__item"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(null);
                      item.action?.();
                    }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && (
                      <span className="menubar__shortcut">{item.shortcut}</span>
                    )}
                  </button>
                  {item.separatorAfter && (
                    <div className="menubar__separator" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
