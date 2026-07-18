#!/usr/bin/env bash
set -euo pipefail

# Publishes the exact reviewed source and constructor arguments for the ten-contract,
# no-value Robinhood Chain Testnet consent rehearsal. It never signs or broadcasts a transaction.

CHAIN_ID="46630"
RPC_URL="${ROBINHOOD_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com/}"
VERIFIER_URL="https://explorer.testnet.chain.robinhood.com/api/"
COMPILER_VERSION="v0.8.26+commit.8a97fa7a"
EVM_VERSION="cancun"
OPTIMIZER_RUNS="200"
EXPECTED_OPERATOR="0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA"
TERMS_DOCUMENT_HASH="0x236ed1f849548c61a923152a92dc91593f22a6e2ff3d176a4b0db38b3b2d2b57"
POOL_FEE="3000"
GOVERNANCE_DELAY="86400"
GOVERNANCE_WINDOW="604800"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$CONTRACTS_DIR/../.." && pwd)"

fail() {
  echo "Consent rehearsal source verification stopped: $*" >&2
  exit 1
}

lowercase() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

require_tool() {
  command -v "$1" >/dev/null 2>&1 || fail "required command '$1' is unavailable."
}

expect_equal() {
  local label="$1"
  local actual="$2"
  local expected="$3"
  [[ "$(lowercase "$actual")" == "$(lowercase "$expected")" ]] \
    || fail "$label mismatch: expected $expected, received $actual."
}

