import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { sendFixture, verifyRuntime } from "../../packages/contracts/scripts/deploy-fixed-supply-fixture.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { encodeDeployData, keccak256 } = require("viem");
const json = value => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n";

/** New local module only: the existing factory, token code and ledgers remain
 * unchanged. The supplied operator belongs to the parent synthetic fixture. */
export async function deployProjectTreasuryFixture({ client, compilation, core, coreArtifacts, operator, out }) {
  assert.equal(await client.getChainId(), 31337, "Treasury fixture must use isolated chain 31337");
  const factoryArtifact = compilation.artifacts.RMTProjectTreasuryFactoryV1;
  const treasuryArtifact = compilation.artifacts.RMTProjectTreasuryV1;
  assert.ok(factoryArtifact && treasuryArtifact, "Expected separately versioned treasury module artifacts");
  const pins = { factory: core.factory, factoryRuntimeHash: core.factoryRuntimeHash,
    graduationEngine: core.graduationEngine, graduationRuntimeHash: core.graduationRuntimeHash,
    tokenRuntimeHash: keccak256(coreArtifacts.RMTLaunchCurveTokenV2.runtime) };
  assert.equal(keccak256(await client.getCode({ address: pins.factory })), pins.factoryRuntimeHash);
  assert.equal(keccak256(await client.getCode({ address: pins.graduationEngine })), pins.graduationRuntimeHash);
  const initcode = encodeDeployData({ abi: factoryArtifact.abi, bytecode: factoryArtifact.bytecode, args: [pins] });
  assert.ok((initcode.length - 2) / 2 <= 49_152, "Encoded treasury factory constructor exceeds EIP-3860");
  const receipt = await sendFixture(client, operator, { data: initcode });
  const factory = receipt.contractAddress; assert.ok(factory);
  const factoryRuntimeHash = await verifyRuntime(client, factory, factoryArtifact);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber }); assert.equal(block.hash, receipt.blockHash);
  const treasuryCreationCodeHash = keccak256(treasuryArtifact.bytecode);
  assert.equal(await client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: "treasuryCreationCodeHash" }), treasuryCreationCodeHash);
  const result = { schemaVersion: 1, profile: "rmt-project-treasury-v1", chainId: 31337,
    treasuryFactory: factory, factoryRuntimeHash, coreFactory: pins.factory, coreFactoryRuntimeHash: pins.factoryRuntimeHash,
    graduationEngine: pins.graduationEngine, graduationRuntimeHash: pins.graduationRuntimeHash, tokenRuntimeHash: pins.tokenRuntimeHash,
    treasuryCreationCode: treasuryArtifact.bytecode, treasuryCreationCodeHash,
    treasuryRuntimeTemplate: treasuryArtifact.runtime, treasuryImmutableReferences: treasuryArtifact.immutableOffsets,
    treasuryImmutableNames: Object.fromEntries(Object.keys(treasuryArtifact.immutableOffsets).map(id => {
      assert.ok(compilation.immutableNames[id], "Missing immutable AST name: " + id);
      return [id, compilation.immutableNames[id]];
    })), deployment: { transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
      timestamp: new Date(Number(block.timestamp) * 1000).toISOString() },
    compilerInputSha256: compilation.manifest.inputSha256 };
  writeFileSync(join(out, "project-treasury-deployment.json"), json(result));
  writeFileSync(join(out, "project-treasury-compiler-manifest.json"), json(compilation.manifest));
  return result;
}
