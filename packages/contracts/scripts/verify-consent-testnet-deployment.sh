#!/usr/bin/env bash
set -euo pipefail

# Read-only verifier for the no-value Robinhood Chain Testnet consent rehearsal.
# This script accepts no key, mnemonic, signature, unpause instruction, or migration input.

CHAIN_ID="46630"
RPC_URL="${ROBINHOOD_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com/}"
EXPECTED_OPERATOR="0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA"
CREATE2_DEPLOYER="0x4e59b44847b379578588920cA78FbF26c0B4956C"
CREATE2_DEPLOYER_RUNTIME_HASH="0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989"
TERMS_DOCUMENT_HASH="0x236ed1f849548c61a923152a92dc91593f22a6e2ff3d176a4b0db38b3b2d2b57"
CONTRACT_SOURCE="packages/contracts/src/RMTTestnetSushiV3RehearsalStack.sol"
TERMS_SOURCE="docs/CONSENT_MIGRATION_TESTNET_TERMS_V1.md"
POOL_FEE="3000"
TICK_SPACING="60"
PAIRED_TOKEN_FIXED_SUPPLY="1000000000000000000000000000"
WETH_FIXED_SUPPLY="1000000000000000000000000"
GOVERNANCE_DELAY="86400"
GOVERNANCE_WINDOW="604800"

