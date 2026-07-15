#!/usr/bin/env bash
set -euo pipefail

# V6 source-verification gate. This script submits exact source-verification requests to Blockscout,
# but never broadcasts a blockchain transaction and intentionally accepts no private key, mnemonic,
# activation, or unpause input.

CHAIN_ID="4663"
RPC_URL="${ROBINHOOD_MAINNET_RPC_URL:-https://rpc.mainnet.chain.robinhood.com/}"
VERIFIER_URL="${BLOCKSCOUT_VERIFIER_URL:-https://robinhoodchain.blockscout.com/api/}"
BLOCKSCOUT_API_V2_URL="${BLOCKSCOUT_API_V2_URL:-https://robinhoodchain.blockscout.com/api/v2/smart-contracts}"
EXPECTED_COMPILER_VERSION="v0.8.26+commit.8a97fa7a"
EXPECTED_EVM_VERSION="cancun"
BLOCKSCOUT_POLL_ATTEMPTS="12"
BLOCKSCOUT_POLL_INTERVAL="10"

OPERATOR="0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA"
POOL_MANAGER="0x8366a39CC670B4001A1121B8F6A443A643e40951"
LEGACY_FACTORY="0x25A92D8C79c38D07B0d3eFd0ebe929D30e401cdD"
OFFICIAL_LEGACY_RMT_TOKEN="0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C"
V5_ADAPTER="0xf25bc82a271648e5aeea0a28523c44ec4515ab78"
V5_REWARDS_CONTROLLER="0xed282288e583605850ec7e0e430b7bf9f9fd7d45"
V5_REVENUE_ROUTER="0x066fd10caf090f274d1861e4f838558f98ce1ee9"
V4_IDENTITY_FACTORY="0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4"
ZERO_ADDRESS="0x0000000000000000000000000000000000000000"
ZERO_BYTES32="0x0000000000000000000000000000000000000000000000000000000000000000"

GOVERNANCE_DELAY="86400"
GOVERNANCE_EXECUTION_WINDOW="604800"
REGISTRY_ACTIVATION_DELAY="172800"
LAUNCH_UNPAUSE_DELAY="86400"
BOOTSTRAP_WINDOW="43200"
CURVE_FEE_BPS="100"
CREATOR_FEE_SHARE_BPS="7000"
PROTOCOL_FEE_SHARE_BPS="3000"
POST_GRADUATION_FEE_BPS="50"
V4_POOL_FEE="5000"
V4_TICK_SPACING="200"
INITIAL_VIRTUAL_ETH_RESERVE="300000000000000000"
INITIAL_VIRTUAL_TOKEN_RESERVE="1017500000000000000000000000"
GRADUATION_TARGET="2000000000000000000"
TOKEN_SUPPLY="1000000000000000000000000000"
EXPECTED_HOOK_FLAGS="10400" # 0x28a0: beforeInitialize, beforeAddLiquidity, beforeSwap, beforeDonate

fail() {
  echo "V6 verification stopped: $*" >&2
  exit 1
}

lowercase() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

require_tool() {
  command -v "$1" >/dev/null 2>&1 || fail "required command '$1' is unavailable."
}

