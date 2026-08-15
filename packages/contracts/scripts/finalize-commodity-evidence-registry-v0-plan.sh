#!/usr/bin/env bash
set -euo pipefail

TARGET_CHAIN_ID="46630"
ZERO_ADDRESS="0x0000000000000000000000000000000000000000"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() {
  printf 'commodity-evidence final-plan preflight: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

require_command cast
require_command forge

: "${RPC_URL:?Set RPC_URL to an approved Robinhood Chain testnet RPC endpoint.}"
: "${ADMINISTRATOR_ADDRESS:?Set ADMINISTRATOR_ADDRESS to the approved public administrator address.}"
: "${DEPLOYER_ADDRESS:?Set DEPLOYER_ADDRESS to the approved public deployer address.}"

[[ "$ADMINISTRATOR_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "ADMINISTRATOR_ADDRESS is malformed"
[[ "$DEPLOYER_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "DEPLOYER_ADDRESS is malformed"
[[ "${ADMINISTRATOR_ADDRESS,,}" != "$ZERO_ADDRESS" ]] || fail "ADMINISTRATOR_ADDRESS must be nonzero"
[[ "${DEPLOYER_ADDRESS,,}" != "$ZERO_ADDRESS" ]] || fail "DEPLOYER_ADDRESS must be nonzero"

actual_chain_id="$(cast chain-id --rpc-url "$RPC_URL")"
[[ "$actual_chain_id" == "$TARGET_CHAIN_ID" ]] \
  || fail "wrong RPC chain ID: expected $TARGET_CHAIN_ID, received $actual_chain_id"

pending_nonce_hex="$(cast rpc eth_getTransactionCount "$DEPLOYER_ADDRESS" pending --rpc-url "$RPC_URL" | tr -d '"')"
pending_nonce="$(cast to-dec "$pending_nonce_hex")"
predicted_output="$(cast compute-address "$DEPLOYER_ADDRESS" --nonce "$pending_nonce")"
predicted_address="$(printf '%s\n' "$predicted_output" | grep -Eo '0x[0-9a-fA-F]{40}' | tail -n 1)"
[[ -n "$predicted_address" ]] || fail "could not derive predicted CREATE address"

predicted_code="$(cast code "$predicted_address" --rpc-url "$RPC_URL")"
[[ "$predicted_code" == "0x" ]] || fail "predicted address already contains runtime code"

cd "$CONTRACTS_DIR"
forge fmt --check \
  src/RMTCommodityEvidenceRegistryV0.sol \
  script/FinalizeCommodityEvidenceRegistryV0DeploymentPlan.s.sol \
  test/RMTCommodityEvidenceRegistryV0AddressPlan.t.sol
forge build
forge test --match-path test/RMTCommodityEvidenceRegistryV0AddressPlan.t.sol -vv

forge script \
  script/FinalizeCommodityEvidenceRegistryV0DeploymentPlan.s.sol:FinalizeCommodityEvidenceRegistryV0DeploymentPlan \
  --sig 'run(address,address,uint256)' \
  "$ADMINISTRATOR_ADDRESS" \
  "$DEPLOYER_ADDRESS" \
  "$pending_nonce" \
  --rpc-url "$RPC_URL" \
  -vvv

printf '%s\n' \
  "commodity-evidence final-plan preflight passed" \
  "chainId=$actual_chain_id" \
  "administrator=$ADMINISTRATOR_ADDRESS" \
  "deployer=$DEPLOYER_ADDRESS" \
  "pendingNonce=$pending_nonce" \
  "predictedRegistry=$predicted_address" \
  "predictedAddressCode=empty" \
  "mode=simulation-only" \
  "broadcast=not-authorized"
