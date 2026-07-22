import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const contractsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(contractsRoot, "../../apps/web/lib/generated/consent-testnet-stack.json");
const releaseOutput = resolve(contractsRoot, "../../apps/web/lib/generated/consent-testnet-release.json");
const deploymentRecord = resolve(
  contractsRoot,
  "deployments/robinhood-testnet-consent-rehearsal-2026-07-18.json"
);
const artifacts = {
  venue: "out/RMTTestnetSushiV3RehearsalStack.sol/RMTTestnetSushiV3RehearsalVenue.json",
  consentStack: "out/RMTTestnetSushiV3RehearsalStack.sol/RMTTestnetSushiV3ConsentStack.json"
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const REQUIRED_CONTRACTS = [
  "venue",
  "governance",
  "pairedToken",
  "weth",
  "factory",
  "pool",
  "positionManager",
  "consentStack",
  "session",
  "migrator"
];

function requireValue(condition, message) {
  if (!condition) throw new Error(`Invalid consent rehearsal deployment record: ${message}`);
}

function publicReleaseFrom(record) {
  requireValue(record.schemaVersion === 1, "unsupported schema version");
  requireValue(record.network?.chainId === 46_630, "wrong chain ID");
  requireValue(record.configuration?.destinationChainId === 46_630, "wrong destination chain ID");
  requireValue(ADDRESS_PATTERN.test(record.operator), "invalid operator address");
  requireValue(record.configuration?.governanceSigner === record.operator, "operator/signer mismatch");
  requireValue(record.configuration?.guardian === record.operator, "operator/guardian mismatch");
  requireValue(record.configuration?.paused === true, "deployment did not start paused");
  requireValue(record.verification?.result === "passed", "deployment verification did not pass");
  requireValue(record.classification?.officialSushiDeployment === false, "official Sushi classification must be false");
  requireValue(record.classification?.productionAmm === false, "production AMM classification must be false");
  requireValue(record.classification?.realAssetsPermitted === false, "real assets must remain prohibited");
  requireValue(record.classification?.publicExecutionEnabled === false, "deployment record must not enable execution");

  for (const name of REQUIRED_CONTRACTS) {
    const contract = record.contracts?.[name];
    requireValue(ADDRESS_PATTERN.test(contract?.address), `${name} has an invalid address`);
    requireValue(HASH_PATTERN.test(contract?.runtimeCodeHash), `${name} has an invalid runtime code hash`);
    requireValue(contract?.sourceVerification === "verified", `${name} source is not verified`);
  }

  for (const name of ["configurationHash", "termsDocumentHash", "migrationTermsHash"]) {
    requireValue(HASH_PATTERN.test(record.configuration?.[name]), `${name} is invalid`);
  }
  for (const name of ["venue", "consentStack"]) {
    const deployment = record.create2?.[name];
    requireValue(HASH_PATTERN.test(deployment?.transactionHash), `${name} deployment transaction is invalid`);
    requireValue(ADDRESS_PATTERN.test(deployment?.deployedAddress), `${name} deployment address is invalid`);
    requireValue(deployment?.deployedAddress === record.contracts[name].address, `${name} deployment address mismatch`);
  }

  return {
    schemaVersion: 1,
    release: {
      name: record.release.name,
      status: record.release.status,
      sourceCommit: record.release.sourceCommit,
      contractSourceSha256: record.release.contractSourceSha256,
      deployedAtUtc: record.release.deployedAtUtc,
      compiler: record.release.compiler
    },
    network: {
      name: record.network.name,
      chainId: record.network.chainId,
      explorerUrl: record.network.explorerUrl
    },
    operator: record.operator,
    create2: {
      venue: record.create2.venue,
      consentStack: record.create2.consentStack
    },
    contracts: Object.fromEntries(REQUIRED_CONTRACTS.map((name) => [name, record.contracts[name]])),
    configuration: {
      destinationChainId: record.configuration.destinationChainId,
      governanceSigner: record.configuration.governanceSigner,
      guardian: record.configuration.guardian,
      poolFee: record.configuration.poolFee,
      tickSpacing: record.configuration.tickSpacing,
      governanceDelaySeconds: record.configuration.governanceDelaySeconds,
      governanceWindowSeconds: record.configuration.governanceWindowSeconds,
      pairedTokenFixedSupply: record.configuration.pairedTokenFixedSupply,
      wethFixedSupply: record.configuration.wethFixedSupply,
      configurationHash: record.configuration.configurationHash,
      termsDocumentHash: record.configuration.termsDocumentHash,
      migrationTermsHash: record.configuration.migrationTermsHash,
      initialPaused: record.configuration.paused
    },
    verification: record.verification,
    classification: record.classification
  };
}

const result = {};
for (const [name, path] of Object.entries(artifacts)) {
  const artifact = JSON.parse(await readFile(resolve(contractsRoot, path), "utf8"));
  result[name] = { abi: artifact.abi, bytecode: artifact.bytecode.object };
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result)}\n`);
const releaseRecord = JSON.parse(await readFile(deploymentRecord, "utf8"));
await writeFile(releaseOutput, `${JSON.stringify(publicReleaseFrom(releaseRecord), null, 2)}\n`);
console.log(`Wrote ${output}`);
console.log(`Wrote ${releaseOutput}`);
