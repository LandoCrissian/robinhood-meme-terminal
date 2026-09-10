import { getAddress, type Address } from "viem";
import { identityReadFailureReason, type DirectoryFailureReason } from "../vnext/directory-availability";
import { readRobinhoodTokenIdentities } from "./universal-market-resolver";

type Reader = typeof readRobinhoodTokenIdentities;
type Identity = Awaited<ReturnType<Reader>> extends Map<string, infer T> ? T : never;
type Entry = { expires: number; pending: boolean; value: Promise<Identity | undefined> };
type State = { entries: Map<string, Entry>; active: number };
const states = new WeakMap<Reader, State>();
const MAX_ENTRIES = 2048;
const BATCH_SIZE = 100;
const MAX_ACTIVE_BATCHES = 4;
const RETRY_MS = 30_000;

// Browse-only coalescing. This cache is never execution identity authority.
// Per-address keys deduplicate overlapping pages as well as identical requests.
export async function readDirectoryIdentityEnrichment(
  addresses: readonly Address[],
  onFailure?: (reason: DirectoryFailureReason) => void,
  reader: Reader = readRobinhoodTokenIdentities
) {
  let state = states.get(reader);
  if (!state) { state = { entries: new Map(), active: 0 }; states.set(reader, state); }
  const current = state;
  for (const [key, entry] of current.entries) {
    if (!entry.pending && entry.expires <= Date.now()) current.entries.delete(key);
  }
  const unique = [...new Set(addresses.slice(0, MAX_ENTRIES).map((a) => getAddress(a).toLowerCase()))];
  const absent = unique.filter((key) => !current.entries.has(key));
  for (let offset = 0; offset < absent.length; offset += BATCH_SIZE) {
    if (current.active >= MAX_ACTIVE_BATCHES || current.entries.size >= MAX_ENTRIES) break;
    const batch = absent.slice(offset, offset + Math.min(BATCH_SIZE, MAX_ENTRIES - current.entries.size));
    current.active++;
    const task = Promise.resolve().then(() => reader(batch.map((a) => getAddress(a)), onFailure))
      .catch((error: unknown) => { onFailure?.(identityReadFailureReason(error)); return new Map<string, Identity>(); })
      .finally(() => { current.active--; });
    for (const key of batch) {
      const entry: Entry = { expires: Infinity, pending: true, value: Promise.resolve(undefined) };
      entry.value = task.then((values) => {
        const identity = values.get(key);
        return identity?.address.toLowerCase() === key ? identity : undefined;
      }).finally(() => { entry.pending = false; entry.expires = Date.now() + RETRY_MS; });
      current.entries.set(key, entry);
    }
  }
  const found = new Map<string, Identity>();
  await Promise.all(unique.map(async (key) => {
    const identity = await current.entries.get(key)?.value;
    if (identity) found.set(key, identity);
  }));
  return found;
}
