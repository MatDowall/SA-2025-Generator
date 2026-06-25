import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Generic debounced key/value field editor backed by a per-entity store
 * (e.g. field_values keyed by subcontractor, contract_info_values keyed by
 * project). Extracted from App.tsx's original PDF-field-edit logic so the
 * same load/edit/debounce/flush behavior can be reused by the Contract Info
 * form and the Subcontractor Details / TP Companies grids.
 */
export function useDebouncedFieldSave(
  entityId: number | null,
  fetchValues: (id: number) => Promise<Record<string, string>>,
  saveValue: (id: number, key: string, value: string) => Promise<void>,
  debounceMs = 350,
) {
  const [values, setValues] = useState<Record<string, string>>({});
  const valuesRef = useRef<Record<string, string>>({});
  const activeIdRef = useRef<number | null>(null);
  const pendingRef = useRef<Set<string>>(new Set());
  const flushTimer = useRef<number | null>(null);

  const load = useCallback(
    async (id: number | null) => {
      activeIdRef.current = id;
      if (id == null) {
        setValues({});
        valuesRef.current = {};
        return;
      }
      const v = await fetchValues(id);
      // If the caller switched entities while loading, drop this stale result.
      if (activeIdRef.current !== id) return;
      // Preserve any edits made to this same entity while the load was in flight.
      const merged = { ...v };
      for (const key of pendingRef.current) {
        merged[key] = valuesRef.current[key] ?? "";
      }
      setValues(merged);
      valuesRef.current = merged;
    },
    [fetchValues],
  );

  const flush = useCallback(
    async (id: number | null) => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      if (id == null || pendingRef.current.size === 0) return;
      // Snapshot the values now — valuesRef may be reassigned by an entity
      // switch before these awaits resolve.
      const snapshot = valuesRef.current;
      const pairs = [...pendingRef.current].map(
        (key) => [key, snapshot[key] ?? ""] as const,
      );
      pendingRef.current.clear();
      for (const [key, value] of pairs) {
        await saveValue(id, key, value);
      }
    },
    [saveValue],
  );

  // Load values when the active entity changes; flush the outgoing one.
  useEffect(() => {
    load(entityId);
    const outgoing = entityId;
    return () => {
      void flush(outgoing);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  const onFieldChange = useCallback(
    (key: string, value: string) => {
      setValues((v) => {
        const next = { ...v, [key]: value };
        valuesRef.current = next;
        return next;
      });
      pendingRef.current.add(key);
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(() => {
        void flush(entityId);
      }, debounceMs);
    },
    [entityId, flush, debounceMs],
  );

  return { values, onFieldChange, load, flush, valuesRef, activeIdRef, pendingRef };
}
