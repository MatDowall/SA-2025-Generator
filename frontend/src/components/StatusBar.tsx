import "./StatusBar.css";

export interface StatusBarProps {
  page: number;
  pageCount: number;
  zoom: number;
  onFirstPage: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onLastPage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  message?: string;
}

// Bottom status bar / footer: page navigation, zoom, and ad-hoc messages.
// Controls are wired to placeholder state in M1; they drive the real viewer in M2.
export function StatusBar({
  page,
  pageCount,
  zoom,
  onFirstPage,
  onPrevPage,
  onNextPage,
  onLastPage,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  message,
}: StatusBarProps) {
  return (
    <footer className="statusbar">
      <div className="statusbar__group">
        <button className="statusbar__btn" onClick={onFirstPage} title="First page">
          «
        </button>
        <button className="statusbar__btn" onClick={onPrevPage} title="Previous page">
          ‹
        </button>
        <span className="statusbar__label">
          Page {page} / {pageCount}
        </span>
        <button className="statusbar__btn" onClick={onNextPage} title="Next page">
          ›
        </button>
        <button className="statusbar__btn" onClick={onLastPage} title="Last page">
          »
        </button>
      </div>

      <div className="statusbar__spacer">{message}</div>

      <div className="statusbar__group">
        <button className="statusbar__btn" onClick={onZoomOut} title="Zoom out">
          −
        </button>
        <span className="statusbar__label">{Math.round(zoom * 100)}%</span>
        <button className="statusbar__btn" onClick={onZoomIn} title="Zoom in">
          +
        </button>
        <button
          className="statusbar__btn"
          onClick={onZoomReset}
          title="Reset zoom (100%)"
        >
          ⟲
        </button>
      </div>
    </footer>
  );
}
