#!/usr/bin/env bash
set -euo pipefail

TARGET_CHAIN_ID="46630"
ZERO_ADDRESS="0x0000000000000000000000000000000000000000"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() {
  printf 'commodity-evidence preflight: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

require_command cast
require_command forge
require_command python3

: "${RPC_URL:?Set RPC_URL to an approved Robinhood Chain testnet RPC endpoint.}"
: "${ADMINISTRATOR_ADDRESS:?Set ADMINISTRATOR_ADDRESS to the public testnet administrator address.}"

[[ "$ADMINISTRATOR_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "ADMINISTRATOR_ADDRESS is malformed"
[[ "${ADMINISTRATOR_ADDRESS,,}" != "$ZERO_ADDRESS" ]] || fail "ADMINISTRATOR_ADDRESS must be nonzero"

actual_chain_id="$(cast chain-id --rpc-url "$RPC_URL")"
[[ "$actual_chain_id" == "$TARGET_CHAIN_ID" ]] \
  || fail "wrong RPC chain ID: expected $TARGET_CHAIN_ID, received $actual_chain_id"

cd "$CONTRACTS_DIR"
python3 -m json.tool deployments/rmt-commodity-evidence-registry-v0-readiness.template.json >/dev/null
grep -q '"status": "UNDEPLOYED"' deployments/rmt-commodity-evidence-registry-v0-readiness.template.json \
  || fail "deployment template is not fail-closed"
grep -q '"broadcastAuthorized": false' deployments/rmt-commodity-evidence-registry-v0-readiness.template.json \
  || fail "deployment template unexpectedly authorizes broadcast"

forge fmt --check \
  src/RMTCommodityEvidenceRegistryV0.sol \
  script/PrepareCommodityEvidenceRegistryV0Deployment.s.sol \
  test/RMTCommodityEvidenceRegistryV0DeploymentReadiness.t.sol
forge build
forge test --match-path test/RMTCommodityEvidenceRegistryV0.t.sol -vv
forge test --match-path test/RMTCommodityEvidenceRegistryV0Hardening.t.sol -vv
forge test --match-path test/RMTCommodityEvidenceRegistryV0Rehearsal.t.sol -vv
forge test --match-path test/RMTCommodityEvidenceRegistryV0DeploymentReadiness.t.sol -vv

forge script \
  script/PrepareCommodityEvidenceRegistryV0Deployment.s.sol:PrepareCommodityEvidenceRegistryV0Deployment \
  --sig 'run(address)' \
  "$ADMINISTRATOR_ADDRESS" \
  --rpc-url "$RPC_URL" \
  -vvv

printf '%s\n' \
  "commodity-evidence preflight passed" \
  "chainId=$actual_chain_id" \
  "administrator=$ADMINISTRATOR_ADDRESS" \
  "mode=simulation-only" \
  "broadcast=not-authorized"
