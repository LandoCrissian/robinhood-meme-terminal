"use client";

import { robinhoodChainTestnet } from "@rmt/shared/chains";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import {
  concat,
  encodeAbiParameters,
  encodeDeployData,
  formatEther,
  getAddress,
  getCreate2Address,
  isAddress,
  isHex,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex
} from "viem";
import artifactsJson from "../../lib/generated/consent-testnet-stack.json";

const APPROVED_TEST_WALLET = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA" as Address;
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address;
const CREATE2_DEPLOYER_RUNTIME_HASH = "0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989" as Hex;
const EXPECTED_TERMS_DOCUMENT_HASH = "0x236ed1f849548c61a923152a92dc91593f22a6e2ff3d176a4b0db38b3b2d2b57" as Hex;
const CONFIGURATION_TYPEHASH = keccak256(toHex("RMTConsentLiquidityConfiguration(address migrator,uint256 chainId,address governance,address guardian,address weth,address pairedToken,address positionManager,address factory,address pool,address session,uint24 poolFee,bytes32 positionManagerCodeHash,bytes32 factoryCodeHash,bytes32 poolCodeHash,bytes32 sessionCodeHash,bytes32 wethCodeHash,bytes32 pairedTokenCodeHash)"));
const TERMS_DOMAIN_TYPEHASH = keccak256(toHex("RMTConsentLiquidityTerms(bytes32 configurationHash,bytes32 termsDocumentHash)"));
const PAIRED_TOKEN_FIXED_SUPPLY = 1_000_000_000n * 10n ** 18n;
const WETH_FIXED_SUPPLY = 1_000_000n * 10n ** 18n;
const POOL_FEE = 3_000;
const TICK_SPACING = 60;
const STORAGE_KEY_PREFIX = "rmt:consent-rehearsal:v1";

type Artifact = { abi: Abi; bytecode: Hex };
type Deployment = {
  venue?: Address;
  consentStack?: Address;
  migrator?: Address;
  session?: Address;
  governance?: Address;
  venueTransaction?: Hex;
  consentTransaction?: Hex;
  venueAttempts?: Hex[];
  consentAttempts?: Hex[];
  venueBlock?: string;
  consentBlock?: string;
  verifiedBlock?: string;
  venueInitCodeHash?: Hex;
  consentInitCodeHash?: Hex;
  configurationHash?: Hex;
  migrationTermsHash?: Hex;
};
type Stage = "idle" | "checking" | "venue" | "consent" | "verifying" | "complete" | "failed";

const artifacts = artifactsJson as Record<"venue" | "consentStack", Artifact>;
const ARTIFACT_SET_HASH = keccak256(concat([
  keccak256(artifacts.venue.bytecode),
  keccak256(artifacts.consentStack.bytecode)
]));
const labels: Record<Stage, string> = {
  idle: "Ready for the approved test wallet",
  checking: "Checking testnet and deployment code…",
  venue: "Approve the valueless rehearsal venue",
  consent: "Approve the paused consent stack",
  verifying: "Verifying every immutable binding…",
  complete: "Paused testnet rehearsal verified",
  failed: "Deployment stopped safely"
};

const migratorReadAbi = [
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "destinationChainId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "governance", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "guardian", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "liquiditySession", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "weth", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "pairedToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "positionManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "sushiFactory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "sushiPool", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "poolFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "poolTickSpacing", stateMutability: "view", inputs: [], outputs: [{ type: "int24" }] },
  { type: "function", name: "configurationHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "migrationTermsHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "termsDocumentHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }
] as const;
const sessionReadAbi = [
  { type: "function", name: "router", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "pairedToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "weth", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "positionManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "poolFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "pairedTokenIsToken0", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] }
] as const;
const governanceReadAbi = [
  { type: "function", name: "isSigner", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "signerCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "threshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "executionDelay", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "executionWindow", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] }
] as const;
const tokenReadAbi = [
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "initialRecipient", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
] as const;
const factoryReadAbi = [
  { type: "function", name: "pool", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }], outputs: [{ type: "address" }] },
  { type: "function", name: "feeAmountTickSpacing", stateMutability: "view", inputs: [{ type: "uint24" }], outputs: [{ type: "int24" }] }
] as const;
const poolReadAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "tickSpacing", stateMutability: "view", inputs: [], outputs: [{ type: "int24" }] }
] as const;
const managerReadAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "WETH9", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "pool", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
] as const;

function hasCode(code: Hex | undefined): code is Hex {
  return Boolean(code && code !== "0x");
}

function short(address: Address) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function explorerAddress(address: Address) {
  return `https://explorer.testnet.chain.robinhood.com/address/${address}`;
}

function validHash(value: unknown): value is Hex {
  return typeof value === "string" && isHex(value) && value.length === 66;
}

function deploymentStorageKey(operator: Address) {
  return `${STORAGE_KEY_PREFIX}:${robinhoodChainTestnet.id}:${getAddress(operator).toLowerCase()}`;
}

