#!/usr/bin/env bash
set -euo pipefail

# Read-only verifier for a separately authorized Robinhood Chain Testnet deployment.
# This script accepts no key, mnemonic, signature, or transaction-submission option.

CHAIN_ID="46630"
RPC_URL="${ROBINHOOD_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com/}"
CREATE2_DEPLOYER="0x4e59b44847b379578588920cA78FbF26c0B4956C"
CREATE2_DEPLOYER_RUNTIME_HASH="0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$CONTRACTS_DIR/../.." && pwd)"

fail() {
  echo "Commodity evidence registry deployment verification stopped: $*" >&2
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

scalar_call() {
  local address="$1"
  local signature="$2"
  local output
  if ! output="$(cast call "$address" "$signature" --rpc-url "$RPC_URL" 2>&1)"; then
    fail "call $signature on $address failed: $output"
  fi
  printf '%s\n' "${output%%[[:space:]]*}"
}

verify_transaction() {
  local label="$1"
  local tx_hash="$2"
  local expected_from="$3"
  local expected_to="$4"
  local expected_input="$5"
  local minimum_block="$6"
  local tx_file="$TMP_DIR/${label}.tx.json"
  local receipt_file="$TMP_DIR/${label}.receipt.json"

  cast tx "$tx_hash" --json --rpc-url "$RPC_URL" >"$tx_file" \
    || fail "could not read $label transaction $tx_hash."
  cast receipt "$tx_hash" --json --rpc-url "$RPC_URL" >"$receipt_file" \
    || fail "could not read $label receipt $tx_hash."

  python3 - "$tx_file" "$receipt_file" "$tx_hash" "$expected_from" "$expected_to" \
    "$expected_input" "$CHAIN_ID" "$minimum_block" <<'PY'
import json
import sys

(tx_path, receipt_path, expected_hash, expected_from, expected_to,
 expected_input, expected_chain, minimum_block) = sys.argv[1:]
with open(tx_path, encoding="utf-8") as source:
    tx = json.load(source)
with open(receipt_path, encoding="utf-8") as source:
    receipt = json.load(source)

def stop(message):
    raise SystemExit(message)

def integer(value):
    if isinstance(value, int):
        return value
    return int(str(value), 0)

def same(left, right):
    return str(left).lower() == str(right).lower()

if not same(tx.get("hash"), expected_hash) or not same(receipt.get("transactionHash"), expected_hash):
    stop("transaction hash mismatch")
if not same(tx.get("from"), expected_from) or not same(receipt.get("from"), expected_from):
    stop("transaction sender mismatch")
if not same(tx.get("to"), expected_to) or not same(receipt.get("to"), expected_to):
    stop("transaction destination mismatch")
if integer(tx.get("chainId", 0)) != int(expected_chain):
    stop("transaction chain ID mismatch")
if integer(tx.get("value", 0)) != 0:
    stop("transaction value is nonzero")
if not same(tx.get("input"), expected_input):
    stop("transaction calldata mismatch")
if integer(receipt.get("status", 0)) != 1:
    stop("transaction receipt failed")
block = integer(receipt.get("blockNumber", 0))
if block < int(minimum_block):
    stop("transaction precedes required block")
if integer(tx.get("blockNumber", 0)) != block:
    stop("transaction and receipt blocks differ")
index = integer(receipt.get("transactionIndex", 0))
print(block, index, sep="\t")
PY
}

usage() {
  echo "usage: $0 <completed-deployment-record.json>" >&2
  exit 1
}

[[ $# -eq 1 ]] || usage
RECORD="$1"
[[ -f "$RECORD" ]] || fail "deployment record does not exist: $RECORD"
RECORD="$(cd "$(dirname "$RECORD")" && pwd)/$(basename "$RECORD")"

require_tool cast
require_tool forge
require_tool git
require_tool python3

python3 - "$RECORD" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    record = json.load(source)

def stop(message):
    raise SystemExit(f"record validation failed: {message}")

def at(path):
    value = record
    for part in path.split("."):
        value = value[int(part)] if isinstance(value, list) else value[part]
    return value

address = re.compile(r"^0x[0-9a-fA-F]{40}$")
hash32 = re.compile(r"^0x[0-9a-fA-F]{64}$")
commit = re.compile(r"^[0-9a-f]{40}$")
if record.get("schemaVersion") != 1:
    stop("schemaVersion must be 1")
if record.get("schema") != "rmt.synthetic-commodity-evidence-registry-release.v0":
    stop("unexpected schema")
if record.get("status") not in {"DEPLOYED_CONFIGURED", "VERIFIED_CONFIGURED"}:
    stop("status must be DEPLOYED_CONFIGURED or VERIFIED_CONFIGURED")
if at("network.chainId") != 46630:
    stop("wrong chain")
if at("source.pullRequest") != 372 or not commit.fullmatch(str(at("source.commit"))):
    stop("invalid source identity")
for path in (
    "create2.deployer", "create2.predictedAddress", "contract.address",
    "contract.predictedAddress", "administrator.address",
    "transactionPlan.deployment.requiredSigner",
):
    if not address.fullmatch(str(at(path))):
        stop(f"invalid address at {path}")
for path in (
    "create2.deployerRuntimeCodeHash", "create2.salt", "create2.initCodeHash",
    "create2.deploymentCalldataHash", "contract.deploymentTransactionHash",
    "contract.expectedRuntimeCodeHash", "contract.liveRuntimeCodeHash",
    "contract.expectedDomainSeparator", "contract.liveDomainSeparator",
):
    if not hash32.fullmatch(str(at(path))):
        stop(f"invalid hash at {path}")
if at("create2.predictedAddress").lower() != at("contract.address").lower():
    stop("deployed address differs from CREATE2 prediction")
if at("contract.predictedAddress").lower() != at("contract.address").lower():
    stop("contract prediction differs from deployed address")
if at("create2.deployer").lower() != "0x4e59b44847b379578588920ca78fbf26c0b4956c":
    stop("unexpected CREATE2 deployer")
if at("create2.deployerRuntimeCodeHash").lower() != "0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989":
    stop("unexpected CREATE2 deployer hash")
if at("instrument.configured") is not True:
    stop("instrument is not recorded configured")
configuration = at("transactionPlan.configuration")
if not isinstance(configuration, list) or len(configuration) != 4:
    stop("configuration plan must contain four transactions")
for index, item in enumerate(configuration, start=2):
    if item.get("sequence") != index or item.get("broadcastAuthorized") is not True:
        stop("configuration sequence or historical broadcast authorization is invalid")
    if not hash32.fullmatch(str(item.get("transactionHash", ""))):
        stop("configuration transaction hash is invalid")
    if not isinstance(item.get("calldata"), str) or not item["calldata"].startswith("0x"):
        stop("configuration calldata is missing")
for key in ("realInventoryAuthorized", "tokenIssuanceAuthorized", "mergeAuthorized"):
    if at(f"authorization.{key}") is not False:
        stop(f"{key} must remain false")
boundaries = at("boundaries")
expected = {
    "syntheticOnly": True,
    "createsToken": False,
    "createsCommodityRight": False,
    "createsRedemptionRight": False,
    "createsTransferRight": False,
    "createsRmtTokenRight": False,
    "productionEnvironmentChanged": False,
    "publicUiChanged": False,
    "containsPrivateKey": False,
    "remoteTransactionSubmitted": True,
}
for key, value in expected.items():
    if boundaries.get(key) is not value:
        stop(f"boundary mismatch for {key}")
PY

SOURCE_COMMIT="$(json_value source.commit)"
CURRENT_HEAD="$(git -C "$REPO_ROOT" rev-parse HEAD)"
expect_equal "checked-out source commit" "$CURRENT_HEAD" "$SOURCE_COMMIT"
git -C "$REPO_ROOT" diff --quiet -- \
  packages/contracts/src/RMTCommodityEvidenceRegistryV0.sol \
  packages/contracts/foundry.toml \
  packages/contracts/remappings.txt \
  packages/contracts/script/VerifySyntheticCommodityEvidenceRegistryV0.s.sol \
  || fail "tracked source or compiler configuration has uncommitted changes."
git -C "$REPO_ROOT" diff --cached --quiet -- \
  packages/contracts/src/RMTCommodityEvidenceRegistryV0.sol \
  packages/contracts/foundry.toml \
  packages/contracts/remappings.txt \
  packages/contracts/script/VerifySyntheticCommodityEvidenceRegistryV0.s.sol \
  || fail "tracked source or compiler configuration has staged changes."

ACTUAL_CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
[[ "$ACTUAL_CHAIN_ID" == "$CHAIN_ID" ]] \
  || fail "expected chain $CHAIN_ID, received $ACTUAL_CHAIN_ID."

LIVE_DEPLOYER_CODE="$(cast code "$CREATE2_DEPLOYER" --rpc-url "$RPC_URL")"
[[ "$LIVE_DEPLOYER_CODE" != "0x" ]] || fail "canonical CREATE2 deployer has no code."
expect_equal "CREATE2 deployer runtime hash" "$(cast keccak "$LIVE_DEPLOYER_CODE")" \
  "$CREATE2_DEPLOYER_RUNTIME_HASH"

REGISTRY="$(json_value contract.address)"
ADMINISTRATOR="$(json_value administrator.address)"
EXPECTED_RUNTIME_HASH="$(json_value contract.expectedRuntimeCodeHash)"
EXPECTED_DOMAIN="$(json_value contract.expectedDomainSeparator)"
SALT="$(json_value create2.salt)"
INIT_CODE_HASH="$(json_value create2.initCodeHash)"
DEPLOYMENT_TX="$(json_value contract.deploymentTransactionHash)"
DEPLOYMENT_SENDER="$(json_value transactionPlan.deployment.requiredSigner)"
DEPLOYMENT_CALLDATA_FILE="$(json_value transactionPlan.deployment.calldataFile)"
DEPLOYMENT_CALLDATA_PATH="$(dirname "$RECORD")/$DEPLOYMENT_CALLDATA_FILE"
[[ -f "$DEPLOYMENT_CALLDATA_PATH" ]] \
  || fail "deployment calldata file does not exist: $DEPLOYMENT_CALLDATA_PATH"
DEPLOYMENT_CALLDATA="$(tr -d '[:space:]' <"$DEPLOYMENT_CALLDATA_PATH")"
expect_equal "deployment calldata hash" "$(cast keccak "$DEPLOYMENT_CALLDATA")" \
  "$(json_value create2.deploymentCalldataHash)"
expect_equal "predicted CREATE2 address" \
  "$(cast create2 --deployer "$CREATE2_DEPLOYER" --salt "$SALT" --init-code-hash "$INIT_CODE_HASH")" \
  "$REGISTRY"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
read -r DEPLOYMENT_BLOCK DEPLOYMENT_INDEX < <(
  verify_transaction "deployment" "$DEPLOYMENT_TX" "$DEPLOYMENT_SENDER" \
    "$CREATE2_DEPLOYER" "$DEPLOYMENT_CALLDATA" "1"
)
[[ "$DEPLOYMENT_BLOCK" == "$(json_value contract.deploymentBlock)" ]] \
  || fail "recorded deployment block differs from receipt."

if (( DEPLOYMENT_BLOCK > 0 )); then
  PRIOR_CODE="$(cast code "$REGISTRY" --block "$((DEPLOYMENT_BLOCK - 1))" --rpc-url "$RPC_URL")"
  [[ "$PRIOR_CODE" == "0x" || "$PRIOR_CODE" == "0x0" ]] \
    || fail "registry address contained code before deployment."
fi
DEPLOYED_CODE="$(cast code "$REGISTRY" --block "$DEPLOYMENT_BLOCK" --rpc-url "$RPC_URL")"
[[ "$DEPLOYED_CODE" != "0x" && "$DEPLOYED_CODE" != "0x0" ]] \
  || fail "registry has no code at its deployment block."
LATEST_CODE="$(cast code "$REGISTRY" --rpc-url "$RPC_URL")"
LIVE_RUNTIME_HASH="$(cast keccak "$LATEST_CODE")"
expect_equal "live runtime hash" "$LIVE_RUNTIME_HASH" "$EXPECTED_RUNTIME_HASH"
expect_equal "recorded live runtime hash" "$(json_value contract.liveRuntimeCodeHash)" "$EXPECTED_RUNTIME_HASH"
expect_equal "live administrator" "$(scalar_call "$REGISTRY" 'administrator()(address)')" "$ADMINISTRATOR"
expect_equal "live target chain" "$(scalar_call "$REGISTRY" 'TARGET_CHAIN_ID()(uint256)')" "$CHAIN_ID"
expect_equal "live synthetic-only flag" "$(scalar_call "$REGISTRY" 'SYNTHETIC_ONLY()(bool)')" "true"
expect_equal "live domain separator" "$(scalar_call "$REGISTRY" 'domainSeparator()(bytes32)')" "$EXPECTED_DOMAIN"
expect_equal "recorded live domain separator" "$(json_value contract.liveDomainSeparator)" "$EXPECTED_DOMAIN"
[[ "$(cast balance "$REGISTRY" --rpc-url "$RPC_URL")" == "0" ]] \
  || fail "registry holds native currency."

PREVIOUS_BLOCK="$DEPLOYMENT_BLOCK"
PREVIOUS_INDEX="$DEPLOYMENT_INDEX"
while IFS=$'\t' read -r SEQUENCE LABEL SIGNER TO VALUE CALLDATA CALLDATA_HASH TX_HASH; do
  [[ "$VALUE" == "0" ]] || fail "$LABEL has nonzero recorded value."
  expect_equal "$LABEL signer" "$SIGNER" "$ADMINISTRATOR"
  expect_equal "$LABEL destination" "$TO" "$REGISTRY"
  expect_equal "$LABEL calldata hash" "$(cast keccak "$CALLDATA")" "$CALLDATA_HASH"
  read -r TX_BLOCK TX_INDEX < <(
    verify_transaction "$LABEL" "$TX_HASH" "$SIGNER" "$TO" "$CALLDATA" "$DEPLOYMENT_BLOCK"
  )
  if (( TX_BLOCK < PREVIOUS_BLOCK || (TX_BLOCK == PREVIOUS_BLOCK && TX_INDEX <= PREVIOUS_INDEX) )); then
    fail "$LABEL transaction order is not strictly increasing."
  fi
  PREVIOUS_BLOCK="$TX_BLOCK"
  PREVIOUS_INDEX="$TX_INDEX"
done < <(
  python3 - "$RECORD" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as source:
    record = json.load(source)
for item in record["transactionPlan"]["configuration"]:
    print(
        item["sequence"], item["label"], item["requiredSigner"], item["to"],
        item["valueWei"], item["calldata"], item["calldataHash"], item["transactionHash"],
        sep="\t",
    )
PY
)

VALID_FROM="$(json_value syntheticParties.validFrom)"
VALID_UNTIL="$(json_value syntheticParties.validUntil)"
forge script \
  script/VerifySyntheticCommodityEvidenceRegistryV0.s.sol:VerifySyntheticCommodityEvidenceRegistryV0 \
  --rpc-url "$RPC_URL" \
  --sig 'run(address,address,bytes32,uint64,uint64)' \
  "$REGISTRY" "$ADMINISTRATOR" "$EXPECTED_RUNTIME_HASH" "$VALID_FROM" "$VALID_UNTIL" \
  -vvv

echo "Synthetic commodity evidence registry deployment verified read-only."
echo "Registry: $REGISTRY"
echo "Deployment block: $DEPLOYMENT_BLOCK"
echo "Runtime hash: $EXPECTED_RUNTIME_HASH"
echo "Domain separator: $EXPECTED_DOMAIN"
echo "No transaction was submitted by this verifier."
