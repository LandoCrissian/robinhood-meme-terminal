#!/usr/bin/env bash
set -euo pipefail

RPC_URL="${ROBINHOOD_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com/}"
FACTORY_ADDRESS="${FACTORY_ADDRESS:-}"

if [[ ! "$FACTORY_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "FACTORY_ADDRESS must be a valid EVM address." >&2
  exit 1
fi

CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
if [[ "$CHAIN_ID" != "46630" ]]; then
  echo "Refusing smoke test: RPC is chain $CHAIN_ID, not Robinhood testnet 46630." >&2
  exit 1
fi

CODE="$(cast code "$FACTORY_ADDRESS" --rpc-url "$RPC_URL")"
if [[ "$CODE" == "0x" ]]; then
  echo "No contract bytecode found at $FACTORY_ADDRESS." >&2
  exit 1
fi

COUNT="$(cast call "$FACTORY_ADDRESS" 'launchCount()(uint256)' --rpc-url "$RPC_URL")"
ADAPTER_ADDRESS="$(cast call "$FACTORY_ADDRESS" 'graduationAdapter()(address)' --rpc-url "$RPC_URL")"
HOOK_ADDRESS="$(cast call "$ADAPTER_ADDRESS" 'hook()(address)' --rpc-url "$RPC_URL")"
MANAGER_ADDRESS="$(cast call "$ADAPTER_ADDRESS" 'poolManager()(address)' --rpc-url "$RPC_URL")"
BOUND_FACTORY="$(cast call "$ADAPTER_ADDRESS" 'factory()(address)' --rpc-url "$RPC_URL")"
BOUND_ADAPTER="$(cast call "$HOOK_ADDRESS" 'adapter()(address)' --rpc-url "$RPC_URL")"
TARGET="$(cast call "$FACTORY_ADDRESS" 'GRADUATION_TARGET()(uint256)' --rpc-url "$RPC_URL")"

for ADDRESS in "$ADAPTER_ADDRESS" "$HOOK_ADDRESS" "$MANAGER_ADDRESS"; do
  if [[ "$(cast code "$ADDRESS" --rpc-url "$RPC_URL")" == "0x" ]]; then
    echo "Missing deployed bytecode at $ADDRESS." >&2
    exit 1
  fi
done

normalize_address() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

if [[ "$(normalize_address "$BOUND_FACTORY")" != "$(normalize_address "$FACTORY_ADDRESS")" ]]; then
  echo "Adapter is not bound to the configured factory." >&2
  exit 1
fi

if [[ "$(normalize_address "$BOUND_ADAPTER")" != "$(normalize_address "$ADAPTER_ADDRESS")" ]]; then
  echo "Hook is not bound to the factory adapter." >&2
  exit 1
fi

if [[ "$TARGET" != "1000000000000000" ]]; then
  echo "Unexpected testnet graduation target: $TARGET." >&2
  exit 1
fi

echo "Guarded stack verified."
echo "Factory: $FACTORY_ADDRESS"
echo "Adapter: $ADAPTER_ADDRESS"
echo "Hook: $HOOK_ADDRESS"
echo "PoolManager: $MANAGER_ADDRESS"
echo "Graduation target: $TARGET wei"
echo "Launch count: $COUNT"
