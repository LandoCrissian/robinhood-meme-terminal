// External-wallet transport and session state only. No trade signing or submission.
import React, { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { createModal, getDefaultConfig } from '@rabby-wallet/rabbykit';
import { createConfig, disconnect, getAccount, getConnections, http, reconnect, signMessage, switchChain,
  watchConnections, type Config, type Connector } from '@wagmi/core';
import { injected } from 'wagmi/connectors';
import { getAddress, type Address } from 'viem';
import { robinhoodChain } from '@rmt/shared/chains';
import { readConnectedWallet, type ConnectedWalletProvider } from '../connected-wallet-state';
import { walletGatewayKey } from '../wallet-gateway';

export type SessionWallet = {
  address: Address; type: 'ethereum'; chainId: string; connectorType: string; walletClientType: string;
  linked: boolean; meta: { id: string; name: string };
  getEthereumProvider(): Promise<ConnectedWalletProvider>;
  switchChain(chainId: number): Promise<void>;
  authenticate(): Promise<void>;
};
type Session = { authenticated: true; wallet: Address; chainId: 4663; csrfToken: string; expiresAt: number };
type Snapshot = { ready: boolean; walletsReady: boolean; wallets: SessionWallet[]; authenticated: boolean;
  session: Session | null; error: string; signing: boolean };
const initial: Snapshot = { ready: false, walletsReady: false, wallets: [], authenticated: false, session: null, error: '', signing: false };
const VERSION = 'rmt-cannacat-embed-v1';
const OPT_OUT = 'rmt:cannacat:wallet-return:1'; // Existing public preference; transaction journals are untouched.
function optedOut() { try { return JSON.parse(localStorage.getItem(OPT_OUT) ?? '{}').userDisconnected === true; } catch { return false; } }
const message = (error: unknown) => {
  const code = error instanceof Error ? error.message : '';
  if (/reject|denied|4001/i.test(code)) return 'Wallet sign-in was cancelled. No trade was requested.';
  if (/WALLET_AUTH_UNAVAILABLE/.test(code)) return 'Wallet sign-in is temporarily unavailable. Your history and amounts are kept.';
  if (/WALLET_AUTH_RATE_LIMITED/.test(code)) return 'Too many sign-in attempts. Wait a few minutes, then reconnect.';
  return 'Wallet sign-in could not finish. Check the selected account and Robinhood Chain, then reconnect.';
};
export class WalletSessionController {
  readonly wagmi: Config;
  private modal: ReturnType<typeof createModal>;
  private state = initial;
  private listeners = new Set<() => void>();
  private stopWatch?: () => void;
  private generation = 0;
  private sessionRead?: Promise<void>;
  private authRead?: Promise<void>;
  private logoutRead?: Promise<void>;
  private walletCache = new Map<string, SessionWallet>();
  private disposed = false;
  private mobileRelayConfigured: boolean;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(readonly apiBaseUrl: string, projectId: string) {
    const url = new URL(apiBaseUrl, location.origin);
    if (url.origin !== location.origin || url.pathname !== '/api/rmt/cannacat' || url.search || url.hash || url.username || url.password)
      throw Error('A same-origin wallet API is required.');
    if (projectId && !/^[a-f0-9]{32}$/i.test(projectId)) throw Error('Invalid WalletConnect project configuration.');
    this.mobileRelayConfigured = Boolean(projectId);
    this.wagmi = createConfig(projectId ? getDefaultConfig({ projectId, appName: 'LAMMB Genesis', appUrl: location.origin,
      appDesc: 'CannaCat trading on Robinhood Chain', appLogo: location.origin + '/icon.png',
      chains: [robinhoodChain], transports: { [4663]: http(robinhoodChain.rpcUrls.default.http[0]) }, ssr: false })
      : { chains: [robinhoodChain], connectors: [injected({ shimDisconnect: true })], multiInjectedProviderDiscovery: true,
        transports: { [4663]: http(robinhoodChain.rpcUrls.default.http[0]) }, ssr: false });
    this.modal = createModal({ wagmi: this.wagmi, showWalletConnect: Boolean(projectId), theme: 'dark',
      themeVariables: { '--rk-primary-button-bg': '#d6ff24', '--rk-primary-button-color': '#10150b' } });
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private publish(patch: Partial<Snapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
    // Public identity only. This is NOT an authorization grant to Genesis registration/admin APIs.
    window.dispatchEvent(new CustomEvent('lammb:wallet-session', { detail: { wallet: this.state.session?.wallet ?? null,
      chainId: 4663, authenticated: this.state.authenticated } }));
  }
  private inventory = () => {
    const connected = getConnections(this.wagmi);
    const wallets: SessionWallet[] = [];
    for (const connection of connected) for (const account of connection.accounts) {
      const address = getAddress(account), connector = connection.connector;
      const linked = Boolean(this.state.session && this.state.session.wallet.toLowerCase() === address.toLowerCase() && !optedOut());
      const key = `${connector.uid}:${address}:${connection.chainId}:${linked}`;
      let wallet = this.walletCache.get(key);
      if (!wallet) {
        wallet = { address, type: 'ethereum', chainId: `eip155:${connection.chainId}`, connectorType: connector.type,
          walletClientType: connector.id, linked, meta: { id: connector.uid, name: connector.name },
          getEthereumProvider: async () => await connector.getProvider() as ConnectedWalletProvider,
          switchChain: async chainId => { if (chainId !== 4663) throw Error('Only Robinhood Chain is supported.'); await switchChain(this.wagmi, { chainId: 4663, connector }); this.inventory(); },
          authenticate: () => this.authenticate(connector, address) };
        this.walletCache.set(key, wallet);
      }
      wallets.push(wallet);
    }
    if (this.walletCache.size > 128) this.walletCache.clear();
    const prior = this.state.wallets.map(w => `${walletGatewayKey(w)}:${w.chainId}:${w.linked}`).join('|');
    const next = wallets.map(w => `${walletGatewayKey(w)}:${w.chainId}:${w.linked}`).join('|');
    if (prior !== next || !this.state.walletsReady) this.publish({ wallets, walletsReady: true });
  };
  private async post(operation: string, input: object = {}, csrf?: string) {
    const response = await fetch(`${this.apiBaseUrl}/auth-${operation}`, { method: 'POST', credentials: 'same-origin',
      keepalive: operation === 'logout',
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json', 'x-rmt-client': VERSION, ...(csrf ? { 'x-rmt-csrf': csrf } : {}) }, body: JSON.stringify(input) });
    const value = await response.json();
    if (!response.ok) throw Error(typeof value?.code === 'string' ? value.code : 'WALLET_AUTH_UNAVAILABLE');
    return value;
  }
  private acceptSession(value: unknown) {
    const candidate = value as Partial<Session>;
    const valid = candidate?.authenticated === true && candidate.chainId === 4663 && typeof candidate.wallet === 'string'
      && /^0x[0-9a-f]{40}$/i.test(candidate.wallet) && typeof candidate.csrfToken === 'string' && /^[a-f0-9]{64}$/.test(candidate.csrfToken)
      && typeof candidate.expiresAt === 'number' && candidate.expiresAt > Date.now();
    const session = valid ? candidate as Session : null;
    if (JSON.stringify(session) !== JSON.stringify(this.state.session)) this.publish({ session, authenticated: !!session && !optedOut() });
    if (this.timer) clearTimeout(this.timer);
    if (session) this.timer = setTimeout(() => { this.publish({ session: null, authenticated: false }); this.inventory(); }, Math.min(86400000, session.expiresAt - Date.now()));
    this.inventory();
  }
  refresh = (): Promise<void> => {
    if (this.sessionRead) return this.sessionRead;
    const generation = this.generation;
    const work = (async () => {
      try { const value = await this.post('session'); if (generation === this.generation) this.acceptSession(value); }
      catch { if (generation === this.generation) { this.publish({ session: null, authenticated: false, error: 'Wallet sign-in could not be restored. Reconnect before trade review.' }); this.inventory(); } }
    })();
    this.sessionRead = work; void work.finally(() => { if (this.sessionRead === work) this.sessionRead = undefined; }); return work;
  };
  private resume = () => { if (document.visibilityState === 'visible') { this.inventory(); if (!this.state.signing && !optedOut()) void this.refresh(); } };
  async start() {
    // Share only a live transport, not the HttpOnly cookie, CSRF token, or trading authorization.
    const bridge = { getConnection: async () => {
      if (this.disposed) return null;
      const session = this.state.session;
      const matches = this.state.wallets.filter(w => w.address.toLowerCase() === session?.wallet.toLowerCase());
      if (!session || optedOut() || matches.length !== 1) return null;
      const wallet = matches[0], checked = await readConnectedWallet(wallet);
      return checked.status === 'ready' && checked.provider ? { address: wallet.address, chainId: 4663 as const, provider: checked.provider } : null;
    } };
    (window as Window & { lammbExternalWallet?: typeof bridge }).lammbExternalWallet = bridge;
    this.stopWatch = watchConnections(this.wagmi, { onChange: () => {
      this.inventory();
      // A temporary mobile transport disconnect is not a logout. A connected
      // replacement account must authenticate; no provider is selected by array order.
      const accounts = getConnections(this.wagmi).flatMap(connection => connection.accounts);
      if (this.state.ready && this.state.session && accounts.length
        && !accounts.some(address => address.toLowerCase() === this.state.session!.wallet.toLowerCase())) {
        void this.invalidateSession().catch(() => this.publish({ error: 'The previous account was disconnected locally. Reconnect to authenticate this account.' }));
      }
    } });
    document.addEventListener('visibilitychange', this.resume); window.addEventListener('pageshow', this.resume);
    try { if (!optedOut()) { await Promise.all([reconnect(this.wagmi), this.refresh()]); } }
    catch { this.publish({ error: 'The previous signing provider could not reconnect. Choose your wallet again.' }); }
    finally { this.inventory(); this.publish({ ready: true }); }
  }
  private async invalidateSession() {
    const session = this.state.session; ++this.generation;
    this.publish({ session: null, authenticated: false }); this.inventory();
    if (session) {
      const work = this.post('logout', {}, session.csrfToken).then(() => undefined);
      this.logoutRead = work;
      try { await work; } finally { if (this.logoutRead === work) this.logoutRead = undefined; }
    }
  }
  private authenticate(connector: Connector, address: Address): Promise<void> {
    if (this.authRead) return this.authRead;
    const work = this.authenticateOnce(connector, address);
    this.authRead = work; void work.finally(() => { if (this.authRead === work) this.authRead = undefined; }).catch(() => undefined); return work;
  }
  private async authenticateOnce(connector: Connector, address: Address) {
    const generation = ++this.generation;
    this.publish({ signing: true, error: '' });
    try {
      await this.logoutRead;
      const candidate = this.state.wallets.find(w => w.address === address && w.meta.id === connector.uid);
      if (!candidate) throw Error('The selected signing provider is unavailable.');
      const before = await readConnectedWallet(candidate);
      if (before.status !== 'ready') throw Error('Select Robinhood Chain before wallet sign-in.');
      const challenge = await this.post('challenge', { wallet: address });
      if (generation !== this.generation || optedOut()) return;
      if (typeof challenge.message !== 'string' || !challenge.message.startsWith(`https://${location.host} wants you to sign in with your Ethereum account:\n${address}\n`)
        || !challenge.message.includes(`URI: ${location.origin}/mint\nVersion: 1\nChain ID: 4663\n`)
        || typeof challenge.csrfToken !== 'string' || !/^[a-f0-9]{64}$/.test(challenge.csrfToken)) throw Error('Invalid sign-in challenge.');
      // Called only within a user-initiated connect/authentication flow. This is SIWE, never an allowance or trade.
      const signature = await signMessage(this.wagmi, { connector, account: address, message: challenge.message });
      const after = await readConnectedWallet(candidate);
      if (generation !== this.generation || optedOut() || after.status !== 'ready') throw Error('Wallet changed during sign-in.');
      const value = await this.post('verify', { message: challenge.message, signature }, challenge.csrfToken);
      if (generation !== this.generation || optedOut()) return;
      if (value.wallet?.toLowerCase() !== address.toLowerCase()) throw Error('Wallet sign-in account mismatch.');
      this.acceptSession(value); this.publish({ error: '' });
    } catch (error) { this.publish({ error: message(error) }); throw error; }
    finally { this.publish({ signing: false }); }
  }
  connect = async (selectedKey?: string) => {
    this.publish({ error: '' });
    if (!this.mobileRelayConfigured && !this.state.wallets.length && /iPhone|iPad|Android/.test(navigator.userAgent)) {
      this.publish({ error: 'Mobile wallet handoff is awaiting the owner’s free WalletConnect setup. No wallet request was opened.' });
      return;
    }
    const selected = this.state.wallets.find(w => walletGatewayKey(w) === selectedKey)
      ?? (this.state.wallets.length === 1 ? this.state.wallets[0] : undefined);
    if (selected) {
      const live = await readConnectedWallet(selected);
      if (live.status === 'ready') {
        if (this.state.authenticated && selected.linked) { this.inventory(); return; }
        await selected.authenticate(); return;
      }
      if (live.status === 'wrong-chain') { this.publish({ error: 'Select Switch to Robinhood Chain before signing in.' }); return; }
    }
    this.modal.open({ forceOpen: true, onConnect: () => {
      this.inventory(); const account = getAccount(this.wagmi);
      if (account.address && account.connector) {
        if (this.state.authenticated && this.state.session?.wallet.toLowerCase() === account.address.toLowerCase()) this.inventory();
        else void this.authenticate(account.connector, getAddress(account.address)).catch(() => undefined);
      }
    }, onConnectError: () => this.publish({ error: 'The wallet connection was not completed. Try again when ready.' }) });
  };
  logout = async () => {
    const session = this.state.session; ++this.generation;
    this.publish({ session: null, authenticated: false, error: '' }); this.inventory();
    const work = this.post('logout', {}, session?.csrfToken).then(() => undefined);
    this.logoutRead = work;
    try { await work; }
    catch { this.publish({ error: 'Disconnected on this device. Server sign-out could not be confirmed; reconnect to sign in again.' }); }
    finally { await Promise.allSettled(getConnections(this.wagmi).map(c => disconnect(this.wagmi, { connector: c.connector }))); this.inventory(); if (this.logoutRead === work) this.logoutRead = undefined; }
  };
  dispose() { this.disposed = true; this.stopWatch?.(); this.modal.close(); if (this.timer) clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.resume); window.removeEventListener('pageshow', this.resume); }
}
const Context = createContext<WalletSessionController | null>(null);
export function WalletSessionProvider({ controller, children }: { controller: WalletSessionController; children: React.ReactNode }) {
  useEffect(() => { void controller.start(); return () => controller.dispose(); }, [controller]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function useWalletSession() {
  const controller = useContext(Context); if (!controller) throw Error('Wallet session provider missing.');
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  return { ...state, connect: controller.connect, logout: controller.logout };
}