function loadDeployment(operator: Address): Deployment {
  const storageKey = deploymentStorageKey(operator);
  const saved = localStorage.getItem(storageKey);
  if (!saved) return {};
  try {
    const parsed = JSON.parse(saved) as Record<string, unknown>;
    if (
      parsed.schemaVersion !== 1 || parsed.chainId !== robinhoodChainTestnet.id
      || typeof parsed.operator !== "string" || !isAddress(parsed.operator)
      || getAddress(parsed.operator) !== getAddress(operator)
      || parsed.artifactSetHash !== ARTIFACT_SET_HASH
    ) throw new Error("stale deployment record");
    for (const key of ["venue", "consentStack", "migrator", "session", "governance"] as const) {
      if (parsed[key] !== undefined && (typeof parsed[key] !== "string" || !isAddress(parsed[key]))) {
        throw new Error(`invalid ${key}`);
      }
    }
    for (const key of ["venueTransaction", "consentTransaction", "venueInitCodeHash", "consentInitCodeHash", "configurationHash", "migrationTermsHash"] as const) {
      if (parsed[key] !== undefined && !validHash(parsed[key])) throw new Error(`invalid ${key}`);
    }
    for (const key of ["venueAttempts", "consentAttempts"] as const) {
      if (parsed[key] !== undefined && (!Array.isArray(parsed[key]) || !parsed[key].every(validHash))) {
        throw new Error(`invalid ${key}`);
      }
    }
    for (const key of ["venueBlock", "consentBlock", "verifiedBlock"] as const) {
      if (parsed[key] !== undefined && (typeof parsed[key] !== "string" || !/^\d+$/.test(parsed[key]))) {
        throw new Error(`invalid ${key}`);
      }
    }
    return parsed as Deployment;
  } catch {
    localStorage.removeItem(storageKey);
    return {};
  }
}

function saveDeployment(operator: Address, deployment: Deployment) {
  localStorage.setItem(deploymentStorageKey(operator), JSON.stringify({
    schemaVersion: 1,
    chainId: robinhoodChainTestnet.id,
    artifactSetHash: ARTIFACT_SET_HASH,
    operator: getAddress(operator),
    ...deployment
  }));
}

function readableDeploymentError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes("4001") || /rejected|denied|cancelled/i.test(message)) {
    return "The wallet cancelled this testnet approval. No production assets moved. You can resume safely.";
  }
  return message || "Deployment was stopped by the wallet or network.";
}

