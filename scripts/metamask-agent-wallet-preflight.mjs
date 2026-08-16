#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ROBINHOOD_MAINNET_CHAIN_ID = 4_663;
const ROBINHOOD_TESTNET_CHAIN_ID = 46_630;
const KNOWN_CHAIN_FEATURES = new Set(["swap", "predict", "perps"]);
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const VERSION_PATTERN = /@metamask\/agent-wallet\/(\d+\.\d+\.\d+)/u;

// This allowlist is deliberately read-only. State-changing commands do not
// belong in this preflight.
export const READ_ONLY_MM_COMMANDS = Object.freeze({
  version: Object.freeze(["--version"]),
  doctor: Object.freeze(["doctor", "--json"]),
  chains: Object.freeze(["chains", "list", "--json"]),
  init: Object.freeze(["init", "show", "--json"]),
  address: Object.freeze(["wallet", "address", "--json"]),
  tradingMode: Object.freeze(["wallet", "trading-mode", "get", "--json"]),
  policy: Object.freeze(["wallet", "policy", "get", "--json"]),
  policyTemplate: Object.freeze(["wallet", "policy", "template", "--json"])
});

export function systemMmRunner(args) {
  const result = spawnSync("mm", args, {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20_000
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    errorCode: result.error && typeof result.error === "object" && "code" in result.error
      ? String(result.error.code)
      : null
  };
}

function jsonResult(run, args) {
  const command = run(args);
  if (command.errorCode === "ENOENT") return { data: null, error: "CLI_NOT_FOUND" };
  let envelope;
  try {
    envelope = JSON.parse(command.stdout);
  } catch {
    return { data: null, error: "MALFORMED_JSON" };
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || typeof envelope.ok !== "boolean") {
    return { data: null, error: "INVALID_ENVELOPE" };
  }
  if (!envelope.ok) {
    const code = envelope.error && typeof envelope.error === "object" && typeof envelope.error.code === "string"
      ? envelope.error.code
      : "COMMAND_FAILED";
    return { data: null, error: code };
  }
  if (command.status !== 0) return { data: null, error: "NONZERO_EXIT" };
  if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
    return { data: null, error: "INVALID_DATA" };
  }
  return { data: envelope.data, error: null };
}

function unavailableChain(chainId) {
  return {
    present: null,
    canonicalName: null,
    chainId,
    caip2: `eip155:${chainId}`,
    relaySupported: null,
    features: null,
    swapAdvertised: null,
    unknownFeatures: [],
    schemaValid: null
  };
}

function summarizeChain(chains, chainId, warnings) {
  if (!chains) return unavailableChain(chainId);
  const matches = chains.filter((candidate) => candidate && typeof candidate === "object" && candidate.chainId === chainId);
  if (matches.length === 0) return { ...unavailableChain(chainId), present: false, schemaValid: true };
  if (matches.length !== 1) {
    warnings.push(`DUPLICATE_CHAIN_${chainId}`);
    return { ...unavailableChain(chainId), present: true, schemaValid: false };
  }
  const candidate = matches[0];
  const expectedCaip2 = `eip155:${chainId}`;
  const canonicalName = typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : null;
  const caip2 = typeof candidate.caip2 === "string" ? candidate.caip2 : null;
  const namespaceValid = candidate.chainNamespace === "eip155";
  const featuresValid = Array.isArray(candidate.features) && candidate.features.every((feature) => typeof feature === "string");
  const features = featuresValid ? [...new Set(candidate.features)].sort() : null;
  const unknownFeatures = features?.filter((feature) => !KNOWN_CHAIN_FEATURES.has(feature)) ?? [];
  const relaySupported = candidate.relaySupported === undefined
    ? null
    : typeof candidate.relaySupported === "boolean" ? candidate.relaySupported : null;
  if (!canonicalName) warnings.push(`CHAIN_${chainId}_NAME_INVALID`);
  if (caip2 !== expectedCaip2) warnings.push(`CHAIN_${chainId}_CAIP2_INVALID`);
  if (!namespaceValid) warnings.push(`CHAIN_${chainId}_NAMESPACE_INVALID`);
  if (!featuresValid) warnings.push(`CHAIN_${chainId}_FEATURES_INVALID`);
  if (candidate.relaySupported !== undefined && relaySupported === null) warnings.push(`CHAIN_${chainId}_RELAY_INVALID`);
  if (unknownFeatures.length > 0) warnings.push(`CHAIN_${chainId}_UNKNOWN_FEATURES`);
  const schemaValid = Boolean(
    canonicalName
    && caip2 === expectedCaip2
    && namespaceValid
    && featuresValid
    && (candidate.relaySupported === undefined || relaySupported !== null)
    && unknownFeatures.length === 0
  );
  return {
    present: true,
    canonicalName,
    chainId,
    caip2: caip2 ?? expectedCaip2,
    relaySupported,
    features,
    swapAdvertised: features ? features.includes("swap") : null,
    unknownFeatures,
    schemaValid
  };
}

