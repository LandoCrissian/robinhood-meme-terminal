import assert from "node:assert/strict";
import { createDirectoryEnrichmentQueue } from "./directory-enrichment-queue";

async function main() {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const timers = new Map<number, () => void>();
  let timerId = 0;
  globalThis.setTimeout = ((callback: () => void, ms: number) => {
    assert.equal(ms, 60_000);
    timers.set(++timerId, callback);
    return timerId;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as unknown as typeof clearTimeout;
  const jobs: { cursor: string | null; signal: AbortSignal; generation: number; done: boolean; resolve: () => void; reject: () => void }[] = [];
  let maximum = 0;
  const queue = createDirectoryEnrichmentQueue((cursor, signal, generation) => new Promise<void>((resolve, reject) => {
    const job = { cursor, signal, generation, done: false, resolve: () => { job.done = true; resolve(); }, reject: () => { job.done = true; reject(new Error("fixture unavailable")); } };
    jobs.push(job);
    maximum = Math.max(maximum, jobs.filter(j => !j.done && !j.signal.aborted).length);
  }));
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  try {
    queue.beginGeneration(1);
    for (let page = 0; page < 7; page++) assert.equal(queue.enqueue(page ? `p${page}` : null, 1, 7), true);
    assert.equal(queue.enqueue("p5", 1, 7), false, "pending duplicate coalesces");
    assert.equal(queue.enqueue(null, 1, 7), false, "active duplicate coalesces");
    assert.equal(queue.enqueue("unsupported", 1, 7), false, "state is bounded by supported window");
    await flush(); assert.equal(jobs.length, 4);
    jobs[0].reject(); await flush(); assert.equal(jobs.length, 5);
    const [id, timeout] = timers.entries().next().value!;
    timers.delete(id); timeout(); await flush(); assert.equal(jobs.length, 6);
    assert.equal(jobs[1].signal.aborted, true, "timeout cancels request and frees capacity");
    jobs[2].resolve(); await flush(); assert.equal(jobs.length, 7);
    for (const job of jobs) job.resolve();
    await flush();
    assert.equal(new Set(jobs.map(j => j.cursor)).size, 7);
    assert.equal(queue.enqueue("p5", 1, 7), false, "no same-generation retry loop after completion");
    assert.equal(timers.size, 0);
    queue.beginGeneration(2);
    for (let page = 0; page < 7; page++) queue.enqueue(`p${page}`, 2, 7);
    await flush(); const old = jobs.slice(7); assert.equal(old.length, 4);
    queue.beginGeneration(3);
    queue.enqueue("new", 3, 1); await flush();
    assert.ok(old.every(j => j.signal.aborted));
    const count = jobs.length;
    for (const job of old) job.resolve();
    await flush(); assert.equal(jobs.length, count);
    assert.equal(queue.enqueue("obsolete", 2, 7), false);
    queue.dispose(); assert.equal(timers.size, 0);
    jobs.at(-1)!.resolve(); await flush();
    assert.equal(queue.enqueue("after-unmount", 3, 7), false);
    assert.equal(jobs.length, count); assert.equal(maximum, 4);
    console.log(JSON.stringify({ queue: "production-client", supportedPages: 7, attempted: 7, maximum, duplicates: 0, failureDrain: true, timeoutDrain: true, pendingTimersAfterUnmount: timers.size }));
  } finally { queue.dispose(); globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
