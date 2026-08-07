import type { Address } from "viem";
import {
  readTradeExecutionJournal,
  updateTradeExecutionRecord,
  type TradeExecutionSide,
  type TradeExecutionStorage
} from "./trade-execution-reliability";

const RECOVERABLE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

/**
 * A pending buy or sell remains the same exposure even if automatic routing
 * later selects a different venue or pool. Recover the newest unresolved hash
 * for the wallet, token, and side so a route change cannot enable a duplicate
 * submission.
 */
export function findRecoverableTradeAcrossRoutes(
  identity: { wallet: Address; token: Address; side: TradeExecutionSide },
  storage?: TradeExecutionStorage,
  now = Date.now()
) {
  const wallet = identity.wallet.toLowerCase();
  const token = identity.token.toLowerCase();
  const record = readTradeExecutionJournal(storage, now).find((candidate) => (
    candidate.state === "submitted"
    && candidate.wallet.toLowerCase() === wallet
    && candidate.token.toLowerCase() === token
    && candidate.side === identity.side
    && now - candidate.createdAt <= RECOVERABLE_MAX_AGE_MS
  ));
  if (!record) return null;
  if (record.recoveredAt === undefined) {
    updateTradeExecutionRecord(record.id, { recoveredAt: now }, storage, now);
  }
  return { ...record, recoveredAt: record.recoveredAt ?? now };
}