function validMode(value, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}

function walletEvidence(run, warnings) {
  const init = jsonResult(run, READ_ONLY_MM_COMMANDS.init);
  const address = jsonResult(run, READ_ONLY_MM_COMMANDS.address);
  const trading = jsonResult(run, READ_ONLY_MM_COMMANDS.tradingMode);
  const policy = jsonResult(run, READ_ONLY_MM_COMMANDS.policy);
  const policyTemplate = jsonResult(run, READ_ONLY_MM_COMMANDS.policyTemplate);
  const walletMode = validMode(init.data?.walletMode, ["server-wallet", "byok"]);
  const initTradingMode = validMode(init.data?.tradingMode, ["guard", "beast"]);
  const tradingMode = validMode(trading.data?.mode, ["guard", "beast"]);
  const walletAddress = typeof address.data?.address === "string" && ADDRESS_PATTERN.test(address.data.address)
    ? address.data.address
    : null;
  const tradingAddress = typeof trading.data?.address === "string" && ADDRESS_PATTERN.test(trading.data.address)
    ? trading.data.address
    : null;
  if (!walletMode) warnings.push("WALLET_MODE_INVALID");
  if (!walletAddress) warnings.push("WALLET_ADDRESS_INVALID");
  if (!tradingMode) warnings.push("TRADING_MODE_INVALID");
  if (initTradingMode && tradingMode && initTradingMode !== tradingMode) warnings.push("TRADING_MODE_MISMATCH");
  if (walletAddress && tradingAddress && walletAddress.toLowerCase() !== tradingAddress.toLowerCase()) {
    warnings.push("TRADING_WALLET_MISMATCH");
  }
  return {
    walletMode,
    walletAddress,
    tradingMode,
    guardModeActive: walletMode === "server-wallet" && tradingMode === "guard",
    beastModeDetected: tradingMode === "beast",
    policyReadable: policy.error === null && policy.data?.policy !== undefined,
    policyTemplateReadable: policyTemplate.error === null && typeof policyTemplate.data?.policyYaml === "string"
      && policyTemplate.data.policyYaml.trim().length > 0,
    commandErrors: {
      init: init.error,
      address: address.error,
      tradingMode: trading.error,
      policy: policy.error,
      policyTemplate: policyTemplate.error
    }
  };
}

