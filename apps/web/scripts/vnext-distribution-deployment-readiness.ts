import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Hex } from "viem";
import {
  buildDistributionDeploymentReadinessPacketV1,
  parseDistributionDeploymentReadinessPacketV1
} from "../lib/vnext/distribution-deployment-readiness";

type FoundryArtifact = {
  bytecode?: { object?: string };
  deployedBytecode?: { object?: string };
};

function artifact(path: string): FoundryArtifact {
  return JSON.parse(readFileSync(path, "utf8")) as FoundryArtifact;
}

function bytecode(value: string | undefined, label: string): Hex {
  if (!value || !/^0x[0-9a-fA-F]+$/.test(value) || value === "0x") {
    throw new Error(`${label} is unavailable; compile the reviewed contracts before running readiness.`);
  }
  return value as Hex;
}

function main() {
  const repository = resolve(import.meta.dirname, "../../../");
  const contracts = resolve(repository, "packages/contracts");
  const engine = artifact(resolve(contracts, "out/RMTDistributionEngineV1.sol/RMTDistributionEngineV1.json"));
  const sink = artifact(resolve(contracts, "out/RMTRetirementSinkV1.sol/RMTRetirementSinkV1.json"));
  const sourceCommit = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["-C", repository, "status", "--porcelain"], { encoding: "utf8" }).trim();
  const packet = parseDistributionDeploymentReadinessPacketV1(buildDistributionDeploymentReadinessPacketV1({
    sourceCommit,
    engineCreationCode: bytecode(engine.bytecode?.object, "engine creation bytecode"),
    retirementSinkCreationCode: bytecode(sink.bytecode?.object, "retirement sink creation bytecode"),
    retirementSinkRuntimeCode: bytecode(sink.deployedBytecode?.object, "retirement sink runtime bytecode")
  }));

  console.log(JSON.stringify({
    mode: "read_only_predeployment",
    repositoryClean: dirty.length === 0,
    ...packet,
    releaseReady: false,
    transactionCapability: false,
    nextHumanDecision: "Approve or reject exact immutable ERC-20, ERC-721, and ERC-1155 per-recipient RMT rates."
  }, null, 2));
}

try {
  main();
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
}
