import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  loadTemplateDocument,
  getPageLayout,
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask,
  type FieldBox,
} from "../pdf";
import { FieldOverlay } from "./FieldOverlay";
import "./PdfViewer.css";

const DATA_PAGE_LIMIT = 10;

export interface PdfViewerHandle {
  goToPage: (page: number) => void;
}

interface PdfViewerProps {
  zoom: number;
  values: Record<string, string>;
  editable: boolean;
  onFieldChange: (name: string, value: string) => void;
  onLoaded: (pageCount: number) => void;
  onPageChange: (page: number) => void;
  onError: (message: string) => void;
}

// Renders the template PDF as a vertical stack of pages (scrollable), using
// pdf.js. Crisp at the display's device pixel ratio; re-renders on zoom change.
export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(
  function PdfViewer(
    { zoom, values, editable, onFieldChange, onLoaded, onPageChange, onError },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const pageEls = useRef<(HTMLDivElement | null)[]>([]);
    const canvasEls = useRef<(HTMLCanvasElement | null)[]>([]);
    const docRef = useRef<PDFDocumentProxy | null>(null);
    const taskRef = useRef<PDFDocumentLoadingTask | null>(null);
    const renderTasks = useRef<Array<{ cancel: () => void }>>([]);
    const [numPages, setNumPages] = useState(0);
    const [loading, setLoading] = useState(true);
    const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
    const [boxesByPage, setBoxesByPage] = useState<Map<number, FieldBox[]>>(
      new Map(),
    );

    // Click-and-drag (hand tool) panning. Ignores drags that start on an
    // interactive element so it won't fight form-field editing in later
    // milestones.
    const onPanStart = (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, button, a, [contenteditable]"))
        return;
      const container = containerRef.current;
      if (!container) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = container.scrollLeft;
      const startTop = container.scrollTop;
      let dragging = false;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) < 4) return; // ignore tiny clicks
        dragging = true;
        container.classList.add("is-panning");
        container.scrollLeft = startLeft - dx;
        container.scrollTop = startTop - dy;
        ev.preventDefault();
      };
      const onUp = () => {
        container.classList.remove("is-panning");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

    useImperativeHandle(ref, () => ({
      goToPage(page: number) {
        const el = pageEls.current[page - 1];
        const container = containerRef.current;
        if (el && container) {
          container.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
        }
      },
    }));

    // Load the document once.
    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const task = await loadTemplateDocument();
          taskRef.current = task;
          const doc = await task.promise;
          if (cancelled) {
            task.destroy();
            return;
          }
          docRef.current = doc;
          pageEls.current = new Array(doc.numPages).fill(null);
          canvasEls.current = new Array(doc.numPages).fill(null);
          setNumPages(doc.numPages);
          setLoading(false);
          onLoaded(doc.numPages);

          // Field positions + page sizes for the editable overlay.
          const layout = await getPageLayout(doc, DATA_PAGE_LIMIT);
          if (!cancelled) {
            setSizes(layout.sizes);
            setBoxesByPage(layout.boxesByPage);
          }
        } catch (e) {
          if (!cancelled) onError(`Failed to load PDF: ${String(e)}`);
        }
      })();
      return () => {
        cancelled = true;
        renderTasks.current.forEach((t) => t.cancel());
        taskRef.current?.destroy();
        taskRef.current = null;
        docRef.current = null;
      };
    }, [onLoaded, onError]);

    // (Re)render every page whenever the document or zoom changes.
    useEffect(() => {
      const doc = docRef.current;
      if (!doc || numPages === 0) return;
      let cancelled = false;

      // Cancel any in-flight renders before starting a new pass.
      renderTasks.current.forEach((t) => t.cancel());
      renderTasks.current = [];

      const dpr = window.devicePixelRatio || 1;

      (async () => {
        for (let n = 1; n <= numPages; n++) {
          if (cancelled) return;
          const canvas = canvasEls.current[n - 1];
          if (!canvas) continue;
          const page = await doc.getPage(n);
          if (cancelled) return;
          // Render at device-pixel resolution for crisp text; display at the
          // CSS (logical) size so the page measures correctly on screen.
          const viewport = page.getViewport({ scale: zoom });
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;

          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;

          const renderViewport =
            dpr !== 1 ? page.getViewport({ scale: zoom * dpr }) : viewport;
          const task = page.render({
            canvas,
            canvasContext: ctx,
            viewport: renderViewport,
          });
          renderTasks.current.push(task);
          try {
            await task.promise;
          } catch {
            /* render cancelled — expected when zoom changes mid-pass */
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [numPages, zoom]);

    // Track the most-visible page for the status bar.
    useEffect(() => {
      if (numPages === 0) return;
      const container = containerRef.current;
      if (!container) return;

      const ratios = new Map<number, number>();
      const observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page);
            ratios.set(n, e.intersectionRatio);
          }
          let best = 1;
          let bestRatio = -1;
          for (const [n, r] of ratios) {
            if (r > bestRatio) {
              bestRatio = r;
              best = n;
            }
          }
          onPageChange(best);
        },
        { root: container, threshold: [0.1, 0.25, 0.5, 0.75, 1] },
      );

      pageEls.current.forEach((el) => el && observer.observe(el));
      return () => observer.disconnect();
    }, [numPages, onPageChange]);

    return (
      <div className="pdfviewer" ref={containerRef} onMouseDown={onPanStart}>
        {loading && <div className="pdfviewer__loading">Loading PDF…</div>}
        <div className="pdfviewer__pages">
          {Array.from({ length: numPages }, (_, i) => {
            const size = sizes[i];
            const boxes = boxesByPage.get(i + 1);
            const style = size
              ? { width: size.w * zoom, height: size.h * zoom }
              : undefined;
            return (
              <div
                key={i}
                className="pdfviewer__page"
                data-page={i + 1}
                style={style}
                ref={(el) => {
                  pageEls.current[i] = el;
                }}
              >
                <canvas
                  ref={(el) => {
                    canvasEls.current[i] = el;
                  }}
                />
                {boxes && boxes.length > 0 && (
                  <FieldOverlay
                    boxes={boxes}
                    zoom={zoom}
                    values={values}
                    editable={editable}
                    onChange={onFieldChange}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);
