import {
  VNEXT_EXECUTION_SCHEMA_VERSION,
  assertTradeIntent,
  chainKey,
  type AssetMetadata,
  type TradeIntent,
  type WalletAccount
} from "./execution-domain";

export type TradeSide = "buy" | "sell";
export const NATIVE_GAS_RESERVE_ATOMIC = 100_000_000_000_000n;

export function spendableNativeAtomic(balance: bigint | undefined) {
  if (balance === undefined) return undefined;
  return balance > NATIVE_GAS_RESERVE_ATOMIC ? balance - NATIVE_GAS_RESERVE_ATOMIC : 0n;
}

function requireVerifiedAsset(asset: AssetMetadata, label: string) {
  if (asset.metadataState !== "verified" || asset.decimals === null) {
    throw new Error(`${label} requires verified identity and decimals.`);
  }
  return asset.decimals;
}

export function decimalToAtomic(value: string, decimals: number) {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("Asset decimals are invalid.");
  }
  const normalized = value.trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(normalized);
  if (!match) throw new Error("Enter a positive amount using digits and one decimal point.");
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) throw new Error(`Amount supports at most ${decimals} decimal places.`);
  const atomic = BigInt(match[1]) * (10n ** BigInt(decimals))
    + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (atomic <= 0n) throw new Error("Amount must be greater than zero.");
  return atomic.toString();
}

export function percentageOfAtomic(balanceAtomic: string, basisPoints: number) {
  if (!/^(0|[1-9][0-9]*)$/.test(balanceAtomic)) throw new Error("Confirmed balance must be an unsigned atomic amount.");
  if (!Number.isSafeInteger(basisPoints) || basisPoints <= 0 || basisPoints > 10_000) {
    throw new Error("Balance percentage must be between 1 and 10,000 basis points.");
  }
  const amount = BigInt(balanceAtomic) * BigInt(basisPoints) / 10_000n;
  if (amount <= 0n) throw new Error("Confirmed balance is too small for this percentage.");
  return amount.toString();
}

export function affordableDefaultAmount(balanceAtomic: string, decimals: number, desiredAmount: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(balanceAtomic)) throw new Error("Confirmed balance must be an unsigned atomic amount.");
  const balance = BigInt(balanceAtomic);
  if (balance === 0n) return "";
  const desired = BigInt(decimalToAtomic(desiredAmount, decimals));
  const selected = balance < desired ? balance : desired;
  const scale = 10n ** BigInt(decimals);
  const whole = selected / scale;
  const fraction = (selected % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function assetsForSide(side: TradeSide, marketAsset: AssetMetadata, settlementAsset: AssetMetadata) {
  return side === "buy"
    ? { inputAsset: settlementAsset, outputAsset: marketAsset }
    : { inputAsset: marketAsset, outputAsset: settlementAsset };
}

export function createExactInputIntent(input: {
  intentId: string;
  sourceAccount: WalletAccount;
  recipient: WalletAccount;
  inputAsset: AssetMetadata;
  outputAsset: AssetMetadata;
  amount: string;
  requestedAtMs: number;
}): TradeIntent {
  const inputDecimals = requireVerifiedAsset(input.inputAsset, "Input asset");
  requireVerifiedAsset(input.outputAsset, "Output asset");
  if (chainKey(input.sourceAccount.chain) !== chainKey(input.inputAsset.id.chain)) {
    throw new Error("Source wallet and input asset are on different chains.");
  }
  if (chainKey(input.recipient.chain) !== chainKey(input.outputAsset.id.chain)) {
    throw new Error("Recipient and output asset are on different chains.");
  }
  const intent: TradeIntent = {
    schemaVersion: VNEXT_EXECUTION_SCHEMA_VERSION,
    intentId: input.intentId,
    sourceAccount: input.sourceAccount,
    inputAsset: input.inputAsset.id,
    outputAsset: input.outputAsset.id,
    amountAtomic: decimalToAtomic(input.amount, inputDecimals),
    tradeType: "exact_input",
    recipient: input.recipient,
    preference: "recommended",
    requestedAtMs: input.requestedAtMs
  };
  assertTradeIntent(intent);
  return intent;
}
