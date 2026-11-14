import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const website = new URL('../../../apps/launch-website/', import.meta.url);
const requireWebsite = createRequire(new URL('package.json', website));
const { keccak256, toEventSelector, toFunctionSelector } = requireWebsite('viem');
const snapshot = JSON.parse(readFileSync(new URL('data/historical-launches-4663.json', website)));
const registration = snapshot.launches.find(({ version, launchId }) => version === 6 && launchId === '0');
const historicalFactory = snapshot.factories.find(({ version }) => version === 6);

const sources = Object.freeze({
  official: 'https://rpc.mainnet.chain.robinhood.com',
  pocket: 'https://robinhood.api.pocket.network',
  pinax: 'https://robinhood.rpc.pinax.network',
});
const readMethods = new Set([
  'eth_chainId', 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getCode',
  'eth_getLogs', 'eth_getTransactionReceipt', 'eth_call', 'debug_traceTransaction',
]);
const expectedChain = '0x1237';
const forkBlock = 113412054;
const forkHash = '0x17252a232b68a4e9fc494caf0660cff722ac2da966ee5c62b40e20dbcfd32ea2';
const routerCreation = '0xf669b9a4b8c322f5992788f737ee5fd2a1a73fd44f17546c5ac8b2211b6da339';
const routerCreationHash = '0x34b52ae62932a3b93c9a1a053d30409909c805c98b730dae59279b39fd414001';
const curveForkFactory = '0x33905B3A95BA5E09Cbf7EaE887B4f0466820944E';
const registrationSelector = toEventSelector('TokenLaunchedV6(uint256,address,address,address,address,bytes32,bytes32,uint32,uint16,uint16,uint16,uint16,bool,uint64,uint64,uint16,uint16,uint256,bool,string,string,string)');
// Archived #584 deployment-provenance pins, checked against official Uniswap addresses.
const pins = {
  poolManager: ['0x8366a39cc670b4001a1121b8f6a443a643e40951', '0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626'],
  positionManager: ['0x58daec3116aae6d93017baaea7749052e8a04fa7', '0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2'],
  permit2: ['0x000000000022D473030F116dDEE9F6B43aC78BA3', '0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca'],
  quoter: ['0x8dc178efb8111bb0973dd9d722ebeff267c98f94', '0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6'],
  stateView: ['0xf3334192d15450cdd385c8b70e03f9a6bd9e673b', '0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6'],
  universalRouter212: ['0x204FAca1764B154221e35c0d20aBb3c525710498', '0x76b92a5bba2dd32019a64eb421f1750e78c6ba044dbfa6840b722eb5ac63d296'],
};
const routerOffsets = {
  permit2: [3930, 11898, 14413],
  poolManager: [1654, 2189, 5163, 6847, 11440, 20357, 20476, 20726, 21062, 23462, 23823],
  positionManager: [2053, 5258],
};

function quantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function blockHeader({ number, hash, parentHash, stateRoot, timestamp, gasLimit }) {
  return { number: Number(number), hash, parentHash, stateRoot,
    timestamp: new Date(Number(timestamp) * 1000).toISOString(), gasLimit: BigInt(gasLimit).toString() };
}

function previousRegistration(log) {
  return log.address.toLowerCase() === historicalFactory.factory && log.topics[0] === registrationSelector &&
    Number(log.logIndex) === registration.receipt.logIndex &&
    log.transactionHash === registration.receipt.transactionHash && log.blockHash === registration.receipt.blockHash && log.removed !== true;
}

function publicFailure(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const reason = /missing trie|historical state|unknown state|pruned/i.test(message) ? 'historical-state-unavailable'
    : /method .*not|not (available|supported)|does not exist|not enabled/i.test(message) ? 'method-unavailable'
    : /request |too many|rate limit/i.test(message) ? 'request-limited'
    : 'rpc-error';
  return { status: 'unavailable', reason, ...(Number.isInteger(error?.code) && { code: error.code }) };
}

