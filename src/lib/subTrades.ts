// Settings' "Sub Trades" reference list stores one trade per line as
// "Trade Name,Cost Code" (e.g. "Plumbing,623") — the cost code half drives
// the Subcontractor Details grid's auto-generated Code column.
export interface SubTradeEntry {
  trade: string;
  code: string;
}

export function parseSubTrades(json: string | undefined): SubTradeEntry[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v
      .map((line) => {
        const [trade, code] = String(line).split(",");
        return { trade: (trade ?? "").trim(), code: (code ?? "").trim() };
      })
      .filter((e) => e.trade);
  } catch {
    return [];
  }
}

/** "SC-<job number>-<cost code>", or "" if either half is missing. */
export function buildCostCode(
  trade: string,
  jobNumber: string | undefined,
  codeByTrade: Record<string, string>,
): string {
  const code = codeByTrade[trade.trim()];
  const job = (jobNumber ?? "").trim();
  if (!job || !code) return "";
  return `SC-${job}-${code}`;
}
