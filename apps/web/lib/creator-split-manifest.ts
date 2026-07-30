import {
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  isAddress,
  keccak256,
  zeroAddress,
  type Address,
  type Hex
} from "viem";

export const CREATOR_SPLIT_MANIFEST_SCHEMA_VERSION = 1 as const;
export const CREATOR_SPLIT_BPS_DENOMINATOR = 10_000;
export const MAXIMUM_CREATOR_SPLIT_RECIPIENTS = 32;
export const MAXIMUM_CREATOR_SPLIT_CONSENT_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;

export type CreatorSplitRecipientInput = {
  recipient: Address;
  shareBps: number;
  recoveryAddress?: Address;
};

export type CreatorSplitConsentTypedData = {
  domain: {
    name: "RMT V7 Consent Bound Split";
    version: "1";
    chainId: number;
    verifyingContract: Address;
  };
  types: {
    SplitConsent: readonly [
      { readonly name: "releaseRegistry"; readonly type: "address" },
      { readonly name: "releaseId"; readonly type: "bytes32" },
      { readonly name: "creator"; readonly type: "address" },
      { readonly name: "module"; readonly type: "address" },
      { readonly name: "configurationHash"; readonly type: "bytes32" },
      { readonly name: "payoutManifestHash"; readonly type: "bytes32" },
      { readonly name: "recipient"; readonly type: "address" },
      { readonly name: "shareBps"; readonly type: "uint16" },
      { readonly name: "recoveryAddress"; readonly type: "address" },
      { readonly name: "consentDeadline"; readonly type: "uint64" }
    ];
  };
  primaryType: "SplitConsent";
  message: {
    releaseRegistry: Address;
    releaseId: Hex;
    creator: Address;
    module: Address;
    configurationHash: Hex;
    payoutManifestHash: Hex;
    recipient: Address;
    shareBps: number;
    recoveryAddress: Address;
    consentDeadline: bigint;
  };
};

const splitConsentTypes = {
  SplitConsent: [
    { name: "releaseRegistry", type: "address" },
    { name: "releaseId", type: "bytes32" },
    { name: "creator", type: "address" },
    { name: "module", type: "address" },
    { name: "configurationHash", type: "bytes32" },
    { name: "payoutManifestHash", type: "bytes32" },
    { name: "recipient", type: "address" },
    { name: "shareBps", type: "uint16" },
    { name: "recoveryAddress", type: "address" },
    { name: "consentDeadline", type: "uint64" }
  ]
} as const;

function cleanAddress(value: unknown, field: string, allowZero = false): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new Error(`${field} must be an EVM address.`);
  }
  const cleaned = getAddress(value);
  if (!allowZero && cleaned === zeroAddress) throw new Error(`${field} cannot be zero.`);
  return cleaned;
}

function cleanBytes32(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${field} must be a 32-byte hash.`);
  }
  const cleaned = value.toLowerCase() as Hex;
  if (cleaned === ZERO_BYTES32) throw new Error(`${field} cannot be zero.`);
  return cleaned;
}

function cleanChainId(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error("Split consent chain is invalid.");
  }
  return value as number;
}

function cleanTimestamp(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${field} is invalid.`);
  }
  return value as number;
}

export function hashCreatorSplitConfig(config: {
  recipients: Address[];
  sharesBps: number[];
  recoveryAddresses: Address[];
  consentDeadline: number;
}) {
  const payoutManifestHash = keccak256(encodeAbiParameters(
    [{ type: "address[]" }, { type: "uint16[]" }],
    [config.recipients, config.sharesBps]
  ));
  const consentManifestHash = keccak256(encodeAbiParameters(
    [{ type: "address[]" }, { type: "uint16[]" }, { type: "address[]" }, { type: "uint64" }],
    [
      config.recipients,
      config.sharesBps,
      config.recoveryAddresses,
      BigInt(config.consentDeadline)
    ]
  ));
  const configurationHash = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }, { type: "uint256" }],
    [
      payoutManifestHash,
      consentManifestHash,
      BigInt(config.consentDeadline),
      BigInt(config.recipients.length)
    ]
  ));
  return { configurationHash, payoutManifestHash, consentManifestHash };
}

