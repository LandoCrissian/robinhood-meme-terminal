#!/usr/bin/env bash
set -euo pipefail

EXPECTED_CHAIN_ID="46630"
RPC_URL="${ROBINHOOD_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com/}"
CREATE2_DEPLOYER="0x4e59b44847b379578588920cA78FbF26c0B4956C"

if [[ -z "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  echo "DEPLOYER_PRIVATE_KEY is required. Use a dedicated testnet-only key." >&2
  exit 1
fi

ACTUAL_CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
if [[ "$ACTUAL_CHAIN_ID" != "$EXPECTED_CHAIN_ID" ]]; then
  echo "Refusing deployment: expected chain $EXPECTED_CHAIN_ID, received $ACTUAL_CHAIN_ID." >&2
  exit 1
fi

CREATE2_CODE="$(cast code "$CREATE2_DEPLOYER" --rpc-url "$RPC_URL")"
if [[ "$CREATE2_CODE" == "0x" ]]; then
  echo "Refusing deployment: the required CREATE2 deployer is missing." >&2
  exit 1
fi

echo "Deploying the guarded V4 test stack to Robinhood Chain testnet ($EXPECTED_CHAIN_ID)."
forge script script/DeployMemeLaunchFactory.s.sol:DeployMemeLaunchFactory \
  --rpc-url "$RPC_URL" \
  --broadcast \
  -vvvv

echo "Deployment broadcast complete. Record the manager, hook, adapter, factory, transaction hashes, and source commit from broadcast/."
