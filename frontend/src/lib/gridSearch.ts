import type Handsontable from "handsontable";

// Hides (rather than removes) rows whose source data has no column
// containing `query` anywhere, using the TrimRows plugin so physical row
// indices/ids stay stable for the rest of each grid's edit/save logic.
// Source data is read via getSourceData (always full + physical-ordered,
// unaffected by any existing trim) so re-filtering after a previous filter
// still sees every row.
export function applySearchFilter(hot: Handsontable, query: string): void {
  const trimPlugin = hot.getPlugin("trimRows");
  const q = query.trim().toLowerCase();
  if (!q) {
    trimPlugin.untrimAll();
    hot.render();
    return;
  }
  const data = hot.getSourceData() as Record<string, unknown>[];
  const rowsToTrim: number[] = [];
  data.forEach((row, physicalRow) => {
    const matches = Object.values(row).some(
      (v) => v !== null && v !== undefined && String(v).toLowerCase().includes(q),
    );
    if (!matches) rowsToTrim.push(physicalRow);
  });
  trimPlugin.untrimAll();
  trimPlugin.trimRows(rowsToTrim);
  hot.render();
}
