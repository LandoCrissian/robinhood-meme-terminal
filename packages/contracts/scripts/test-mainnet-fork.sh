#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_RPC_URL="${ROBINHOOD_MAINNET_RPC_URL:-https://rpc.mainnet.chain.robinhood.com/}"
FORK_PORT="${RMT_FORK_PORT:-8547}"
FORK_RPC_URL="http://127.0.0.1:$FORK_PORT"
ANVIL_LOG="${TMPDIR:-/tmp}/rmt-mainnet-fork-anvil.log"
FORK_COMPUTE_UNITS_PER_SECOND="${RMT_FORK_COMPUTE_UNITS_PER_SECOND:-75}"
FORK_REQUEST_RETRIES="${RMT_FORK_REQUEST_RETRIES:-8}"
FORK_RETRY_BACKOFF_MS="${RMT_FORK_RETRY_BACKOFF_MS:-1500}"
FORK_REQUEST_TIMEOUT_MS="${RMT_FORK_REQUEST_TIMEOUT_MS:-60000}"

cleanup() {
  if [[ -n "${ANVIL_PID:-}" ]]; then
    kill "$ANVIL_PID" 2>/dev/null || true
    wait "$ANVIL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

anvil \
  --fork-url "$UPSTREAM_RPC_URL" \
  --chain-id 4663 \
  --port "$FORK_PORT" \
  --compute-units-per-second "$FORK_COMPUTE_UNITS_PER_SECOND" \
  --retries "$FORK_REQUEST_RETRIES" \
  --fork-retry-backoff "$FORK_RETRY_BACKOFF_MS" \
  --timeout "$FORK_REQUEST_TIMEOUT_MS" \
  --silent >"$ANVIL_LOG" 2>&1 &
ANVIL_PID=$!

for _ in {1..30}; do
  if cast chain-id --rpc-url "$FORK_RPC_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if [[ "$(cast chain-id --rpc-url "$FORK_RPC_URL" 2>/dev/null || true)" != "4663" ]]; then
  cat "$ANVIL_LOG" >&2
  echo "Robinhood mainnet fork did not start correctly." >&2
  exit 1
fi

RMT_FORK_REHEARSAL=true \
  forge script script/DeployMainnetV6OfficialMigration.s.sol:DeployMainnetV6OfficialMigration \
  --fork-url "$FORK_RPC_URL" \
  -vvvv

ROBINHOOD_MAINNET_RPC_URL="$FORK_RPC_URL" \
  forge test --match-contract V6MainnetForkTest -vvv

ROBINHOOD_MAINNET_RPC_URL="$FORK_RPC_URL" \
  forge test --match-contract V6UniversalRouterForkTest -vvv

echo "The exact V6 deployment script, phased launch, graduation, fee routing, and official Universal Router Buy/Sell rehearsal passed on a Robinhood mainnet fork."
