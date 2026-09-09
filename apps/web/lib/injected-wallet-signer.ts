import { getAddress, isAddress } from "viem";
import { browserSignerPreferenceStorage, INJECTED_SIGNER_PREFERENCE_KEY, readInjectedSignerPreference, sameInjectedPreferenceWallet, type SignerPreferenceStorage } from "./injected-signer-preference";
import { parseWalletGatewayKey } from "./wallet-gateway";

export type InjectedSignerProvider = {
  request: (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
};
export type InjectedSignerIdentity = {
  authenticated: boolean;
  userId: string;
  linkedAddress?: string;
  activeWalletKey: string | null;
  address?: string;
  chainId?: number;
};
type Announcement = { uuid: string; name: string; rdns: string; provider: InjectedSignerProvider; conflicted: boolean };
export type InjectedSignerTicket = Readonly<{
  generation: number;
  uuid: string;
  walletKey: string;
  wallet: string;
  provider: InjectedSignerProvider;
  request: InjectedSignerProvider["request"];
}>;

/** Provider objects remain page-local. Only an explicit non-secret preference survives reload. */
export function createInjectedSignerSelection(options: { storage?: () => SignerPreferenceStorage | undefined } = {}) {
  const preferenceStorage = options.storage ?? browserSignerPreferenceStorage;
  let restoredSelection = false;
  const forgetPreference = () => {
    try { preferenceStorage()?.removeItem(INJECTED_SIGNER_PREFERENCE_KEY); } catch { /* Manual selection remains available. */ }
  };
  const announcements = new Map<string, Announcement>();
  const listeners = new Set<() => void>();
  let identity: InjectedSignerIdentity = { authenticated: false, userId: "", activeWalletKey: null };
  let identityKey = "";
  let generation = 0;
  let selected: Announcement | null = null;
  let selectedRequest: InjectedSignerProvider["request"] | null = null;
  let unlisten = () => {};
  let snapshot: { eligible: boolean; generation: number; selectedUuid: string | null; choices: readonly { uuid: string; name: string; rdns: string; conflicted: boolean }[] } = {
    eligible: false, generation, selectedUuid: null, choices: []
  };
  function publish() {
    let eligible = false;
    try { requireIdentity(); eligible = true; } catch { /* No authenticated injected identity. */ }
    snapshot = { eligible, generation, selectedUuid: selected?.uuid ?? null, choices: [...announcements.values()].map(({ uuid, name, rdns, conflicted }) => ({ uuid, name, rdns, conflicted })) };
    listeners.forEach((listener) => listener());
  }
  function invalidate() {
    generation += 1;
    selected = null;
    selectedRequest = null;
    unlisten();
    unlisten = () => {};
    publish();
  }
  function requireIdentity(walletKey?: string, recipient?: string) {
    const active = parseWalletGatewayKey(identity.activeWalletKey);
    if (!identity.authenticated || !identity.userId || !active || active.connectorType !== "injected"
      || !identity.linkedAddress || !identity.address || identity.chainId !== 4663
      || active.address !== identity.linkedAddress.toLowerCase() || active.address !== identity.address.toLowerCase()
      || (walletKey !== undefined && walletKey !== identity.activeWalletKey)
      || (recipient !== undefined && recipient.toLowerCase() !== active.address)) {
      throw new Error("The injected signer must match the authenticated linked trading wallet on Robinhood Chain.");
    }
    return active.address;
  }
  function assertCurrent(ticket: InjectedSignerTicket, walletKey: string, recipient: string) {
    const wallet = requireIdentity(walletKey, recipient);
    if (!selected || selected.conflicted || generation !== ticket.generation || selected.uuid !== ticket.uuid
      || selected.provider !== ticket.provider || selected.provider.request !== ticket.request
      || ticket.walletKey !== walletKey || ticket.wallet !== wallet
      || (restoredSelection && [...announcements.values()].filter((entry) => entry.rdns === selected?.rdns).length !== 1)) {
      throw new Error("Injected signer selection changed. Select it again and prepare fresh authority.");
    }
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    invalidate: () => { forgetPreference(); invalidate(); },
    setIdentity(next: InjectedSignerIdentity) {
      const key = JSON.stringify([next.authenticated, next.userId, next.activeWalletKey,
        next.address?.toLowerCase(), next.linkedAddress?.toLowerCase(), next.chainId]);
      if (selected && next.authenticated && (!sameInjectedPreferenceWallet(identity.activeWalletKey, next.activeWalletKey)
        || next.address?.toLowerCase() !== identity.address?.toLowerCase() || next.chainId !== identity.chainId)) forgetPreference();
      identity = { ...next };
      if (key !== identityKey) { identityKey = key; invalidate(); }
    },
    announce(detail: unknown) {
      if (!detail || typeof detail !== "object") return;
      const { info, provider } = detail as { info?: Record<string, unknown>; provider?: InjectedSignerProvider };
      if (!info || typeof info.uuid !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(info.uuid)
        || typeof info.name !== "string" || !/^[\x20-\x7e]{1,80}$/.test(info.name)
        || typeof info.rdns !== "string" || !/^[a-z0-9.-]{1,160}$/i.test(info.rdns)
        || !provider || typeof provider.request !== "function" || typeof provider.on !== "function" || typeof provider.removeListener !== "function") return;
      const uuid = info.uuid.toLowerCase();
      const existing = announcements.get(uuid);
      const aliases = [...announcements.values()].filter((item) => item.provider === provider && item.uuid !== uuid);
      if (existing && (existing.provider !== provider || existing.name !== info.name || existing.rdns !== info.rdns) || aliases.length) {
        if (existing) existing.conflicted = true;
        aliases.forEach((item) => { item.conflicted = true; });
        if (!existing && announcements.size < 32) announcements.set(uuid, { uuid, name: info.name, rdns: info.rdns, provider, conflicted: true });
        forgetPreference();
        invalidate();
        return;
      }
      if (!existing && announcements.size < 32) {
        announcements.set(uuid, { uuid, name: info.name, rdns: info.rdns, provider, conflicted: false });
        if (restoredSelection && selected?.rdns === info.rdns) { forgetPreference(); invalidate(); }
        else publish();
      }
    },
    async restorePreference() {
      if (selected) return false;
      const preference = readInjectedSignerPreference(preferenceStorage());
      if (!preference) return false;
      const before = generation;
      try {
        const wallet = requireIdentity();
        if (wallet.toLowerCase() !== preference.wallet.toLowerCase() || !sameInjectedPreferenceWallet(preference.walletKey, identity.activeWalletKey)) return false;
        const matches = [...announcements.values()].filter((entry) => entry.rdns === preference.rdns);
        if (matches.length !== 1 || matches[0].conflicted) return false;
        const choice = matches[0];
        const request = choice.provider.request;
        const accounts = await request.call(choice.provider, { method: "eth_accounts" });
        const chain = await request.call(choice.provider, { method: "eth_chainId" });
        if (generation !== before || selected || choice.provider.request !== request
          || requireIdentity() !== wallet || choice.conflicted
          || [...announcements.values()].filter((entry) => entry.rdns === preference.rdns).length !== 1
          || !Array.isArray(accounts) || accounts.length === 0
          || !accounts.every((account) => typeof account === "string" && isAddress(account, { strict: false }))
          || !accounts.some((account) => getAddress(account).toLowerCase() === wallet.toLowerCase())
          || typeof chain !== "string" || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== 4663n) return false;
        this.select(choice.uuid);
        restoredSelection = true;
        return true;
      } catch { return false; }
    },
    select(uuid: string) {
      requireIdentity();
      const choice = announcements.get(uuid);
      if (!choice || choice.conflicted) throw new Error("That injected provider announcement is unavailable or conflicting.");
      invalidate();
      selected = choice;
      restoredSelection = false;
      selectedRequest = choice.provider.request;
      const events = ["accountsChanged", "chainChanged", "disconnect"];
      const changed = () => { forgetPreference(); invalidate(); };
      // Each event revokes unsent preparation, even if an address changes away and back.
      unlisten = () => { for (const event of events) { try { choice.provider.removeListener(event, changed); } catch { /* already invalidated */ } } };
      try { for (const event of events) choice.provider.on(event, changed); }
      catch { invalidate(); throw new Error("Injected signer event binding is unavailable."); }
      try {
        preferenceStorage()?.setItem(INJECTED_SIGNER_PREFERENCE_KEY, JSON.stringify({ version: 1,
          wallet: requireIdentity(), walletKey: identity.activeWalletKey, rdns: choice.rdns, name: choice.name, chainId: 4663, connectorType: "injected" }));
      } catch { /* Storage failure never changes dispatch or grants authority. */ }
      publish();
    },
    async prepare(walletKey: string, recipient: string): Promise<InjectedSignerTicket> {
      const wallet = requireIdentity(walletKey, recipient);
      // Discovery can precede mounting the selector. Rebind before consuming the trade action.
      if (!selected) await this.restorePreference();
      if (!selected || selected.conflicted) throw new Error("Choose an injected signer in the existing wallet menu before reviewing this 0x request.");
      if (selected.provider.request !== selectedRequest) {
        forgetPreference();
        invalidate();
        throw new Error("Selected provider request method changed. Choose the injected signer again.");
      }
      const ticket = Object.freeze({ generation, uuid: selected.uuid, walletKey, wallet, provider: selected.provider, request: selected.provider.request });
      const [accounts, chain] = await Promise.all([
        ticket.request.call(ticket.provider, { method: "eth_accounts" }),
        ticket.request.call(ticket.provider, { method: "eth_chainId" })
      ]).catch((cause: unknown) => { if (generation === ticket.generation) { forgetPreference(); invalidate(); } throw cause; });
      assertCurrent(ticket, walletKey, recipient);
      // eth_accounts is a permitted account set, not a new trading-wallet selection.
      // Validate the whole response, then require the already-bound owner regardless of order.
      if (!Array.isArray(accounts) || accounts.length === 0
        || !accounts.every((account) => typeof account === "string" && isAddress(account, { strict: false }))
        || !accounts.some((account) => getAddress(account) === getAddress(wallet))
        || typeof chain !== "string" || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== 4663n) {
        invalidate();
        forgetPreference();
        throw new Error("Selected injected signer account or chain does not match the authenticated trading wallet.");
      }
      return ticket;
    },
    assertCurrent
  };
}

export const injectedSignerSelection = createInjectedSignerSelection();
let discoveryStarted = false;
export function startInjectedSignerDiscovery() {
  if (discoveryStarted || typeof window === "undefined") return;
  discoveryStarted = true;
  // EIP-6963 requires this listener for the lifetime of the page. No global provider fallback.
  window.addEventListener("eip6963:announceProvider", (event) => injectedSignerSelection.announce((event as CustomEvent).detail));
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}
