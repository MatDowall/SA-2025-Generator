import "./TabBar.css";

export interface TabDef<T extends string> {
  key: T;
  label: string;
}

export function TabBar<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: TabDef<T>[];
  active: T;
  onSelect: (key: T) => void;
}) {
  return (
    <div className="tabbar" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={active === tab.key}
          className={`tabbar__tab ${active === tab.key ? "is-active" : ""}`}
          onClick={() => onSelect(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
