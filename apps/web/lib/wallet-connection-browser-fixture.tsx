import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { WalletConnectionPanel } from "../app/wallet-connection-panel";
import { activateSelectedWallet, WalletConnectionController } from "./wallet-connection-controller";

// Fake providers only. This fixture never reads window.ethereum, Privy, or an RPC URL.
const timers = new Map<number, () => void>();
let now = 0;
const controller = new WalletConnectionController({ now: () => now,
  set: (fn, ms) => { timers.set(ms, fn); return ms; }, clear: id => { timers.delete(id as number); }
}, 8, 30);
const address = "0x1111111111111111111111111111111111111111";
const commits: string[] = [];
let releaseMetaMask = () => {};
const lateMetaMask = new Promise<void>(resolve => { releaseMetaMask = resolve; });
const wallets = ["MetaMask", "Tabby", "Generic EIP6963"].map(name => {
  const provider = { request: async () => [address] };
  return { key: name, name, address, getEthereumProvider: async () => provider,
    loginOrLink: () => name === "MetaMask" ? lateMetaMask : Promise.resolve() };
});
const select = (key: string) => {
  const wallet = wallets.find(wallet => wallet.key === key)!;
  void controller.select(key, scope => activateSelectedWallet(scope, wallet, {
    stillSelected: () => true, needsLogin: () => true, activate: async () => key
  }), () => { commits.push(key); });
};
function Fixture() {
  const connection = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return <main><h1>Deterministic wallet connection fixture</h1>
    <output id="state">{connection.state}:{connection.walletKey}</output>
    <button onClick={() => controller.begin()}>Connect</button>
    {connection.state !== "IDLE" && connection.state !== "CONNECTED" && <WalletConnectionPanel
      connection={connection} wallets={wallets} select={select} cancel={controller.cancel}
      retry={() => connection.walletKey ? select(connection.walletKey) : controller.begin()}
      chooseAnother={() => controller.begin()} />}
  </main>;
}
const root = createRoot(document.getElementById("root")!);
flushSync(() => root.render(<Fixture />));
const results: string[] = [];
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const settle = async () => {
  for (let i = 0; i < 80; i++) await Promise.resolve();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
};
const click = async (label: string) => {
  const button = [...document.querySelectorAll("button")].find(button => button.textContent?.startsWith(label));
  check(button, `Missing button: ${label}`);
  flushSync(() => button!.click()); await settle();
};
async function run() {
  await click("Connect");
  check(controller.getSnapshot().state === "CONNECTING", "connect state");
  flushSync(() => timers.get(8)?.());
  check(document.querySelector('[role="status"]')?.textContent?.includes("longer"), "SLOW recovery visible");
  flushSync(() => timers.get(30)?.());
  check(document.querySelector('[role="status"]')?.textContent?.includes("timed out"), "FAILED recovery visible");
  results.push("hung discovery: CONNECTING -> SLOW -> FAILED with visible recovery");
  await click("Retry"); check(controller.getSnapshot().state === "CONNECTING", "retry starts fresh intent");
  await click("MetaMask"); check(commits.length === 0, "hung MetaMask must not commit");
  await click("Choose another wallet"); await click("Tabby");
  check(controller.getSnapshot().walletKey === "Tabby" && controller.getSnapshot().state === "CONNECTED", "Tabby bound");
  releaseMetaMask(); await settle();
  check(commits.join() === "Tabby", "late same-address MetaMask must not override Tabby");
  results.push("Retry/Choose another: late same-address MetaMask cannot replace selected Tabby");
  await click("Connect"); await click("Generic EIP6963");
  check(controller.getSnapshot().walletKey === "Generic EIP6963", "generic selection supported");
  results.push("generic EIP6963 selection completes without vendor special cases");
  await click("Connect"); await click("Cancel");
  check(controller.getSnapshot().state === "IDLE" && timers.size === 0, "cancel cleans timers");
  await click("Connect"); now += 31;
  // Unmount cancels all outstanding work, including a never-completed discovery.
  flushSync(() => root.unmount()); controller.dispose();
  check(timers.size === 0, "unmount cleanup");
  results.push("Cancel/unmount clean up connection timers");
}
void run().then(() => ({ ok: true, results }), error => ({ ok: false, results, error: String(error) })).then(async result => {
  document.body.textContent = JSON.stringify(result, null, 2);
  await fetch("/result", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
});