require_address_env() {
  local variable="$1"
  local value="${!variable:-}"
  [[ -n "$value" ]] || fail "$variable must be set explicitly."
  [[ "$value" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "$variable is not a valid address."
  [[ "$(lowercase "$value")" != "$(lowercase "$ZERO_ADDRESS")" ]] \
    || fail "$variable cannot be the zero address."
}

require_address_value() {
  local label="$1"
  local value="$2"
  [[ "$value" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "$label is not a valid address."
  [[ "$(lowercase "$value")" != "$(lowercase "$ZERO_ADDRESS")" ]] \
    || fail "$label cannot be the zero address."
}

scalar_call() {
  local address="$1"
  local signature="$2"
  shift 2
  local output
  if ! output="$(cast call "$address" "$signature" "$@" --rpc-url "$RPC_URL" 2>&1)"; then
    fail "call $signature on $address failed: $output"
  fi
  # Newer Cast releases append scientific notation to large decoded integers.
  printf '%s\n' "${output%%[[:space:]]*}"
}

expect_call() {
  local label="$1"
  local address="$2"
  local signature="$3"
  local expected="$4"
  shift 4
  local actual
  actual="$(scalar_call "$address" "$signature" "$@")"
  [[ "$(lowercase "$actual")" == "$(lowercase "$expected")" ]] \
    || fail "$label mismatch: expected $expected, received $actual."
}

expect_string_call() {
  local label="$1"
  local address="$2"
  local signature="$3"
  local expected="$4"
  local actual
  if ! actual="$(cast call "$address" "$signature" --rpc-url "$RPC_URL" 2>&1)"; then
    fail "call $signature on $address failed: $actual"
  fi
  actual="${actual#\"}"
  actual="${actual%\"}"
  [[ "$actual" == "$expected" ]] \
    || fail "$label mismatch: expected $expected, received $actual."
}

require_code() {
  local label="$1"
  local address="$2"
  local code
  if ! code="$(cast code "$address" --rpc-url "$RPC_URL" 2>&1)"; then
    fail "could not read $label bytecode at $address: $code"
  fi
  [[ "$code" != "0x" && "$code" != "0x0" && -n "$code" ]] \
    || fail "$label has no bytecode at $address."
}

exact_blockscout_record() {
  local address="$1"
  local expected_name="$2"
  local expected_path="$3"
  local payload
  if ! payload="$(curl --fail --silent --show-error --location --connect-timeout 10 --max-time 30 \
    --header 'Accept: application/json' "${BLOCKSCOUT_API_V2_URL%/}/$address" 2>/dev/null)"; then
    return 1
  fi

  python3 -c '
import json
import sys

expected_name, expected_compiler, expected_evm, expected_path = sys.argv[1:]
record = json.load(sys.stdin)
settings = record.get("compiler_settings")
optimizer = settings.get("optimizer") if isinstance(settings, dict) else None
target = settings.get("compilationTarget") if isinstance(settings, dict) else None
runs = record.get("optimizations_runs", record.get("optimization_runs"))
with open(expected_path, "r", encoding="utf-8", newline="") as source_file:
    expected_source = source_file.read()
valid = (
    record.get("is_verified") is True
    and record.get("is_fully_verified") is True
    and record.get("is_partially_verified") is False
    and record.get("is_changed_bytecode") is False
    and record.get("name") == expected_name
    and str(record.get("language", "")).lower() == "solidity"
    and record.get("compiler_version") == expected_compiler
    and record.get("evm_version") == expected_evm
    and record.get("file_path") == expected_path
    and record.get("source_code") == expected_source
    and record.get("optimization_enabled") is True
    and runs == 200
    and isinstance(settings, dict)
    and settings.get("viaIR") is True
    and isinstance(optimizer, dict)
    and optimizer.get("enabled") is True
    and optimizer.get("runs") == 200
    and settings.get("evmVersion") == expected_evm
    and target == {expected_path: expected_name}
    and record.get("creation_status") == "success"
)
sys.exit(0 if valid else 1)
' "$expected_name" "$EXPECTED_COMPILER_VERSION" "$EXPECTED_EVM_VERSION" "$expected_path" \
    <<<"$payload" >/dev/null 2>&1
}

describe_blockscout_record() {
  local address="$1"
  local expected_name="$2"
  local expected_path="$3"
  local payload
  if ! payload="$(curl --fail --silent --show-error --location --connect-timeout 10 --max-time 30 \
    --header 'Accept: application/json' "${BLOCKSCOUT_API_V2_URL%/}/$address" 2>/dev/null)"; then
    echo "Blockscout has no readable v2 source record for $address"
    return
  fi

  python3 -c '
import hashlib
import json
import sys

expected_name, expected_path = sys.argv[1:]
record = json.load(sys.stdin)
settings = record.get("compiler_settings")
target = settings.get("compilationTarget") if isinstance(settings, dict) else None
source = record.get("source_code")
summary = {
    "is_verified": record.get("is_verified"),
    "is_fully_verified": record.get("is_fully_verified"),
    "is_partially_verified": record.get("is_partially_verified"),
    "is_changed_bytecode": record.get("is_changed_bytecode"),
    "name": record.get("name"),
    "file_path": record.get("file_path"),
    "language": record.get("language"),
    "compiler_version": record.get("compiler_version"),
    "evm_version": record.get("evm_version"),
    "optimization_enabled": record.get("optimization_enabled"),
    "optimization_runs": record.get("optimizations_runs", record.get("optimization_runs")),
    "via_ir": settings.get("viaIR") if isinstance(settings, dict) else None,
    "compilation_target": target,
    "creation_status": record.get("creation_status"),
    "source_sha256": hashlib.sha256(source.encode()).hexdigest() if isinstance(source, str) else None,
    "expected_name": expected_name,
    "expected_path": expected_path,
}
print("Blockscout v2 record: " + json.dumps(summary, sort_keys=True))
' "$expected_name" "$expected_path" <<<"$payload"
}

submit_blockscout_standard_input() {
  local label="$1"
  local address="$2"
  local contract="$3"
  local constructor_args="$4"
  local expected_name="${contract##*:}"
  local expected_path="${contract%%:*}"
  local standard_json
  standard_json="$(mktemp)"

  local command=(
    forge verify-contract
    --rpc-url "$RPC_URL"
    --chain "$CHAIN_ID"
    --compiler-version "$EXPECTED_COMPILER_VERSION"
    --num-of-optimizations 200
    --via-ir
    --skip-is-verified-check
    --show-standard-json-input
  )
  if [[ -n "$constructor_args" ]]; then
    command+=(--constructor-args "$constructor_args")
  fi
  command+=("$address" "$contract")

  if ! "${command[@]}" >"$standard_json"; then
    rm -f "$standard_json"
    echo "Could not generate standard JSON for $label"
    return 1
  fi

  if ! python3 - "$standard_json" "$expected_path" "$expected_name" <<'PY'
import json
import sys

json_path, expected_path, expected_name = sys.argv[1:]
with open(json_path, encoding="utf-8") as source:
    compiler_input = json.load(source)
settings = compiler_input.get("settings")
optimizer = settings.get("optimizer") if isinstance(settings, dict) else None
target = settings.get("compilationTarget") if isinstance(settings, dict) else None
sources = compiler_input.get("sources")
with open(expected_path, encoding="utf-8", newline="") as reviewed:
    expected_source = reviewed.read()
valid = (
    compiler_input.get("language") == "Solidity"
    and isinstance(settings, dict)
    and settings.get("viaIR") is True
    and settings.get("evmVersion") == "cancun"
    and isinstance(optimizer, dict)
    and optimizer.get("enabled") is True
    and optimizer.get("runs") == 200
    and target == {expected_path: expected_name}
    and isinstance(sources, dict)
    and isinstance(sources.get(expected_path), dict)
    and sources[expected_path].get("content") == expected_source
)
if not valid:
    raise SystemExit("generated standard JSON does not match the reviewed release settings and source")
PY
  then
    rm -f "$standard_json"
    echo "Generated standard JSON failed the reviewed-release check for $label"
    return 1
  fi

  echo "Submitting exact standard JSON through Blockscout v2 for $label"
  local response=""
  local status=0
  response="$(curl --fail-with-body --silent --show-error --location --connect-timeout 10 --max-time 120 \
    --request POST "${BLOCKSCOUT_API_V2_URL%/}/$address/verification/via/standard-input" \
    --form-string "compiler_version=$EXPECTED_COMPILER_VERSION" \
    --form-string "contract_name=$expected_name" \
    --form "files[0]=@$standard_json;type=application/json" \
    --form-string "autodetect_constructor_args=true" \
    --form-string "license_type=mit" 2>&1)" || status=$?
  rm -f "$standard_json"
  printf '%s\n' "$response"
  return "$status"
}

verify_contract() {
  local label="$1"
  local address="$2"
  local contract="$3"
  local constructor_args="${4:-}"
  local expected_name="${contract##*:}"
  local expected_path="${contract%%:*}"
  local output=""
  local command_status=0

  if exact_blockscout_record "$address" "$expected_name" "$expected_path"; then
    echo "Exact Blockscout record already verified for $label at $address"
    return
  fi

  describe_blockscout_record "$address" "$expected_name" "$expected_path"

  local command=(
    forge verify-contract
    --rpc-url "$RPC_URL"
    --chain "$CHAIN_ID"
    --verifier blockscout
    --verifier-url "$VERIFIER_URL"
    --compiler-version "$EXPECTED_COMPILER_VERSION"
    --num-of-optimizations 200
    --via-ir
    --skip-is-verified-check
    --watch
  )
  if [[ -n "$constructor_args" ]]; then
    command+=(--constructor-args "$constructor_args")
  fi
  command+=("$address" "$contract")

  echo "Verifying $label at $address"
  output="$("${command[@]}" 2>&1)" || command_status=$?
  printf '%s\n' "$output"

  if ! exact_blockscout_record "$address" "$expected_name" "$expected_path"; then
    submit_blockscout_standard_input "$label" "$address" "$contract" "$constructor_args" || true
  fi

  for ((attempt = 1; attempt <= BLOCKSCOUT_POLL_ATTEMPTS; attempt += 1)); do
    if exact_blockscout_record "$address" "$expected_name" "$expected_path"; then
      echo "Exact Blockscout record confirmed for $label at $address"
      return
    fi
    if ((attempt < BLOCKSCOUT_POLL_ATTEMPTS)); then
      echo "Waiting for exact Blockscout record for $label ($attempt/$BLOCKSCOUT_POLL_ATTEMPTS)"
      sleep "$BLOCKSCOUT_POLL_INTERVAL"
    fi
  done

  fail "$label did not produce an exact Blockscout record (forge status $command_status)."
}

[[ "$#" -eq 0 ]] || fail "this script does not accept positional arguments."
require_tool cast
require_tool forge
require_tool curl
require_tool mktemp
require_tool python3

required_addresses=(
  V6_GOVERNANCE_ADDRESS
  V6_BOOTSTRAP_CONTROLLER_ADDRESS
  V6_VERSION_REGISTRY_ADDRESS
  V6_HOOK_ADDRESS
  V6_ADAPTER_ADDRESS
  V6_LAUNCH_GATE_ADDRESS
  V6_POLICY_REGISTRY_ADDRESS
  V6_MARKET_IMPLEMENTATION_ADDRESS
  V6_FACTORY_ADDRESS
)
for variable in "${required_addresses[@]}"; do
  require_address_env "$variable"
done

actual_chain_id="$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null || true)"
[[ "$actual_chain_id" == "$CHAIN_ID" ]] \
  || fail "expected Robinhood mainnet chain ID $CHAIN_ID, received ${actual_chain_id:-no response}."

echo "Checking canonical dependencies and pre-activation release state"
require_code "PoolManager" "$POOL_MANAGER"
require_code "legacy V5 factory" "$LEGACY_FACTORY"
require_code "official legacy RMT token" "$OFFICIAL_LEGACY_RMT_TOKEN"
require_code "V5 graduation adapter" "$V5_ADAPTER"
require_code "V5 rewards controller" "$V5_REWARDS_CONTROLLER"
require_code "V5 revenue router" "$V5_REVENUE_ROUTER"
require_code "V4 identity factory" "$V4_IDENTITY_FACTORY"

expect_call "legacy official name reservation" "$LEGACY_FACTORY" "isNameUsed(string)(bool)" "true" "Robinhood Meme Terminal"
expect_call "legacy official ticker reservation" "$LEGACY_FACTORY" "isSymbolUsed(string)(bool)" "true" "RMT"
expect_call "official legacy RMT creator" "$OFFICIAL_LEGACY_RMT_TOKEN" "creator()(address)" "$OPERATOR"
expect_string_call "official legacy RMT name" "$OFFICIAL_LEGACY_RMT_TOKEN" "name()(string)" "Robinhood Meme Terminal"
expect_string_call "official legacy RMT ticker" "$OFFICIAL_LEGACY_RMT_TOKEN" "symbol()(string)" "RMT"
expect_call "V5 graduation adapter" "$LEGACY_FACTORY" "graduationAdapter()(address)" "$V5_ADAPTER"
expect_call "V5 rewards controller" "$LEGACY_FACTORY" "rewardsController()(address)" "$V5_REWARDS_CONTROLLER"
expect_call "V5 revenue router" "$LEGACY_FACTORY" "platformTreasury()(address)" "$V5_REVENUE_ROUTER"
expect_call "V5 identity source" "$LEGACY_FACTORY" "legacyIdentityFactory()(address)" "$V4_IDENTITY_FACTORY"
expect_call "V5 curve fee" "$LEGACY_FACTORY" "marketFeeBps()(uint16)" "$CURVE_FEE_BPS"
expect_call "V5 virtual ETH reserve" "$LEGACY_FACTORY" "initialVirtualEthReserve()(uint256)" "$INITIAL_VIRTUAL_ETH_RESERVE"
expect_call "V5 virtual token reserve" "$LEGACY_FACTORY" "initialVirtualTokenReserve()(uint256)" "$INITIAL_VIRTUAL_TOKEN_RESERVE"
expect_call "V5 graduation target" "$LEGACY_FACTORY" "graduationTarget()(uint256)" "$GRADUATION_TARGET"

V5_VERSION="$(cast keccak 'RMT_FACTORY_V5')"
V6_VERSION="$(cast keccak 'RMT_FACTORY_V6')"
FAIR_POLICY_ID="$(cast keccak 'RMT_SIMPLE_FAIR_V1')"
OPEN_POLICY_ID="$(cast keccak 'RMT_SIMPLE_OPEN_V1')"

echo "Checking the nine operator-supplied V6 contracts"
require_code "V6 governance" "$V6_GOVERNANCE_ADDRESS"
require_code "V6 bootstrap controller" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS"
V6_FOUNDATION_VERIFIER_ADDRESS="$(scalar_call "$V6_BOOTSTRAP_CONTROLLER_ADDRESS" "foundationVerifier()(address)")"
V6_SMOKE_VERIFIER_ADDRESS="$(scalar_call "$V6_BOOTSTRAP_CONTROLLER_ADDRESS" "smokeVerifier()(address)")"
require_address_value "V6 foundation verifier" "$V6_FOUNDATION_VERIFIER_ADDRESS"
require_address_value "V6 smoke verifier" "$V6_SMOKE_VERIFIER_ADDRESS"
require_code "V6 foundation verifier" "$V6_FOUNDATION_VERIFIER_ADDRESS"
require_code "V6 smoke verifier" "$V6_SMOKE_VERIFIER_ADDRESS"
require_code "V6 version registry" "$V6_VERSION_REGISTRY_ADDRESS"
require_code "V6 hook" "$V6_HOOK_ADDRESS"
require_code "V6 adapter" "$V6_ADAPTER_ADDRESS"
require_code "V6 launch gate" "$V6_LAUNCH_GATE_ADDRESS"
require_code "V6 policy registry" "$V6_POLICY_REGISTRY_ADDRESS"
require_code "V6 market implementation" "$V6_MARKET_IMPLEMENTATION_ADDRESS"
require_code "V6 factory" "$V6_FACTORY_ADDRESS"

hook_tail="${V6_HOOK_ADDRESS: -4}"
hook_tail="$(lowercase "$hook_tail")"
hook_flags=$((16#$hook_tail & 0x3fff))
[[ "$hook_flags" -eq "$EXPECTED_HOOK_FLAGS" ]] \
  || fail "hook permission flags mismatch: expected 0x28a0, received $(printf '0x%04x' "$hook_flags")."
expect_call "hook PoolManager" "$V6_HOOK_ADDRESS" "poolManager()(address)" "$POOL_MANAGER"
expect_call "hook deployer" "$V6_HOOK_ADDRESS" "deployer()(address)" "$OPERATOR"
expect_call "hook adapter binding" "$V6_HOOK_ADDRESS" "adapter()(address)" "$V6_ADAPTER_ADDRESS"

expect_call "adapter PoolManager" "$V6_ADAPTER_ADDRESS" "poolManager()(address)" "$POOL_MANAGER"
expect_call "adapter hook" "$V6_ADAPTER_ADDRESS" "hook()(address)" "$V6_HOOK_ADDRESS"
expect_call "adapter deployer" "$V6_ADAPTER_ADDRESS" "deployer()(address)" "$OPERATOR"
expect_call "adapter factory binding" "$V6_ADAPTER_ADDRESS" "factory()(address)" "$V6_FACTORY_ADDRESS"
expect_call "adapter pool fee" "$V6_ADAPTER_ADDRESS" "poolFee()(uint24)" "$V4_POOL_FEE"
expect_call "adapter tick spacing" "$V6_ADAPTER_ADDRESS" "tickSpacing()(int24)" "$V4_TICK_SPACING"

expect_call "V6 governance operator signer" "$V6_GOVERNANCE_ADDRESS" "isSigner(address)(bool)" "true" "$OPERATOR"
expect_call "V6 governance signer count" "$V6_GOVERNANCE_ADDRESS" "signerCount()(uint256)" "1"
expect_call "V6 governance threshold" "$V6_GOVERNANCE_ADDRESS" "threshold()(uint256)" "1"
expect_call "V6 governance delay" "$V6_GOVERNANCE_ADDRESS" "executionDelay()(uint64)" "$GOVERNANCE_DELAY"
expect_call "V6 governance execution window" "$V6_GOVERNANCE_ADDRESS" "executionWindow()(uint64)" "$GOVERNANCE_EXECUTION_WINDOW"
expect_call "V6 governance configuration epoch" "$V6_GOVERNANCE_ADDRESS" "configurationEpoch()(uint64)" "1"
expect_call "pre-release V6 governance proposal count" "$V6_GOVERNANCE_ADDRESS" "transactionCount()(uint256)" "0"

expect_call "bootstrap governance" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS" "governance()(address)" "$V6_GOVERNANCE_ADDRESS"
expect_call "bootstrap chain" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS" "CHAIN_ID()(uint256)" "$CHAIN_ID"
expect_call "bootstrap operator" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS" "OPERATOR()(address)" "$OPERATOR"
expect_call "bootstrap PoolManager" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS" "POOL_MANAGER()(address)" "$POOL_MANAGER"
expect_call "bootstrap window" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS" "BOOTSTRAP_WINDOW()(uint64)" "$BOOTSTRAP_WINDOW"
expect_call "bootstrap virtual ETH reserve" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS" "INITIAL_VIRTUAL_ETH_RESERVE()(uint256)" "$INITIAL_VIRTUAL_ETH_RESERVE"
expect_call "bootstrap virtual token reserve" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS" "INITIAL_VIRTUAL_TOKEN_RESERVE()(uint256)" "$INITIAL_VIRTUAL_TOKEN_RESERVE"
expect_call "bootstrap V4 pool fee" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS" "V4_POOL_FEE()(uint24)" "$V4_POOL_FEE"
expect_call "bootstrap V4 tick spacing" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS" "V4_TICK_SPACING()(int24)" "$V4_TICK_SPACING"
expect_call "bootstrap hook flags" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS" "REQUIRED_HOOK_FLAGS()(uint160)" "$EXPECTED_HOOK_FLAGS"
expect_call "bootstrap initial state" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS" "state()(uint8)" "0"
expect_call "bootstrap availability" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS" "bootstrapAvailable()(bool)" "true"
expect_call "foundation verifier binding" "$V6_FOUNDATION_VERIFIER_ADDRESS" "controller()(address)" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS"
expect_call "smoke verifier binding" "$V6_SMOKE_VERIFIER_ADDRESS" "controller()(address)" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS"

expect_call "registry governance" "$V6_VERSION_REGISTRY_ADDRESS" "governance()(address)" "$V6_GOVERNANCE_ADDRESS"
expect_call "registry bootstrap controller" "$V6_VERSION_REGISTRY_ADDRESS" "bootstrapController()(address)" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS"
expect_call "registry bootstrap latch" "$V6_VERSION_REGISTRY_ADDRESS" "bootstrapConsumed()(bool)" "false"
expect_call "registry activation delay" "$V6_VERSION_REGISTRY_ADDRESS" "activationDelay()(uint256)" "$REGISTRY_ACTIVATION_DELAY"
expect_call "registry initial factory" "$V6_VERSION_REGISTRY_ADDRESS" "initialFactory()(address)" "$LEGACY_FACTORY"
expect_call "registry initial version" "$V6_VERSION_REGISTRY_ADDRESS" "initialVersion()(bytes32)" "$V5_VERSION"
expect_call "pre-activation factory" "$V6_VERSION_REGISTRY_ADDRESS" "activeFactory()(address)" "$LEGACY_FACTORY"
expect_call "pre-activation version" "$V6_VERSION_REGISTRY_ADDRESS" "activeVersion()(bytes32)" "$V5_VERSION"
expect_call "pending factory" "$V6_VERSION_REGISTRY_ADDRESS" "pendingFactory()(address)" "$ZERO_ADDRESS"
expect_call "pending version" "$V6_VERSION_REGISTRY_ADDRESS" "pendingVersion()(bytes32)" "$ZERO_BYTES32"
expect_call "pending activation time" "$V6_VERSION_REGISTRY_ADDRESS" "pendingActivationTime()(uint64)" "0"
expect_call "pending expiration time" "$V6_VERSION_REGISTRY_ADDRESS" "pendingExpirationTime()(uint64)" "0"
expect_call "pending governance epoch" "$V6_VERSION_REGISTRY_ADDRESS" "pendingConfigurationEpoch()(uint64)" "0"

expect_call "launch-gate governance" "$V6_LAUNCH_GATE_ADDRESS" "governance()(address)" "$V6_GOVERNANCE_ADDRESS"
expect_call "launch-gate guardian" "$V6_LAUNCH_GATE_ADDRESS" "guardian()(address)" "$OPERATOR"
expect_call "launch-gate bootstrap controller" "$V6_LAUNCH_GATE_ADDRESS" "bootstrapController()(address)" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS"
expect_call "launch-gate bootstrap latch" "$V6_LAUNCH_GATE_ADDRESS" "bootstrapConsumed()(bool)" "false"
expect_call "launch-gate delay" "$V6_LAUNCH_GATE_ADDRESS" "unpauseDelay()(uint64)" "$LAUNCH_UNPAUSE_DELAY"
expect_call "launch-gate paused state" "$V6_LAUNCH_GATE_ADDRESS" "launchesPaused()(bool)" "true"
expect_call "launch-gate unpause schedule" "$V6_LAUNCH_GATE_ADDRESS" "unpauseExecutableAt()(uint64)" "0"
expect_call "launch-gate unpause expiry" "$V6_LAUNCH_GATE_ADDRESS" "unpauseExpiresAt()(uint64)" "0"
expect_call "launch-gate unpause epoch" "$V6_LAUNCH_GATE_ADDRESS" "unpauseConfigurationEpoch()(uint64)" "0"

expect_call "policy governance" "$V6_POLICY_REGISTRY_ADDRESS" "governance()(address)" "$V6_GOVERNANCE_ADDRESS"
expect_call "policy guardian" "$V6_POLICY_REGISTRY_ADDRESS" "guardian()(address)" "$OPERATOR"
expect_call "policy governance delay" "$V6_POLICY_REGISTRY_ADDRESS" "governanceDelay()(uint64)" "$GOVERNANCE_DELAY"
expect_call "policy treasury" "$V6_POLICY_REGISTRY_ADDRESS" "canonicalProtocolTreasury()(address)" "$V6_GOVERNANCE_ADDRESS"
expect_call "canonical market implementation" "$V6_POLICY_REGISTRY_ADDRESS" "canonicalMarketImplementation()(address)" "$V6_MARKET_IMPLEMENTATION_ADDRESS"
expect_call "canonical graduation adapter" "$V6_POLICY_REGISTRY_ADDRESS" "canonicalGraduationAdapter()(address)" "$V6_ADAPTER_ADDRESS"
expect_call "canonical curve fee" "$V6_POLICY_REGISTRY_ADDRESS" "CANONICAL_CURVE_FEE_BPS()(uint16)" "$CURVE_FEE_BPS"
expect_call "canonical creator share" "$V6_POLICY_REGISTRY_ADDRESS" "CANONICAL_CREATOR_FEE_SHARE_BPS()(uint16)" "$CREATOR_FEE_SHARE_BPS"
expect_call "canonical protocol share" "$V6_POLICY_REGISTRY_ADDRESS" "CANONICAL_PROTOCOL_FEE_SHARE_BPS()(uint16)" "$PROTOCOL_FEE_SHARE_BPS"
expect_call "canonical post-graduation fee" "$V6_POLICY_REGISTRY_ADDRESS" "CANONICAL_POST_GRADUATION_FEE_BPS()(uint16)" "$POST_GRADUATION_FEE_BPS"
expect_call "canonical graduation target" "$V6_POLICY_REGISTRY_ADDRESS" "CANONICAL_GRADUATION_TARGET()(uint256)" "$GRADUATION_TARGET"
expect_call "Fair default policy" "$V6_POLICY_REGISTRY_ADDRESS" "defaultPolicyId()(bytes32)" "$FAIR_POLICY_ID"
FAIR_POLICY_HASH="$(scalar_call "$V6_POLICY_REGISTRY_ADDRESS" "policyHash(bytes32)(bytes32)" "$FAIR_POLICY_ID")"
OPEN_POLICY_HASH="$(scalar_call "$V6_POLICY_REGISTRY_ADDRESS" "policyHash(bytes32)(bytes32)" "$OPEN_POLICY_ID")"
[[ "$FAIR_POLICY_HASH" != "$ZERO_BYTES32" ]] || fail "Fair genesis policy hash is missing."
[[ "$OPEN_POLICY_HASH" != "$ZERO_BYTES32" ]] || fail "Open genesis policy hash is missing."

expect_call "factory protocol version" "$V6_FACTORY_ADDRESS" "protocolVersion()(uint32)" "6"
expect_call "factory launch gate" "$V6_FACTORY_ADDRESS" "launchGate()(address)" "$V6_LAUNCH_GATE_ADDRESS"
expect_call "factory policy registry" "$V6_FACTORY_ADDRESS" "policyRegistry()(address)" "$V6_POLICY_REGISTRY_ADDRESS"
expect_call "factory version registry" "$V6_FACTORY_ADDRESS" "factoryRegistry()(address)" "$V6_VERSION_REGISTRY_ADDRESS"
expect_call "factory legacy identity source" "$V6_FACTORY_ADDRESS" "legacyIdentityFactory()(address)" "$LEGACY_FACTORY"
expect_call "factory official legacy token" "$V6_FACTORY_ADDRESS" "officialLegacyToken()(address)" "$OFFICIAL_LEGACY_RMT_TOKEN"
expect_call "creator payout authority" "$V6_FACTORY_ADDRESS" "creatorPayoutAuthority()(address)" "$V6_GOVERNANCE_ADDRESS"
expect_call "official migration policy" "$V6_FACTORY_ADDRESS" "OFFICIAL_MIGRATION_POLICY_ID()(bytes32)" "$FAIR_POLICY_ID"
expect_call "factory V6 version label" "$V6_FACTORY_ADDRESS" "FACTORY_VERSION()(bytes32)" "$V6_VERSION"
expect_call "factory legacy version label" "$V6_FACTORY_ADDRESS" "LEGACY_FACTORY_VERSION()(bytes32)" "$V5_VERSION"
expect_call "factory virtual ETH reserve" "$V6_FACTORY_ADDRESS" "initialVirtualEthReserve()(uint256)" "$INITIAL_VIRTUAL_ETH_RESERVE"
expect_call "factory virtual token reserve" "$V6_FACTORY_ADDRESS" "initialVirtualTokenReserve()(uint256)" "$INITIAL_VIRTUAL_TOKEN_RESERVE"
expect_call "factory token supply" "$V6_FACTORY_ADDRESS" "TOKEN_SUPPLY()(uint256)" "$TOKEN_SUPPLY"

TOKEN_IMPLEMENTATION="$(scalar_call "$V6_FACTORY_ADDRESS" "tokenImplementation()(address)")"
FEE_SPLITTER_IMPLEMENTATION="$(scalar_call "$V6_FACTORY_ADDRESS" "feeSplitterImplementation()(address)")"
OFFICIAL_IDENTITY_MIGRATION="$(scalar_call "$V6_FACTORY_ADDRESS" "officialIdentityMigration()(address)")"
for derived_address in "$TOKEN_IMPLEMENTATION" "$FEE_SPLITTER_IMPLEMENTATION" "$OFFICIAL_IDENTITY_MIGRATION"; do
  [[ "$derived_address" =~ ^0x[0-9a-fA-F]{40}$ \
    && "$(lowercase "$derived_address")" != "$(lowercase "$ZERO_ADDRESS")" ]] \
    || fail "factory returned an invalid derived contract address: $derived_address."
done
require_code "factory token implementation" "$TOKEN_IMPLEMENTATION"
require_code "factory fee-splitter implementation" "$FEE_SPLITTER_IMPLEMENTATION"
require_code "official identity migration" "$OFFICIAL_IDENTITY_MIGRATION"
expect_call "official launcher" "$OFFICIAL_IDENTITY_MIGRATION" "officialLauncher()(address)" "$OPERATOR"
expect_call "official migration factory" "$OFFICIAL_IDENTITY_MIGRATION" "authorizedFactory()(address)" "$V6_FACTORY_ADDRESS"
expect_call "official migration legacy token" "$OFFICIAL_IDENTITY_MIGRATION" "officialLegacyToken()(address)" "$OFFICIAL_LEGACY_RMT_TOKEN"
expect_call "official migration consumption" "$OFFICIAL_IDENTITY_MIGRATION" "consumed()(bool)" "false"

echo "All onchain checks passed. Starting exact Blockscout source verification for fifteen contracts."

V6_GOVERNANCE_ARGS="$(cast abi-encode 'constructor(address,uint64,uint64)' "$OPERATOR" "$GOVERNANCE_DELAY" "$GOVERNANCE_EXECUTION_WINDOW")"
BOOTSTRAP_ARGS="$(cast abi-encode 'constructor(address)' "$V6_GOVERNANCE_ADDRESS")"
BOOTSTRAP_VERIFIER_ARGS="$(cast abi-encode 'constructor(address)' "$V6_BOOTSTRAP_CONTROLLER_ADDRESS")"
REGISTRY_ARGS="$(cast abi-encode 'constructor(address,uint256,address,bytes32,address)' "$V6_GOVERNANCE_ADDRESS" "$REGISTRY_ACTIVATION_DELAY" "$LEGACY_FACTORY" "$V5_VERSION" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS")"
V5_FACTORY_ARGS="$(cast abi-encode 'constructor(address,uint16,uint256,uint256,uint256,address,address,address)' "$V5_ADAPTER" "$CURVE_FEE_BPS" "$INITIAL_VIRTUAL_ETH_RESERVE" "$INITIAL_VIRTUAL_TOKEN_RESERVE" "$GRADUATION_TARGET" "$V5_REWARDS_CONTROLLER" "$V5_REVENUE_ROUTER" "$V4_IDENTITY_FACTORY")"
HOOK_ARGS="$(cast abi-encode 'constructor(address,address)' "$POOL_MANAGER" "$OPERATOR")"
ADAPTER_ARGS="$(cast abi-encode 'constructor(address,address,uint24,int24)' "$POOL_MANAGER" "$V6_HOOK_ADDRESS" "$V4_POOL_FEE" "$V4_TICK_SPACING")"
GATE_ARGS="$(cast abi-encode 'constructor(address,address,uint64,address)' "$V6_GOVERNANCE_ADDRESS" "$OPERATOR" "$LAUNCH_UNPAUSE_DELAY" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS")"
POLICY_ARGS="$(cast abi-encode 'constructor(address,address,uint64,address,address,address)' "$V6_GOVERNANCE_ADDRESS" "$OPERATOR" "$GOVERNANCE_DELAY" "$V6_GOVERNANCE_ADDRESS" "$V6_MARKET_IMPLEMENTATION_ADDRESS" "$V6_ADAPTER_ADDRESS")"
FACTORY_ARGS="$(cast abi-encode 'constructor(address,address,address,uint256,uint256,address,address,address)' "$V6_LAUNCH_GATE_ADDRESS" "$V6_POLICY_REGISTRY_ADDRESS" "$V6_VERSION_REGISTRY_ADDRESS" "$INITIAL_VIRTUAL_ETH_RESERVE" "$INITIAL_VIRTUAL_TOKEN_RESERVE" "$LEGACY_FACTORY" "$OFFICIAL_LEGACY_RMT_TOKEN" "$OPERATOR")"
MIGRATION_ARGS="$(cast abi-encode 'constructor(address,address,address)' "$OPERATOR" "$V6_FACTORY_ADDRESS" "$OFFICIAL_LEGACY_RMT_TOKEN")"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

verify_contract "V6 governance" "$V6_GOVERNANCE_ADDRESS" "src/RMTV6Governance.sol:RMTV6Governance" "$V6_GOVERNANCE_ARGS"
verify_contract "V6 bootstrap controller" "$V6_BOOTSTRAP_CONTROLLER_ADDRESS" "src/RMTV6BootstrapController.sol:RMTV6BootstrapController" "$BOOTSTRAP_ARGS"
verify_contract "V6 foundation verifier" "$V6_FOUNDATION_VERIFIER_ADDRESS" "src/RMTV6BootstrapFoundationVerifier.sol:RMTV6BootstrapFoundationVerifier" "$BOOTSTRAP_VERIFIER_ARGS"
verify_contract "V6 smoke verifier" "$V6_SMOKE_VERIFIER_ADDRESS" "src/RMTV6BootstrapSmokeVerifier.sol:RMTV6BootstrapSmokeVerifier" "$BOOTSTRAP_VERIFIER_ARGS"
verify_contract "V6 version registry" "$V6_VERSION_REGISTRY_ADDRESS" "src/VersionedFactoryRegistry.sol:VersionedFactoryRegistry" "$REGISTRY_ARGS"
verify_contract "V5 identity factory" "$LEGACY_FACTORY" "src/LowCostMemeLaunchFactoryV5.sol:LowCostMemeLaunchFactoryV5" "$V5_FACTORY_ARGS"
verify_contract "V6 graduation hook" "$V6_HOOK_ADDRESS" "src/V5GraduationHook.sol:V5GraduationHook" "$HOOK_ARGS"
verify_contract "V6 graduation adapter" "$V6_ADAPTER_ADDRESS" "src/V4GraduationAdapter.sol:V4GraduationAdapter" "$ADAPTER_ARGS"
verify_contract "V6 launch gate" "$V6_LAUNCH_GATE_ADDRESS" "src/RMTLaunchGate.sol:RMTLaunchGate" "$GATE_ARGS"
verify_contract "V6 policy registry" "$V6_POLICY_REGISTRY_ADDRESS" "src/RMTLaunchPolicyRegistry.sol:RMTLaunchPolicyRegistry" "$POLICY_ARGS"
verify_contract "V6 market implementation" "$V6_MARKET_IMPLEMENTATION_ADDRESS" "src/clone/CloneBondingCurveMarketV6.sol:CloneBondingCurveMarketV6"
verify_contract "factory token implementation" "$TOKEN_IMPLEMENTATION" "src/clone/CloneFixedSupplyMemeToken.sol:CloneFixedSupplyMemeToken"
verify_contract "factory fee-splitter implementation" "$FEE_SPLITTER_IMPLEMENTATION" "src/DirectLaunchFeeSplitter.sol:DirectLaunchFeeSplitter"
verify_contract "official identity migration" "$OFFICIAL_IDENTITY_MIGRATION" "src/OfficialRMTIdentityMigration.sol:OfficialRMTIdentityMigration" "$MIGRATION_ARGS"
verify_contract "V6 launch factory" "$V6_FACTORY_ADDRESS" "src/RMTLaunchFactoryV6.sol:RMTLaunchFactoryV6" "$FACTORY_ARGS"

echo "V6 source verification passed for all fifteen contracts. No blockchain transaction was broadcast and V6 remains inactive and paused."
