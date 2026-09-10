import type { Pool } from "pg";

export const CATALOG_PAGE_SIZE = 4096;
export const CATALOG_PAGE_SQL = `SELECT encode(token0,'hex') AS token0, encode(token1,'hex') AS token1,
  block_number, log_index FROM market_pools
  WHERE (block_number, log_index) < ($1, $2)
  ORDER BY block_number DESC, log_index DESC LIMIT 4096`;

// The existing event-key index bounds each database read. Deduplication uses
// the worker's existing in-memory catalog, not a PostgreSQL global sort/spill.
export async function readCanonicalTokenCatalog(pool: Pool): Promise<Set<string>> {
  const tokens = new Set<string>();
  let block = 2147483647;
  let log = 2147483647;
  while (true) {
    const result = await pool.query<{ token0: string; token1: string; block_number: number; log_index: number }>(
      CATALOG_PAGE_SQL, [block, log]);
    if (result.rows.length > CATALOG_PAGE_SIZE) throw new Error("INVALID_CATALOG_PAGE_SIZE");
    for (const row of result.rows) {
      if (!Number.isSafeInteger(row.block_number) || row.block_number < 0
        || !Number.isSafeInteger(row.log_index) || row.log_index < 0
        || !(row.block_number < block || (row.block_number === block && row.log_index < log))) {
        throw new Error("INVALID_CATALOG_CURSOR");
      }
      block = row.block_number;
      log = row.log_index;
      for (const token of [row.token0, row.token1]) {
        if (!/^[0-9a-f]{40}$/.test(token)) throw new Error("INVALID_CATALOG_ADDRESS");
        if (!/^0{40}$/.test(token)) tokens.add(`0x${token}`);
      }
    }
    if (result.rows.length < CATALOG_PAGE_SIZE) break;
  }
  // Preserve deterministic historical scheduling, independent of page order.
  return new Set([...tokens].sort());
}
