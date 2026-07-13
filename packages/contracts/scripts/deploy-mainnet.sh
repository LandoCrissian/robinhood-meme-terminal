#!/usr/bin/env bash
set -euo pipefail

EXPECTED_CHAIN_ID="4663"
CANONICAL_POOL_MANAGER="0x8366a39cC670b4001A1121b8F6A443A643E40951"
CREATE2_DEPLOYER="0x4e59b44847b379578588920cA78FbF26c0B4956C"
RPC_URL="${ROBINHOOD_MAINNET_RPC_URL:-}"

fail() {
  echo "Mainnet deployment refused: $1" >&2
  exit 1
}

normalize() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

require_address() {
  local name="$1"
  local value="${!name:-}"
  [[ "$value" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "$name must be a valid EVM address."
}

require_contract() {
  local name="$1"
  local value="${!name}"
  [[ "$(cast code "$value" --rpc-url "$RPC_URL")" != "0x" ]] ||
    fail "$name must be a deployed multisig or purpose-specific contract, not an EOA."
}

[[ "${MAINNET_DEPLOYMENT_CONFIRMED:-}" == "YES_DEPLOY_ROBINHOOD_MAINNET" ]] ||
  fail "set MAINNET_DEPLOYMENT_CONFIRMED=YES_DEPLOY_ROBINHOOD_MAINNET after reviewing the release checklist."
[[ -n "$RPC_URL" ]] || fail "ROBINHOOD_MAINNET_RPC_URL is required; use a production-capable RPC endpoint."
[[ -n "${DEPLOYER_PRIVATE_KEY:-}" ]] || fail "DEPLOYER_PRIVATE_KEY is required from a dedicated deployment wallet."

OPERATOR_ADDRESSES=(
  REWARDS_CONTROLLER
  FACTORY_GOVERNANCE
  TREASURY_RECIPIENT
  BUYBACK_RESERVE_RECIPIENT
  GRADUATION_ASSISTANCE_RECIPIENT
  REFERRAL_RESERVE_RECIPIENT
  ECOSYSTEM_GROWTH_RECIPIENT
)
for NAME in "${OPERATOR_ADDRESSES[@]}"; do
  require_address "$NAME"
done

REVENUE_ADDRESSES=(
  "$TREASURY_RECIPIENT"
  "$BUYBACK_RESERVE_RECIPIENT"
  "$GRADUATION_ASSISTANCE_RECIPIENT"
  "$REFERRAL_RESERVE_RECIPIENT"
  "$ECOSYSTEM_GROWTH_RECIPIENT"
)
for ((i = 0; i < ${#REVENUE_ADDRESSES[@]}; i++)); do
  for ((j = 0; j < i; j++)); do
    [[ "$(normalize "${REVENUE_ADDRESSES[$i]}")" != "$(normalize "${REVENUE_ADDRESSES[$j]}")" ]] ||
      fail "protocol revenue destinations must be five distinct contracts."
  done
done

ACTUAL_CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
[[ "$ACTUAL_CHAIN_ID" == "$EXPECTED_CHAIN_ID" ]] ||
  fail "expected chain $EXPECTED_CHAIN_ID, received $ACTUAL_CHAIN_ID."

for ADDRESS in "$CANONICAL_POOL_MANAGER" "$CREATE2_DEPLOYER"; do
  [[ "$(cast code "$ADDRESS" --rpc-url "$RPC_URL")" != "0x" ]] ||
    fail "required canonical contract is missing at $ADDRESS."
done
for NAME in "${OPERATOR_ADDRESSES[@]}"; do
  require_contract "$NAME"
done

DEPLOYER_ADDRESS="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
BALANCE="$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC_URL")"
[[ "$BALANCE" != "0" ]] || fail "deployment wallet $DEPLOYER_ADDRESS has no ETH for gas."

echo "Robinhood Chain mainnet preflight passed."
echo "Deployer: $DEPLOYER_ADDRESS"
echo "Governance: $FACTORY_GOVERNANCE"
echo "Rewards controller: $REWARDS_CONTROLLER"
echo "Canonical Uniswap V4 PoolManager: $CANONICAL_POOL_MANAGER"
echo "Deployer balance: $BALANCE wei"
echo "All protocol revenue destinations are distinct deployed contracts."

forge script script/DeployMainnetMemeLaunchFactory.s.sol:DeployMainnetMemeLaunchFactory \
  --rpc-url "$RPC_URL" \
  --broadcast \
  -vvvv

echo "Broadcast complete. Record the hook, adapter, router, factory, registry, transaction hashes, source commit, and deployment block."
