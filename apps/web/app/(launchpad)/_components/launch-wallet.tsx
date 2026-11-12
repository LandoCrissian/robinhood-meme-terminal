"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAddress, isAddress, toHex, type Address } from "viem";
import { metaMaskDappLink, rabbyDappLink, walletBrowserEnvironment } from "../../../lib/mobile-wallet-link";
import { type BoundWallet, type LaunchConfig, type LaunchDeployment, type WalletProvider, walletErrorCode, walletMessage } from "../../../lib/launchpad/transactions";
import { launchPublicClient } from "../../../lib/launchpad/direct-v4";

type WalletChoice = { id: string; name: string; provider: WalletProvider; conflicted?: boolean };
type WalletContext = {
  config: LaunchConfig | null;
  wallet: BoundWallet | null;
  choices: WalletChoice[];
  connecting: boolean;
  error: string;
  connect(choice: WalletChoice): Promise<void>;
  disconnect(): void;
  switchNetwork(): Promise<void>;
  stillSelected(wallet: BoundWallet): boolean;
  refresh(): void;
};

const Wallet = createContext<WalletContext | null>(null);

function isProvider(value: unknown): value is WalletProvider {
  if (!value || typeof value !== "object") return false;
  const provider = value as Partial<WalletProvider>;
  return typeof provider.request === "function" && typeof provider.on === "function" && typeof provider.removeListener === "function";
}

function walletChoice(detail: unknown): WalletChoice | undefined {
  if (!detail || typeof detail !== "object") return;
  const { info, provider } = detail as { info?: { uuid?: unknown; name?: unknown }; provider?: unknown };
  if (!info || typeof info.uuid !== "string" || !/^[\da-f-]{36}$/i.test(info.uuid)
    || typeof info.name !== "string" || !/^[\x20-\x7e]{1,80}$/.test(info.name) || !isProvider(provider)) return;
  return { id: info.uuid, name: info.name, provider };
}

function firstAddress(accounts: unknown): Address | undefined {
  const address: unknown = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof address === "string" && isAddress(address, { strict: false })) return getAddress(address);
}

function walletChainId(chain: unknown) {
  if (typeof chain !== "string" || !/^0x[\da-f]+$/i.test(chain)) return;
  const id = Number(BigInt(chain));
  if (Number.isSafeInteger(id) && id > 0) return id;
}

