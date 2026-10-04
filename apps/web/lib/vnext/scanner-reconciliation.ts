/** Preserve positions during interaction, but never resurrect excluded evidence. */
export function reconcileScannerRows<T>(rows: readonly T[], ids: readonly string[], key: (row: T) => string, hold: boolean, previousPageRows: readonly T[] = [], eligibleRows: readonly T[] = rows) {
  if (!hold || !ids.length) return { rows: [...rows], pending: false, newCount: 0 };
  // The ranked window is presentation, not exclusion authority. Markets pass
  // the current eligible view before slicing; held identities may move below
  // the cutoff, but absence from that eligible view still removes them.
  const byId = new Map(eligibleRows.map(row => [key(row), row]));
  // A bounded page omission is not an authoritative deletion. Only paged
  // readers opt in; canonical market exclusions continue to take effect.
  for (const row of previousPageRows) if (!byId.has(key(row))) byId.set(key(row), row);
  const previous = new Set(ids);
  const currentIds = rows.map(key);
  return {
    // Retain only the established rendered window: no historical accumulation
    // or new entrants during hold, and metrics always come from current rows.
    rows: ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []),
    pending: currentIds.join("|") !== ids.filter(id => byId.has(id)).join("|"),
    newCount: currentIds.filter(id => !previous.has(id)).length
  };
}
