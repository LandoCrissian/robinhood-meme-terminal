import assert from 'node:assert/strict';
import { keccak256, type Hex } from 'viem';
import { readOfficialExplorerSettlementTrace } from './vnext-settlement-trace-client';

async function main() {
  let checks = 0;
  const hash = `0x${'1'.repeat(64)}` as Hex, blockHash = `0x${'2'.repeat(64)}` as Hex;
  const from = '0x0000000000000000000000000000000000000123';
  const to = '0x0000000000001ff3684f28c67538d4d072c22734';
  const expected = { hash, blockHash, blockNumber: 100n, from, to, input: '0xdeadbeef' as Hex, value: 0n };
  const block = { hash: blockHash, height: 100 };
  const transaction = { hash, block_number: 100, from: { hash: from }, to: { hash: to }, raw_input: expected.input, value: '0', status: 'ok' };
  const trace = { type: 'CALL', from, to, input: expected.input, value: '0x0', calls: [
    { type: 'CALL', from: to, to: from, value: '0x7b', input: '0x' },
  ] };
  type Mutate = (path: string, value: unknown, count: number) => unknown;
  const source = (mutate: Mutate = (_path, value) => value) => {
    let count = 0;
    return (async (url, options) => {
      assert.equal(new URL(String(url)).origin, 'https://robinhoodchain.blockscout.com'); checks++;
      assert.equal(options?.method, 'GET'); assert.equal(options?.credentials, 'omit');
      assert.equal(options?.redirect, 'error'); assert.equal(options?.cache, 'no-store'); checks += 4;
      const path = new URL(String(url)).pathname;
      const value = path.endsWith('/raw-trace') ? trace : path.includes('/blocks/') ? block : transaction;
      return Response.json(mutate(path, structuredClone(value), ++count));
    }) as typeof fetch;
  };
  const good = await readOfficialExplorerSettlementTrace(expected, { fetch: source() });
  assert.equal(good.status, 'available'); checks++;
  if (good.status !== 'available') throw Error('Expected a complete anchored trace');
  assert.equal(good.trace.inputHash, keccak256(expected.input)); checks++;
  assert.equal(good.trace.calls?.[0]?.value, '0x7b'); checks++;
  const rejected = async (name: string, mutate: Mutate) => {
    assert.equal((await readOfficialExplorerSettlementTrace(expected, { fetch: source(mutate) })).status, 'unavailable', name); checks++;
  };
  await rejected('wrong block', (path, value) => path.includes('/blocks/') ? { ...value as object, hash } : value);
  await rejected('wrong height', (path, value) => path.includes('/blocks/') ? { ...value as object, height: 101 } : value);
  await rejected('wrong tx', (path, value) => path.endsWith(hash) ? { ...value as object, hash: blockHash } : value);
  await rejected('wrong sender', (path, value) => path.endsWith(hash) ? { ...value as object, from: { hash: to } } : value);
  await rejected('wrong destination', (path, value) => path.endsWith(hash) ? { ...value as object, to: { hash: from } } : value);
  await rejected('wrong calldata', (path, value) => path.endsWith(hash) ? { ...value as object, raw_input: '0x00' } : value);
  await rejected('nonzero value', (path, value) => path.endsWith(hash) ? { ...value as object, value: '1' } : value);
  await rejected('failed indexed tx', (path, value) => path.endsWith(hash) ? { ...value as object, status: 'error' } : value);
  await rejected('wrong trace caller', (path, value) => path.endsWith('/raw-trace') ? { ...value as object, from: to } : value);
  await rejected('truncated trace', (path) => path.endsWith('/raw-trace') ? { type: 'CALL' } : path.includes('/blocks/') ? block : transaction);
  await rejected('wrong root input', (path, value) => path.endsWith('/raw-trace') ? { ...value as object, input: '0x00' } : value);
  await rejected('root execution reverted', (path, value) => path.endsWith('/raw-trace') ? { ...value as object, error: 'reverted' } : value);
  await rejected('reorg during trace retrieval', (path, value, count) => count > 3 && path.includes('/blocks/') ? { ...value as object, hash } : value);
  await rejected('transaction changed during trace retrieval', (path, value, count) => count > 3 && path.endsWith(hash) ? { ...value as object, block_number: 101 } : value);
  for (const response of [new Response('Unavailable', { status: 503 }), new Response('{"hash":1,"hash":2}'), new Response('x'.repeat(1024 * 1024 + 1))]) {
    assert.equal((await readOfficialExplorerSettlementTrace(expected, { fetch: (async () => response) as typeof fetch })).status, 'unavailable'); checks++;
  }
  assert.equal((await readOfficialExplorerSettlementTrace(expected, { fetch: (() => new Promise(() => {})) as typeof fetch, timeoutMs: 5 })).status, 'unavailable'); checks++;
  assert.equal((await readOfficialExplorerSettlementTrace({ ...expected, blockNumber: BigInt(Number.MAX_SAFE_INTEGER) + 1n }, { fetch: source() })).status, 'unavailable'); checks++;
  console.log(JSON.stringify({ result: 'PASS', checks, scope: 'fixed-origin anchored full-trace read; failures stay unavailable', transactions: 0 }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
