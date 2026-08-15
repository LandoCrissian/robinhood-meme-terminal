#!/usr/bin/env bash
set -euo pipefail

# Exact-source verifier for the synthetic commodity registry. Dry-run is local only.
# Live mode publishes source and compiler metadata to the public testnet Blockscout API.

CHAIN_ID="46630"
RPC_URL="${ROBINHOOD_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com/}"
VERIFIER_URL="https://explorer.testnet.chain.robinhood.com/api/"
COMPILER_VERSION="v0.8.26+commit.8a97fa7a"
EVM_VERSION="cancun"
OPTIMIZER_RUNS="200"
CONTRACT_ID="src/RMTCommodityEvidenceRegistryV0.sol:RMTCommodityEvidenceRegistryV0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() {
  echo "Commodity evidence registry source verification stopped: $*" >&2
  exit 1
}

json_value() {
  local path="$1"
  python3 - "$RECORD" "$path" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as source:
    value = json.load(source)
for part in sys.argv[2].split("."):
    value = value[int(part)] if isinstance(value, list) else value[part]
if value is None:
    print("")
elif value is True:
    print("true")
elif value is False:
    print("false")
else:
    print(value)
PY
}

usage() {
  echo "usage: $0 <completed-deployment-record.json> --dry-run" >&2
  echo "       $0 <completed-deployment-record.json> --publish" >&2
  exit 1
}

[[ $# -eq 2 ]] || usage
RECORD="$1"
MODE="$2"
[[ -f "$RECORD" ]] || fail "deployment record does not exist: $RECORD"
[[ "$MODE" == "--dry-run" || "$MODE" == "--publish" ]] || usage
RECORD="$(cd "$(dirname "$RECORD")" && pwd)/$(basename "$RECORD")"

command -v forge >/dev/null 2>&1 || fail "forge is unavailable."
command -v cast >/dev/null 2>&1 || fail "cast is unavailable."
command -v python3 >/dev/null 2>&1 || fail "python3 is unavailable."

# This must pass before compiler input is produced or any public source publication is attempted.
"$SCRIPT_DIR/verify-rmt-commodity-evidence-registry-v0-deployment.sh" "$RECORD"

REGISTRY="$(json_value contract.address)"
ADMINISTRATOR="$(json_value administrator.address)"
CONSTRUCTOR_ARGS="$(cast abi-encode 'f(address)' "$ADMINISTRATOR")"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
STANDARD_JSON="$TMP_DIR/rmt-commodity-evidence-registry-v0.standard.json"

if [[ "$MODE" == "--dry-run" ]]; then
  forge verify-contract \
    --root "$CONTRACTS_DIR" \
    --rpc-url "$RPC_URL" \
    --chain "$CHAIN_ID" \
    --compiler-version "$COMPILER_VERSION" \
    --num-of-optimizations "$OPTIMIZER_RUNS" \
    --via-ir \
    --evm-version "$EVM_VERSION" \
    --no-auto-detect \
    --constructor-args "$CONSTRUCTOR_ARGS" \
    --show-standard-json-input \
    "$REGISTRY" "$CONTRACT_ID" >"$STANDARD_JSON"

  python3 - "$STANDARD_JSON" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as source:
    compiler_input = json.load(source)
settings = compiler_input.get("settings")
optimizer = settings.get("optimizer") if isinstance(settings, dict) else None
sources = compiler_input.get("sources")
target = settings.get("compilationTarget") if isinstance(settings, dict) else None
expected_path = "src/RMTCommodityEvidenceRegistryV0.sol"
expected_name = "RMTCommodityEvidenceRegistryV0"
valid_target = target is None or target == {expected_path: expected_name}
valid = (
    compiler_input.get("language") == "Solidity"
    and isinstance(settings, dict)
    and settings.get("viaIR") is True
    and settings.get("evmVersion") == "cancun"
    and isinstance(optimizer, dict)
    and optimizer.get("enabled") is True
    and optimizer.get("runs") == 200
    and isinstance(sources, dict)
    and expected_path in sources
    and valid_target
)
if not valid:
    raise SystemExit("standard JSON compiler input does not match the reviewed release")
PY

  echo "Synthetic registry Blockscout compiler input validated locally."
  echo "Registry: $REGISTRY"
  echo "No source was published and no transaction was submitted."
  exit 0
fi

[[ "${SOURCE_PUBLICATION_CONFIRMED:-}" == "YES_PUBLISH_SYNTHETIC_REGISTRY_SOURCE" ]] \
  || fail "set SOURCE_PUBLICATION_CONFIRMED=YES_PUBLISH_SYNTHETIC_REGISTRY_SOURCE after final review."
[[ "$(json_value authorization.sourcePublicationAuthorized)" == "true" ]] \
  || fail "deployment record does not authorize source publication."
[[ "$(json_value sourceVerification.publishAuthorized)" == "true" ]] \
  || fail "sourceVerification.publishAuthorized is not true."

forge verify-contract \
  --root "$CONTRACTS_DIR" \
  --rpc-url "$RPC_URL" \
  --chain "$CHAIN_ID" \
  --verifier blockscout \
  --verifier-url "$VERIFIER_URL" \
  --compiler-version "$COMPILER_VERSION" \
  --num-of-optimizations "$OPTIMIZER_RUNS" \
  --via-ir \
  --evm-version "$EVM_VERSION" \
  --no-auto-detect \
  --skip-is-verified-check \
  --constructor-args "$CONSTRUCTOR_ARGS" \
  --watch \
  "$REGISTRY" "$CONTRACT_ID"

echo "Synthetic registry source publication request completed."
echo "No blockchain transaction was submitted by this script."
