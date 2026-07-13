#!/usr/bin/env bash
set -euo pipefail

EXPECTED_CHAIN_ID="4663"
CANONICAL_POOL_MANAGER="0x8366a39cC670b4001A1121b8F6A443A643E40951"
EXPECTED_MARKET_FEE_BPS="100"
EXPECTED_VIRTUAL_ETH="300000000000000000"
EXPECTED_VIRTUAL_TOKEN="1073000000000000000000000000"
EXPECTED_GRADUATION_TARGET="1000000000000000000"

RPC_URL="${ROBINHOOD_MAINNET_RPC_URL:-}"
FACTORY_ADDRESS="${FACTORY_ADDRESS:-}"
EXPECTED_PLATFORM_TREASURY="${PLATFORM_TREASURY:-}"
EXPECTED_REWARDS_CONTROLLER="${REWARDS_CONTROLLER:-}"

fail() {
  echo "Mainnet smoke test failed: $1" >&2
  exit 1
}

[[ -n "$RPC_URL" ]] || fail "ROBINHOOD_MAINNET_RPC_URL is required."
[[ "$FACTORY_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "FACTORY_ADDRESS must be a valid EVM address."
[[ "$EXPECTED_PLATFORM_TREASURY" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "PLATFORM_TREASURY is required."
[[ "$EXPECTED_REWARDS_CONTROLLER" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "REWARDS_CONTROLLER is required."
[[ "$(cast chain-id --rpc-url "$RPC_URL")" == "$EXPECTED_CHAIN_ID" ]] || fail "RPC is not Robinhood Chain mainnet."
[[ "$(cast code "$FACTORY_ADDRESS" --rpc-url "$RPC_URL")" != "0x" ]] || fail "factory has no bytecode."

ADAPTER="$(cast call "$FACTORY_ADDRESS" 'graduationAdapter()(address)' --rpc-url "$RPC_URL")"
HOOK="$(cast call "$ADAPTER" 'hook()(address)' --rpc-url "$RPC_URL")"
MANAGER="$(cast call "$ADAPTER" 'poolManager()(address)' --rpc-url "$RPC_URL")"
BOUND_FACTORY="$(cast call "$ADAPTER" 'factory()(address)' --rpc-url "$RPC_URL")"
BOUND_ADAPTER="$(cast call "$HOOK" 'adapter()(address)' --rpc-url "$RPC_URL")"
TREASURY="$(cast call "$FACTORY_ADDRESS" 'platformTreasury()(address)' --rpc-url "$RPC_URL")"
CONTROLLER="$(cast call "$FACTORY_ADDRESS" 'rewardsController()(address)' --rpc-url "$RPC_URL")"
FEE="$(cast call "$FACTORY_ADDRESS" 'marketFeeBps()(uint16)' --rpc-url "$RPC_URL" | awk '{print $1}')"
VIRTUAL_ETH="$(cast call "$FACTORY_ADDRESS" 'initialVirtualEthReserve()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"
VIRTUAL_TOKEN="$(cast call "$FACTORY_ADDRESS" 'initialVirtualTokenReserve()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"
TARGET="$(cast call "$FACTORY_ADDRESS" 'graduationTarget()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"
COUNT="$(cast call "$FACTORY_ADDRESS" 'launchCount()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"

normalize() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

for ADDRESS in "$ADAPTER" "$HOOK" "$MANAGER"; do
  [[ "$(cast code "$ADDRESS" --rpc-url "$RPC_URL")" != "0x" ]] || fail "missing bytecode at $ADDRESS."
done

[[ "$(normalize "$MANAGER")" == "$(normalize "$CANONICAL_POOL_MANAGER")" ]] || fail "adapter is not using canonical PoolManager."
[[ "$(normalize "$BOUND_FACTORY")" == "$(normalize "$FACTORY_ADDRESS")" ]] || fail "adapter/factory binding mismatch."
[[ "$(normalize "$BOUND_ADAPTER")" == "$(normalize "$ADAPTER")" ]] || fail "hook/adapter binding mismatch."
[[ "$(normalize "$TREASURY")" == "$(normalize "$EXPECTED_PLATFORM_TREASURY")" ]] || fail "platform treasury mismatch."
[[ "$(normalize "$CONTROLLER")" == "$(normalize "$EXPECTED_REWARDS_CONTROLLER")" ]] || fail "rewards controller mismatch."
[[ "$FEE" == "$EXPECTED_MARKET_FEE_BPS" ]] || fail "market fee mismatch: $FEE."
[[ "$VIRTUAL_ETH" == "$EXPECTED_VIRTUAL_ETH" ]] || fail "virtual ETH reserve mismatch: $VIRTUAL_ETH."
[[ "$VIRTUAL_TOKEN" == "$EXPECTED_VIRTUAL_TOKEN" ]] || fail "virtual token reserve mismatch: $VIRTUAL_TOKEN."
[[ "$TARGET" == "$EXPECTED_GRADUATION_TARGET" ]] || fail "graduation target mismatch: $TARGET."

echo "Robinhood Chain mainnet stack verified."
echo "Factory: $FACTORY_ADDRESS"
echo "Adapter: $ADAPTER"
echo "Hook: $HOOK"
echo "Canonical PoolManager: $MANAGER"
echo "Launch count: $COUNT"
