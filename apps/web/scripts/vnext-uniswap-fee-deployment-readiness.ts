import { readFile } from "node:fs/promises";
import {
  concatHex,
  createPublicClient,
  encodeAbiParameters,
  encodeDeployData,
  getAddress,
  getCreate2Address,
  http,
  keccak256,
  parseAbi,
  parseAbiParameters,
  type Abi,
  type Address,
  type Hex
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { createRmtExecutionV1Policy } from "../lib/vnext/execution-fee-policy";
import { rmtUniswapV3PolicyIdHash } from "../lib/vnext/uniswap-v3-fee-executor";

type DeploymentManifest = {
  schemaVersion: number;
  status: "prepared_not_authorized" | "deployed_not_activated";
  chainId: number;
  contract: "RMTUniswapV3FeeExecutorV1";
  sourceBaseline: string;
  deploymentAuthorized: boolean;
  feeActivationAuthorized: false;
  deployer: Address;
  deterministicDeployment: {
    factory: Address;
    factoryRuntimeHash: Hex;
    salt: Hex;
    predictedExecutor: Address;
    creationCodeHash: Hex;
    constructorArgumentsHash: Hex;
    initCodeHash: Hex;
    expectedRuntimeHash: Hex;
    creationCodeBytes: number;
    initCodeBytes: number;
    deploymentTransaction: Hex | null;
    deploymentBlock?: string;
    deploymentBlockHash?: Hex;
    deployedRuntimeHash?: Hex;
    gasUsed?: string;
    effectiveGasPriceWei?: string;
    actualCostWei?: string;
  };
  treasury: {
    address: Address;
    kind: "safe_1_of_1";
    owner: Address;
    threshold: 1;
    safeVersion: string;
    singleton: Address;
    singletonRuntimeHash: Hex;
    fallbackHandler: Address;
    fallbackHandlerRuntimeHash: Hex;
    proxyRuntimeHash: Hex;
    deploymentTransaction: Hex;
    deploymentBlock: string;
    deploymentBlockHash: Hex;
  };
  infrastructure: {
    router: Address;
    routerRuntimeHash: Hex;
    factory: Address;
    factoryRuntimeHash: Hex;
    weth: Address;
    wethRuntimeHash: Hex;
    wethImplementation: Address;
    wethImplementationRuntimeHash: Hex;
    usdg: Address;
    usdgRuntimeHash: Hex;
  };
  policy: {
    policyId: "RMT_EXECUTION_V1";
    policyIdHash: Hex;
    version: 1;
    feeBps: 25;
    policyHash: Hex;
    fromBlock: string;
    beforeBlock: string | null;
    eligibleSettlementAssetIds: string[];
    eligibleFeeAssets: Address[];
    nativeFeeAssetEligible: boolean;
  };
};

type ContractArtifact = { abi: Abi; bytecode: { object: Hex } };

const manifestUrl = new URL(
  "../../../packages/contracts/deployments/rmt-uniswap-v3-fee-executor-v1.json",
  import.meta.url
);
const artifactUrl = new URL(
  "../../../packages/contracts/out/RMTUniswapV3FeeExecutorV1.sol/RMTUniswapV3FeeExecutorV1.json",
  import.meta.url
);

const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function masterCopy() view returns (address)",
  "function VERSION() view returns (string)"
]);
const routerAbi = parseAbi([
  "function factory() view returns (address)",
  "function WETH9() view returns (address)"
]);
const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const SAFE_FALLBACK_HANDLER_SLOT =
  "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5" as Hex;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Uniswap fee deployment readiness failed: ${message}.`);
}

function same(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function codeHash(code: Hex | undefined, label: string) {
  invariant(code && code !== "0x", `${label} has no runtime bytecode`);
  return keccak256(code);
}

function byteLength(value: Hex) {
  return (value.length - 2) / 2;
}

async function loadJson<T>(url: URL) {
  return JSON.parse(await readFile(url, "utf8")) as T;
}

async function main() {
  const manifest = await loadJson<DeploymentManifest>(manifestUrl);
  const artifact = await loadJson<ContractArtifact>(artifactUrl).catch(() => {
    throw new Error("Run `forge build --root packages/contracts --contracts src/RMTUniswapV3FeeExecutorV1.sol` first");
  });
  invariant(manifest.schemaVersion === 1, "unsupported manifest schema");
  const deploymentRecorded = manifest.status === "deployed_not_activated";
  invariant(
    manifest.status === "prepared_not_authorized" || deploymentRecorded,
    "deployment status is not fail closed"
  );
  invariant(!manifest.feeActivationAuthorized, "manifest unexpectedly authorizes fee activation");
  invariant(manifest.chainId === robinhoodChain.id, "manifest chain is not Robinhood Chain 4663");
  if (deploymentRecorded) {
    invariant(manifest.deploymentAuthorized, "recorded deployment is missing its explicit authorization");
    invariant(manifest.deterministicDeployment.deploymentTransaction !== null, "deployment transaction is missing");
    invariant(manifest.deterministicDeployment.deploymentBlock !== undefined, "deployment block is missing");
    invariant(manifest.deterministicDeployment.deploymentBlockHash !== undefined, "deployment block hash is missing");
    invariant(manifest.deterministicDeployment.deployedRuntimeHash !== undefined, "deployed runtime hash is missing");
  } else {
    invariant(!manifest.deploymentAuthorized, "prepared manifest unexpectedly authorizes deployment");
    invariant(manifest.deterministicDeployment.deploymentTransaction === null, "prepared manifest records a deployment");
  }

  const rpc = process.env.RMT_MAINNET_RPC_URL?.trim()
    || process.env.ROBINHOOD_MAINNET_RPC_URL?.trim()
    || process.env.NEXT_PUBLIC_RMT_RPC_URL?.trim()
    || robinhoodChain.rpcUrls.default.http[0];
  const client = createPublicClient({
    chain: robinhoodChain,
    transport: http(rpc, { retryCount: 2, timeout: 10_000 })
  });
  const chainId = await client.getChainId();
  invariant(chainId === manifest.chainId, "RPC returned the wrong chain");

  const treasury = getAddress(manifest.treasury.address);
  const treasuryOwner = getAddress(manifest.treasury.owner);
  const [
    treasuryCode,
    treasuryOwners,
    treasuryThreshold,
    treasurySingleton,
    treasuryVersion,
    fallbackStorage,
    treasuryReceipt,
    treasuryTransaction,
    treasuryBlock
  ] = await Promise.all([
    client.getBytecode({ address: treasury }),
    client.readContract({ address: treasury, abi: safeAbi, functionName: "getOwners" }),
    client.readContract({ address: treasury, abi: safeAbi, functionName: "getThreshold" }),
    client.readContract({ address: treasury, abi: safeAbi, functionName: "masterCopy" }),
    client.readContract({ address: treasury, abi: safeAbi, functionName: "VERSION" }),
    client.getStorageAt({ address: treasury, slot: SAFE_FALLBACK_HANDLER_SLOT }),
    client.getTransactionReceipt({ hash: manifest.treasury.deploymentTransaction }),
    client.getTransaction({ hash: manifest.treasury.deploymentTransaction }),
    client.getBlock({ blockNumber: BigInt(manifest.treasury.deploymentBlock) })
  ]);
  invariant(same(codeHash(treasuryCode, "treasury Safe"), manifest.treasury.proxyRuntimeHash), "treasury Safe runtime changed");
  invariant(treasuryOwners.length === 1 && getAddress(treasuryOwners[0]) === treasuryOwner, "treasury owner set changed");
  invariant(treasuryThreshold === 1n, "treasury signature threshold changed");
  invariant(getAddress(treasurySingleton) === getAddress(manifest.treasury.singleton), "treasury Safe singleton changed");
  invariant(treasuryVersion === manifest.treasury.safeVersion, "treasury Safe version changed");
  invariant(
    fallbackStorage !== undefined
      && getAddress(`0x${fallbackStorage.slice(-40)}`) === getAddress(manifest.treasury.fallbackHandler),
    "treasury fallback handler changed"
  );
  invariant(treasuryReceipt.status === "success", "treasury deployment transaction was not successful");
  invariant(treasuryReceipt.blockNumber === BigInt(manifest.treasury.deploymentBlock), "treasury deployment block changed");
  invariant(same(treasuryReceipt.blockHash, manifest.treasury.deploymentBlockHash), "treasury deployment block hash changed");
  invariant(getAddress(treasuryTransaction.from) === treasuryOwner, "treasury was deployed by an unexpected wallet");
  invariant(getAddress(treasuryTransaction.to!) === getAddress("0x14F2982D601c9458F93bd70B218933A6f8165e7b"), "treasury factory changed");
  invariant(same(treasuryBlock.hash, manifest.treasury.deploymentBlockHash), "treasury canonical block no longer matches");

  const [singletonCode, handlerCode] = await Promise.all([
    client.getBytecode({ address: getAddress(manifest.treasury.singleton) }),
    client.getBytecode({ address: getAddress(manifest.treasury.fallbackHandler) })
  ]);
  invariant(same(codeHash(singletonCode, "Safe singleton"), manifest.treasury.singletonRuntimeHash), "Safe singleton runtime changed");
  invariant(same(codeHash(handlerCode, "Safe fallback handler"), manifest.treasury.fallbackHandlerRuntimeHash), "Safe fallback runtime changed");

  const policy = createRmtExecutionV1Policy({
    treasury,
    chainId: manifest.chainId,
    fromBlock: manifest.policy.fromBlock,
    beforeBlock: manifest.policy.beforeBlock,
    eligibleSettlementAssetIds: manifest.policy.eligibleSettlementAssetIds
  });
  invariant(policy.policyId === manifest.policy.policyId, "policy ID changed");
  invariant(policy.version === manifest.policy.version, "policy version changed");
  invariant(policy.feeBps === manifest.policy.feeBps, "policy fee changed");
  invariant(same(policy.policyHash, manifest.policy.policyHash), "policy hash does not match its fields");
  invariant(
    same(rmtUniswapV3PolicyIdHash(policy.policyId), manifest.policy.policyIdHash),
    "policy ID hash changed"
  );
  invariant(
    manifest.policy.fromBlock === manifest.treasury.deploymentBlock,
    "policy boundary is not anchored to the confirmed treasury deployment"
  );

  const infrastructure = manifest.infrastructure;
  const create2Factory = getAddress(manifest.deterministicDeployment.factory);
  const router = getAddress(infrastructure.router);
  const factory = getAddress(infrastructure.factory);
  const weth = getAddress(infrastructure.weth);
  const usdg = getAddress(infrastructure.usdg);
  const [
    create2FactoryCode,
    routerCode,
    factoryCode,
    wethCode,
    usdgCode,
    wethImplementationStorage,
    routerFactory,
    routerWeth
  ] = await Promise.all([
    client.getBytecode({ address: create2Factory }),
    client.getBytecode({ address: router }),
    client.getBytecode({ address: factory }),
    client.getBytecode({ address: weth }),
    client.getBytecode({ address: usdg }),
    client.getStorageAt({ address: weth, slot: EIP1967_IMPLEMENTATION_SLOT }),
    client.readContract({ address: router, abi: routerAbi, functionName: "factory" }),
    client.readContract({ address: router, abi: routerAbi, functionName: "WETH9" })
  ]);
  invariant(same(codeHash(create2FactoryCode, "CREATE2 factory"), manifest.deterministicDeployment.factoryRuntimeHash), "CREATE2 factory runtime changed");
  invariant(same(codeHash(routerCode, "Uniswap Router02"), infrastructure.routerRuntimeHash), "Router02 runtime changed");
  invariant(same(codeHash(factoryCode, "Uniswap V3 factory"), infrastructure.factoryRuntimeHash), "Uniswap factory runtime changed");
  invariant(same(codeHash(wethCode, "canonical WETH"), infrastructure.wethRuntimeHash), "WETH proxy runtime changed");
  invariant(same(codeHash(usdgCode, "canonical USDG"), infrastructure.usdgRuntimeHash), "USDG runtime changed");
  invariant(getAddress(routerFactory) === factory, "Router02 factory dependency changed");
  invariant(getAddress(routerWeth) === weth, "Router02 WETH dependency changed");
  invariant(wethImplementationStorage !== undefined, "WETH implementation slot is empty");
  const wethImplementation = getAddress(`0x${wethImplementationStorage.slice(-40)}`);
  invariant(wethImplementation === getAddress(infrastructure.wethImplementation), "WETH implementation address changed");
  const wethImplementationCode = await client.getBytecode({ address: wethImplementation });
  invariant(
    same(codeHash(wethImplementationCode, "WETH implementation"), infrastructure.wethImplementationRuntimeHash),
    "WETH implementation runtime changed"
  );

  const eligibleFeeAssets = manifest.policy.eligibleFeeAssets.map((asset) => getAddress(asset));
  invariant(
    eligibleFeeAssets.length === 2 && eligibleFeeAssets[0] === weth && eligibleFeeAssets[1] === usdg,
    "eligible fee-asset constructor order changed"
  );
  const constructorParameters = parseAbiParameters(
    "address router, bytes32 routerRuntimeHash, address factory, bytes32 factoryRuntimeHash, address weth, bytes32 wethRuntimeHash, address treasury, address[] eligibleFeeAssets, bool nativeFeeAssetEligible, bytes32 policyIdHash, uint256 policyVersion, bytes32 policyHash, uint16 policyFeeBps, uint256 policyFromBlock, uint256 policyBeforeBlock"
  );
  const constructorArguments = [
    router,
    infrastructure.routerRuntimeHash,
    factory,
    infrastructure.factoryRuntimeHash,
    weth,
    infrastructure.wethRuntimeHash,
    treasury,
    eligibleFeeAssets,
    manifest.policy.nativeFeeAssetEligible,
    manifest.policy.policyIdHash,
    BigInt(manifest.policy.version),
    manifest.policy.policyHash,
    manifest.policy.feeBps,
    BigInt(manifest.policy.fromBlock),
    BigInt(manifest.policy.beforeBlock ?? "0")
  ] as const;
  const encodedConstructorArguments = encodeAbiParameters(constructorParameters, constructorArguments);
  const creationCode = artifact.bytecode.object;
  const initCode = encodeDeployData({
    abi: artifact.abi,
    bytecode: creationCode,
    args: constructorArguments
  });
  invariant(initCode === concatHex([creationCode, encodedConstructorArguments]), "artifact constructor encoding disagrees");
  invariant(same(keccak256(creationCode), manifest.deterministicDeployment.creationCodeHash), "creation code hash changed");
  invariant(same(keccak256(encodedConstructorArguments), manifest.deterministicDeployment.constructorArgumentsHash), "constructor arguments hash changed");
  invariant(same(keccak256(initCode), manifest.deterministicDeployment.initCodeHash), "init code hash changed");
  invariant(byteLength(creationCode) === manifest.deterministicDeployment.creationCodeBytes, "creation code size changed");
  invariant(byteLength(initCode) === manifest.deterministicDeployment.initCodeBytes, "init code size changed");

  const predictedExecutor = getCreate2Address({
    from: create2Factory,
    salt: manifest.deterministicDeployment.salt,
    bytecodeHash: manifest.deterministicDeployment.initCodeHash
  });
  invariant(predictedExecutor === getAddress(manifest.deterministicDeployment.predictedExecutor), "predicted executor changed");
  const deploymentData = concatHex([manifest.deterministicDeployment.salt, initCode]);
  const [existingExecutorCode, simulatedRuntime, gasPrice, deployerBalance] = await Promise.all([
    client.getBytecode({ address: predictedExecutor }),
    client.request({
      method: "eth_call",
      params: [{ from: manifest.deployer, data: initCode, value: "0x0" }, "latest"]
    }),
    client.getGasPrice(),
    client.getBalance({ address: getAddress(manifest.deployer) })
  ]);
  invariant(typeof simulatedRuntime === "string" && simulatedRuntime !== "0x", "constructor simulation returned no runtime");
  const simulatedRuntimeHash = keccak256(simulatedRuntime);
  invariant(
    same(simulatedRuntimeHash, manifest.deterministicDeployment.expectedRuntimeHash),
    `simulated executor runtime changed (received ${simulatedRuntimeHash})`
  );
  const alreadyDeployed = existingExecutorCode !== undefined && existingExecutorCode !== "0x";
  let estimatedGas: bigint | null = null;
  let create2SimulationPassed = false;
  let deploymentReceipt: {
    transaction: Hex;
    blockNumber: string;
    blockHash: Hex;
    confirmations: string;
    gasUsed: string;
    effectiveGasPriceWei: string;
    actualCostWei: string;
  } | null = null;
  if (alreadyDeployed) {
    invariant(deploymentRecorded, "predicted executor contains code but the deployment is not recorded");
    invariant(
      same(codeHash(existingExecutorCode, "deployed executor"), manifest.deterministicDeployment.expectedRuntimeHash),
      "predicted executor contains unexpected code"
    );
    invariant(
      same(manifest.deterministicDeployment.deployedRuntimeHash!, manifest.deterministicDeployment.expectedRuntimeHash),
      "recorded deployed runtime hash changed"
    );
    const deploymentTransaction = manifest.deterministicDeployment.deploymentTransaction!;
    const [receipt, transaction, latestBlock] = await Promise.all([
      client.getTransactionReceipt({ hash: deploymentTransaction }),
      client.getTransaction({ hash: deploymentTransaction }),
      client.getBlockNumber()
    ]);
    invariant(receipt.status === "success", "deployment transaction was not successful");
    invariant(getAddress(transaction.from) === getAddress(manifest.deployer), "deployment sender changed");
    invariant(transaction.to !== null && getAddress(transaction.to) === create2Factory, "deployment target changed");
    invariant(transaction.value === 0n, "deployment unexpectedly transferred value");
    invariant(same(keccak256(transaction.input), keccak256(deploymentData)), "deployment calldata changed");
    invariant(
      receipt.blockNumber === BigInt(manifest.deterministicDeployment.deploymentBlock!),
      "deployment block changed"
    );
    invariant(
      same(receipt.blockHash, manifest.deterministicDeployment.deploymentBlockHash!),
      "deployment block hash changed"
    );
    const actualCostWei = receipt.gasUsed * receipt.effectiveGasPrice;
    if (manifest.deterministicDeployment.gasUsed !== undefined) {
      invariant(receipt.gasUsed === BigInt(manifest.deterministicDeployment.gasUsed), "recorded deployment gas changed");
    }
    if (manifest.deterministicDeployment.effectiveGasPriceWei !== undefined) {
      invariant(
        receipt.effectiveGasPrice === BigInt(manifest.deterministicDeployment.effectiveGasPriceWei),
        "recorded deployment gas price changed"
      );
    }
    if (manifest.deterministicDeployment.actualCostWei !== undefined) {
      invariant(
        actualCostWei === BigInt(manifest.deterministicDeployment.actualCostWei),
        "recorded deployment cost changed"
      );
    }
    deploymentReceipt = {
      transaction: deploymentTransaction,
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      confirmations: (latestBlock - receipt.blockNumber + 1n).toString(),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
      actualCostWei: actualCostWei.toString()
    };
  } else {
    invariant(!deploymentRecorded, "recorded executor deployment has no runtime bytecode");
    const [create2Simulation, gasEstimate] = await Promise.all([
      client.call({
        account: getAddress(manifest.deployer),
        to: create2Factory,
        data: deploymentData,
        value: 0n
      }),
      client.estimateGas({
        account: getAddress(manifest.deployer),
        to: create2Factory,
        data: deploymentData,
        value: 0n
      })
    ]);
    invariant(create2Simulation.data !== undefined, "CREATE2 simulation returned no address");
    invariant(
      getAddress(`0x${create2Simulation.data.slice(-40)}`) === predictedExecutor,
      "CREATE2 factory returned an unexpected executor"
    );
    estimatedGas = gasEstimate;
    create2SimulationPassed = true;
  }

  const estimatedCostWei = estimatedGas === null ? null : estimatedGas * gasPrice;
  const technicalDeploymentReady = !alreadyDeployed && estimatedCostWei !== null && deployerBalance >= estimatedCostWei;
  console.log(JSON.stringify({
    status: alreadyDeployed ? "executor_already_deployed" : "executor_deployment_prepared",
    chainId,
    sourceBaseline: manifest.sourceBaseline,
    treasury: {
      address: treasury,
      kind: manifest.treasury.kind,
      owners: treasuryOwners,
      threshold: treasuryThreshold.toString(),
      version: treasuryVersion,
      singleton: getAddress(treasurySingleton),
      fallbackHandler: getAddress(`0x${fallbackStorage!.slice(-40)}`),
      deploymentTransaction: manifest.treasury.deploymentTransaction,
      deploymentBlock: manifest.treasury.deploymentBlock,
      verified: true
    },
    policy: {
      policyId: policy.policyId,
      policyIdHash: manifest.policy.policyIdHash,
      version: policy.version,
      feeBps: policy.feeBps,
      policyHash: policy.policyHash,
      effectiveBoundary: policy.effectiveBoundary,
      eligibleSettlementAssetIds: policy.eligibleSettlementAssetIds,
      deploymentBoundaryDoesNotActivateFees: true
    },
    deployment: {
      create2Factory,
      create2FactoryRuntimeHash: manifest.deterministicDeployment.factoryRuntimeHash,
      salt: manifest.deterministicDeployment.salt,
      predictedExecutor,
      creationCodeHash: manifest.deterministicDeployment.creationCodeHash,
      constructorArgumentsHash: manifest.deterministicDeployment.constructorArgumentsHash,
      initCodeHash: manifest.deterministicDeployment.initCodeHash,
      expectedRuntimeHash: manifest.deterministicDeployment.expectedRuntimeHash,
      deploymentCalldataHash: keccak256(deploymentData),
      transactionTo: create2Factory,
      transactionValueWei: "0",
      estimatedGas: estimatedGas?.toString() ?? null,
      gasPriceWei: gasPrice.toString(),
      estimatedCostWei: estimatedCostWei?.toString() ?? null,
      deployerBalanceWei: deployerBalance.toString(),
      existingCode: alreadyDeployed,
      constructorSimulationPassed: true,
      create2SimulationPassed,
      technicalDeploymentReady,
      deploymentReceipt,
      deploymentVerified: deploymentReceipt !== null
    },
    authorization: {
      deploymentAuthorized: manifest.deploymentAuthorized,
      feeActivationAuthorized: manifest.feeActivationAuthorized,
      productionEnvironmentChanged: false,
      transactionSubmitted: deploymentReceipt !== null
    },
    releaseReady: false,
    blockers: alreadyDeployed
      ? [
          "production fee and provider gates remain disabled",
          "wallet disclosure and controlled small-value proof remain required after deployment"
        ]
      : [
          "executor deployment requires a separate explicit authorization",
          "production fee and provider gates remain disabled",
          "wallet disclosure and controlled small-value proof remain required after deployment"
        ]
  }, null, 2));
}

void main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
