#!/usr/bin/env bash
set -euo pipefail

TARGET_CHAIN_ID="46630"
ZERO_ADDRESS="0x0000000000000000000000000000000000000000"
ZERO_HASH="0x0000000000000000000000000000000000000000000000000000000000000000"

fail() {
  printf 'commodity-evidence verification: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

require_command cast

: "${RPC_URL:?Set RPC_URL to the approved Robinhood Chain testnet RPC endpoint.}"
: "${REGISTRY_ADDRESS:?Set REGISTRY_ADDRESS to the deployed testnet registry address.}"
: "${EXPECTED_ADMINISTRATOR:?Set EXPECTED_ADMINISTRATOR to the approved public administrator address.}"
: "${EXPECTED_RUNTIME_CODE_HASH:?Set EXPECTED_RUNTIME_CODE_HASH from the approved deployment manifest.}"
: "${EXPECTED_DOMAIN_SEPARATOR:?Set EXPECTED_DOMAIN_SEPARATOR from the approved deployment manifest.}"

[[ "$REGISTRY_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "REGISTRY_ADDRESS is malformed"
[[ "$EXPECTED_ADMINISTRATOR" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "EXPECTED_ADMINISTRATOR is malformed"
[[ "$EXPECTED_RUNTIME_CODE_HASH" =~ ^0x[0-9a-fA-F]{64}$ ]] \
  || fail "EXPECTED_RUNTIME_CODE_HASH is malformed"
[[ "$EXPECTED_DOMAIN_SEPARATOR" =~ ^0x[0-9a-fA-F]{64}$ ]] \
  || fail "EXPECTED_DOMAIN_SEPARATOR is malformed"
[[ "${REGISTRY_ADDRESS,,}" != "$ZERO_ADDRESS" ]] || fail "REGISTRY_ADDRESS must be nonzero"
[[ "${EXPECTED_ADMINISTRATOR,,}" != "$ZERO_ADDRESS" ]] || fail "EXPECTED_ADMINISTRATOR must be nonzero"
[[ "${EXPECTED_RUNTIME_CODE_HASH,,}" != "$ZERO_HASH" ]] \
  || fail "EXPECTED_RUNTIME_CODE_HASH must be populated"
[[ "${EXPECTED_DOMAIN_SEPARATOR,,}" != "$ZERO_HASH" ]] \
  || fail "EXPECTED_DOMAIN_SEPARATOR must be populated"

actual_chain_id="$(cast chain-id --rpc-url "$RPC_URL")"
[[ "$actual_chain_id" == "$TARGET_CHAIN_ID" ]] \
  || fail "wrong RPC chain ID: expected $TARGET_CHAIN_ID, received $actual_chain_id"

runtime_code="$(cast code "$REGISTRY_ADDRESS" --rpc-url "$RPC_URL")"
[[ "$runtime_code" != "0x" ]] || fail "no runtime code at REGISTRY_ADDRESS"
actual_runtime_hash="$(cast keccak "$runtime_code")"
[[ "${actual_runtime_hash,,}" == "${EXPECTED_RUNTIME_CODE_HASH,,}" ]] \
  || fail "runtime code hash mismatch: expected $EXPECTED_RUNTIME_CODE_HASH, received $actual_runtime_hash"

contract_chain_id="$(cast call "$REGISTRY_ADDRESS" 'TARGET_CHAIN_ID()(uint256)' --rpc-url "$RPC_URL")"
[[ "$contract_chain_id" == "$TARGET_CHAIN_ID" ]] || fail "contract target chain mismatch"

synthetic_only="$(cast call "$REGISTRY_ADDRESS" 'SYNTHETIC_ONLY()(bool)' --rpc-url "$RPC_URL")"
[[ "$synthetic_only" == "true" ]] || fail "synthetic-only guard is not true"

administrator="$(cast call "$REGISTRY_ADDRESS" 'administrator()(address)' --rpc-url "$RPC_URL")"
[[ "${administrator,,}" == "${EXPECTED_ADMINISTRATOR,,}" ]] \
  || fail "administrator mismatch: expected $EXPECTED_ADMINISTRATOR, received $administrator"

domain_separator="$(cast call "$REGISTRY_ADDRESS" 'domainSeparator()(bytes32)' --rpc-url "$RPC_URL")"
[[ "${domain_separator,,}" == "${EXPECTED_DOMAIN_SEPARATOR,,}" ]] \
  || fail "domain separator mismatch: expected $EXPECTED_DOMAIN_SEPARATOR, received $domain_separator"

rights_hash="$(cast call "$REGISTRY_ADDRESS" 'NO_RIGHTS_VERSION_HASH()(bytes32)' --rpc-url "$RPC_URL")"
transfer_hash="$(cast call "$REGISTRY_ADDRESS" 'NON_TRANSFERABLE_POLICY_HASH()(bytes32)' --rpc-url "$RPC_URL")"
[[ "${rights_hash,,}" != "$ZERO_HASH" ]] || fail "no-rights commitment is zero"
[[ "${transfer_hash,,}" != "$ZERO_HASH" ]] || fail "non-transferable commitment is zero"

if cast call \
  "$REGISTRY_ADDRESS" \
  'mint(address,uint256)' \
  "$EXPECTED_ADMINISTRATOR" \
  1 \
  --rpc-url "$RPC_URL" >/dev/null 2>&1; then
  fail "unexpected mint interface succeeded"
fi

printf '%s\n' \
  "commodity-evidence deployment verification passed" \
  "chainId=$actual_chain_id" \
  "registry=$REGISTRY_ADDRESS" \
  "administrator=$administrator" \
  "runtimeCodeHash=$actual_runtime_hash" \
  "domainSeparator=$domain_separator" \
  "syntheticOnly=$synthetic_only" \
  "mintSurface=absent"
