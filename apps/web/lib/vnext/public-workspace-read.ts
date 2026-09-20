// Browser memory only, public selected-token data only. Never use for balances,
// identity admission, executable quotes, authorization or wallet commitments.
const entries = new Map<string, { at: number; pending?: Promise<unknown>; value?: unknown }>();
const TTL_MS = 60_000;
const LIMIT = 24;
export function cachedPublicWorkspaceRead<T>(url: string): T | undefined {
  return entries.get(url)?.value as T | undefined;
}
export async function readPublicWorkspace<T>(url: string): Promise<T> {
  if (!/^\/api\/(vnext\/asset-workspace\?|markets\/external\?)/.test(url)) throw new Error("Not public workspace data");
  const prior = entries.get(url);
  if (prior?.pending) return prior.pending as Promise<T>;
  if (prior?.value && Date.now() - prior.at < TTL_MS) return prior.value as T;
  const entry = prior ?? { at: 0 };
  const pending = fetch(url, { signal: AbortSignal.timeout(12_000) }).then(async response => {
    if (!response.ok) throw new Error("Public market data unavailable");
    const value: unknown = await response.json();
    entry.value = value; entry.at = Date.now(); return value;
  }).finally(() => { entry.pending = undefined; });
  entry.pending = pending; entries.delete(url); entries.set(url, entry);
  if (entries.size > LIMIT) entries.delete(entries.keys().next().value!);
  return pending as Promise<T>;
}