function probeSource(url) {
  let id = 0;
  return async function read(method, params, summarize = (result) => result) {
    if (!readMethods.has(method)) throw new Error('RPC method outside read-only allowlist');
    const requestId = ++id;
    let body;
    try {
      const response = await fetch(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8_000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
      });
      if (!response.ok) return { status: 'unavailable', reason: 'http-error', httpStatus: response.status };
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 192 * 1024) {
          await reader.cancel();
          return { status: 'unavailable', reason: 'response-limit' };
        }
        chunks.push(value);
      }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      return { status: 'unavailable', reason: error.name === 'TimeoutError' ? 'timeout' : 'transport-or-json' };
    }
    if (body?.id !== requestId || body.jsonrpc !== '2.0') return { status: 'unavailable', reason: 'invalid-envelope' };
    if (body.error) return publicFailure(body.error);
    if (body.result == null) return { status: 'unavailable', reason: 'no-result' };
    try {
      return { status: 'observed', value: summarize(body.result) };
    } catch {
      return { status: 'unavailable', reason: 'malformed-result' };
    }
  };
}

async function inspect(read, chainId, observation) {
  if (chainId.value !== expectedChain) return { chainId, status: 'unverified-chain' };
  const evidence = { chainId, blocks: {}, dependencies: {}, archiveForkDependencies: {} };
  for (const tag of ['safe', 'finalized', observation, quantity(forkBlock)]) {
    evidence.blocks[tag] = await read('eth_getBlockByNumber', [tag, false], blockHeader);
  }
  evidence.forkHeaderByHash = await read('eth_getBlockByHash', [forkHash, false], blockHeader);
  for (const [tag, target] of [[observation, evidence.dependencies], [quantity(forkBlock), evidence.archiveForkDependencies]]) {
    for (const [name, [address, expected]] of Object.entries(pins)) {
      target[name] = await read('eth_getCode', [address, tag], (code) => {
        const hash = keccak256(code);
        const result = { address, bytes: (code.length - 2) / 2, hash, matches: hash === expected };
        if (name === 'universalRouter212' && result.matches) {
          result.immutableMatches = Object.fromEntries(Object.entries(routerOffsets).map(([dependency, offsets]) => {
            const pin = pins[dependency][0].slice(2).toLowerCase().padStart(64, '0');
            return [dependency, offsets.every((offset) => code.slice(2 + offset * 2, 66 + offset * 2).toLowerCase() === pin)];
          }));
        }
        return result;
      });
      await delay(200);
    }
  }
  const call = (to, signature, block = observation) => read('eth_call', [{ to, data: toFunctionSelector(signature) }, block], (data) => {
    if (!/^0x(?:[0-9a-f]{64})+$/i.test(data)) throw new Error('Invalid ABI result');
    return data;
  });
  evidence.bindings = {};
  for (const name of ['positionManager', 'quoter', 'stateView', 'universalRouter212']) {
    evidence.bindings[`${name}.poolManager`] = await call(pins[name][0], 'poolManager()');
  }
  evidence.bindings['positionManager.permit2'] = await call(pins.positionManager[0], 'permit2()');
  evidence.bindings['historicalFactory.factoryRegistry'] = await call(historicalFactory.factory, 'factoryRegistry()');
  evidence.historicalFactoryCode = await read('eth_getCode', [historicalFactory.factory, observation], (code) => {
    const hash = keccak256(code);
    return { hash, matches: hash === historicalFactory.runtimeHash };
  });
  evidence.historicalRegistryCode = await read('eth_getCode', [historicalFactory.registry, observation], (code) => {
    const hash = keccak256(code);
    return { hash, matches: hash === historicalFactory.registryHash };
  });
  evidence.curveForkFactoryCode = await read('eth_getCode', [curveForkFactory, observation], (code) => ({
    address: curveForkFactory, empty: code === '0x',
  }));
  const arbGasInfo = '0x000000000000000000000000000000000000006c';
  const readGasWords = (signature, words, summarize) => read('eth_call',
    [{ to: arbGasInfo, data: toFunctionSelector(signature) }, observation], (data) => {
      if (!new RegExp(`^0x[0-9a-f]{${64 * words}}$`, 'i').test(data)) throw new Error('Invalid gas accounting result');
      return summarize(data.slice(2).match(/.{64}/g).map((word) => BigInt(`0x${word}`).toString()));
    });
  evidence.arbGasAccounting = await readGasWords('getGasAccountingParams()', 3, ([speedLimitPerSecond, gasPoolMax, maxBlockGas]) => ({
    speedLimitPerSecond, gasPoolMax, maxBlockGas,
  }));
  evidence.arbMaxTransactionGas = await readGasWords('getMaxTxGasLimit()', 1, ([maxTransactionGas]) => maxTransactionGas);
  evidence.verifyHistoricalReceipt = await read('eth_getTransactionReceipt', [registration.receipt.transactionHash], (receipt) => ({
    status: receipt.status, matched: receipt.status === '0x1' && receipt.blockHash === registration.receipt.blockHash &&
      receipt.to.toLowerCase() === historicalFactory.factory && receipt.logs.some(previousRegistration),
  }));
  const registrationBlock = quantity(registration.receipt.blockNumber);
  evidence.historicalLogs = await read('eth_getLogs', [{ address: historicalFactory.factory, topics: [registrationSelector],
    fromBlock: registrationBlock, toBlock: registrationBlock }], (logs) => ({ count: logs.length, matched: logs.some(previousRegistration) }));
  evidence.routerCreation = await read('eth_getTransactionReceipt', [routerCreation], (receipt) => ({ status: receipt.status,
    contractAddress: receipt.contractAddress, blockHash: receipt.blockHash, matches: receipt.status === '0x1' &&
      receipt.contractAddress.toLowerCase() === pins.universalRouter212[0].toLowerCase() && receipt.blockHash === routerCreationHash,
  }));
  evidence.historicalTrace = await read('debug_traceTransaction', [registration.receipt.transactionHash,
    { tracer: 'callTracer', timeout: '3s' }], (result) => ({
    tracer: 'callTracer', rootMatchesFactory: result.type === 'CALL' && result.to?.toLowerCase() === historicalFactory.factory &&
      (result.calls === undefined || Array.isArray(result.calls)), rootType: result.type ?? null,
  }));
  evidence.recheckedBlock = await read('eth_getBlockByNumber', [observation, false], blockHeader);
  return evidence;
}

