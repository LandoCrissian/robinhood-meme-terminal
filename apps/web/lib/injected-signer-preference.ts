import { getAddress, isAddress } from "viem";
import { parseWalletGatewayKey } from "./wallet-gateway";

export const INJECTED_SIGNER_PREFERENCE_KEY = "rmt:explicit-injected-signer:v1:4663";
export type InjectedSignerPreference = {
  version: 1; wallet: string; walletKey: string; rdns: string; name: string;
  chainId: 4663; connectorType: "injected";
};
export type SignerPreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

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