export function inspectMetaMaskAgentWallet(run = systemMmRunner) {
  const warnings = [];
  const versionCommand = run(READ_ONLY_MM_COMMANDS.version);
  const versionMatch = typeof versionCommand.stdout === "string" ? versionCommand.stdout.match(VERSION_PATTERN) : null;
  const cliInstalled = versionCommand.errorCode !== "ENOENT" && versionCommand.status === 0 && versionMatch !== null;
  const cliVersion = versionMatch?.[1] ?? null;
  const doctor = cliInstalled ? jsonResult(run, READ_ONLY_MM_COMMANDS.doctor) : { data: null, error: "CLI_NOT_FOUND" };
  const doctorData = doctor.data;
  const doctorHealthy = doctor.error === null && typeof doctorData?.cli === "string";
  const skill = doctorData?.recommendedSkills && typeof doctorData.recommendedSkills === "object"
    ? doctorData.recommendedSkills["metamask-agent-wallet"]
    : null;
  const skillFound = skill?.found === true;
  const skillsCompatible = doctorData?.compatible === true && skillFound;
  const authenticated = typeof doctorData?.authenticated === "boolean" ? doctorData.authenticated : null;
  const initialized = typeof doctorData?.initialized === "boolean" ? doctorData.initialized : null;

  let chains = null;
  let chainsError = authenticated === true && initialized === true ? null : "AUTH_OR_INIT_REQUIRED";
  if (authenticated === true && initialized === true) {
    const chainResult = jsonResult(run, READ_ONLY_MM_COMMANDS.chains);
    chainsError = chainResult.error;
    if (chainResult.error === null && Array.isArray(chainResult.data?.chains)) chains = chainResult.data.chains;
    else if (chainResult.error === null) chainsError = "INVALID_CHAIN_LIST";
  }
  const robinhoodMainnet = summarizeChain(chains, ROBINHOOD_MAINNET_CHAIN_ID, warnings);
  const robinhoodTestnet = summarizeChain(chains, ROBINHOOD_TESTNET_CHAIN_ID, warnings);

  const wallet = authenticated === true && initialized === true
    ? walletEvidence(run, warnings)
    : {
      walletMode: null,
      walletAddress: null,
      tradingMode: null,
      guardModeActive: false,
      beastModeDetected: false,
      policyReadable: false,
      policyTemplateReadable: false,
      commandErrors: null
    };

  const transactionPrerequisitesMet = Boolean(
    cliInstalled
    && doctorHealthy
    && skillsCompatible
    && authenticated
    && initialized
    && robinhoodMainnet.present === true
    && robinhoodMainnet.schemaValid === true
    && robinhoodTestnet.present === true
    && robinhoodTestnet.schemaValid === true
    && wallet.walletMode === "server-wallet"
    && wallet.guardModeActive
    && wallet.walletAddress
    && wallet.policyReadable
    && wallet.policyTemplateReadable
    && warnings.length === 0
  );
  const blockers = [];
  if (!cliInstalled) blockers.push("CLI_NOT_INSTALLED");
  if (!doctorHealthy) blockers.push("DOCTOR_UNHEALTHY");
  if (!skillsCompatible) blockers.push("SKILL_INCOMPATIBLE");
  if (authenticated !== true) blockers.push("AUTHENTICATION_REQUIRED");
  if (initialized !== true) blockers.push("INITIALIZATION_REQUIRED");
  if (robinhoodMainnet.present !== true) blockers.push("ROBINHOOD_MAINNET_UNVERIFIED");
  if (robinhoodTestnet.present !== true) blockers.push("ROBINHOOD_TESTNET_UNVERIFIED");
  if (!wallet.guardModeActive) blockers.push("GUARD_MODE_UNVERIFIED");
  if (!wallet.policyReadable || !wallet.policyTemplateReadable) blockers.push("POLICY_UNVERIFIED");
  blockers.push("TRANSACTION_CAPABILITY_NOT_AUTHORIZED");

  return {
    schemaVersion: 1,
    cliInstalled,
    cliVersion,
    doctorHealthy,
    doctorError: doctor.error,
    skillFound,
    skillVersion: typeof skill?.version === "string" ? skill.version : null,
    skillCliVersion: typeof skill?.cliVersion === "string" ? skill.cliVersion : null,
    skillsCompatible,
    authenticated,
    initialized,
    chainsError,
    robinhoodMainnet,
    robinhoodTestnet,
    walletMode: wallet.walletMode,
    walletAddress: wallet.walletAddress,
    tradingMode: wallet.tradingMode,
    guardModeActive: wallet.guardModeActive,
    beastModeDetected: wallet.beastModeDetected,
    policyReadable: wallet.policyReadable,
    policyTemplateReadable: wallet.policyTemplateReadable,
    walletCommandErrors: wallet.commandErrors,
    safeForReadOnlyAgentUse: cliInstalled && doctorHealthy && skillsCompatible,
    readOnlyWalletQueriesAvailable: authenticated === true && initialized === true,
    transactionPrerequisitesMet,
    transactionUseAuthorized: false,
    safeForTransactionUse: false,
    warnings,
    blockers
  };
}

function main() {
  const result = inspectMetaMaskAgentWallet();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.safeForReadOnlyAgentUse) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