export function creatorSplitConsentTypedData(input: {
  chainId: number;
  releaseRegistry: Address;
  releaseId: Hex;
  creator: Address;
  module: Address;
  configurationHash: Hex;
  payoutManifestHash: Hex;
  recipient: Address;
  shareBps: number;
  recoveryAddress: Address;
  consentDeadline: number;
}): CreatorSplitConsentTypedData {
  return {
    domain: {
      name: "RMT V7 Consent Bound Split",
      version: "1",
      chainId: cleanChainId(input.chainId),
      verifyingContract: cleanAddress(input.module, "Split module")
    },
    types: splitConsentTypes,
    primaryType: "SplitConsent",
    message: {
      releaseRegistry: cleanAddress(input.releaseRegistry, "Release registry"),
      releaseId: cleanBytes32(input.releaseId, "Release ID"),
      creator: cleanAddress(input.creator, "Release creator"),
      module: cleanAddress(input.module, "Split module"),
      configurationHash: cleanBytes32(input.configurationHash, "Split configuration hash"),
      payoutManifestHash: cleanBytes32(input.payoutManifestHash, "Payout manifest hash"),
      recipient: cleanAddress(input.recipient, "Split recipient"),
      shareBps: input.shareBps,
      recoveryAddress: cleanAddress(input.recoveryAddress, "Recovery address", true),
      consentDeadline: BigInt(cleanTimestamp(input.consentDeadline, "Consent deadline"))
    }
  };
}

export function buildCreatorSplitManifest(input: {
  chainId: number;
  releaseRegistry: Address;
  releaseId: Hex;
  creator: Address;
  module: Address;
  currentTimestamp: number;
  consentDeadline: number;
  recipients: readonly CreatorSplitRecipientInput[];
}) {
  const chainId = cleanChainId(input.chainId);
  const releaseRegistry = cleanAddress(input.releaseRegistry, "Release registry");
  const releaseId = cleanBytes32(input.releaseId, "Release ID");
  const creator = cleanAddress(input.creator, "Release creator");
  const module = cleanAddress(input.module, "Split module");
  const currentTimestamp = cleanTimestamp(input.currentTimestamp, "Current timestamp");
  const consentDeadline = cleanTimestamp(input.consentDeadline, "Consent deadline");
  if (
    consentDeadline <= currentTimestamp
    || consentDeadline > currentTimestamp + MAXIMUM_CREATOR_SPLIT_CONSENT_LIFETIME_SECONDS
  ) throw new Error("Split consent deadline must be within the next 30 days.");
  if (
    input.recipients.length === 0
    || input.recipients.length > MAXIMUM_CREATOR_SPLIT_RECIPIENTS
  ) throw new Error("Split recipient count is invalid.");

  let totalShareBps = 0;
  const seen = new Set<string>();
  const entries = input.recipients.map((entry) => {
    const recipient = cleanAddress(entry.recipient, "Split recipient");
    const recipientKey = recipient.toLowerCase();
    if (seen.has(recipientKey)) throw new Error("Split recipients must be unique.");
    seen.add(recipientKey);
    if (
      !Number.isSafeInteger(entry.shareBps)
      || entry.shareBps < 1
      || entry.shareBps > CREATOR_SPLIT_BPS_DENOMINATOR
    ) throw new Error("Split share is invalid.");
    totalShareBps += entry.shareBps;
    return {
      recipient,
      shareBps: entry.shareBps,
      recoveryAddress: cleanAddress(
        entry.recoveryAddress ?? zeroAddress,
        "Recovery address",
        true
      )
    };
  }).sort((left, right) => (
    left.recipient.toLowerCase() < right.recipient.toLowerCase() ? -1 : 1
  ));
  if (totalShareBps !== CREATOR_SPLIT_BPS_DENOMINATOR) {
    throw new Error("Split shares must total exactly 100%.");
  }

  const config = {
    recipients: entries.map((entry) => entry.recipient),
    sharesBps: entries.map((entry) => entry.shareBps),
    recoveryAddresses: entries.map((entry) => entry.recoveryAddress),
    consentDeadline
  };
  const hashes = hashCreatorSplitConfig(config);
  const consentRequests = entries.map((entry) => {
    const typedData = creatorSplitConsentTypedData({
      chainId,
      releaseRegistry,
      releaseId,
      creator,
      module,
      configurationHash: hashes.configurationHash,
      payoutManifestHash: hashes.payoutManifestHash,
      recipient: entry.recipient,
      shareBps: entry.shareBps,
      recoveryAddress: entry.recoveryAddress,
      consentDeadline
    });
    return {
      recipient: entry.recipient,
      shareBps: entry.shareBps,
      recoveryAddress: entry.recoveryAddress,
      typedData,
      digest: hashTypedData(typedData),
      signature: null,
      status: "unsigned" as const
    };
  });

  return {
    schemaVersion: CREATOR_SPLIT_MANIFEST_SCHEMA_VERSION,
    chainId,
    releaseRegistry,
    releaseId,
    creator,
    module,
    config,
    ...hashes,
    consentRequests,
    totalShareBps,
    contractExecution: "disabled" as const
  };
}