const report = { observedAt: new Date().toISOString(), forkBlock, forkHash, evidence: {} };
const fixedBlock = process.argv[2];
if (fixedBlock !== undefined && !/^\d{1,10}$/.test(fixedBlock)) throw new Error('Optional block must be a decimal block height');
if (process.argv.length > 3) throw new Error('Only one optional block height is supported');
const official = probeSource(sources.official);
const chainId = await official('eth_chainId', []);
const observed = await official('eth_getBlockByNumber', [fixedBlock === undefined ? 'latest' : quantity(fixedBlock), false], blockHeader);
if (chainId.value !== expectedChain || observed.status !== 'observed') {
  console.log(JSON.stringify({ ...report, chainId, coordinator: observed }, null, 2));
  process.exitCode = 1;
} else {
  report.observation = observed.value;
  report.evidence.official = await inspect(official, chainId, quantity(observed.value.number));
  for (const name of ['pocket', 'pinax']) {
    const read = probeSource(sources[name]);
    report.evidence[name] = await inspect(read, await read('eth_chainId', []), quantity(observed.value.number));
  }
  report.currentEvidence = Object.fromEntries(Object.entries(report.evidence).map(([source, entry]) => [source, {
    sameBlockHash: entry.blocks?.[quantity(observed.value.number)]?.value?.hash === observed.value.hash &&
      entry.recheckedBlock?.value?.hash === observed.value.hash,
    allSixRuntimePinsMatch: Object.values(entry.dependencies ?? {}).length === 6 &&
      Object.values(entry.dependencies).every(({ value }) => value?.matches === true),
  }]));
  report.currentDependenciesVerified = report.currentEvidence.official.sameBlockHash && report.currentEvidence.official.allSixRuntimePinsMatch &&
    ['pocket', 'pinax'].some((name) => report.currentEvidence[name].sameBlockHash && report.currentEvidence[name].allSixRuntimePinsMatch);
  console.log(JSON.stringify(report, null, 2));
  if (!report.currentDependenciesVerified) process.exitCode = 1;
}
