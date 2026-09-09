import { getAddress, isAddress } from "viem";
import { parseWalletGatewayKey } from "./wallet-gateway";

export const INJECTED_SIGNER_PREFERENCE_KEY = "rmt:explicit-injected-signer:v1:4663";
export type InjectedSignerPreference = {
  version: 1; wallet: string; walletKey: string; rdns: string; name: string;
  chainId: 4663; connectorType: "injected";
};
export type SignerPreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const sessionUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only a session UUID may change. Brand, connector and account never migrate. */
export function sameInjectedPreferenceWallet(previousKey: string | null, currentKey: string | null) {
  const previous = parseWalletGatewayKey(previousKey);
  const current = parseWalletGatewayKey(currentKey);
  return Boolean(previous && current && previous.connectorType === "injected" && current.connectorType === "injected"
    && previous.walletClientType === current.walletClientType && previous.address === current.address
    && (previous.reportedId === current.reportedId
      || (sessionUuid.test(previous.reportedId) && sessionUuid.test(current.reportedId))));
}

export function readInjectedSignerPreference(storage?: SignerPreferenceStorage): InjectedSignerPreference | null {
  try {
    const value = JSON.parse(storage?.getItem(INJECTED_SIGNER_PREFERENCE_KEY) ?? "null");
    const binding = parseWalletGatewayKey(value?.walletKey);
    if (!value || value.version !== 1 || value.chainId !== 4663 || value.connectorType !== "injected"
      || typeof value.wallet !== "string" || !isAddress(value.wallet, { strict: false })
      || !binding || binding.connectorType !== "injected" || binding.address !== value.wallet.toLowerCase()
      || typeof value.rdns !== "string" || !/^[a-z0-9.-]{1,160}$/i.test(value.rdns)
      || typeof value.name !== "string" || !/^[\x20-\x7e]{1,80}$/.test(value.name)) return null;
    return { version: 1, wallet: getAddress(value.wallet), walletKey: value.walletKey, rdns: value.rdns,
      name: value.name, chainId: 4663, connectorType: "injected" };
  } catch { return null; }
}

export function browserSignerPreferenceStorage(): SignerPreferenceStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; }
  catch { return undefined; }
}
