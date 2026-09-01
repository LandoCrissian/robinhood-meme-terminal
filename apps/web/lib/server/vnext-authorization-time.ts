import { createPublicClient, http } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";

export const VNEXT_AUTHORIZATION_WINDOW_SECONDS = 240n;
export const VNEXT_MAX_AUTHORIZATION_WINDOW_SECONDS = 300n;
export const VNEXT_PLAN_MAX_AGE_MS = 60_000;
export const VNEXT_MINIMUM_WALLET_REVIEW_RUNWAY_MS = 180_000;

const MAX_CHAIN_CLOCK_LAG_MS = 30_000;
const MAX_CHAIN_CLOCK_LEAD_MS = 5_000;

export function vNextAuthorizationRpcUrl(
  env: Readonly<Record<string, string | undefined>>,
  fallback: string
) {
  return env.RMT_RPC_URL?.trim()
    || env.RMT_MAINNET_RPC_URL?.trim()
    || env.ROBINHOOD_MAINNET_RPC_URL?.trim()
    || env.NEXT_PUBLIC_RMT_RPC_URL?.trim()
    || fallback;
}

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    vNextAuthorizationRpcUrl(process.env, robinhoodChain.rpcUrls.default.http[0]),
    { retryCount: 2, timeout: 8_000 }
  )
});

export function deriveVNextAuthorizationTiming(chainTimestampSeconds: bigint, preparedAtMs: number) {
  const chainTimestampMs = Number(chainTimestampSeconds * 1_000n);
  if (
    chainTimestampSeconds <= 0n
    || !Number.isSafeInteger(chainTimestampMs)
    || !Number.isSafeInteger(preparedAtMs)
    || preparedAtMs <= 0
    || chainTimestampMs > preparedAtMs + MAX_CHAIN_CLOCK_LEAD_MS
    || preparedAtMs - chainTimestampMs > MAX_CHAIN_CLOCK_LAG_MS
  ) throw new Error("Authoritative Robinhood Chain time is unavailable or stale.");

  const deadlineSeconds = chainTimestampSeconds + VNEXT_AUTHORIZATION_WINDOW_SECONDS;
  const deadlineMs = Number(deadlineSeconds * 1_000n);
  const expiresAtMs = Math.min(
    preparedAtMs + VNEXT_PLAN_MAX_AGE_MS,
    deadlineMs - VNEXT_MINIMUM_WALLET_REVIEW_RUNWAY_MS
  );
  if (expiresAtMs <= preparedAtMs || deadlineSeconds > chainTimestampSeconds + VNEXT_MAX_AUTHORIZATION_WINDOW_SECONDS) {
    throw new Error("The verified wallet-review runway is unavailable.");
  }
  return { chainTimestampMs, deadlineSeconds, deadlineMs, preparedAtMs, expiresAtMs } as const;
}

export function deriveVNextCommittedAuthorizationTiming(
  chainTimestampSeconds: bigint,
  preparedAtMs: number,
  committedDeadlineSeconds: bigint
) {
  const chainTimestampMs = Number(chainTimestampSeconds * 1_000n);
  if (
    chainTimestampSeconds <= 0n
    || !Number.isSafeInteger(chainTimestampMs)
    || !Number.isSafeInteger(preparedAtMs)
    || preparedAtMs <= 0
    || chainTimestampMs > preparedAtMs + MAX_CHAIN_CLOCK_LEAD_MS
    || preparedAtMs - chainTimestampMs > MAX_CHAIN_CLOCK_LAG_MS
    || committedDeadlineSeconds <= chainTimestampSeconds
    || committedDeadlineSeconds > chainTimestampSeconds + VNEXT_MAX_AUTHORIZATION_WINDOW_SECONDS
  ) throw new Error("Authoritative Robinhood Chain time or the committed deadline is unavailable or stale.");
  const deadlineMs = Number(committedDeadlineSeconds * 1_000n);
  const expiresAtMs = Math.min(
    preparedAtMs + VNEXT_PLAN_MAX_AGE_MS,
    deadlineMs - VNEXT_MINIMUM_WALLET_REVIEW_RUNWAY_MS
  );
  if (!Number.isSafeInteger(deadlineMs) || expiresAtMs <= preparedAtMs) {
    throw new Error("The verified wallet-review runway is unavailable.");
  }
  return {
    chainTimestampMs,
    deadlineSeconds: committedDeadlineSeconds,
    deadlineMs,
    preparedAtMs,
    expiresAtMs
  } as const;
}

export async function readVNextAuthorizationChainTimestamp() {
  const block = await client.getBlock({ blockTag: "latest" });
  if (!block.hash || block.timestamp <= 0n) throw new Error("Authoritative Robinhood Chain time is unavailable.");
  return block.timestamp;
}