export function ConsentTestnetDeployment() {
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const [stage, setStage] = useState<Stage>("idle");
  const [deployment, setDeployment] = useState<Deployment>({});
  const [balance, setBalance] = useState<bigint>();
  const [error, setError] = useState<string>();
  const [runActive, setRunActive] = useState(false);
  const [recordVerified, setRecordVerified] = useState(false);
  const [recoveryVenueHash, setRecoveryVenueHash] = useState("");
  const [recoveryConsentHash, setRecoveryConsentHash] = useState("");
  const runGeneration = useRef(0);
  const inFlight = useRef(false);
  const busy = runActive || !["idle", "complete", "failed"].includes(stage);
  const approvedWallet = Boolean(address && getAddress(address) === APPROVED_TEST_WALLET);
  const correctChain = chainId === robinhoodChainTestnet.id;
  const canStart = Boolean(isConnected && address && approvedWallet && correctChain && walletClient && publicClient && !busy);
  const steps = useMemo(() => ["Wallet and chain", "Valueless venue", "Paused consent stack", "Immutable verification"], []);

  useEffect(() => {
    runGeneration.current += 1;
    setRecordVerified(false);
    if (inFlight.current) {
      setStage("failed");
      setError("The wallet account or network changed. The prior run was cancelled and cannot submit another transaction.");
    } else {
      setStage("idle");
      setError(undefined);
    }
    setDeployment({});
    setBalance(undefined);
    if (!isConnected || !address || !publicClient || chainId !== robinhoodChainTestnet.id) return;
    void publicClient.getBalance({ address }).then(setBalance).catch(() => setBalance(undefined));
    setDeployment(loadDeployment(address));
  }, [address, chainId, isConnected, publicClient]);

  async function readStackAddress(stack: Address, functionName: string, blockNumber?: bigint) {
    return getAddress(String(await publicClient!.readContract({
      address: stack,
      abi: artifacts.consentStack.abi,
      functionName,
      blockNumber
    })));
  }

  async function readStackHash(stack: Address, functionName: string, blockNumber?: bigint) {
    return String(await publicClient!.readContract({
      address: stack,
      abi: artifacts.consentStack.abi,
      functionName,
      blockNumber
    })) as Hex;
  }

  async function readVenueAddress(venue: Address, functionName: string, blockNumber?: bigint) {
    return getAddress(String(await publicClient!.readContract({
      address: venue,
      abi: artifacts.venue.abi,
      functionName,
      blockNumber
    })));
  }

  async function deploy() {
    if (
      !address || !walletClient || !publicClient || !correctChain || !approvedWallet
      || inFlight.current
    ) return;
    inFlight.current = true;
    setRunActive(true);
    setStage("checking");
    setError(undefined);
    setRecordVerified(false);
    const runId = ++runGeneration.current;
    const current = { ...deployment };
    const assertActiveRun = () => {
      if (runGeneration.current !== runId) {
        throw new Error("The wallet account or network changed. This deployment run was cancelled safely.");
      }
    };
    const persistCurrent = () => {
      assertActiveRun();
      setDeployment({ ...current });
      saveDeployment(address, current);
    };

    const confirmDeploymentTransaction = async (
      hash: Hex,
      expectedInput: Hex,
      phase: "venue" | "consent"
    ) => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
      assertActiveRun();
      const minedHash = receipt.transactionHash;
      const transaction = await publicClient.getTransaction({ hash: minedHash });
      assertActiveRun();
      if (minedHash.toLowerCase() !== hash.toLowerCase()) {
        if (phase === "venue") {
          current.venueTransaction = minedHash;
          current.venueAttempts = [...new Set([...(current.venueAttempts ?? []), minedHash])];
        } else {
          current.consentTransaction = minedHash;
          current.consentAttempts = [...new Set([...(current.consentAttempts ?? []), minedHash])];
        }
        persistCurrent();
      }
      if (receipt.status !== "success") {
        if (phase === "venue") delete current.venueTransaction;
        else delete current.consentTransaction;
        persistCurrent();
        throw new Error(`The ${phase} deployment transaction reverted. Its hash remains in the attempt history.`);
      }
      if (
        getAddress(transaction.from) !== getAddress(address)
        || !transaction.to || getAddress(transaction.to) !== getAddress(CREATE2_DEPLOYER)
        || transaction.input.toLowerCase() !== expectedInput.toLowerCase()
      ) throw new Error(`The mined ${phase} transaction does not match the exact reviewed deployment payload.`);
      return receipt;
    };

    try {
      assertActiveRun();
      if ((await publicClient.getChainId()) !== robinhoodChainTestnet.id) throw new Error("Connect to Robinhood Chain Testnet.");
      assertActiveRun();
      const create2Code = await publicClient.getBytecode({ address: CREATE2_DEPLOYER });
      if (
        !hasCode(create2Code) || (create2Code.length - 2) / 2 !== 69
        || keccak256(create2Code).toLowerCase() !== CREATE2_DEPLOYER_RUNTIME_HASH
      ) throw new Error("The trusted testnet deployment helper failed exact runtime verification.");
      setBalance(await publicClient.getBalance({ address }));

      const venueInitCode = encodeDeployData({
        abi: artifacts.venue.abi,
        bytecode: artifacts.venue.bytecode,
        args: [address]
      });
      if ((venueInitCode.length - 2) / 2 >= 49_152) throw new Error("The encoded venue deployment exceeds the network limit.");
      const venueSalt = keccak256(concat([toHex("rmt-consent-rehearsal-venue-v1"), address]));
      const venue = getCreate2Address({ from: CREATE2_DEPLOYER, salt: venueSalt, bytecode: venueInitCode });
      const venueData = concat([venueSalt, venueInitCode]);
      current.venue = venue;
      current.venueInitCodeHash = keccak256(venueInitCode);
      const existingVenueCode = await publicClient.getBytecode({ address: venue });
      if (!hasCode(existingVenueCode)) {
        setStage("venue");
        let hash = current.venueTransaction;
        if (!hash) {
          const [estimate, availableBalance, gasPrice] = await Promise.all([
            publicClient.estimateGas({ account: address, to: CREATE2_DEPLOYER, data: venueData }),
            publicClient.getBalance({ address }),
            publicClient.getGasPrice()
          ]);
          const gasLimit = estimate * 120n / 100n;
          const conservativeGasPrice = gasPrice * 2n;
          const consentGasReserve = 15_000_000n * conservativeGasPrice;
          if (availableBalance < gasLimit * conservativeGasPrice + consentGasReserve) {
            throw new Error("The approved wallet needs more test ETH to cover both reviewed deployments safely.");
          }
          assertActiveRun();
          hash = await walletClient.sendTransaction({
            account: address,
            chain: robinhoodChainTestnet,
            to: CREATE2_DEPLOYER,
            data: venueData,
            gas: gasLimit
          });
          current.venueTransaction = hash;
          current.venueAttempts = [...new Set([...(current.venueAttempts ?? []), hash])];
          saveDeployment(address, current);
          assertActiveRun();
          persistCurrent();
        }
        const receipt = await confirmDeploymentTransaction(hash, venueData, "venue");
        current.venueBlock = receipt.blockNumber.toString();
      } else if (current.venueTransaction) {
        const receipt = await confirmDeploymentTransaction(current.venueTransaction, venueData, "venue");
        current.venueBlock = receipt.blockNumber.toString();
      } else {
        throw new Error("The predicted venue already has code, but this reviewed browser has no matching transaction record.");
      }
      assertActiveRun();
      if (!hasCode(await publicClient.getBytecode({ address: venue }))) throw new Error("The rehearsal venue was not created.");
      assertActiveRun();
      const deployedVenueOperator = getAddress(String(await publicClient.readContract({
        address: venue,
        abi: artifacts.venue.abi,
        functionName: "operator"
      })));
      if (deployedVenueOperator !== getAddress(address)) throw new Error("The rehearsal venue is bound to a different operator.");
      persistCurrent();

      const consentInitCode = encodeDeployData({
        abi: artifacts.consentStack.abi,
        bytecode: artifacts.consentStack.bytecode,
        args: [address, venue]
      });
      if ((consentInitCode.length - 2) / 2 >= 49_152) throw new Error("The encoded consent deployment exceeds the network limit.");
      const consentSalt = keccak256(concat([toHex("rmt-consent-rehearsal-stack-v1"), venue]));
      const consentStack = getCreate2Address({ from: CREATE2_DEPLOYER, salt: consentSalt, bytecode: consentInitCode });
      const consentData = concat([consentSalt, consentInitCode]);
      current.consentStack = consentStack;
      current.consentInitCodeHash = keccak256(consentInitCode);
      const existingConsentCode = await publicClient.getBytecode({ address: consentStack });
      if (!hasCode(existingConsentCode)) {
        setStage("consent");
        let hash = current.consentTransaction;
        if (!hash) {
          const [estimate, availableBalance, gasPrice] = await Promise.all([
            publicClient.estimateGas({ account: address, to: CREATE2_DEPLOYER, data: consentData }),
            publicClient.getBalance({ address }),
            publicClient.getGasPrice()
          ]);
          const gasLimit = estimate * 120n / 100n;
          if (availableBalance < gasLimit * gasPrice * 2n) {
            throw new Error("The approved wallet needs more test ETH for the paused consent-stack deployment.");
          }
          assertActiveRun();
          hash = await walletClient.sendTransaction({
            account: address,
            chain: robinhoodChainTestnet,
            to: CREATE2_DEPLOYER,
            data: consentData,
            gas: gasLimit
          });
          current.consentTransaction = hash;
          current.consentAttempts = [...new Set([...(current.consentAttempts ?? []), hash])];
          saveDeployment(address, current);
          assertActiveRun();
          persistCurrent();
        }
        const receipt = await confirmDeploymentTransaction(hash, consentData, "consent");
        current.consentBlock = receipt.blockNumber.toString();
      } else if (current.consentTransaction) {
        const receipt = await confirmDeploymentTransaction(current.consentTransaction, consentData, "consent");
        current.consentBlock = receipt.blockNumber.toString();
      } else {
        throw new Error("The predicted consent stack already has code, but this reviewed browser has no matching transaction record.");
      }
      assertActiveRun();
      if (!hasCode(await publicClient.getBytecode({ address: consentStack }))) throw new Error("The consent stack was not created.");

      setStage("verifying");
      const verificationBlock = await publicClient.getBlockNumber();
      assertActiveRun();
      const [operator, boundVenue, migrator, session, governance, pairedToken, weth, factory, pool, positionManager] = await Promise.all([
        readStackAddress(consentStack, "operator", verificationBlock),
        readStackAddress(consentStack, "venue", verificationBlock),
        readStackAddress(consentStack, "migrator", verificationBlock),
        readStackAddress(consentStack, "session", verificationBlock),
        readStackAddress(consentStack, "governance", verificationBlock),
        readStackAddress(consentStack, "pairedToken", verificationBlock),
        readStackAddress(consentStack, "weth", verificationBlock),
        readStackAddress(consentStack, "factory", verificationBlock),
        readStackAddress(consentStack, "pool", verificationBlock),
        readStackAddress(consentStack, "positionManager", verificationBlock)
      ]);
      if (operator !== getAddress(address) || boundVenue !== venue) throw new Error("The consent stack operator or venue binding changed.");

      const expectedOperator = getAddress(address);
      const token0 = BigInt(pairedToken) < BigInt(weth) ? pairedToken : weth;
      const token1 = token0 === pairedToken ? weth : pairedToken;
      const [
        venueOperator, venueGovernance, venuePairedToken, venueWeth, venueFactory, venuePool, venueManager,
        governanceSigner, signerCount, threshold, executionDelay, executionWindow,
        pairedSupply, pairedRecipient, wethSupply, wethRecipient,
        factoryPool, factoryToken0, factoryToken1, forwardPool, reversePool, feeSpacing,
        poolFactory, poolToken0, poolToken1, poolFee, poolTickSpacing,
        managerFactory, managerWeth, managerPool, managerToken0, managerToken1
      ] = await Promise.all([
        readVenueAddress(venue, "operator", verificationBlock),
        readVenueAddress(venue, "governance", verificationBlock),
        readVenueAddress(venue, "pairedToken", verificationBlock),
        readVenueAddress(venue, "weth", verificationBlock),
        readVenueAddress(venue, "factory", verificationBlock),
        readVenueAddress(venue, "pool", verificationBlock),
        readVenueAddress(venue, "positionManager", verificationBlock),
        publicClient.readContract({ address: governance, abi: governanceReadAbi, functionName: "isSigner", args: [expectedOperator], blockNumber: verificationBlock }),
        publicClient.readContract({ address: governance, abi: governanceReadAbi, functionName: "signerCount", blockNumber: verificationBlock }),
        publicClient.readContract({ address: governance, abi: governanceReadAbi, functionName: "threshold", blockNumber: verificationBlock }),
        publicClient.readContract({ address: governance, abi: governanceReadAbi, functionName: "executionDelay", blockNumber: verificationBlock }),
        publicClient.readContract({ address: governance, abi: governanceReadAbi, functionName: "executionWindow", blockNumber: verificationBlock }),
        publicClient.readContract({ address: pairedToken, abi: tokenReadAbi, functionName: "totalSupply", blockNumber: verificationBlock }),
        publicClient.readContract({ address: pairedToken, abi: tokenReadAbi, functionName: "initialRecipient", blockNumber: verificationBlock }),
        publicClient.readContract({ address: weth, abi: tokenReadAbi, functionName: "totalSupply", blockNumber: verificationBlock }),
        publicClient.readContract({ address: weth, abi: tokenReadAbi, functionName: "initialRecipient", blockNumber: verificationBlock }),
        publicClient.readContract({ address: factory, abi: factoryReadAbi, functionName: "pool", blockNumber: verificationBlock }),
        publicClient.readContract({ address: factory, abi: factoryReadAbi, functionName: "token0", blockNumber: verificationBlock }),
        publicClient.readContract({ address: factory, abi: factoryReadAbi, functionName: "token1", blockNumber: verificationBlock }),
        publicClient.readContract({ address: factory, abi: factoryReadAbi, functionName: "getPool", args: [token0, token1, POOL_FEE], blockNumber: verificationBlock }),
        publicClient.readContract({ address: factory, abi: factoryReadAbi, functionName: "getPool", args: [token1, token0, POOL_FEE], blockNumber: verificationBlock }),
        publicClient.readContract({ address: factory, abi: factoryReadAbi, functionName: "feeAmountTickSpacing", args: [POOL_FEE], blockNumber: verificationBlock }),
        publicClient.readContract({ address: pool, abi: poolReadAbi, functionName: "factory", blockNumber: verificationBlock }),
        publicClient.readContract({ address: pool, abi: poolReadAbi, functionName: "token0", blockNumber: verificationBlock }),
        publicClient.readContract({ address: pool, abi: poolReadAbi, functionName: "token1", blockNumber: verificationBlock }),
        publicClient.readContract({ address: pool, abi: poolReadAbi, functionName: "fee", blockNumber: verificationBlock }),
        publicClient.readContract({ address: pool, abi: poolReadAbi, functionName: "tickSpacing", blockNumber: verificationBlock }),
        publicClient.readContract({ address: positionManager, abi: managerReadAbi, functionName: "factory", blockNumber: verificationBlock }),
        publicClient.readContract({ address: positionManager, abi: managerReadAbi, functionName: "WETH9", blockNumber: verificationBlock }),
        publicClient.readContract({ address: positionManager, abi: managerReadAbi, functionName: "pool", blockNumber: verificationBlock }),
        publicClient.readContract({ address: positionManager, abi: managerReadAbi, functionName: "token0", blockNumber: verificationBlock }),
        publicClient.readContract({ address: positionManager, abi: managerReadAbi, functionName: "token1", blockNumber: verificationBlock })
      ]);
      if (
        venueOperator !== expectedOperator || venueGovernance !== governance || venuePairedToken !== pairedToken
        || venueWeth !== weth || venueFactory !== factory || venuePool !== pool || venueManager !== positionManager
        || governanceSigner !== true || signerCount !== 1n || threshold !== 1n
        || executionDelay !== 86_400n || executionWindow !== 604_800n
        || pairedSupply !== PAIRED_TOKEN_FIXED_SUPPLY || getAddress(pairedRecipient) !== expectedOperator
        || wethSupply !== WETH_FIXED_SUPPLY || getAddress(wethRecipient) !== expectedOperator
        || getAddress(factoryPool) !== pool || getAddress(factoryToken0) !== token0 || getAddress(factoryToken1) !== token1
        || getAddress(forwardPool) !== pool || getAddress(reversePool) !== pool || feeSpacing !== TICK_SPACING
        || getAddress(poolFactory) !== factory || getAddress(poolToken0) !== token0 || getAddress(poolToken1) !== token1
        || poolFee !== POOL_FEE || poolTickSpacing !== TICK_SPACING
        || getAddress(managerFactory) !== factory || getAddress(managerWeth) !== weth || getAddress(managerPool) !== pool
        || getAddress(managerToken0) !== token0 || getAddress(managerToken1) !== token1
      ) throw new Error("The venue, governance, token, pool, or manager topology failed independent verification.");

      const [
        paused, destinationChainId, migratorGovernance, guardian, liquiditySession,
        migratorWeth, migratorPaired, migratorManager, migratorFactory, migratorPool, migratorPoolFee, migratorTickSpacing,
        configurationHash, migrationTermsHash, termsDocumentHash,
        sessionRouter, sessionPaired, sessionWeth, sessionToken0, sessionToken1, sessionManager, sessionPoolFee,
        sessionPairedIsToken0
      ] = await Promise.all([
        publicClient.readContract({ address: migrator, abi: migratorReadAbi, functionName: "paused", blockNumber: verificationBlock }),
        publicClient.readContract({ address: migrator, abi: migratorReadAbi, functionName: "destinationChainId", blockNumber: verificationBlock }),
        publicClient.readContract({ address: migrator, abi: migratorReadAbi, functionName: "governance", blockNumber: verificationBlock }),
        publicClient.readContract({ address: migrator, abi: migratorReadAbi, functionName: "guardian", blockNumber: verificationBlock }),
        publicClient.readContract({ address: migrator, abi: migratorReadAbi, functionName: "liquiditySession", blockNumber: verificationBlock }),
        publicClient.readContract({ address: migrator, abi: migratorReadAbi, functionName: "weth", blockNumber: verificationBlock }),
        publicClient.readContract({ address: migrator, abi: migratorReadAbi, functionName: "pairedToken", blockNumber: verificationBlock }),
        publicClient.readContract({ address: migrator, abi: migratorReadAbi, functionName: "positionManager", blockNumber: verificationBlock }),
        publicClient.readContract({ address: migrator, abi: migratorReadAbi, functionName: "sushiFactory", blockNumber: verificationBlock }),
        publicClient.readContract({ address: migrator, abi: migratorReadAbi, functionName: "sushiPool", blockNumber: verificationBlock }),
        publicClient.readContract({ address: migrator, abi: migratorReadAbi, functionName: "poolFee", blockNumber: verificationBlock }),
        publicClient.readContract({ address: migrator, abi: migratorReadAbi, functionName: "poolTickSpacing", blockNumber: verificationBlock }),
        publicClient.readContract({ address: migrator, abi: migratorReadAbi, functionName: "configurationHash", blockNumber: verificationBlock }),
        publicClient.readContract({ address: migrator, abi: migratorReadAbi, functionName: "migrationTermsHash", blockNumber: verificationBlock }),
        publicClient.readContract({ address: migrator, abi: migratorReadAbi, functionName: "termsDocumentHash", blockNumber: verificationBlock }),
        publicClient.readContract({ address: session, abi: sessionReadAbi, functionName: "router", blockNumber: verificationBlock }),
        publicClient.readContract({ address: session, abi: sessionReadAbi, functionName: "pairedToken", blockNumber: verificationBlock }),
        publicClient.readContract({ address: session, abi: sessionReadAbi, functionName: "weth", blockNumber: verificationBlock }),
        publicClient.readContract({ address: session, abi: sessionReadAbi, functionName: "token0", blockNumber: verificationBlock }),
        publicClient.readContract({ address: session, abi: sessionReadAbi, functionName: "token1", blockNumber: verificationBlock }),
        publicClient.readContract({ address: session, abi: sessionReadAbi, functionName: "positionManager", blockNumber: verificationBlock }),
        publicClient.readContract({ address: session, abi: sessionReadAbi, functionName: "poolFee", blockNumber: verificationBlock }),
        publicClient.readContract({ address: session, abi: sessionReadAbi, functionName: "pairedTokenIsToken0", blockNumber: verificationBlock })
      ]);
      if (
        paused !== true || destinationChainId !== BigInt(robinhoodChainTestnet.id)
        || getAddress(migratorGovernance) !== governance || getAddress(guardian) !== expectedOperator
        || getAddress(liquiditySession) !== session || getAddress(sessionRouter) !== migrator
        || getAddress(migratorWeth) !== weth || getAddress(migratorPaired) !== pairedToken
        || getAddress(migratorManager) !== positionManager || getAddress(migratorFactory) !== factory
        || getAddress(migratorPool) !== pool || migratorPoolFee !== POOL_FEE || migratorTickSpacing !== TICK_SPACING
        || getAddress(sessionPaired) !== pairedToken || getAddress(sessionWeth) !== weth
        || getAddress(sessionToken0) !== token0 || getAddress(sessionToken1) !== token1
        || getAddress(sessionManager) !== positionManager || sessionPoolFee !== POOL_FEE
        || sessionPairedIsToken0 !== (pairedToken === token0)
        || String(termsDocumentHash).toLowerCase() !== EXPECTED_TERMS_DOCUMENT_HASH
      ) throw new Error("The paused router, session, governance, chain, or terms binding failed verification.");

      const codeBindings: Array<[Address, string]> = [
        [venue, "venueCodeHash"],
        [governance, "governanceCodeHash"],
        [pairedToken, "pairedTokenCodeHash"],
        [weth, "wethCodeHash"],
        [factory, "factoryCodeHash"],
        [pool, "poolCodeHash"],
        [positionManager, "positionManagerCodeHash"],
        [session, "sessionCodeHash"],
        [migrator, "migratorCodeHash"],
        [consentStack, "runtimeCodeHash"]
      ];
      const liveCodeHashes = new Map<string, Hex>();
      for (const [target, getter] of codeBindings) {
        const [code, expectedHash] = await Promise.all([
          publicClient.getBytecode({ address: target, blockNumber: verificationBlock }),
          readStackHash(consentStack, getter, verificationBlock)
        ]);
        if (!hasCode(code) || keccak256(code).toLowerCase() !== expectedHash.toLowerCase()) {
          throw new Error(`Runtime verification failed for ${getter.replace("CodeHash", "")}.`);
        }
        liveCodeHashes.set(getter, keccak256(code));
      }
      const venueSelfCodeHash = String(await publicClient.readContract({
        address: venue,
        abi: artifacts.venue.abi,
        functionName: "runtimeCodeHash",
        blockNumber: verificationBlock
      })) as Hex;
      if (venueSelfCodeHash.toLowerCase() !== liveCodeHashes.get("venueCodeHash")?.toLowerCase()) {
        throw new Error("The venue live runtime hash does not match its immutable manifest.");
      }

      const requiredLiveHash = (key: string) => {
        const value = liveCodeHashes.get(key);
        if (!value) throw new Error(`Missing independently verified runtime hash: ${key}.`);
        return value;
      };
      const independentConfigurationHash = keccak256(encodeAbiParameters(
        [
          { type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "address" },
          { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" },
          { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint24" },
          { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
          { type: "bytes32" }, { type: "bytes32" }
        ],
        [
          CONFIGURATION_TYPEHASH, migrator, BigInt(robinhoodChainTestnet.id), governance,
          expectedOperator, weth, pairedToken, positionManager, factory, pool, session, POOL_FEE,
          requiredLiveHash("positionManagerCodeHash"), requiredLiveHash("factoryCodeHash"),
          requiredLiveHash("poolCodeHash"), requiredLiveHash("sessionCodeHash"),
          requiredLiveHash("wethCodeHash"), requiredLiveHash("pairedTokenCodeHash")
        ]
      ));
      const independentMigrationTermsHash = keccak256(encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
        [TERMS_DOMAIN_TYPEHASH, independentConfigurationHash, EXPECTED_TERMS_DOCUMENT_HASH]
      ));
      const [stackConfigurationHash, stackMigrationTermsHash] = await Promise.all([
        readStackHash(consentStack, "configurationHash", verificationBlock),
        readStackHash(consentStack, "migrationTermsHash", verificationBlock)
      ]);
      if (
        stackConfigurationHash.toLowerCase() !== String(configurationHash).toLowerCase()
        || stackMigrationTermsHash.toLowerCase() !== String(migrationTermsHash).toLowerCase()
        || independentConfigurationHash.toLowerCase() !== stackConfigurationHash.toLowerCase()
        || independentMigrationTermsHash.toLowerCase() !== stackMigrationTermsHash.toLowerCase()
      ) throw new Error("The published configuration or terms hash does not match the router.");

      const [activeWalletChainId, activeWalletAddresses] = await Promise.all([
        walletClient.getChainId(),
        walletClient.getAddresses()
      ]);
      if (
        activeWalletChainId !== robinhoodChainTestnet.id || activeWalletAddresses.length === 0
        || getAddress(activeWalletAddresses[0]) !== expectedOperator
      ) throw new Error("The connected wallet or network changed during verification. Reconnect and verify again.");
      const currentlyPaused = await publicClient.readContract({
        address: migrator,
        abi: migratorReadAbi,
        functionName: "paused"
      });
      if (currentlyPaused !== true) throw new Error("The consent router is no longer paused. Stop and quarantine this deployment.");

      current.migrator = migrator;
      current.session = session;
      current.governance = governance;
      current.configurationHash = stackConfigurationHash;
      current.migrationTermsHash = stackMigrationTermsHash;
      current.verifiedBlock = verificationBlock.toString();
      persistCurrent();
      setBalance(await publicClient.getBalance({ address }));
      assertActiveRun();
      setRecordVerified(true);
      setStage("complete");
    } catch (cause) {
      if (runGeneration.current === runId) {
        setError(readableDeploymentError(cause));
        setStage("failed");
      }
    } finally {
      inFlight.current = false;
      setRunActive(false);
    }
  }

  function recoverTransactionEvidence() {
    if (!address || !approvedWallet || !correctChain || inFlight.current) return;
    const venueHash = recoveryVenueHash.trim();
    const consentHash = recoveryConsentHash.trim();
    if ((!venueHash && !consentHash) || (venueHash && !validHash(venueHash)) || (consentHash && !validHash(consentHash))) {
      setError("Enter one or two complete 0x transaction hashes from the reviewed CREATE2 deployments.");
      return;
    }
    const recovered: Deployment = { ...deployment };
    if (validHash(venueHash)) {
      recovered.venueTransaction = venueHash;
      recovered.venueAttempts = [...new Set([...(recovered.venueAttempts ?? []), venueHash])];
    }
    if (validHash(consentHash)) {
      recovered.consentTransaction = consentHash;
      recovered.consentAttempts = [...new Set([...(recovered.consentAttempts ?? []), consentHash])];
    }
    delete recovered.verifiedBlock;
    setRecordVerified(false);
    setDeployment(recovered);
    saveDeployment(address, recovered);
    setError(undefined);
    setStage("idle");
  }

  return (
    <section className="deployment-card">
      <div className={`deployment-status ${stage}`}><span className="status-dot" /><strong>{labels[stage]}</strong></div>
      <ol className="deployment-steps">{steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
      <div className="deployment-rules">
        <p><strong>Valueless test fixture:</strong> fixed test tokens and a minimal Sushi V3 ABI-compatible venue; not an official Sushi deployment or production AMM.</p>
        <p><strong>Starts paused:</strong> enabling later requires a separate 24-hour governance proposal and execution.</p>
        <p><strong>No public execution UI:</strong> this operator page only deploys and verifies the contracts.</p>
      </div>
      {address && <div className="deployment-addresses"><p><span>Connected wallet</span><code>{address}</code></p>{balance !== undefined && <p><span>Test ETH</span><code>{formatEther(balance)}</code></p>}</div>}
      {isConnected && address && !approvedWallet && <p className="deployment-error">This wallet is not approved for the testnet rehearsal deployment.</p>}
      {recordVerified && deployment.venue && <div className="deployment-addresses">
        <p><span>Venue</span><a href={explorerAddress(deployment.venue)} target="_blank" rel="noreferrer"><code>{short(deployment.venue)}</code></a></p>
        {deployment.consentStack && <p><span>Consent stack</span><a href={explorerAddress(deployment.consentStack)} target="_blank" rel="noreferrer"><code>{short(deployment.consentStack)}</code></a></p>}
        {deployment.migrator && <p><span>Paused router</span><a href={explorerAddress(deployment.migrator)} target="_blank" rel="noreferrer"><code>{short(deployment.migrator)}</code></a></p>}
        {deployment.session && <p><span>Accounting session</span><a href={explorerAddress(deployment.session)} target="_blank" rel="noreferrer"><code>{short(deployment.session)}</code></a></p>}
        {deployment.governance && <p><span>Governance</span><a href={explorerAddress(deployment.governance)} target="_blank" rel="noreferrer"><code>{short(deployment.governance)}</code></a></p>}
      </div>}
      {error && <p className="deployment-error">{error}</p>}
      <div className="deployment-recovery">
        <div>
          <strong>Recover reviewed transaction evidence</strong>
          <span>If this browser lost its local record, paste the mined CREATE2 transaction hash or hashes. Recovery never sends a transaction; the normal verifier must still prove every binding.</span>
        </div>
        <div className="deployment-recovery-fields">
          <input value={recoveryVenueHash} onChange={(event) => setRecoveryVenueHash(event.target.value)} aria-label="Venue deployment transaction hash" placeholder="Venue transaction hash" spellCheck={false} />
          <input value={recoveryConsentHash} onChange={(event) => setRecoveryConsentHash(event.target.value)} aria-label="Consent-stack deployment transaction hash" placeholder="Consent transaction hash" spellCheck={false} />
          <button type="button" onClick={recoverTransactionEvidence} disabled={!address || !approvedWallet || !correctChain || busy}>Recover and verify</button>
        </div>
      </div>
      {stage === "complete" ? (
        <button className="deploy-stack-button" disabled>Deployment verified · remains paused</button>
      ) : (
        <button className="deploy-stack-button" disabled={!canStart} onClick={deploy}>
          {!isConnected ? "Connect wallet above" : !approvedWallet ? "Switch to approved test wallet" : !correctChain ? "Switch to Robinhood Chain Testnet above" : busy ? "Waiting for wallet approval…" : deployment.venueTransaction ? "Resume safe deployment" : "Deploy paused testnet rehearsal"}
        </button>
      )}
      <p className="deployment-safety">Your wallet shows both testnet contract creations before approval. Never enter a private key or recovery phrase. Never send real assets to these addresses.</p>
    </section>
  );
}
