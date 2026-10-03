/** Preserve positions during interaction, but never resurrect excluded evidence. */
export function reconcileScannerRows<T>(rows: readonly T[], ids: readonly string[], key: (row: T) => string, hold: boolean) {
  if (!hold || !ids.length) return { rows: [...rows], pending: false, newCount: 0 };
  const byId = new Map(rows.map(row => [key(row), row]));
  const previous = new Set(ids);
  const currentIds = rows.map(key);
  return {
    rows: ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []),
    pending: currentIds.join("|") !== ids.filter(id => byId.has(id)).join("|"),
    newCount: currentIds.filter(id => !previous.has(id)).length
  };
}
