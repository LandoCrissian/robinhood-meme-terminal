import { assertCurveLaunchBinding, curveFixedSupplyProfile, type CurveLaunchBinding } from "./curve-launch-evidence.js";
import { getAddress, type Address, type Hash } from "viem";

export type CurveProductionConfig = {
  binding: CurveLaunchBinding & { chainId: 4663 };
  deploymentTransactionHash: Hash;
  reserveRecipient: Address;
  sourceVerificationEvidenceSha256: string;
};

function hash(value: unknown): value is Hash {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value) && !/^0x0+$/i.test(value);
}

/** Public deployment inputs only. Missing configuration keeps the production feed disabled. */
export function curveProductionConfig(env: NodeJS.ProcessEnv): CurveProductionConfig | null {
  const text = env.RMT_CURVE_PRODUCTION_BINDING;
  if (text === undefined || text === "") return null;
  if (Buffer.byteLength(text, "utf8") > 16_384) throw new Error("Production curve binding exceeds its bound");
  const row: unknown = JSON.parse(text);
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid production curve binding");
  const data = row as Record<string, unknown>;
  if (data.schemaVersion !== 1 || data.chainId !== 4663 || data.profile !== curveFixedSupplyProfile
      || data.evidence !== "CANONICAL_DEPLOYMENT_AND_SOURCE_VERIFIED"
      || typeof data.deploymentBlock !== "string" || !/^[1-9][0-9]{0,15}$/.test(data.deploymentBlock)
      || !hash(data.deploymentBlockHash) || !hash(data.deploymentTransactionHash)
      || !hash(data.factoryRuntimeHash) || !hash(data.registryRuntimeHash)
      || typeof data.sourceVerificationEvidenceSha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(data.sourceVerificationEvidenceSha256)
      || /^0+$/.test(data.sourceVerificationEvidenceSha256)
      || data.creationFeeWei !== "400000000000000") throw new Error("Production curve deployment evidence is incomplete");
  const factory = getAddress(String(data.factory));
  const projectRegistry = getAddress(String(data.projectRegistry));
  const creationFeeRecipient = getAddress(String(data.operatingRecipient));
  const reserveRecipient = getAddress(String(data.reserveRecipient));
  const addresses = [factory, projectRegistry, creationFeeRecipient, reserveRecipient].map((address) => address.toLowerCase());
  if (new Set(addresses).size !== addresses.length || addresses.some((address) => BigInt(address) <= 0xffffn)) {
    throw new Error("Production contract and treasury addresses must be distinct non-reserved addresses");
  }
  const confirmations = data.confirmations ?? 20;
  if (typeof confirmations !== "number" || !Number.isInteger(confirmations) || confirmations < 20 || confirmations > 256) {
    throw new Error("Invalid production curve confirmation depth");
  }
  const binding: CurveProductionConfig["binding"] = {
    chainId: 4663 as const, profile: curveFixedSupplyProfile, engineVersion: 1 as const,
    factory, projectRegistry, creationFeeRecipient, creationFeeWei: BigInt(data.creationFeeWei),
    factoryRuntimeHash: data.factoryRuntimeHash, projectRegistryRuntimeHash: data.registryRuntimeHash,
    deploymentBlock: BigInt(data.deploymentBlock), deploymentBlockHash: data.deploymentBlockHash, confirmations,
  };
  assertCurveLaunchBinding(binding);
  return { binding, reserveRecipient, deploymentTransactionHash: data.deploymentTransactionHash,
    sourceVerificationEvidenceSha256: data.sourceVerificationEvidenceSha256 };
}
