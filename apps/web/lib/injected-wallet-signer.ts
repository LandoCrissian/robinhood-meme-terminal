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

/** Page-session selection, not a second connected-wallet manager. No provider is auto-selected. */
export function createInjectedSignerSelection() {
  const announcements = new Map<string, Announcement>();
  const listeners = new Set<() => void>();
  let identity: InjectedSignerIdentity = { authenticated: false, userId: "", activeWalletKey: null };
  let identityKey = "";
  let generation = 0;
  let selected: Announcement | null = null;
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
      || ticket.walletKey !== walletKey || ticket.wallet !== wallet) {
      throw new Error("Injected signer selection changed. Select it again and prepare fresh authority.");
    }
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    invalidate,
    setIdentity(next: InjectedSignerIdentity) {
      const key = JSON.stringify(next);
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
        invalidate();
        return;
      }
      if (!existing && announcements.size < 32) { announcements.set(uuid, { uuid, name: info.name, rdns: info.rdns, provider, conflicted: false }); publish(); }
    },
    select(uuid: string) {
      requireIdentity();
      const choice = announcements.get(uuid);
      if (!choice || choice.conflicted) throw new Error("That injected provider announcement is unavailable or conflicting.");
      invalidate();
      selected = choice;
      const events = ["accountsChanged", "chainChanged", "disconnect"];
      // Each event revokes unsent preparation, even if an address changes away and back.
      unlisten = () => { for (const event of events) { try { choice.provider.removeListener(event, invalidate); } catch { /* already invalidated */ } } };
      try { for (const event of events) choice.provider.on(event, invalidate); }
      catch { invalidate(); throw new Error("Injected signer event binding is unavailable."); }
      publish();
    },
    async prepare(walletKey: string, recipient: string): Promise<InjectedSignerTicket> {
      const wallet = requireIdentity(walletKey, recipient);
      if (!selected || selected.conflicted) throw new Error("Choose an injected signer in the existing wallet menu before reviewing this 0x request.");
      const ticket = Object.freeze({ generation, uuid: selected.uuid, walletKey, wallet, provider: selected.provider, request: selected.provider.request });
      const [accounts, chain] = await Promise.all([
        ticket.request.call(ticket.provider, { method: "eth_accounts" }),
        ticket.request.call(ticket.provider, { method: "eth_chainId" })
      ]);
      assertCurrent(ticket, walletKey, recipient);
      if (!Array.isArray(accounts) || accounts.length !== 1 || typeof accounts[0] !== "string"
        || accounts[0].toLowerCase() !== wallet || typeof chain !== "string" || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== 4663n) {
        invalidate();
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