json_value() {
  local path="$1"
  python3 - "$RECORD" "$path" <<'PY'
import json
import sys

record_path, dotted_path = sys.argv[1:]
with open(record_path, encoding="utf-8") as source:
    value = json.load(source)
for part in dotted_path.split("."):
    value = value[part]
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

record_address() {
  json_value "contracts.$1.address"
}

scalar_call() {
  local address="$1"
  local signature="$2"
  shift 2
  local output
  if ! output="$(cast call "$address" "$signature" "$@" --rpc-url "$RPC_URL" 2>&1)"; then
    fail "call $signature on $address failed: $output"
  fi
  printf '%s\n' "${output%%[[:space:]]*}"
}

string_call() {
  local address="$1"
  local signature="$2"
  local output
  if ! output="$(cast call "$address" "$signature" --rpc-url "$RPC_URL" 2>&1)"; then
    fail "call $signature on $address failed: $output"
  fi
  output="${output#\"}"
  output="${output%\"}"
  printf '%s\n' "$output"
}

validate_standard_json() {
  local label="$1"
  local contract="$2"
  local standard_json="$3"
  local expected_path="${contract%%:*}"
  local expected_name="${contract##*:}"

  python3 - "$standard_json" "$expected_path" "$expected_name" <<'PY'
import json
import sys

json_path, expected_path, expected_name = sys.argv[1:]
with open(json_path, encoding="utf-8") as source:
    compiler_input = json.load(source)
settings = compiler_input.get("settings")
optimizer = settings.get("optimizer") if isinstance(settings, dict) else None
sources = compiler_input.get("sources")
target = settings.get("compilationTarget") if isinstance(settings, dict) else None
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
    raise SystemExit(f"standard JSON does not match reviewed settings for {expected_path}:{expected_name}")
PY
  echo "Dry-run compiler input validated for $label ($contract)"
}

verify_source() {
  local label="$1"
  local address="$2"
  local contract="$3"
  local constructor_args="$4"
  local standard_json="$TMP_DIR/${label// /-}.standard.json"

  if [[ "$DRY_RUN" == "true" ]]; then
    forge verify-contract \
      --root "$CONTRACTS_DIR" \
      --rpc-url "$RPC_URL" \
      --chain "$CHAIN_ID" \
      --compiler-version "$COMPILER_VERSION" \
      --num-of-optimizations "$OPTIMIZER_RUNS" \
      --via-ir \
      --evm-version "$EVM_VERSION" \
      --no-auto-detect \
      --constructor-args "$constructor_args" \
      --show-standard-json-input \
      "$address" "$contract" >"$standard_json"
    validate_standard_json "$label" "$contract" "$standard_json"
    return
  fi

  echo "Publishing exact source for $label at $address"
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
    --constructor-args "$constructor_args" \
    --watch \
    "$address" "$contract"
}

usage() {
  echo "usage: $0 <completed-deployment-record.json> [--dry-run]" >&2
  echo "Live mode publishes Solidity source and compiler metadata to the public testnet Blockscout explorer." >&2
  exit 1
}

[[ $# -ge 1 && $# -le 2 ]] || usage
RECORD="$1"
[[ -f "$RECORD" ]] || fail "deployment record does not exist: $RECORD"
RECORD="$(cd "$(dirname "$RECORD")" && pwd)/$(basename "$RECORD")"
DRY_RUN="false"
if [[ $# -eq 2 ]]; then
  [[ "$2" == "--dry-run" ]] || usage
  DRY_RUN="true"
fi
if [[ "${SOURCE_VERIFY_DRY_RUN:-0}" == "1" ]]; then
  DRY_RUN="true"
fi

require_tool cast
require_tool forge
require_tool git
require_tool python3

# This is deliberately first: source publication is forbidden unless the completed
# record and live paused deployment pass the full read-only topology verifier.
"$SCRIPT_DIR/verify-consent-testnet-deployment.sh" "$RECORD"

SOURCE_COMMIT="$(json_value release.sourceCommit)"
CURRENT_HEAD="$(git -C "$REPO_ROOT" rev-parse HEAD)"
expect_equal "checked-out source commit" "$CURRENT_HEAD" "$SOURCE_COMMIT"
git -C "$REPO_ROOT" diff --quiet -- packages/contracts/src packages/contracts/foundry.toml packages/contracts/remappings.txt \
  || fail "tracked contract source or compiler configuration has uncommitted changes."
git -C "$REPO_ROOT" diff --cached --quiet -- packages/contracts/src packages/contracts/foundry.toml packages/contracts/remappings.txt \
  || fail "tracked contract source or compiler configuration has staged changes."

OPERATOR="$(json_value operator)"
expect_equal "fixed operator" "$OPERATOR" "$EXPECTED_OPERATOR"
VENUE="$(record_address venue)"
GOVERNANCE="$(record_address governance)"
PAIRED_TOKEN="$(record_address pairedToken)"
WETH="$(record_address weth)"
FACTORY="$(record_address factory)"
POOL="$(record_address pool)"
POSITION_MANAGER="$(record_address positionManager)"
CONSENT_STACK="$(record_address consentStack)"
SESSION="$(record_address session)"
MIGRATOR="$(record_address migrator)"

# Read constructor values back from the exact live topology. The deployment verifier
# above already bound these addresses and values to the durable record and runtime hashes.
PAIRED_NAME="$(string_call "$PAIRED_TOKEN" 'name()(string)')"
PAIRED_SYMBOL="$(string_call "$PAIRED_TOKEN" 'symbol()(string)')"
PAIRED_RECIPIENT="$(scalar_call "$PAIRED_TOKEN" 'initialRecipient()(address)')"
PAIRED_SUPPLY="$(scalar_call "$PAIRED_TOKEN" 'totalSupply()(uint256)')"
WETH_NAME="$(string_call "$WETH" 'name()(string)')"
WETH_SYMBOL="$(string_call "$WETH" 'symbol()(string)')"
WETH_RECIPIENT="$(scalar_call "$WETH" 'initialRecipient()(address)')"
WETH_SUPPLY="$(scalar_call "$WETH" 'totalSupply()(uint256)')"
expect_equal "paired-token name" "$PAIRED_NAME" "RMT Rehearsal Paired Token (No Value)"
expect_equal "paired-token symbol" "$PAIRED_SYMBOL" "tRMT-NV"
expect_equal "rehearsal-WETH name" "$WETH_NAME" "RMT Rehearsal WETH (No Value)"
expect_equal "rehearsal-WETH symbol" "$WETH_SYMBOL" "tWETH-NV"

TOKEN0="$(scalar_call "$POOL" 'token0()(address)')"
TOKEN1="$(scalar_call "$POOL" 'token1()(address)')"
POOL_FACTORY="$(scalar_call "$POOL" 'factory()(address)')"
LIVE_POOL_FEE="$(scalar_call "$POOL" 'fee()(uint24)')"
TICK_SPACING="$(scalar_call "$POOL" 'tickSpacing()(int24)')"
MANAGER_FACTORY="$(scalar_call "$POSITION_MANAGER" 'factory()(address)')"
MANAGER_WETH="$(scalar_call "$POSITION_MANAGER" 'WETH9()(address)')"
MANAGER_POOL="$(scalar_call "$POSITION_MANAGER" 'pool()(address)')"
LIVE_GOVERNANCE_DELAY="$(scalar_call "$GOVERNANCE" 'executionDelay()(uint64)')"
LIVE_GOVERNANCE_WINDOW="$(scalar_call "$GOVERNANCE" 'executionWindow()(uint64)')"

SESSION_ROUTER="$(scalar_call "$SESSION" 'router()(address)')"
SESSION_PAIRED="$(scalar_call "$SESSION" 'pairedToken()(address)')"
SESSION_WETH="$(scalar_call "$SESSION" 'weth()(address)')"
SESSION_MANAGER="$(scalar_call "$SESSION" 'positionManager()(address)')"
SESSION_POOL_FEE="$(scalar_call "$SESSION" 'poolFee()(uint24)')"

DESTINATION_CHAIN_ID="$(scalar_call "$MIGRATOR" 'destinationChainId()(uint256)')"
MIGRATOR_GOVERNANCE="$(scalar_call "$MIGRATOR" 'governance()(address)')"
GUARDIAN="$(scalar_call "$MIGRATOR" 'guardian()(address)')"
MIGRATOR_WETH="$(scalar_call "$MIGRATOR" 'weth()(address)')"
MIGRATOR_PAIRED="$(scalar_call "$MIGRATOR" 'pairedToken()(address)')"
MIGRATOR_MANAGER="$(scalar_call "$MIGRATOR" 'positionManager()(address)')"
MIGRATOR_FACTORY="$(scalar_call "$MIGRATOR" 'sushiFactory()(address)')"
MIGRATOR_POOL="$(scalar_call "$MIGRATOR" 'sushiPool()(address)')"
MIGRATOR_SESSION="$(scalar_call "$MIGRATOR" 'liquiditySession()(address)')"
MIGRATOR_POOL_FEE="$(scalar_call "$MIGRATOR" 'poolFee()(uint24)')"
POSITION_MANAGER_CODE_HASH="$(scalar_call "$MIGRATOR" 'positionManagerCodeHash()(bytes32)')"
FACTORY_CODE_HASH="$(scalar_call "$MIGRATOR" 'factoryCodeHash()(bytes32)')"
POOL_CODE_HASH="$(scalar_call "$MIGRATOR" 'poolCodeHash()(bytes32)')"
SESSION_CODE_HASH="$(scalar_call "$MIGRATOR" 'sessionCodeHash()(bytes32)')"
WETH_CODE_HASH="$(scalar_call "$MIGRATOR" 'wethCodeHash()(bytes32)')"
PAIRED_TOKEN_CODE_HASH="$(scalar_call "$MIGRATOR" 'pairedTokenCodeHash()(bytes32)')"
LIVE_TERMS_DOCUMENT_HASH="$(scalar_call "$MIGRATOR" 'termsDocumentHash()(bytes32)')"

expect_equal "pool factory constructor value" "$POOL_FACTORY" "$FACTORY"
expect_equal "pool fee constructor value" "$LIVE_POOL_FEE" "$POOL_FEE"
expect_equal "manager factory constructor value" "$MANAGER_FACTORY" "$FACTORY"
expect_equal "manager WETH constructor value" "$MANAGER_WETH" "$WETH"
expect_equal "manager pool constructor value" "$MANAGER_POOL" "$POOL"
expect_equal "governance delay constructor value" "$LIVE_GOVERNANCE_DELAY" "$GOVERNANCE_DELAY"
expect_equal "governance window constructor value" "$LIVE_GOVERNANCE_WINDOW" "$GOVERNANCE_WINDOW"
expect_equal "session router constructor value" "$SESSION_ROUTER" "$MIGRATOR"
expect_equal "session paired-token constructor value" "$SESSION_PAIRED" "$PAIRED_TOKEN"
expect_equal "session WETH constructor value" "$SESSION_WETH" "$WETH"
expect_equal "session manager constructor value" "$SESSION_MANAGER" "$POSITION_MANAGER"
expect_equal "session pool-fee constructor value" "$SESSION_POOL_FEE" "$POOL_FEE"
expect_equal "migrator destination chain constructor value" "$DESTINATION_CHAIN_ID" "$CHAIN_ID"
expect_equal "migrator governance constructor value" "$MIGRATOR_GOVERNANCE" "$GOVERNANCE"
expect_equal "migrator guardian constructor value" "$GUARDIAN" "$OPERATOR"
expect_equal "migrator WETH constructor value" "$MIGRATOR_WETH" "$WETH"
expect_equal "migrator paired-token constructor value" "$MIGRATOR_PAIRED" "$PAIRED_TOKEN"
expect_equal "migrator manager constructor value" "$MIGRATOR_MANAGER" "$POSITION_MANAGER"
expect_equal "migrator factory constructor value" "$MIGRATOR_FACTORY" "$FACTORY"
expect_equal "migrator pool constructor value" "$MIGRATOR_POOL" "$POOL"
expect_equal "migrator session constructor value" "$MIGRATOR_SESSION" "$SESSION"
expect_equal "migrator pool-fee constructor value" "$MIGRATOR_POOL_FEE" "$POOL_FEE"
expect_equal "migrator terms-document constructor value" "$LIVE_TERMS_DOCUMENT_HASH" "$TERMS_DOCUMENT_HASH"

VENUE_ARGS="$(cast abi-encode 'f(address)' "$OPERATOR")"
PAIRED_TOKEN_ARGS="$(cast abi-encode 'f(string,string,address,uint256)' "$PAIRED_NAME" "$PAIRED_SYMBOL" "$PAIRED_RECIPIENT" "$PAIRED_SUPPLY")"
WETH_ARGS="$(cast abi-encode 'f(string,string,address,uint256)' "$WETH_NAME" "$WETH_SYMBOL" "$WETH_RECIPIENT" "$WETH_SUPPLY")"
FACTORY_ARGS="$(cast abi-encode 'f(address,address)' "$PAIRED_TOKEN" "$WETH")"
POOL_ARGS="$(cast abi-encode 'f(address,address,address,uint24,int24)' "$POOL_FACTORY" "$TOKEN0" "$TOKEN1" "$LIVE_POOL_FEE" "$TICK_SPACING")"
POSITION_MANAGER_ARGS="$(cast abi-encode 'f(address,address,address)' "$MANAGER_FACTORY" "$MANAGER_WETH" "$MANAGER_POOL")"
GOVERNANCE_ARGS="$(cast abi-encode 'f(address,uint64,uint64)' "$OPERATOR" "$LIVE_GOVERNANCE_DELAY" "$LIVE_GOVERNANCE_WINDOW")"
CONSENT_STACK_ARGS="$(cast abi-encode 'f(address,address)' "$OPERATOR" "$VENUE")"
SESSION_ARGS="$(cast abi-encode 'f(address,address,address,address,uint24)' "$SESSION_ROUTER" "$SESSION_PAIRED" "$SESSION_WETH" "$SESSION_MANAGER" "$SESSION_POOL_FEE")"
MIGRATOR_ARGS="$(cast abi-encode \
  'f((uint256,address,address,address,address,address,address,address,address,uint24,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32))' \
  "($DESTINATION_CHAIN_ID,$MIGRATOR_GOVERNANCE,$GUARDIAN,$MIGRATOR_WETH,$MIGRATOR_PAIRED,$MIGRATOR_MANAGER,$MIGRATOR_FACTORY,$MIGRATOR_POOL,$MIGRATOR_SESSION,$MIGRATOR_POOL_FEE,$POSITION_MANAGER_CODE_HASH,$FACTORY_CODE_HASH,$POOL_CODE_HASH,$SESSION_CODE_HASH,$WETH_CODE_HASH,$PAIRED_TOKEN_CODE_HASH,$LIVE_TERMS_DOCUMENT_HASH)")"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cd "$CONTRACTS_DIR"
verify_source "paired-token" "$PAIRED_TOKEN" \
  "src/RMTTestnetSushiV3RehearsalStack.sol:RMTTestnetSushiV3RehearsalToken" "$PAIRED_TOKEN_ARGS"
verify_source "rehearsal-WETH" "$WETH" \
  "src/RMTTestnetSushiV3RehearsalStack.sol:RMTTestnetSushiV3RehearsalToken" "$WETH_ARGS"
verify_source "sink-pool" "$POOL" \
  "src/RMTTestnetSushiV3RehearsalStack.sol:RMTTestnetSushiV3RehearsalPool" "$POOL_ARGS"
verify_source "one-pool-factory" "$FACTORY" \
  "src/RMTTestnetSushiV3RehearsalStack.sol:RMTTestnetSushiV3RehearsalFactory" "$FACTORY_ARGS"
verify_source "position-manager" "$POSITION_MANAGER" \
  "src/RMTTestnetSushiV3RehearsalStack.sol:RMTTestnetSushiV3RehearsalPositionManager" "$POSITION_MANAGER_ARGS"
verify_source "governance" "$GOVERNANCE" "src/RMTV6Governance.sol:RMTV6Governance" "$GOVERNANCE_ARGS"
verify_source "venue" "$VENUE" \
  "src/RMTTestnetSushiV3RehearsalStack.sol:RMTTestnetSushiV3RehearsalVenue" "$VENUE_ARGS"
verify_source "session" "$SESSION" \
  "src/RMTConsentLiquiditySession.sol:RMTConsentLiquiditySession" "$SESSION_ARGS"
verify_source "migrator" "$MIGRATOR" \
  "src/RMTConsentLiquidityMigrator.sol:RMTConsentLiquidityMigrator" "$MIGRATOR_ARGS"
verify_source "consent-stack" "$CONSENT_STACK" \
  "src/RMTTestnetSushiV3RehearsalStack.sol:RMTTestnetSushiV3ConsentStack" "$CONSENT_STACK_ARGS"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "Dry run complete: all ten exact standard compiler inputs validated; no source was published."
  exit 0
fi

# Source publication can take several minutes. Recheck the full deployment and current
# pause state after the final Blockscout --watch result.
"$SCRIPT_DIR/verify-consent-testnet-deployment.sh" "$RECORD"
echo "All ten source-verification submissions completed through $VERIFIER_URL"
echo "This operation published Solidity source, constructor arguments, and compiler metadata to the public explorer."