export function LaunchWalletProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<LaunchConfig | null>(null);
  const [attempt, refreshConfig] = useState(0);
  const [choices, setChoices] = useState<WalletChoice[]>([]);
  const [wallet, setWallet] = useState<BoundWallet | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const selected = useRef<BoundWallet | null>(null);
  const unbind = useRef<(() => void) | undefined>(undefined);
  const busy = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/launchpad/config", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const value = await response.json() as LaunchConfig;
        if (value.status === "ready" && value.deployment.chainId !== 31337) {
          throw new Error("This chain is outside the launch preview.");
        }
        if (!controller.signal.aborted) setConfig(value);
      }).catch(() => {
        if (!controller.signal.aborted) setConfig({ status: "unavailable", reason: "Could not check the test deployment." });
      });
    return () => controller.abort();
  }, [attempt]);

  const invalidate = useCallback(() => {
    generation.current += 1;
    selected.current = null;
    setWallet(null);
  }, []);

  useEffect(() => {
    const announced = new Map<string, WalletChoice>();
    const publish = () => {
      const unique = [...announced.values()].filter((choice) => !choice.conflicted);
      const fallback = (window as Window & { ethereum?: unknown }).ethereum;
      if (announced.size === 0 && isProvider(fallback)) unique.push({ id: "injected", name: "Browser wallet", provider: fallback });
      setChoices(unique);
    };
    const listener = (event: Event) => {
      const choice = walletChoice((event as CustomEvent).detail);
      if (!choice) return;
      const existing = announced.get(choice.id);
      const aliases = [...announced.values()].filter((entry) => entry.id !== choice.id && entry.provider === choice.provider);
      if (existing && (existing.provider !== choice.provider || existing.name !== choice.name) || aliases.length > 0) {
        if (selected.current?.provider === choice.provider || selected.current?.provider === existing?.provider) invalidate();
        aliases.forEach((alias) => { alias.conflicted = true; });
        if (existing) existing.conflicted = true;
        choice.conflicted = true;
      }
      if (!existing && announced.size < 24) announced.set(choice.id, choice);
      publish();
    };
    window.addEventListener("eip6963:announceProvider", listener);
    window.addEventListener("ethereum#initialized", publish);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    publish();
    return () => {
      window.removeEventListener("eip6963:announceProvider", listener);
      window.removeEventListener("ethereum#initialized", publish);
      unbind.current?.();
    };
  }, [invalidate]);

  const connect = useCallback(async (choice: WalletChoice) => {
    if (busy.current) return;
    busy.current = true;
    setConnecting(true);
    setError("");
    unbind.current?.();
    invalidate();
    const provider = choice.provider;
    const publish = (address: Address, chainId: number) => {
      const bound = { address, chainId, provider, request: provider.request, generation: ++generation.current };
      selected.current = bound;
      setWallet(bound);
    };
    const change = () => invalidate();
    try {
      const address = firstAddress(await provider.request({ method: "eth_requestAccounts" }));
      const chain = walletChainId(await provider.request({ method: "eth_chainId" }));
      if (!address || !chain) throw new Error("The wallet returned no usable account or network.");
      const events = ["accountsChanged", "chainChanged", "disconnect"];
      unbind.current = () => events.forEach((event) => provider.removeListener(event, change));
      events.forEach((event) => provider.on(event, change));
      publish(address, chain);
    } catch (cause) {
      setError(walletMessage(cause));
    } finally {
      busy.current = false;
      setConnecting(false);
    }
  }, [invalidate]);

  const disconnect = useCallback(() => {
    unbind.current?.();
    invalidate();
  }, [invalidate]);

  const switchNetwork = useCallback(async () => {
    if (!wallet || config?.status !== "ready" || busy.current) return;
    busy.current = true;
    setConnecting(true);
    setError("");
    const { deployment } = config;
    const chainId = toHex(deployment.chainId);
    try {
      try {
        await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
      } catch (cause) {
        if (walletErrorCode(cause) !== 4902) throw cause;
        await wallet.provider.request({ method: "wallet_addEthereumChain", params: [{
          chainId, chainName: deployment.name,
          nativeCurrency: { name: "Test Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [deployment.rpcUrl],
        }] });
      }
      const [accounts, activeChain] = await Promise.all([
        wallet.provider.request({ method: "eth_accounts" }), wallet.provider.request({ method: "eth_chainId" }),
      ]);
      const address = firstAddress(accounts);
      if (address !== wallet.address || walletChainId(activeChain) !== deployment.chainId) {
        throw new Error("Select the required network in your wallet, then reconnect the same account.");
      }
      const updated = { ...wallet, chainId: deployment.chainId, generation: ++generation.current };
      selected.current = updated;
      setWallet(updated);
    } catch (cause) {
      setError(walletMessage(cause));
    } finally {
      busy.current = false;
      setConnecting(false);
    }
  }, [wallet, config]);

  const stillSelected = useCallback((candidate: BoundWallet) => selected.current === candidate, []);
  const refresh = useCallback(() => refreshConfig((value) => value + 1), []);
  const value = useMemo(() => ({
    config, wallet, choices, connecting, error, connect, disconnect, switchNetwork, stillSelected, refresh,
  }), [config, wallet, choices, connecting, error, connect, disconnect, switchNetwork, stillSelected, refresh]);
  return <Wallet.Provider value={value}>{children}</Wallet.Provider>;
}

export function useLaunchWallet() {
  const wallet = useContext(Wallet);
  if (!wallet) throw new Error("Launch wallet provider is unavailable.");
  return wallet;
}

export function useLaunchClient(deployment: LaunchDeployment | undefined) {
  return useMemo(() => deployment ? launchPublicClient(deployment) : undefined, [deployment]);
}

export function WalletConnection({ compact = false }: { compact?: boolean }) {
  const state = useLaunchWallet();
  const [links, setLinks] = useState<string[]>([]);
  useEffect(() => {
    if (window.location.protocol !== "https:" || walletBrowserEnvironment(navigator.userAgent, state.choices.length > 0) !== "mobile-browser") {
      setLinks([]);
      return;
    }
    setLinks([metaMaskDappLink(window.location.href), rabbyDappLink(window.location.href)]);
  }, [state.choices.length]);

  const deployment = state.config?.status === "ready" ? state.config.deployment : undefined;
  if (state.wallet) {
    return <div className="lpWalletOptions">
      <span className="lpAddress">{state.wallet.address}</span>
      {deployment && state.wallet.chainId !== deployment.chainId &&
        <button type="button" className="lpButton" disabled={state.connecting} onClick={() => void state.switchNetwork()}>Switch to {deployment.name}</button>}
      {!compact && <button type="button" className="lpButton lpSecondary" onClick={state.disconnect}>Disconnect RMT</button>}
      {state.error && <p role="alert">{state.error}</p>}
    </div>;
  }
  return <div className="lpWalletOptions">
    {state.choices.map((choice) => <button key={choice.id} type="button" className="lpButton" disabled={state.connecting}
      onClick={() => void state.connect(choice)}>{state.connecting ? "Check your wallet…" : `Connect ${choice.name}`}</button>)}
    {state.choices.length === 0 && <p>Open RMT in a wallet browser or use an injected desktop wallet.</p>}
    {links[0] && <a className="lpButton lpSecondary" href={links[0]}>Open MetaMask</a>}
    {links[1] && <a className="lpButton lpSecondary" href={links[1]}>Open Rabby</a>}
    {state.error && <p role="alert">{state.error}</p>}
  </div>;
}
