#!/usr/bin/env python3
"""Prepare or verify the no-key CREATE2 release record for the synthetic registry.

The only transaction this program can submit is to a loopback Anvil fork. It
has no private-key argument and no remote broadcast path.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Sequence

CHAIN_ID = 46_630
RPC_DEFAULT = "https://rpc.testnet.chain.robinhood.com/"
EXPLORER_URL = "https://explorer.testnet.chain.robinhood.com/"
VERIFIER_URL = "https://explorer.testnet.chain.robinhood.com/api/"
CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C"
CREATE2_DEPLOYER_HASH = "0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989"
CONTRACT_ID = "src/RMTCommodityEvidenceRegistryV0.sol:RMTCommodityEvidenceRegistryV0"
CONTRACT_PATH = "packages/contracts/src/RMTCommodityEvidenceRegistryV0.sol"
SALT_LABEL = "RMT_COMMODITY_EVIDENCE_REGISTRY_V0_CREATE2_SALT"
ZERO_ADDRESS = "0x" + "00" * 20
ZERO_HASH = "0x" + "00" * 32
LOCAL_SENDER = "0x000000000000000000000000000000000000dEaD"
ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
HASH32 = re.compile(r"^0x[0-9a-fA-F]{64}$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
HEX = re.compile(r"^0x[0-9a-fA-F]*$")


class Stop(RuntimeError):
    pass


def run(args: Sequence[str], cwd: Path, timeout: int = 300) -> str:
    result = subprocess.run(
        list(args), cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=timeout, check=False,
    )
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()
        raise Stop(f"command failed ({' '.join(args)}): {detail}")
    return result.stdout.strip()


def require_tools() -> None:
    missing = [tool for tool in ("anvil", "cast", "forge", "git", "python3") if not shutil.which(tool)]
    if missing:
        raise Stop("missing required commands: " + ", ".join(missing))


def roots() -> tuple[Path, Path]:
    override = os.environ.get("RMT_REPO_ROOT")
    candidates = ([Path(override).expanduser().resolve()] if override else [])
    here = Path(__file__).resolve()
    cwd = Path.cwd().resolve()
    candidates += [here.parent, *here.parents, cwd, *cwd.parents]
    for candidate in candidates:
        contracts = candidate / "packages" / "contracts"
        if contracts.is_dir():
            return candidate, contracts
    raise Stop("repository root not found; set RMT_REPO_ROOT")


def normalize_hex(value: str, label: str, *, allow_empty: bool = False) -> str:
    value = "".join(value.split()).lower()
    if not HEX.fullmatch(value) or (len(value) - 2) % 2:
        raise Stop(f"{label} is not even-length hex")
    if not allow_empty and value in {"0x", "0x0"}:
        raise Stop(f"{label} is empty")
    return value


def hash32(value: str, label: str) -> str:
    value = value.lower()
    if not HASH32.fullmatch(value):
        raise Stop(f"{label} is not bytes32: {value}")
    return value


def number(value: Any, label: str) -> int:
    try:
        return value if isinstance(value, int) else int(str(value), 0)
    except (TypeError, ValueError) as exc:
        raise Stop(f"{label} is not an integer: {value}") from exc


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def json_object(raw: str, label: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start < 0 or end < start:
            raise Stop(f"{label} did not return JSON")
        value = json.loads(raw[start:end + 1])
    if not isinstance(value, dict):
        raise Stop(f"{label} JSON is not an object")
    return value


def cast(contracts: Path, *args: str, rpc: str | None = None) -> str:
    command = ["cast", *args]
    if rpc:
        command += ["--rpc-url", rpc]
    return run(command, contracts)


def keccak(contracts: Path, value: str, label: str) -> str:
    return hash32(cast(contracts, "keccak", value), label)


def abi_encode(contracts: Path, signature: str, *args: str) -> str:
    return normalize_hex(cast(contracts, "abi-encode", signature, *args), signature)


def calldata(contracts: Path, signature: str, *args: str) -> str:
    return normalize_hex(cast(contracts, "calldata", signature, *args), signature)


def address_from_test_key(contracts: Path, key: str) -> str:
    value = cast(contracts, "wallet", "address", "--private-key", key)
    if not ADDRESS.fullmatch(value):
        raise Stop(f"invalid synthetic test address: {value}")
    return value


def git_state(repo: Path) -> tuple[str, str]:
    commit = run(["git", "rev-parse", "HEAD"], repo)
    branch = run(["git", "branch", "--show-current"], repo)
    if not COMMIT.fullmatch(commit) or not branch:
        raise Stop("release preparation requires a named branch and full commit SHA")
    tracked = [
        CONTRACT_PATH,
        "packages/contracts/foundry.toml",
        "packages/contracts/remappings.txt",
        "packages/contracts/script/BuildSyntheticCommodityEvidenceV0.s.sol",
        "packages/contracts/script/RehearseSyntheticCommodityEvidenceRegistryV0.s.sol",
        "packages/contracts/test/fixtures/commodity-evidence/synthetic-helium-public-manifest-v0.json",
        "packages/contracts/test/fixtures/commodity-evidence/synthetic-helium-full-manifest-v0.json",
    ]
    for cached in (False, True):
        command = ["git", "diff"] + (["--cached"] if cached else []) + ["--quiet", "--", *tracked]
        if subprocess.run(command, cwd=repo, check=False).returncode:
            raise Stop("release source, compiler configuration, or fixtures have uncommitted changes")
    return commit, branch


def snapshot(contracts: Path, rpc: str) -> tuple[int, str, int]:
    chain = number(cast(contracts, "chain-id", rpc=rpc), "chain ID")
    if chain != CHAIN_ID:
        raise Stop(f"expected Robinhood testnet chain {CHAIN_ID}, received {chain}")
    block = json_object(cast(contracts, "block", "latest", "--json", rpc=rpc), "latest block")
    block_number = number(block.get("number"), "block number")
    block_hash = hash32(str(block.get("hash", "")), "block hash")
    timestamp = number(block.get("timestamp"), "block timestamp")
    return block_number, block_hash, timestamp


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def simulate_create2(
    contracts: Path, rpc: str, block_number: int, predicted: str, deployment_data: str,
) -> tuple[str, str, int]:
    port = free_port()
    local_rpc = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory(prefix="rmt-evidence-release-") as temp:
        log_path = Path(temp) / "anvil.log"
        with log_path.open("w", encoding="utf-8") as log:
            process = subprocess.Popen(
                ["anvil", "--silent", "--host", "127.0.0.1", "--port", str(port),
                 "--chain-id", str(CHAIN_ID), "--fork-url", rpc,
                 "--fork-block-number", str(block_number)],
                cwd=contracts, text=True, stdout=log, stderr=subprocess.STDOUT,
            )
        try:
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise Stop("Anvil fork stopped: " + log_path.read_text(errors="replace"))
                try:
                    if number(cast(contracts, "chain-id", rpc=local_rpc), "local chain ID") == CHAIN_ID:
                        break
                except Stop:
                    time.sleep(0.25)
            else:
                raise Stop("Anvil fork did not become ready")

            run(["cast", "rpc", "anvil_impersonateAccount", LOCAL_SENDER,
                 "--rpc-url", local_rpc], contracts)
            run(["cast", "rpc", "anvil_setBalance", LOCAL_SENDER,
                 "0x3635C2ADB5DEA50000", "--rpc-url", local_rpc], contracts)
            sent = run(
                ["cast", "send", CREATE2_DEPLOYER, "--data", deployment_data,
                 "--from", LOCAL_SENDER, "--unlocked", "--rpc-url", local_rpc, "--json"],
                contracts,
            )
            receipt = json_object(sent, "local CREATE2 send")
            if "status" not in receipt:
                tx_hash = receipt.get("transactionHash") or receipt.get("hash")
                if not isinstance(tx_hash, str) or not HASH32.fullmatch(tx_hash):
                    raise Stop("local CREATE2 send did not return a receipt or transaction hash")
                receipt = json_object(cast(contracts, "receipt", tx_hash, "--json", rpc=local_rpc), "receipt")
            if number(receipt.get("status"), "receipt status") != 1:
                raise Stop("local CREATE2 rehearsal reverted")

            runtime = normalize_hex(cast(contracts, "code", predicted, rpc=local_rpc), "runtime code")
            runtime_hash = keccak(contracts, runtime, "runtime code hash")
            admin = cast(contracts, "call", predicted, "administrator()(address)", rpc=local_rpc).split()[0]
            if not ADDRESS.fullmatch(admin):
                raise Stop("simulated administrator read failed")
            target = number(cast(contracts, "call", predicted, "TARGET_CHAIN_ID()(uint256)", rpc=local_rpc).split()[0], "target chain")
            synthetic = cast(contracts, "call", predicted, "SYNTHETIC_ONLY()(bool)", rpc=local_rpc).split()[0].lower()
            domain = hash32(cast(contracts, "call", predicted, "domainSeparator()(bytes32)", rpc=local_rpc).split()[0], "domain separator")
            if target != CHAIN_ID or synthetic not in {"true", "1", "0x1"}:
                raise Stop("simulated registry boundary check failed")
            return runtime_hash, domain, number(receipt.get("gasUsed", 0), "gas used")
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


def release_material(admin: str, rpc: str) -> tuple[dict[str, Any], str]:
    repo, contracts = roots()
    require_tools()
    if not ADDRESS.fullmatch(admin) or admin.lower() == ZERO_ADDRESS:
        raise Stop("administrator must be a nonzero EVM address")
    commit, branch = git_state(repo)
    block_number, block_hash, block_timestamp = snapshot(contracts, rpc)

    deployer_code = normalize_hex(cast(contracts, "code", CREATE2_DEPLOYER, "--block", str(block_number), rpc=rpc), "CREATE2 deployer code")
    if keccak(contracts, deployer_code, "CREATE2 deployer hash") != CREATE2_DEPLOYER_HASH:
        raise Stop("canonical CREATE2 deployer runtime hash mismatch")

    run(["forge", "build"], contracts, timeout=600)
    inspect = run(["forge", "inspect", CONTRACT_ID, "bytecode"], contracts)
    matches = re.findall(r"0x[0-9a-fA-F]+", inspect)
    if not matches:
        raise Stop("forge inspect did not return creation bytecode")
    creation = normalize_hex(matches[-1], "creation bytecode")
    constructor_args = abi_encode(contracts, "f(address)", admin)
    init_code = creation + constructor_args[2:]
    creation_hash = keccak(contracts, creation, "creation code hash")
    init_hash = keccak(contracts, init_code, "init code hash")
    salt_domain = keccak(contracts, SALT_LABEL, "salt domain")
    salt_input = abi_encode(contracts, "f(bytes32,address,bytes20)", salt_domain, admin, "0x" + commit)
    salt = keccak(contracts, salt_input, "CREATE2 salt")
    predicted = cast(contracts, "create2", "--deployer", CREATE2_DEPLOYER,
                     "--salt", salt, "--init-code-hash", init_hash)
    if not ADDRESS.fullmatch(predicted):
        raise Stop("invalid predicted CREATE2 address")
    if cast(contracts, "code", predicted, "--block", str(block_number), rpc=rpc).lower() not in {"0x", "0x0"}:
        raise Stop(f"predicted address already contains code: {predicted}")
    deployment_data = normalize_hex(salt + init_code[2:], "deployment calldata")
    deployment_hash = keccak(contracts, deployment_data, "deployment calldata hash")
    runtime_hash, domain, gas_used = simulate_create2(contracts, rpc, block_number, predicted, deployment_data)

    issuer = address_from_test_key(contracts, "0xA11CE")
    custodian = address_from_test_key(contracts, "0xB0B")
    attestor = address_from_test_key(contracts, "0xC4DE")
    ids = {
        "schema": keccak(contracts, "rmt.physical-commodity-evidence.v0.schema", "schema hash"),
        "instrument": keccak(contracts, "RMT-HE-DEMO-V0", "instrument ID"),
        "series": keccak(contracts, "RMT-HE-COLORADO-SYNTHETIC-SERIES-V0", "series ID"),
        "governing": keccak(contracts, "RMT_SYNTHETIC_NO_RIGHTS_GOVERNING_TEXT_V0", "governing hash"),
        "issuer": keccak(contracts, "RMT-SYNTHETIC-ISSUER-0001", "issuer party ID"),
        "custodian": keccak(contracts, "RMT-SYNTHETIC-CUSTODIAN-0001", "custodian party ID"),
        "attestor": keccak(contracts, "RMT-SYNTHETIC-ATTESTOR-0001", "attestor party ID"),
    }
    valid_from = max(1, block_timestamp - 60)
    valid_until = block_timestamp + 365 * 24 * 60 * 60
    calls = [
        ("register-synthetic-issuer", calldata(contracts, "registerParty(bytes32,address,uint256,uint64,uint64)", ids["issuer"], issuer, "1", str(valid_from), str(valid_until))),
        ("register-synthetic-custodian", calldata(contracts, "registerParty(bytes32,address,uint256,uint64,uint64)", ids["custodian"], custodian, "2", str(valid_from), str(valid_until))),
        ("register-synthetic-attestor", calldata(contracts, "registerParty(bytes32,address,uint256,uint64,uint64)", ids["attestor"], attestor, "4", str(valid_from), str(valid_until))),
        ("configure-synthetic-helium-instrument", calldata(contracts, "configureInstrument(bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,uint64)", ids["instrument"], ids["schema"], ids["series"], ids["governing"], ids["issuer"], ids["custodian"], ids["attestor"], str(7 * 24 * 60 * 60))),
    ]
    plan = [{"sequence": i, "label": label, "requiredSigner": admin, "to": predicted,
             "valueWei": "0", "calldata": data, "calldataHash": keccak(contracts, data, label + " hash"),
             "transactionHash": ZERO_HASH, "broadcastAuthorized": False}
            for i, (label, data) in enumerate(calls, 2)]

    public_fixture = contracts / "test/fixtures/commodity-evidence/synthetic-helium-public-manifest-v0.json"
    full_fixture = contracts / "test/fixtures/commodity-evidence/synthetic-helium-full-manifest-v0.json"
    source = repo / CONTRACT_PATH
    foundry = contracts / "foundry.toml"
    remappings = contracts / "remappings.txt"
    now = int(time.time())
    record = {
        "schemaVersion": 1,
        "schema": "rmt.synthetic-commodity-evidence-registry-release.v0",
        "status": "PREPARED_UNDEPLOYED",
        "generatedAt": dt.datetime.fromtimestamp(now, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "preparedRecordExpiresAt": dt.datetime.fromtimestamp(block_timestamp + 21600, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "authorization": {name: False for name in (
            "sourceReviewComplete", "testnetDeploymentAuthorized", "broadcastAuthorized",
            "configurationBroadcastAuthorized", "sourcePublicationAuthorized", "mergeAuthorized",
            "realInventoryAuthorized", "tokenIssuanceAuthorized")},
        "source": {"repository": "https://github.com/LandoCrissian/robinhood-meme-terminal",
                   "pullRequest": 372, "branch": branch, "commit": commit, "cleanReleaseInputs": True,
                   "contractPath": CONTRACT_PATH, "contractSha256": sha256(source),
                   "foundryTomlSha256": sha256(foundry), "remappingsSha256": sha256(remappings),
                   "publicManifestSha256": sha256(public_fixture), "fullManifestSha256": sha256(full_fixture)},
        "network": {"name": "Robinhood Chain Testnet", "chainId": CHAIN_ID,
                    "rpcUrlRecorded": False, "explorerUrl": EXPLORER_URL,
                    "snapshotBlock": block_number, "snapshotBlockHash": block_hash,
                    "snapshotTimestamp": block_timestamp},
        "compiler": {"solcVersion": "0.8.26", "compilerVersion": "v0.8.26+commit.8a97fa7a",
                     "optimizer": True, "optimizerRuns": 200, "viaIR": True, "evmVersion": "cancun"},
        "create2": {"deployer": CREATE2_DEPLOYER, "deployerRuntimeCodeHash": CREATE2_DEPLOYER_HASH,
                    "saltDomainLabel": SALT_LABEL, "saltDomainHash": salt_domain, "salt": salt,
                    "creationCodeHash": creation_hash, "constructorArgs": constructor_args,
                    "initCodeHash": init_hash, "predictedAddress": predicted,
                    "predictedAddressEmptyAtSnapshot": True, "deploymentCalldataHash": deployment_hash,
                    "simulatedDeploymentGasUsed": gas_used},
        "contract": {"name": "RMTCommodityEvidenceRegistryV0", "sourcePath": CONTRACT_PATH,
                     "address": ZERO_ADDRESS, "predictedAddress": predicted,
                     "deploymentTransactionHash": ZERO_HASH, "deploymentBlock": None,
                     "expectedRuntimeCodeHash": runtime_hash, "liveRuntimeCodeHash": ZERO_HASH,
                     "expectedDomainSeparator": domain, "liveDomainSeparator": ZERO_HASH,
                     "explorerVerification": "NOT_STARTED"},
        "administrator": {"address": admin, "authorizationEvidenceHash": ZERO_HASH,
                          "ownerApproved": False, "containsPrivateKey": False},
        "syntheticParties": {"issuer": {"partyId": ids["issuer"], "signingAddress": issuer, "roleBitmap": 1},
                             "custodian": {"partyId": ids["custodian"], "signingAddress": custodian, "roleBitmap": 2},
                             "attestor": {"partyId": ids["attestor"], "signingAddress": attestor, "roleBitmap": 4},
                             "publicTestKeysOnly": True, "validFrom": valid_from, "validUntil": valid_until},
        "instrument": {"instrumentId": ids["instrument"], "schemaHash": ids["schema"],
                       "seriesId": ids["series"], "governingInstrumentHash": ids["governing"],
                       "maximumEvidenceValiditySeconds": 604800, "configured": False},
        "transactionPlan": {"deployment": {"sequence": 1, "requiredSigner": "unselected dedicated testnet deployer",
                            "to": CREATE2_DEPLOYER, "valueWei": "0", "calldataHash": deployment_hash,
                            "predictedContractAddress": predicted, "transactionHash": ZERO_HASH,
                            "broadcastAuthorized": False}, "configuration": plan},
        "evidence": {"published": False,
                     "publicManifestHash": keccak(contracts, "0x" + public_fixture.read_bytes().hex(), "public manifest hash"),
                     "fullManifestHash": keccak(contracts, "0x" + full_fixture.read_bytes().hex(), "full manifest hash"),
                     "publicationTransactionHash": ZERO_HASH, "publicationAuthorized": False},
        "sourceVerification": {"verifier": "blockscout", "verifierUrl": VERIFIER_URL,
                               "status": "NOT_ATTEMPTED", "publishAuthorized": False},
        "boundaries": {"syntheticOnly": True, "createsToken": False, "createsCommodityRight": False,
                       "createsRedemptionRight": False, "createsTransferRight": False,
                       "createsRmtTokenRight": False, "productionEnvironmentChanged": False,
                       "publicUiChanged": False, "containsPrivateKey": False,
                       "remoteTransactionSubmitted": False},
    }
    return record, deployment_data


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def prepare(admin: str, rpc: str, output: Path, overwrite: bool) -> None:
    _, contracts = roots()
    template = contracts / "deployments/rmt-commodity-evidence-registry-v0.template.json"
    if output.resolve() == template.resolve():
        raise Stop("refusing to overwrite the UNDEPLOYED template")
    if output.exists() and not overwrite:
        raise Stop(f"output exists; pass --overwrite: {output}")
    record, deployment_data = release_material(admin, rpc)
    calldata_path = output.with_suffix(".deployment-calldata.txt")
    record["transactionPlan"]["deployment"]["calldataFile"] = calldata_path.name
    write_atomic(output, json.dumps(record, indent=2) + "\n")
    write_atomic(calldata_path, deployment_data + "\n")
    checksum = output.with_suffix(".sha256")
    write_atomic(checksum, sha256(output) + "  " + output.name + "\n")
    print("Prepared deterministic synthetic registry release; no remote transaction submitted.")
    print(f"Record: {output}")
    print(f"Deployment calldata: {calldata_path}")
    print(f"Predicted address: {record['contract']['predictedAddress']}")
    print(f"Expected runtime hash: {record['contract']['expectedRuntimeCodeHash']}")
    print("Every authorization flag remains false.")


def verify(record_path: Path, calldata_path: Path, rpc: str) -> None:
    record = json.loads(record_path.read_text(encoding="utf-8"))
    if record.get("schemaVersion") != 1 or record.get("status") != "PREPARED_UNDEPLOYED":
        raise Stop("not a V0 PREPARED_UNDEPLOYED release record")
    enabled = [key for key, value in record.get("authorization", {}).items() if value is not False]
    if enabled:
        raise Stop("prepared record has enabled authorization flags: " + ", ".join(enabled))
    if record.get("boundaries", {}).get("remoteTransactionSubmitted") is not False:
        raise Stop("record claims a remote transaction was submitted")
    refreshed, deployment_data = release_material(record["administrator"]["address"], rpc)
    stored_data = normalize_hex(calldata_path.read_text(encoding="utf-8"), "stored deployment calldata")
    if stored_data != deployment_data:
        raise Stop("deployment calldata differs from regenerated source-bound calldata")
    paths = (
        "source.commit", "source.contractSha256", "source.foundryTomlSha256", "source.remappingsSha256",
        "compiler", "create2.deployer", "create2.deployerRuntimeCodeHash", "create2.salt",
        "create2.creationCodeHash", "create2.constructorArgs", "create2.initCodeHash",
        "create2.predictedAddress", "create2.deploymentCalldataHash",
        "contract.predictedAddress", "contract.expectedRuntimeCodeHash", "contract.expectedDomainSeparator",
        "administrator.address", "syntheticParties.issuer", "syntheticParties.custodian",
        "syntheticParties.attestor", "instrument.instrumentId", "instrument.schemaHash",
        "instrument.seriesId", "instrument.governingInstrumentHash", "evidence.publicManifestHash",
        "evidence.fullManifestHash", "boundaries",
    )
    def get(value: dict[str, Any], dotted: str) -> Any:
        current: Any = value
        for part in dotted.split("."):
            current = current[part]
        return current
    for dotted in paths:
        if get(record, dotted) != get(refreshed, dotted):
            raise Stop(f"prepared record mismatch at {dotted}")
    expires = dt.datetime.strptime(record["preparedRecordExpiresAt"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    if dt.datetime.now(dt.timezone.utc) > expires:
        raise Stop("prepared release record expired; regenerate it")
    print("Prepared synthetic registry release verified against source and a fresh local fork.")
    print(f"Source commit: {record['source']['commit']}")
    print(f"Predicted address: {record['contract']['predictedAddress']}")
    print("No remote transaction was submitted.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rpc-url", default=os.environ.get("ROBINHOOD_TESTNET_RPC_URL", RPC_DEFAULT))
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--administrator", required=True)
    p.add_argument("--output", type=Path)
    p.add_argument("--overwrite", action="store_true")
    v = sub.add_parser("verify")
    v.add_argument("--record", type=Path, required=True)
    v.add_argument("--calldata", type=Path, required=True)
    args = parser.parse_args()
    try:
        _, contracts = roots()
        if args.command == "prepare":
            output = args.output or contracts / "deployments/rmt-commodity-evidence-registry-v0.prepared.json"
            prepare(args.administrator, args.rpc_url, output, args.overwrite)
        else:
            verify(args.record, args.calldata, args.rpc_url)
        return 0
    except (Stop, OSError, KeyError, json.JSONDecodeError) as exc:
        print(f"Commodity evidence registry release stopped: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
