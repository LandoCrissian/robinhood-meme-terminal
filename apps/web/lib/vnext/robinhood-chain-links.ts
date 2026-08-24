import { getAddress, isAddress, isHash, zeroAddress } from "viem";

export const ROBINHOOD_CHAIN_EXPLORER_ORIGIN = "https://robinhoodchain.blockscout.com";

export function canonicalRobinhoodAddress(value: string) {
  if (!isAddress(value, { strict: false })) throw new Error("Invalid Robinhood Chain address.");
  const address = getAddress(value);
  if (address === zeroAddress) throw new Error("Robinhood Chain links cannot target the zero address.");
  return address;
}

export function canonicalRobinhoodTransactionHash(value: string) {
  if (!isHash(value) || /^0x0{64}$/i.test(value)) throw new Error("Invalid Robinhood Chain transaction hash.");
  return value.toLowerCase();
}

export function robinhoodExplorerToken(address: string) {
  return `${ROBINHOOD_CHAIN_EXPLORER_ORIGIN}/token/${canonicalRobinhoodAddress(address)}`;
}

export function robinhoodExplorerAddress(address: string) {
  return `${ROBINHOOD_CHAIN_EXPLORER_ORIGIN}/address/${canonicalRobinhoodAddress(address)}`;
}

export const robinhoodExplorerPool = robinhoodExplorerAddress;

export function robinhoodExplorerTransaction(hash: string) {
  return `${ROBINHOOD_CHAIN_EXPLORER_ORIGIN}/tx/${canonicalRobinhoodTransactionHash(hash)}`;
}

export function robinhoodExplorerBlock(value: bigint | number | string) {
  const text = typeof value === "string" ? value.trim() : String(value);
  if (!/^(?:0|[1-9][0-9]*)$/.test(text)) throw new Error("Invalid Robinhood Chain block number.");
  const block = BigInt(text);
  if (block > BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000n) throw new Error("Robinhood Chain block number is unreasonable.");
  return `${ROBINHOOD_CHAIN_EXPLORER_ORIGIN}/block/${block}`;
}
