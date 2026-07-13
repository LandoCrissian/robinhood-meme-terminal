#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_RPC_URL="${ROBINHOOD_MAINNET_RPC_URL:-https://rpc.mainnet.chain.robinhood.com/}"
FORK_PORT="${RMT_FORK_PORT:-8547}"
FORK_RPC_URL="http://127.0.0.1:$FORK_PORT"
ANVIL_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
TEST_TREASURY="0x1000000000000000000000000000000000000001"
TEST_CONTROLLER="0x2000000000000000000000000000000000000002"
ANVIL_LOG="${TMPDIR:-/tmp}/rmt-mainnet-fork-anvil.log"

cleanup() {
  if [[ -n "${ANVIL_PID:-}" ]]; then
    kill "$ANVIL_PID" 2>/dev/null || true
    wait "$ANVIL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

anvil --fork-url "$UPSTREAM_RPC_URL" --chain-id 4663 --port "$FORK_PORT" --silent >"$ANVIL_LOG" 2>&1 &
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

ROBINHOOD_MAINNET_RPC_URL="$FORK_RPC_URL" \
DEPLOYER_PRIVATE_KEY="$ANVIL_PRIVATE_KEY" \
PLATFORM_TREASURY="$TEST_TREASURY" \
REWARDS_CONTROLLER="$TEST_CONTROLLER" \
MAINNET_DEPLOYMENT_CONFIRMED="YES_DEPLOY_ROBINHOOD_MAINNET" \
  bash scripts/deploy-mainnet.sh

BROADCAST_FILE="broadcast/DeployMainnetMemeLaunchFactory.s.sol/4663/run-latest.json"
[[ -f "$BROADCAST_FILE" ]] || {
  echo "Mainnet fork deployment did not produce a broadcast record." >&2
  exit 1
}

FACTORY_ADDRESS="$(node - "$BROADCAST_FILE" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const run = JSON.parse(fs.readFileSync(path, "utf8"));
const deployment = run.transactions.find(
  (transaction) => transaction.contractName === "LowCostMemeLaunchFactoryV3" && transaction.contractAddress,
);
if (!deployment) process.exit(1);
process.stdout.write(deployment.contractAddress);
NODE
)"

ROBINHOOD_MAINNET_RPC_URL="$FORK_RPC_URL" \
FACTORY_ADDRESS="$FACTORY_ADDRESS" \
PLATFORM_TREASURY="$TEST_TREASURY" \
REWARDS_CONTROLLER="$TEST_CONTROLLER" \
  bash scripts/smoke-test-mainnet.sh

echo "Exact mainnet release stack passed end-to-end deployment and binding checks on a Robinhood mainnet fork."
