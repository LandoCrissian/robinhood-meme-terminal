import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { creationFee } from "./fixed-supply-profile.mjs";
import { eip712, materializeArtifact } from "./verify-fixed-supply-bundle.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { encodeDeployData, getContractAddress, getCreate2Address, isAddress, isAddressEqual, keccak256, toHex, zeroAddress } = require("viem");

function selectGuard(compilation, bootstrap, poolManager, engine) {
  const { abi, bytecode } = compilation.artifacts.RMTV4CurveInitializationGuardV1;
  const initcode = encodeDeployData({ abi, bytecode, args: [poolManager, engine] });
  const bytecodeHash = keccak256(initcode);
  for (let i = 0n; i < 250_000n; i++) {
    const salt = toHex(i, { size: 32 });
    const address = getCreate2Address({ from: bootstrap, salt, bytecodeHash });
    if ((BigInt(address) & 0x3fffn) === 0x2000n) return { address, salt };
  }
  throw new Error("No admissible initialization guard salt in the bounded search");
}

// Recompute from one nonce/signer/beneficiary scenario. Public callers receive hashes and sizes only.
export function deriveDelegatedConstructors(compilation, { sender, createDestinations, signers, safeAddresses },
  { includePrivateInitcode = false } = {}) {
  assert.equal(compilation.manifest.chainId, 4663);
  assert.equal(signers.length, 3);
  assert.equal(safeAddresses.length, 2);
  assert.ok([...signers, ...safeAddresses, sender].every((address) => isAddress(address) && !isAddressEqual(address, zeroAddress)));
  assert.equal(new Set([...signers, ...safeAddresses, sender].map((address) => address.toLowerCase())).size, 6);
  const [directory, registry, v2, v3, bootstrap] = createDestinations;
  assert.deepEqual(createDestinations.map(({ id }) => id), ["directory", "registry", "successor-v2", "successor-v3", "bootstrap"]);
  assert.ok(createDestinations.every(({ address, nonce }, index) =>
    BigInt(nonce) === BigInt(directory.nonce) + BigInt(index)
      && isAddressEqual(address, getContractAddress({ from: sender, nonce: BigInt(nonce) }))));
  const [operations, reserve] = safeAddresses;
  const { poolManager, positionManager, permit2 } = compilation.manifest.externalRuntimePins;
  const dependencies = {
    poolManager: poolManager.address, positionManager: positionManager.address, permit2: permit2.address,
    poolManagerHash: poolManager.runtimeHash, positionManagerHash: positionManager.runtimeHash, permit2Hash: permit2.runtimeHash,
  };
  const engine = getContractAddress({ from: bootstrap.address, nonce: 2n });
  const factory = getContractAddress({ from: bootstrap.address, nonce: 3n });
  const guard = selectGuard(compilation, bootstrap.address, dependencies.poolManager, engine);
  const materialize = (contract, address, args, immutables) => {
    const { constructorData, ...review } = materializeArtifact(compilation, contract, address, args, immutables);
    if (!includePrivateInitcode) return review;
    const initcode = compilation.artifacts[contract].bytecode + constructorData.slice(2);
    assert.equal(keccak256(initcode), review.initcodeHash);
    return { ...review, constructorData, initcode };
  };
  const directoryPlan = materialize("RMTLaunchCurveDirectoryV2", directory.address, signers,
    eip712("RMT Launch Curve Directory", "2", directory.address));
  const registryPlan = materialize("RMTLaunchProjectRegistryV3", registry.address, [directory.address],
    { ...eip712("RMT Launch Project Registry", "4", registry.address), directory: directory.address });
  const v2Plan = materialize("RMTLaunchCurveSuccessorDeployerV1", v2.address, [], {});
  const v3Plan = materialize("RMTLaunchCurveSuccessorDeployerV2", v3.address, [], {});
  const bootstrapPlan = materialize("RMTLaunchCurveDeploymentV2", bootstrap.address,
    [dependencies, guard.salt, operations, reserve, registry.address, v2.address, v2Plan.runtimeHash, creationFee],
    { factory, graduationEngine: engine, initializationGuard: guard.address });
  const guardPlan = materialize("RMTV4CurveInitializationGuardV1", guard.address, [dependencies.poolManager, engine],
    { poolManager: dependencies.poolManager, graduationEngine: engine });
  const enginePlan = materialize("RMTV4CurveGraduationV1", engine, [dependencies, factory, guard.address],
    { factory, poolManager: dependencies.poolManager, positionManager: dependencies.positionManager, permit2: dependencies.permit2,
      initializationGuard: guard.address, poolManagerRuntimeHash: dependencies.poolManagerHash,
      positionManagerRuntimeHash: dependencies.positionManagerHash, permit2RuntimeHash: dependencies.permit2Hash,
      initializationGuardRuntimeHash: guardPlan.runtimeHash });
  const factoryPlan = materialize("RMTLaunchCurveFactoryV2", factory,
    [engine, operations, reserve, registry.address, v2.address, v2Plan.runtimeHash, creationFee],
    { graduationEngine: engine, operatingRecipient: operations, futureReserveRecipient: reserve, projectRegistry: registry.address,
      successorDeployer: v2.address, successorDeployerRuntimeHash: v2Plan.runtimeHash, creationFeeWei: toHex(creationFee) });
  const plans = [directoryPlan, registryPlan, v2Plan, v3Plan, bootstrapPlan];
  return {
    constructors: createDestinations.map(({ id, nonce }, index) => ({ id, nonce, ...plans[index] })),
    bootstrapChildren: [{ ...guardPlan, create2Salt: guard.salt, hookPermissionBits: "0x2000" }, enginePlan, factoryPlan],
  };
}
