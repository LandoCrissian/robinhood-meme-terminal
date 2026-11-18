"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { accountApi, accountErrorMessage } from "../../lib/account-api";
import { accountChainHex, assertAccountChallenge, assertConnectedAccount, connectAccountWallet, discoverAccountWallets,
  sameAccount, signAccountMessage, type AccountWallet, type ConnectedAccount } from "../../lib/profile-wallet";
import { profileEdit, type AccountProfile, type AccountSession, type ProfileChallenge } from "../../lib/profiles";
import { testWalletErrorCode } from "../../lib/test-wallet";

type AccountContextValue = {
  session: AccountSession; checking: boolean; wallets: AccountWallet[]; discovered: boolean; wallet?: ConnectedAccount; challenge?: ProfileChallenge;
  busy: boolean; logoutUnconfirmed: boolean; message: string; connect(wallet: AccountWallet): Promise<void>; reviewSignIn(): Promise<void>;
  signIn(): Promise<void>; signOut(): Promise<void>; refresh(): Promise<void>; switchNetwork(): Promise<void>;
  updateProfile(profile: AccountProfile): void; clearMessage(): void; notify(message: string): void; discoverWallets(): void;
};
const initialSession: AccountSession = { authenticated: false, availability: "unavailable" };
const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AccountSession>(initialSession), [checking, setChecking] = useState(true);
  const [wallets, setWallets] = useState<AccountWallet[]>([]), [wallet, setWallet] = useState<ConnectedAccount>();
  const [discovered, setDiscovered] = useState(false);
  const [challenge, setChallenge] = useState<ProfileChallenge>(), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [logoutUnconfirmed, setLogoutUnconfirmed] = useState(false);
  const generation = useRef(0), operation = useRef(false), sessionRef = useRef<AccountSession>(initialSession);
  const logoutToken = useRef<string>(undefined);
  const logoutInFlight = useRef<Promise<void>>(undefined);
  const discoveryStop = useRef<() => void>(undefined), walletCleanup = useRef(new Set<() => void>());
  const walletRef = useRef<ConnectedAccount>(undefined), challengeRef = useRef<ProfileChallenge>(undefined), alive = useRef(true);
  const assignSession = useCallback((value: AccountSession) => { sessionRef.current = value; setSession(value); }, []);
  const assignChallenge = useCallback((value?: ProfileChallenge) => { challengeRef.current = value; setChallenge(value); }, []);

  const refresh = useCallback(async () => {
    const current = generation.current;
    setChecking(true);
    try {
      const result = await accountApi<AccountSession>("/api/account/session");
      if (current !== generation.current || !alive.current) return;
      if (!result || typeof result.authenticated !== "boolean" || !["available", "disabled", "unavailable"].includes(result.availability)
          || (result.authenticated && (result.account?.chainId !== 4663 || !/^0x[0-9a-f]{40}$/i.test(result.account.walletAddress)
            || typeof result.csrfToken !== "string" || !result.csrfToken))) throw new Error("Unsupported session response");
      if (result.authenticated) {
        const profile = result.account.profile;
        if (!profile || profile.chainId !== 4663 || !sameAccount(profile.walletAddress, result.account.walletAddress)
            || (profile.avatarUrl !== null && (typeof profile.avatarUrl !== "string" || !/^\/api\/account\/avatar\/0x[0-9a-f]{40}(?:\?v=[0-9a-f]{64})?$/i.test(profile.avatarUrl)))) throw new Error("Unsupported profile response");
        profileEdit({ username: profile.username, displayName: profile.displayName, bio: profile.bio, links: profile.links, preferences: profile.preferences });
      }
      assignSession(result);
    } catch { if (current === generation.current && alive.current) assignSession(initialSession); }
    finally { if (alive.current) setChecking(false); }
  }, [assignSession]);

  const clearLocalIdentity = useCallback(() => {
    generation.current++; walletRef.current = undefined; setWallet(undefined); assignChallenge();
    assignSession({ authenticated: false, availability: sessionRef.current.availability });
  }, [assignChallenge, assignSession]);

  const signOut = useCallback(async () => {
    if (logoutInFlight.current) return logoutInFlight.current;
    const original = sessionRef.current;
    if (original.authenticated) logoutToken.current = original.csrfToken;
    clearLocalIdentity();
    const request = (async () => {
      try {
        await accountApi("/api/account/logout", { method: "POST", csrfToken: logoutToken.current });
        logoutToken.current = undefined; setLogoutUnconfirmed(false);
        setMessage("Signed out. Your wallet funds, token holdings and on-chain history are unchanged.");
      } catch { setLogoutUnconfirmed(true); setMessage("Disconnected locally. Server sign-out could not be confirmed; retry server sign-out to clear the server session."); }
    })();
    logoutInFlight.current = request;
    try { await request; } finally { if (logoutInFlight.current === request) logoutInFlight.current = undefined; }
  }, [clearLocalIdentity]);

  function discoverWallets() {
    if (discoveryStop.current) return;
    setDiscovered(true);
    discoveryStop.current = discoverAccountWallets((found) => {
      setWallets((previous) => previous.some((entry) => entry.provider === found.provider || entry.id === found.id) ? previous : [...previous, found]);
      const changed = () => {
        if (walletRef.current && walletRef.current.provider !== found.provider) return;
        if (!walletRef.current && !sessionRef.current.authenticated && !challengeRef.current) return;
        void signOut();
        setMessage("Wallet account or network changed. Sign in again to continue; the previous review was cleared.");
      };
      for (const event of ["accountsChanged", "chainChanged", "disconnect"]) found.provider.on?.(event, changed);
      walletCleanup.current.add(() => { for (const event of ["accountsChanged", "chainChanged", "disconnect"]) found.provider.removeListener?.(event, changed); });
    });
  }
  useEffect(() => {
    alive.current = true; void refresh();
    return () => { alive.current = false; discoveryStop.current?.(); walletCleanup.current.forEach((fn) => fn()); };
  }, [refresh]);

  async function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setMessage("");
    try { await action(); }
    catch (error) { setMessage(testWalletErrorCode(error) === 4001 ? "You declined the wallet request. No new sign-in was completed."
      : error instanceof Error && !("status" in error) ? error.message : accountErrorMessage(error)); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  async function connect(selected: AccountWallet) {
    await run(async () => {
      if (logoutInFlight.current) await logoutInFlight.current;
      const current = ++generation.current; assignChallenge();
      const connected = await connectAccountWallet(selected);
      if (current !== generation.current || !alive.current) throw new Error("Wallet selection changed. Connect again.");
      const prior = sessionRef.current;
      if (prior.authenticated && (!sameAccount(connected.address, prior.account.walletAddress) || connected.chainId !== 4663)) {
        await signOut();
        if (!alive.current) return;
      }
      walletRef.current = connected; setWallet(connected);
      setMessage(connected.chainId === 4663 ? "Wallet connected. This does not sign you in. Review a separate gas-free sign-in message."
        : "Wallet connected on another network. Switch to Robinhood Chain 4663 before signing in.");
    });
  }
  async function reviewSignIn() {
    await run(async () => {
      const connected = walletRef.current;
      if (!connected || sessionRef.current.availability !== "available" || logoutUnconfirmed) throw new Error("Sign-in is unavailable or the previous server sign-out needs to be retried.");
      const current = generation.current; await assertConnectedAccount(connected); assignChallenge();
      const next = await accountApi<ProfileChallenge>("/api/account/nonce", { method: "POST", body: { address: connected.address, chainId: 4663 } });
      assertAccountChallenge(next, connected, window.location);
      if (current !== generation.current || walletRef.current !== connected) throw new Error("Wallet changed. Review again.");
      assignChallenge(next);
    });
  }
  async function signIn() {
    await run(async () => {
      const connected = walletRef.current, reviewed = challengeRef.current, current = generation.current;
      if (!connected || !reviewed) throw new Error("Review the sign-in message first.");
      const assertCurrent = () => {
        if (current !== generation.current || walletRef.current !== connected || challengeRef.current !== reviewed) throw new Error("Wallet or review changed. Sign in again.");
        assertAccountChallenge(reviewed, connected, window.location);
      };
      assertCurrent();
      const signature = await signAccountMessage(connected, reviewed.message, assertCurrent);
      await accountApi("/api/account/verify", { method: "POST", body: { message: reviewed.message, signature } });
      try { assertCurrent(); } catch (error) { await signOut(); throw error; }
      assignChallenge(); await refresh();
      if (!sessionRef.current.authenticated || !sameAccount(sessionRef.current.account.walletAddress, connected.address)) {
        throw new Error("The server session could not be confirmed. Use Check session before requesting another signature.");
      }
      setMessage("Signed in with your wallet. No blockchain transaction or gas payment occurred.");
    });
  }
  async function switchNetwork() {
    await run(async () => {
      const connected = walletRef.current;
      if (!connected) return;
      await connected.request.call(connected.provider, { method: "wallet_switchEthereumChain", params: [{ chainId: accountChainHex }] });
      assignChallenge(); walletRef.current = undefined; setWallet(undefined);
      setMessage("Network selection changed. Connect your wallet again to confirm Robinhood Chain 4663.");
    });
  }
  function updateProfile(profile: AccountProfile) {
    const current = sessionRef.current;
    if (current.authenticated && sameAccount(profile.walletAddress, current.account.walletAddress)) assignSession({ ...current, account: { ...current.account, profile } });
  }
  return <AccountContext.Provider value={{ session, checking, wallets, discovered, wallet, challenge, busy, logoutUnconfirmed, message,
    connect, reviewSignIn, signIn, signOut, refresh, switchNetwork, updateProfile, discoverWallets, clearMessage: () => setMessage(""), notify: setMessage }}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const context = useContext(AccountContext);
  if (!context) throw new Error("Account provider is unavailable");
  return context;
}
