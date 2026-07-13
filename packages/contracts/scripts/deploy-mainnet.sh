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

[[ "${MAINNET_DEPLOYMENT_CONFIRMED:-}" == "YES_DEPLOY_ROBINHOOD_MAINNET" ]] ||
  fail "set MAINNET_DEPLOYMENT_CONFIRMED=YES_DEPLOY_ROBINHOOD_MAINNET after reviewing the release checklist."
[[ -n "$RPC_URL" ]] || fail "ROBINHOOD_MAINNET_RPC_URL is required; use a production-capable RPC endpoint."
[[ -n "${DEPLOYER_PRIVATE_KEY:-}" ]] || fail "DEPLOYER_PRIVATE_KEY is required from the dedicated deployment wallet."

SIGNER_NAMES=(SIGNER_ONE SIGNER_TWO SIGNER_THREE)
for NAME in "${SIGNER_NAMES[@]}"; do
  require_address "$NAME"
done

SIGNERS=("$SIGNER_ONE" "$SIGNER_TWO" "$SIGNER_THREE")
for ((i = 0; i < ${#SIGNERS[@]}; i++)); do
  for ((j = 0; j < i; j++)); do
    [[ "$(normalize "${SIGNERS[$i]}")" != "$(normalize "${SIGNERS[$j]}")" ]] ||
      fail "SIGNER_ONE, SIGNER_TWO, and SIGNER_THREE must be three independent addresses."
  done
done

ACTUAL_CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
[[ "$ACTUAL_CHAIN_ID" == "$EXPECTED_CHAIN_ID" ]] ||
  fail "expected chain $EXPECTED_CHAIN_ID, received $ACTUAL_CHAIN_ID."

for ADDRESS in "$CANONICAL_POOL_MANAGER" "$CREATE2_DEPLOYER"; do
  [[ "$(cast code "$ADDRESS" --rpc-url "$RPC_URL")" != "0x" ]] ||
    fail "required canonical contract is missing at $ADDRESS."
done

DEPLOYER_ADDRESS="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
BALANCE="$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC_URL")"
[[ "$BALANCE" != "0" ]] || fail "deployment wallet $DEPLOYER_ADDRESS has no ETH for gas."

echo "Robinhood Chain mainnet preflight passed."
echo "Deployer: $DEPLOYER_ADDRESS"
echo "Signer one: $SIGNER_ONE"
echo "Signer two: $SIGNER_TWO"
echo "Signer three: $SIGNER_THREE"
echo "Canonical Uniswap V4 PoolManager: $CANONICAL_POOL_MANAGER"
echo "Deployer balance: $BALANCE wei"
echo "Factory governance, rewards governance, protocol governance, and five purpose vaults will be created automatically."

forge script script/DeployMainnetMemeLaunchFactory.s.sol:DeployMainnetMemeLaunchFactory \
  --rpc-url "$RPC_URL" \
  --broadcast \
  -vvvv

echo "Broadcast complete. Record every governance, vault, protocol, and transaction address before running the smoke test."
