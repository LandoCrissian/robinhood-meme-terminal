#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_RPC_URL="${ROBINHOOD_MAINNET_RPC_URL:-https://rpc.mainnet.chain.robinhood.com/}"
FORK_PORT="${RMT_FORK_PORT:-8547}"
FORK_RPC_URL="http://127.0.0.1:$FORK_PORT"
ANVIL_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
TEST_SIGNER_ONE="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
TEST_SIGNER_TWO="0x2000000000000000000000000000000000000002"
TEST_SIGNER_THREE="0x3000000000000000000000000000000000000003"
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

ROBINHOOD_MAINNET_RPC_URL="$FORK_RPC_URL" \
DEPLOYER_PRIVATE_KEY="$ANVIL_PRIVATE_KEY" \
SIGNER_ONE="$TEST_SIGNER_ONE" \
SIGNER_TWO="$TEST_SIGNER_TWO" \
SIGNER_THREE="$TEST_SIGNER_THREE" \
MAINNET_DEPLOYMENT_CONFIRMED="YES_DEPLOY_ROBINHOOD_MAINNET" \
  bash scripts/deploy-mainnet.sh

BROADCAST_FILE="broadcast/DeployMainnetMemeLaunchFactory.s.sol/4663/run-latest.json"
[[ -f "$BROADCAST_FILE" ]] || {
  echo "Mainnet fork deployment did not produce a broadcast record." >&2
  exit 1
}

readarray -t DEPLOYMENTS < <(node - "$BROADCAST_FILE" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const run = JSON.parse(fs.readFileSync(path, "utf8"));
for (const name of ["LowCostMemeLaunchFactoryV4", "ProtocolRevenueRouter", "VersionedFactoryRegistry", "PurposeRewardsController"]) {
  const deployment = run.transactions.find(
    (transaction) => transaction.contractName === name && transaction.contractAddress,
  );
  if (!deployment) process.exit(1);
  process.stdout.write(deployment.contractAddress + "\n");
}
NODE
)

FACTORY_ADDRESS="${DEPLOYMENTS[0]}"
ROUTER_ADDRESS="${DEPLOYMENTS[1]}"
REGISTRY_ADDRESS="${DEPLOYMENTS[2]}"
CONTROLLER_ADDRESS="${DEPLOYMENTS[3]}"

ROBINHOOD_MAINNET_RPC_URL="$FORK_RPC_URL" \
FACTORY_ADDRESS="$FACTORY_ADDRESS" \
ROUTER_ADDRESS="$ROUTER_ADDRESS" \
REGISTRY_ADDRESS="$REGISTRY_ADDRESS" \
CONTROLLER_ADDRESS="$CONTROLLER_ADDRESS" \
SIGNER_ONE="$TEST_SIGNER_ONE" \
SIGNER_TWO="$TEST_SIGNER_TWO" \
SIGNER_THREE="$TEST_SIGNER_THREE" \
  bash scripts/smoke-test-mainnet.sh

ROBINHOOD_MAINNET_RPC_URL="$FORK_RPC_URL" \
  forge test --match-contract DeployedMainnetGraduationForkTest -vvv

echo "Secured V4 release stack passed deployment, invariant, and full graduation checks on a Robinhood mainnet fork."