fail() {
  echo "Consent rehearsal verification stopped: $*" >&2
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

scalar_call() {
  local address="$1"
  local signature="$2"
  shift 2
  local output
  if ! output="$(cast call "$address" "$signature" "$@" --block "$SNAPSHOT_BLOCK" --rpc-url "$RPC_URL" 2>&1)"; then
    fail "call $signature on $address failed: $output"
  fi
  printf '%s\n' "${output%%[[:space:]]*}"
}

latest_scalar_call() {
  local address="$1"
  local signature="$2"
  shift 2
  local output
  if ! output="$(cast call "$address" "$signature" "$@" --rpc-url "$RPC_URL" 2>&1)"; then
    fail "latest call $signature on $address failed: $output"
  fi
  printf '%s\n' "${output%%[[:space:]]*}"
}

expect_call() {
  local label="$1"
  local address="$2"
  local signature="$3"
  local expected="$4"
  shift 4
  expect_equal "$label" "$(scalar_call "$address" "$signature" "$@")" "$expected"
}

record_address() {
  json_value "contracts.$1.address"
}

record_code_hash() {
  json_value "contracts.$1.runtimeCodeHash"
}

verify_runtime_hash() {
  local label="$1"
  local address
  local expected_hash
  local code
  local live_hash
  address="$(record_address "$label")"
  expected_hash="$(record_code_hash "$label")"
  if ! code="$(cast code "$address" --block "$SNAPSHOT_BLOCK" --rpc-url "$RPC_URL" 2>&1)"; then
    fail "could not read $label runtime code at $address: $code"
  fi
  [[ "$code" != "0x" && "$code" != "0x0" && -n "$code" ]] || fail "$label has no runtime code at $address."
  live_hash="$(cast keccak "$code")"
  expect_equal "$label recorded runtime hash" "$live_hash" "$expected_hash"
}

verify_create2_transaction() {
  local label="$1"
  local expected_address="$2"
  local tx_hash
  local record_block
  local record_salt
  local record_init_hash
  local tx_file="$TMP_DIR/$label-transaction.json"
  local receipt_file="$TMP_DIR/$label-receipt.json"
  local tx_from tx_to tx_value tx_input tx_chain_id receipt_block receipt_status
  local calldata_salt initcode live_init_hash predicted expected_constructor_tail

  tx_hash="$(json_value "create2.$label.transactionHash")"
  record_block="$(json_value "create2.$label.blockNumber")"
  record_salt="$(json_value "create2.$label.salt")"
  record_init_hash="$(json_value "create2.$label.initCodeHash")"

  cast tx "$tx_hash" --json --rpc-url "$RPC_URL" >"$tx_file" \
    || fail "could not read $label transaction $tx_hash."
  cast receipt "$tx_hash" --json --rpc-url "$RPC_URL" >"$receipt_file" \
    || fail "could not read $label receipt $tx_hash."

  IFS=$'\t' read -r tx_from tx_to tx_value tx_input tx_chain_id receipt_block receipt_status < <(
    python3 - "$tx_file" "$receipt_file" "$tx_hash" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    transaction = json.load(source)
with open(sys.argv[2], encoding="utf-8") as source:
    receipt = json.load(source)

expected_hash = sys.argv[3].lower()
if str(transaction.get("hash", "")).lower() != expected_hash:
    raise SystemExit("transaction hash differs from the requested record")
if str(receipt.get("transactionHash", "")).lower() != expected_hash:
    raise SystemExit("receipt hash differs from the requested record")
if str(receipt.get("from", "")).lower() != str(transaction.get("from", "")).lower():
    raise SystemExit("receipt sender differs from transaction sender")
if str(receipt.get("to", "")).lower() != str(transaction.get("to", "")).lower():
    raise SystemExit("receipt destination differs from transaction destination")

block = receipt.get("blockNumber")
if not isinstance(block, str):
    raise SystemExit("receipt block number is missing")
if transaction.get("blockNumber") != block:
    raise SystemExit("transaction and receipt block numbers differ")
print(
    transaction.get("from", ""),
    transaction.get("to", ""),
    transaction.get("value", ""),
    transaction.get("input", ""),
    int(transaction.get("chainId", "0x0"), 16),
    int(block, 16),
    receipt.get("status", ""),
    sep="\t",
)
PY
  )

  expect_equal "$label transaction sender" "$tx_from" "$EXPECTED_OPERATOR"
  expect_equal "$label transaction destination" "$tx_to" "$CREATE2_DEPLOYER"
  [[ "$tx_chain_id" == "$CHAIN_ID" ]] || fail "$label transaction chain ID is $tx_chain_id, not $CHAIN_ID."
  [[ "$tx_value" == "0x0" || "$tx_value" == "0x" ]] || fail "$label transaction value is not zero: $tx_value."
  [[ "$receipt_status" == "0x1" ]] || fail "$label transaction receipt is not successful: $receipt_status."
  [[ "$receipt_block" == "$record_block" ]] \
    || fail "$label receipt block mismatch: expected $record_block, received $receipt_block."
  [[ "$tx_input" =~ ^0x[0-9a-fA-F]+$ && ${#tx_input} -gt 66 ]] || fail "$label transaction input is not salt plus initcode."

  calldata_salt="${tx_input:0:66}"
  initcode="0x${tx_input:66}"
  live_init_hash="$(cast keccak "$initcode")"
  expect_equal "$label CREATE2 salt" "$calldata_salt" "$record_salt"
  expect_equal "$label initcode hash" "$live_init_hash" "$record_init_hash"
  if [[ "$label" == "venue" ]]; then
    expected_constructor_tail="$(cast abi-encode 'f(address)' "$EXPECTED_OPERATOR")"
  else
    expected_constructor_tail="$(cast abi-encode 'f(address,address)' "$EXPECTED_OPERATOR" "$(record_address venue)")"
  fi
  [[ "$(lowercase "$initcode")" == *"$(lowercase "${expected_constructor_tail:2}")" ]] \
    || fail "$label initcode does not end with the reviewed constructor arguments."
  predicted="$(cast create2 --deployer "$CREATE2_DEPLOYER" --salt "$record_salt" --init-code-hash "$record_init_hash")"
  expect_equal "$label CREATE2 address" "$predicted" "$expected_address"
  expect_equal "$label recorded deployed address" "$(json_value "create2.$label.deployedAddress")" "$expected_address"
}

[[ $# -eq 1 ]] || fail "usage: $0 <completed-deployment-record.json>"
RECORD="$1"
[[ -f "$RECORD" ]] || fail "deployment record does not exist: $RECORD"

require_tool cast
require_tool git
require_tool python3
require_tool xxd

python3 - "$RECORD" "$EXPECTED_OPERATOR" "$CREATE2_DEPLOYER" "$CREATE2_DEPLOYER_RUNTIME_HASH" "$TERMS_DOCUMENT_HASH" <<'PY'
import datetime
import json
import re
import sys

record_path, operator, create2_deployer, deployer_hash, terms_hash = sys.argv[1:]
with open(record_path, encoding="utf-8") as source:
    record = json.load(source)

def stop(message):
    raise SystemExit(f"record validation failed: {message}")

def at(path):
    value = record
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            stop(f"missing {path}")
        value = value[part]
    return value

address = re.compile(r"^0x[0-9a-fA-F]{40}$")
hash32 = re.compile(r"^0x[0-9a-fA-F]{64}$")
commit = re.compile(r"^[0-9a-f]{40}$")
sha256 = re.compile(r"^[0-9a-f]{64}$")
utc = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

def valid_utc(value):
    if not isinstance(value, str) or not utc.fullmatch(value):
        return False
    try:
        datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return False
    return True

if at("schemaVersion") != 1:
    stop("schemaVersion must be 1")
if at("release.name") != "RMT consent migration no-value rehearsal":
    stop("unexpected release name")
status = at("release.status")
if status not in {"deployed-paused", "verified-paused"}:
    stop("release.status must be deployed-paused or verified-paused; templates cannot be verified")
if at("release.sourceRepository") != "https://github.com/LandoCrissian/robinhood-meme-terminal":
    stop("unexpected source repository")
if not commit.fullmatch(str(at("release.sourceCommit"))):
    stop("sourceCommit must be a lowercase, full 40-character commit")
if not sha256.fullmatch(str(at("release.contractSourceSha256"))):
    stop("contractSourceSha256 must be a lowercase SHA-256 digest")
if not valid_utc(at("release.deployedAtUtc")):
    stop("deployedAtUtc must use YYYY-MM-DDTHH:MM:SSZ")
expected_compiler = {
    "version": "v0.8.26+commit.8a97fa7a",
    "evmVersion": "cancun",
    "optimizer": True,
    "optimizerRuns": 200,
    "viaIR": True,
}
if at("release.compiler") != expected_compiler:
    stop("compiler settings differ from the reviewed release")
if at("network.chainId") != 46630:
    stop("network chain ID must be 46630")
if at("network.name") != "Robinhood Chain Testnet":
    stop("unexpected network name")
if at("network.rpcUrl") != "https://rpc.testnet.chain.robinhood.com/":
    stop("unexpected recorded RPC URL")
if at("network.explorerUrl") != "https://explorer.testnet.chain.robinhood.com":
    stop("unexpected recorded explorer URL")
if str(at("operator")).lower() != operator.lower():
    stop("operator does not match the fixed release operator")
if str(at("create2.deployer")).lower() != create2_deployer.lower():
    stop("unexpected CREATE2 deployer")
if str(at("create2.deployerRuntimeCodeHash")).lower() != deployer_hash.lower():
    stop("unexpected CREATE2 deployer runtime hash")

contracts = [
    "venue", "governance", "pairedToken", "weth", "factory", "pool",
    "positionManager", "consentStack", "session", "migrator",
]
seen = set()
for label in contracts:
    deployed = str(at(f"contracts.{label}.address"))
    runtime_hash = str(at(f"contracts.{label}.runtimeCodeHash"))
    source_status = at(f"contracts.{label}.sourceVerification")
    if not address.fullmatch(deployed) or int(deployed, 16) == 0:
        stop(f"invalid contracts.{label}.address")
    if deployed.lower() in seen:
        stop(f"duplicate contract address: {deployed}")
    seen.add(deployed.lower())
    if not hash32.fullmatch(runtime_hash) or int(runtime_hash, 16) == 0:
        stop(f"invalid contracts.{label}.runtimeCodeHash")
    if source_status not in {"pending", "verified"}:
        stop(f"invalid contracts.{label}.sourceVerification")

for label, contract_label in (("venue", "venue"), ("consentStack", "consentStack")):
    if not hash32.fullmatch(str(at(f"create2.{label}.transactionHash"))):
        stop(f"invalid {label} transaction hash")
    if not isinstance(at(f"create2.{label}.blockNumber"), int) or at(f"create2.{label}.blockNumber") <= 0:
        stop(f"invalid {label} receipt block")
    if not hash32.fullmatch(str(at(f"create2.{label}.salt"))):
        stop(f"invalid {label} CREATE2 salt")
    if not hash32.fullmatch(str(at(f"create2.{label}.initCodeHash"))):
        stop(f"invalid {label} initcode hash")
    if str(at(f"create2.{label}.deployedAddress")).lower() != str(at(f"contracts.{contract_label}.address")).lower():
        stop(f"{label} CREATE2 address differs from its contract record")

if str(at("create2.venue.transactionHash")).lower() == str(at("create2.consentStack.transactionHash")).lower():
    stop("the two CREATE2 transaction hashes must be distinct")

if at("create2.consentStack.blockNumber") < at("create2.venue.blockNumber"):
    stop("consent-stack receipt block precedes the venue receipt")
if at("configuration.destinationChainId") != 46630:
    stop("configuration destination chain must be 46630")
for field in ("governanceSigner", "guardian"):
    if str(at(f"configuration.{field}")).lower() != operator.lower():
        stop(f"configuration.{field} differs from the fixed operator")
if at("configuration.poolFee") != 3000 or at("configuration.tickSpacing") != 60:
    stop("pool policy differs from the reviewed release")
if at("configuration.governanceDelaySeconds") != 86400 or at("configuration.governanceWindowSeconds") != 604800:
    stop("governance timing differs from the reviewed release")
if at("configuration.pairedTokenFixedSupply") != "1000000000000000000000000000":
    stop("paired-token fixed supply differs from the reviewed release")
if at("configuration.wethFixedSupply") != "1000000000000000000000000":
    stop("rehearsal-WETH fixed supply differs from the reviewed release")
for field in ("configurationHash", "migrationTermsHash"):
    if not hash32.fullmatch(str(at(f"configuration.{field}"))):
        stop(f"invalid configuration.{field}")
if str(at("configuration.termsDocumentHash")).lower() != terms_hash.lower():
    stop("terms-document hash differs from the reviewed terms")
if at("configuration.paused") is not True:
    stop("record does not assert paused state")
snapshot = at("verification.snapshotBlockNumber")
if not isinstance(snapshot, int) or snapshot < at("create2.consentStack.blockNumber"):
    stop("verification snapshot must be at or after the consent-stack receipt")
result = at("verification.result")
verified_at = at("verification.verifiedAtUtc")
if status == "verified-paused":
    if result != "passed" or not valid_utc(verified_at):
        stop("verified-paused requires result passed and a UTC verification time")
    if any(at(f"contracts.{label}.sourceVerification") != "verified" for label in contracts):
        stop("verified-paused requires source verification for all ten contracts")
else:
    if result != "pending" or verified_at is not None:
        stop("deployed-paused requires pending verification and a null verification time")
if at("verification.verifier") != "packages/contracts/scripts/verify-consent-testnet-deployment.sh":
    stop("unexpected verifier path")
if at("verification.sourceVerifier") != "packages/contracts/scripts/verify-consent-testnet-sources.sh":
    stop("unexpected source-verifier path")

classification = at("classification")
for key in ("officialSushiDeployment", "productionAmm", "realAssetsPermitted", "publicExecutionEnabled"):
    if classification.get(key) is not False:
        stop(f"classification.{key} must remain false")
PY

SOURCE_COMMIT="$(json_value release.sourceCommit)"
SOURCE_SHA256="$(json_value release.contractSourceSha256)"
SNAPSHOT_BLOCK="$(json_value verification.snapshotBlockNumber)"

git rev-parse --show-toplevel >/dev/null 2>&1 || fail "run this verifier inside the RMT repository."
git cat-file -e "$SOURCE_COMMIT^{commit}" 2>/dev/null \
  || fail "recorded source commit $SOURCE_COMMIT is not present in this repository."

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
git show "$SOURCE_COMMIT:$CONTRACT_SOURCE" >"$TMP_DIR/rehearsal-source.sol" \
  || fail "contract source is absent from recorded commit $SOURCE_COMMIT."
git show "$SOURCE_COMMIT:$TERMS_SOURCE" >"$TMP_DIR/terms.md" \
  || fail "terms source is absent from recorded commit $SOURCE_COMMIT."

ACTUAL_SOURCE_SHA256="$(python3 - "$TMP_DIR/rehearsal-source.sol" <<'PY'
import hashlib
import sys
with open(sys.argv[1], "rb") as source:
    print(hashlib.sha256(source.read()).hexdigest())
PY
)"
expect_equal "recorded contract-source SHA-256" "$ACTUAL_SOURCE_SHA256" "$SOURCE_SHA256"

TERMS_HEX="0x$(xxd -p "$TMP_DIR/terms.md" | tr -d '\n')"
expect_equal "terms document Keccak-256 at the source commit" "$(cast keccak "$TERMS_HEX")" "$TERMS_DOCUMENT_HASH"

expect_equal "RPC chain ID" "$(cast chain-id --rpc-url "$RPC_URL")" "$CHAIN_ID"
LATEST_BLOCK="$(cast block-number --rpc-url "$RPC_URL")"
(( LATEST_BLOCK >= SNAPSHOT_BLOCK )) \
  || fail "verification snapshot block $SNAPSHOT_BLOCK is ahead of RPC head $LATEST_BLOCK."

CREATE2_CODE="$(cast code "$CREATE2_DEPLOYER" --block "$SNAPSHOT_BLOCK" --rpc-url "$RPC_URL")"
[[ "$CREATE2_CODE" != "0x" && "$CREATE2_CODE" != "0x0" ]] || fail "canonical CREATE2 deployer has no code."
[[ $(( (${#CREATE2_CODE} - 2) / 2 )) -eq 69 ]] || fail "canonical CREATE2 deployer runtime length is not 69 bytes."
expect_equal "canonical CREATE2 deployer runtime hash" "$(cast keccak "$CREATE2_CODE")" "$CREATE2_DEPLOYER_RUNTIME_HASH"

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

VENUE_SALT="$(cast keccak "0x$(printf '%s' 'rmt-consent-rehearsal-venue-v1' | xxd -p | tr -d '\n')${EXPECTED_OPERATOR:2}")"
CONSENT_SALT="$(cast keccak "0x$(printf '%s' 'rmt-consent-rehearsal-stack-v1' | xxd -p | tr -d '\n')${VENUE:2}")"
expect_equal "reviewed venue salt derivation" "$(json_value create2.venue.salt)" "$VENUE_SALT"
expect_equal "reviewed consent-stack salt derivation" "$(json_value create2.consentStack.salt)" "$CONSENT_SALT"

verify_create2_transaction venue "$VENUE"
verify_create2_transaction consentStack "$CONSENT_STACK"

for label in venue governance pairedToken weth factory pool positionManager consentStack session migrator; do
  verify_runtime_hash "$label"
done

# Venue and consent-stack topology.
expect_call "venue operator" "$VENUE" "operator()(address)" "$EXPECTED_OPERATOR"
expect_call "venue governance" "$VENUE" "governance()(address)" "$GOVERNANCE"
expect_call "venue paired token" "$VENUE" "pairedToken()(address)" "$PAIRED_TOKEN"
expect_call "venue rehearsal WETH" "$VENUE" "weth()(address)" "$WETH"
expect_call "venue factory" "$VENUE" "factory()(address)" "$FACTORY"
expect_call "venue pool" "$VENUE" "pool()(address)" "$POOL"
expect_call "venue position manager" "$VENUE" "positionManager()(address)" "$POSITION_MANAGER"
expect_call "venue self runtime hash" "$VENUE" "runtimeCodeHash()(bytes32)" "$(record_code_hash venue)"
for binding in \
  "governanceCodeHash:governance" \
  "pairedTokenCodeHash:pairedToken" \
  "wethCodeHash:weth" \
  "factoryCodeHash:factory" \
  "poolCodeHash:pool" \
  "positionManagerCodeHash:positionManager"; do
  getter="${binding%%:*}"
  label="${binding##*:}"
  expect_call "venue $getter" "$VENUE" "$getter()(bytes32)" "$(record_code_hash "$label")"
done

expect_call "consent-stack operator" "$CONSENT_STACK" "operator()(address)" "$EXPECTED_OPERATOR"
expect_call "consent-stack venue" "$CONSENT_STACK" "venue()(address)" "$VENUE"
expect_call "consent-stack governance" "$CONSENT_STACK" "governance()(address)" "$GOVERNANCE"
expect_call "consent-stack paired token" "$CONSENT_STACK" "pairedToken()(address)" "$PAIRED_TOKEN"
expect_call "consent-stack rehearsal WETH" "$CONSENT_STACK" "weth()(address)" "$WETH"
expect_call "consent-stack factory" "$CONSENT_STACK" "factory()(address)" "$FACTORY"
expect_call "consent-stack pool" "$CONSENT_STACK" "pool()(address)" "$POOL"
expect_call "consent-stack position manager" "$CONSENT_STACK" "positionManager()(address)" "$POSITION_MANAGER"
expect_call "consent-stack session" "$CONSENT_STACK" "session()(address)" "$SESSION"
expect_call "consent-stack migrator" "$CONSENT_STACK" "migrator()(address)" "$MIGRATOR"
expect_call "consent-stack self runtime hash" "$CONSENT_STACK" "runtimeCodeHash()(bytes32)" "$(record_code_hash consentStack)"

for binding in \
  "venueCodeHash:venue" \
  "governanceCodeHash:governance" \
  "pairedTokenCodeHash:pairedToken" \
  "wethCodeHash:weth" \
  "factoryCodeHash:factory" \
  "poolCodeHash:pool" \
  "positionManagerCodeHash:positionManager" \
  "sessionCodeHash:session" \
  "migratorCodeHash:migrator"; do
  getter="${binding%%:*}"
  label="${binding##*:}"
  expect_call "consent-stack $getter" "$CONSENT_STACK" "$getter()(bytes32)" "$(record_code_hash "$label")"
done

# Governance, token supplies, and venue bindings.
expect_call "operator governance signer" "$GOVERNANCE" "isSigner(address)(bool)" "true" "$EXPECTED_OPERATOR"
expect_call "governance signer count" "$GOVERNANCE" "signerCount()(uint256)" "1"
expect_call "governance threshold" "$GOVERNANCE" "threshold()(uint256)" "1"
expect_call "governance delay" "$GOVERNANCE" "executionDelay()(uint64)" "$GOVERNANCE_DELAY"
expect_call "governance window" "$GOVERNANCE" "executionWindow()(uint64)" "$GOVERNANCE_WINDOW"
expect_call "paired-token fixed supply" "$PAIRED_TOKEN" "totalSupply()(uint256)" "$PAIRED_TOKEN_FIXED_SUPPLY"
expect_call "paired-token initial recipient" "$PAIRED_TOKEN" "initialRecipient()(address)" "$EXPECTED_OPERATOR"
expect_call "rehearsal-WETH fixed supply" "$WETH" "totalSupply()(uint256)" "$WETH_FIXED_SUPPLY"
expect_call "rehearsal-WETH initial recipient" "$WETH" "initialRecipient()(address)" "$EXPECTED_OPERATOR"

TOKEN0="$PAIRED_TOKEN"
TOKEN1="$WETH"
if [[ "$(lowercase "$PAIRED_TOKEN")" > "$(lowercase "$WETH")" ]]; then
  TOKEN0="$WETH"
  TOKEN1="$PAIRED_TOKEN"
fi

expect_call "factory pool" "$FACTORY" "pool()(address)" "$POOL"
expect_call "factory token0" "$FACTORY" "token0()(address)" "$TOKEN0"
expect_call "factory token1" "$FACTORY" "token1()(address)" "$TOKEN1"
expect_call "factory forward pool lookup" "$FACTORY" "getPool(address,address,uint24)(address)" "$POOL" "$TOKEN0" "$TOKEN1" "$POOL_FEE"
expect_call "factory reverse pool lookup" "$FACTORY" "getPool(address,address,uint24)(address)" "$POOL" "$TOKEN1" "$TOKEN0" "$POOL_FEE"
expect_call "factory fee tick spacing" "$FACTORY" "feeAmountTickSpacing(uint24)(int24)" "$TICK_SPACING" "$POOL_FEE"
expect_call "pool factory" "$POOL" "factory()(address)" "$FACTORY"
expect_call "pool token0" "$POOL" "token0()(address)" "$TOKEN0"
expect_call "pool token1" "$POOL" "token1()(address)" "$TOKEN1"
expect_call "pool fee" "$POOL" "fee()(uint24)" "$POOL_FEE"
expect_call "pool tick spacing" "$POOL" "tickSpacing()(int24)" "$TICK_SPACING"
expect_call "manager factory" "$POSITION_MANAGER" "factory()(address)" "$FACTORY"
expect_call "manager WETH" "$POSITION_MANAGER" "WETH9()(address)" "$WETH"
expect_call "manager pool" "$POSITION_MANAGER" "pool()(address)" "$POOL"
expect_call "manager token0" "$POSITION_MANAGER" "token0()(address)" "$TOKEN0"
expect_call "manager token1" "$POSITION_MANAGER" "token1()(address)" "$TOKEN1"

# Session and migrator policy.
expect_call "session router" "$SESSION" "router()(address)" "$MIGRATOR"
expect_call "session paired token" "$SESSION" "pairedToken()(address)" "$PAIRED_TOKEN"
expect_call "session rehearsal WETH" "$SESSION" "weth()(address)" "$WETH"
expect_call "session token0" "$SESSION" "token0()(address)" "$TOKEN0"
expect_call "session token1" "$SESSION" "token1()(address)" "$TOKEN1"
expect_call "session position manager" "$SESSION" "positionManager()(address)" "$POSITION_MANAGER"
expect_call "session pool fee" "$SESSION" "poolFee()(uint24)" "$POOL_FEE"
if [[ "$(lowercase "$PAIRED_TOKEN")" == "$(lowercase "$TOKEN0")" ]]; then
  PAIRED_TOKEN_IS_TOKEN0="true"
else
  PAIRED_TOKEN_IS_TOKEN0="false"
fi
expect_call "session paired-token ordering" "$SESSION" "pairedTokenIsToken0()(bool)" "$PAIRED_TOKEN_IS_TOKEN0"

expect_call "migrator paused at snapshot" "$MIGRATOR" "paused()(bool)" "true"
expect_call "migrator destination chain" "$MIGRATOR" "destinationChainId()(uint256)" "$CHAIN_ID"
expect_call "migrator governance" "$MIGRATOR" "governance()(address)" "$GOVERNANCE"
expect_call "migrator guardian" "$MIGRATOR" "guardian()(address)" "$EXPECTED_OPERATOR"
expect_call "migrator session" "$MIGRATOR" "liquiditySession()(address)" "$SESSION"
expect_call "migrator rehearsal WETH" "$MIGRATOR" "weth()(address)" "$WETH"
expect_call "migrator paired token" "$MIGRATOR" "pairedToken()(address)" "$PAIRED_TOKEN"
expect_call "migrator token0" "$MIGRATOR" "token0()(address)" "$TOKEN0"
expect_call "migrator token1" "$MIGRATOR" "token1()(address)" "$TOKEN1"
expect_call "migrator paired-token ordering" "$MIGRATOR" "pairedTokenIsToken0()(bool)" "$PAIRED_TOKEN_IS_TOKEN0"
expect_call "migrator position manager" "$MIGRATOR" "positionManager()(address)" "$POSITION_MANAGER"
expect_call "migrator factory" "$MIGRATOR" "sushiFactory()(address)" "$FACTORY"
expect_call "migrator pool" "$MIGRATOR" "sushiPool()(address)" "$POOL"
expect_call "migrator pool fee" "$MIGRATOR" "poolFee()(uint24)" "$POOL_FEE"
expect_call "migrator tick spacing" "$MIGRATOR" "poolTickSpacing()(int24)" "$TICK_SPACING"
expect_call "migrator terms document" "$MIGRATOR" "termsDocumentHash()(bytes32)" "$TERMS_DOCUMENT_HASH"
for binding in \
  "positionManagerCodeHash:positionManager" \
  "factoryCodeHash:factory" \
  "poolCodeHash:pool" \
  "sessionCodeHash:session" \
  "wethCodeHash:weth" \
  "pairedTokenCodeHash:pairedToken"; do
  getter="${binding%%:*}"
  label="${binding##*:}"
  expect_call "migrator $getter" "$MIGRATOR" "$getter()(bytes32)" "$(record_code_hash "$label")"
done

# Independently derive the configuration and migration-terms hashes from live, recorded bindings.
CONFIGURATION_TYPEHASH="$(cast keccak 'RMTConsentLiquidityConfiguration(address migrator,uint256 chainId,address governance,address guardian,address weth,address pairedToken,address positionManager,address factory,address pool,address session,uint24 poolFee,bytes32 positionManagerCodeHash,bytes32 factoryCodeHash,bytes32 poolCodeHash,bytes32 sessionCodeHash,bytes32 wethCodeHash,bytes32 pairedTokenCodeHash)')"
TERMS_DOMAIN_TYPEHASH="$(cast keccak 'RMTConsentLiquidityTerms(bytes32 configurationHash,bytes32 termsDocumentHash)')"
ENCODED_CONFIGURATION="$(cast abi-encode \
  'f(bytes32,address,uint256,address,address,address,address,address,address,address,address,uint24,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32)' \
  "$CONFIGURATION_TYPEHASH" "$MIGRATOR" "$CHAIN_ID" "$GOVERNANCE" "$EXPECTED_OPERATOR" "$WETH" "$PAIRED_TOKEN" \
  "$POSITION_MANAGER" "$FACTORY" "$POOL" "$SESSION" "$POOL_FEE" \
  "$(record_code_hash positionManager)" "$(record_code_hash factory)" "$(record_code_hash pool)" \
  "$(record_code_hash session)" "$(record_code_hash weth)" "$(record_code_hash pairedToken)")"
DERIVED_CONFIGURATION_HASH="$(cast keccak "$ENCODED_CONFIGURATION")"
ENCODED_TERMS="$(cast abi-encode 'f(bytes32,bytes32,bytes32)' "$TERMS_DOMAIN_TYPEHASH" "$DERIVED_CONFIGURATION_HASH" "$TERMS_DOCUMENT_HASH")"
DERIVED_MIGRATION_TERMS_HASH="$(cast keccak "$ENCODED_TERMS")"

expect_equal "recorded configuration hash" "$(json_value configuration.configurationHash)" "$DERIVED_CONFIGURATION_HASH"
expect_equal "recorded migration-terms hash" "$(json_value configuration.migrationTermsHash)" "$DERIVED_MIGRATION_TERMS_HASH"
expect_call "migrator configuration hash" "$MIGRATOR" "configurationHash()(bytes32)" "$DERIVED_CONFIGURATION_HASH"
expect_call "consent-stack configuration hash" "$CONSENT_STACK" "configurationHash()(bytes32)" "$DERIVED_CONFIGURATION_HASH"
expect_call "migrator migration-terms hash" "$MIGRATOR" "migrationTermsHash()(bytes32)" "$DERIVED_MIGRATION_TERMS_HASH"
expect_call "consent-stack migration-terms hash" "$CONSENT_STACK" "migrationTermsHash()(bytes32)" "$DERIVED_MIGRATION_TERMS_HASH"
expect_call "consent-stack terms document" "$CONSENT_STACK" "TERMS_DOCUMENT_HASH()(bytes32)" "$TERMS_DOCUMENT_HASH"

expect_equal "migrator current paused state" "$(latest_scalar_call "$MIGRATOR" "paused()(bool)")" "true"

echo "Consent rehearsal verified at snapshot block $SNAPSHOT_BLOCK and remains paused at RPC head $LATEST_BLOCK."
echo "All ten runtime hashes, both CREATE2 transactions, topology, configuration, and terms bindings match the durable record."
