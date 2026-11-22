import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { verifiedSolcExecution } from "../../packages/contracts/scripts/pinned-solc.mjs";

const require = createRequire(
  new URL("../../apps/launch-website/package.json", import.meta.url),
);
const {
  createPublicClient,
  http,
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  toFunctionSelector,
  toHex,
  parseAbi,
} = require("viem");
const { values } = parseArgs({
  options: {
    solc: { type: "string" },
    anvil: { type: "string" },
    output: { type: "string" },
    block: { type: "string" },
  },
});
assert.ok(values.solc && values.anvil && values.output);
const archive = (p) =>
  JSON.parse(
    gunzipSync(
      readFileSync(new URL("../../docs/evidence/" + p, import.meta.url)),
    ),
  );
const inputBytes = gunzipSync(
  readFileSync(
    new URL(
      "../../docs/evidence/rmt-task091/governance/source-publication/solc-standard-input-4663.json.gz",
      import.meta.url,
    ),
  ),
);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const inputHash = sha(inputBytes);
assert.equal(
  inputHash,
  "66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10",
);
const compiler = verifiedSolcExecution({ solc: values.solc });
function compile(input) {
  const out = JSON.parse(
    execFileSync(compiler.command, [...compiler.prefix, "--standard-json"], {
      input,
      maxBuffer: 40 * 1024 * 1024,
      timeout: 300000,
      windowsHide: true,
    }),
  );
  assert.ok(
    !out.errors?.some((e) => e.severity === "error"),
    JSON.stringify(out.errors?.filter((e) => e.severity === "error")),
  );
  return out.contracts;
}
const contracts = compile(inputBytes);
const original = archive("rmt-task090/migration/canonical-compilation.json.gz");
const factoryRequest = archive(
  "rmt-task091/governance/source-publication/RMTLaunchCurveFactoryV2.request.json.gz",
);
const probeSource = readFileSync(
  new URL("./GraduationProbe.sol", import.meta.url),
  "utf8",
);
const harness = compile(
  JSON.stringify({
    language: "Solidity",
    sources: { "Probe.sol": { content: probeSource } },
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode.object"] } },
    },
  }),
)["Probe.sol"].GraduationProbe;
const artifact = (name) => contracts["src/" + name + ".sol"][name];
const factory = "0x7281e1F9D8764Ae6533b374DFd08AB2ECbC273c3",
  engine = "0x10e540536F10ed36E5fC6638638f1d862e552D32",
  state = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  probe = "0x0000000000000000000000000000000000Ec0123";
const factoryName = "RMTLaunchCurveFactoryV2",
  curveName = "RMTLaunchBondingCurveV1";
const W = 10n ** 18n,
  M = 10n ** 6n * W,
  supply = 1000n * M,
  virtual = 1800n * M,
  eth = 4n * W,
  ceil = (a, b) => (a + b - 1n) / b;
const potential = (sold) => ceil(eth * virtual, virtual - sold) - eth;
const gross = (net) => ceil(net * 100n, 99n);
const targets = [0, 100, 200, 300, 400, 500, 599, 600].map(
  (x) => BigInt(x) * M,
);
const budgets = [...targets.map((s) => gross(potential(s))), 3n * W];
const providers = [
  "https://rpc.mainnet.chain.robinhood.com",
  "https://robinhood.api.pocket.network",
];
const rpc = (url) =>
  createPublicClient({
    transport: http(url, { timeout: 90000, retryCount: 0 }),
    cacheTime: 0,
  });
const clients = providers.map(rpc);
const heads = await Promise.all(clients.map((c) => c.getBlockNumber()));
const block = values.block
  ? BigInt(values.block)
  : heads.reduce((a, b) => (a < b ? a : b)) - 32n;
const names = new Map(original.immutableNames);
function fields(name) {
  return Object.entries(
    artifact(name).evm.deployedBytecode.immutableReferences,
  ).map(([id, ranges]) => ({ name: names.get(id), ranges }));
}
function bindRuntime(name, observed, getters) {
  const compiled = artifact(name).evm.deployedBytecode;
  let expected = Buffer.from(compiled.object, "hex");
  for (const { name: key, ranges } of fields(name)) {
    const bytes = Buffer.from(getters[key].slice(2), "hex");
    for (const { start, length } of ranges) {
      assert.equal(bytes.length, length);
      bytes.copy(expected, start);
    }
  }
  assert.ok(
    expected.equals(Buffer.from(observed.slice(2), "hex")),
    name + " runtime differs from compiler + getters",
  );
  return keccak256(observed);
}
const direct = [];
const quoteAbi = parseAbi([
  "function previewFunding(uint256,uint256,uint256,uint256) pure returns (uint160,uint128,uint128,uint128)",
]);
const ponsFactory = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const ponsAbi = parseAbi([
  "struct LaunchConfig { uint256 supply; uint256 curveFeeBps; uint256 phantomQuote; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; bool enabled; }",
  "function launchConfigCount() view returns(uint256)",
  "function getLaunchConfig(uint256) view returns(LaunchConfig)",
]);
for (const client of clients) {
  const point = await client.getBlock({ blockNumber: block });
  assert.equal(await client.getChainId(), 4663);
  const code = await client.getCode({ address: factory, blockNumber: block });
  assert.ok(
    code.includes(artifact(curveName).evm.bytecode.object),
    "Factory does not embed the compiled original curve",
  );
  const words = {};
  for (const f of fields(factoryName)) {
    const r = await client.call({
      to: factory,
      data: toFunctionSelector(f.name + "()"),
      blockNumber: block,
    });
    words[f.name] = r.data;
  }
  const factoryHash = bindRuntime(factoryName, code, words);
  assert.equal(factoryHash, factoryRequest.runtimeHash);
  const published = await client.readContract({
    address: "0xE677A69A8124714DD0d88b73BDf1B89cc791ca9C",
    abi: parseAbi(["function factories(uint32) view returns(address,bytes32)"]),
    functionName: "factories",
    args: [1],
    blockNumber: block,
  });
  assert.equal(published[0].toLowerCase(), factory.toLowerCase());
  assert.equal(published[1], factoryHash);
  const funding = await client.readContract({
    address: engine,
    abi: quoteAbi,
    functionName: "previewFunding",
    args: [2n * W, 400n * M, 1200n * M, 6n * W],
    blockNumber: block,
  });
  const readPons = (functionName, args = []) =>
    client.readContract({
      address: ponsFactory,
      abi: ponsAbi,
      functionName,
      args,
      blockNumber: block,
    });
  const count = await readPons("launchConfigCount");
  assert.ok(count <= 100n);
  const configs = [];
  for (let i = 0n; i < count; i++)
    configs.push({ id: i, ...(await readPons("getLaunchConfig", [i])) });
  direct.push({
    hash: point.hash,
    timestamp: point.timestamp,
    factoryHash,
    words,
    funding,
    ponsConfigs: configs,
  });
}
assert.deepEqual(direct[0], direct[1]);
const getters = [
  ...fields(curveName).map((f) => f.name),
  "VIRTUAL_ETH",
  "GRADUATION_BACKING",
  "TRADE_FEE_BPS",
  "executionVersion",
  "economicRules",
];
const payload = encodeFunctionData({
  abi: harness.abi,
  functionName: "run",
  args: [
    factory,
    state,
    getters.map((s) => toFunctionSelector(s + "()")),
    budgets,
  ],
});
async function runFork(url) {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const child = spawn(
    values.anvil,
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      "4663",
      "--accounts",
      "0",
      "--hardfork",
      "prague",
      "--fork-url",
      url,
      "--fork-block-number",
      String(block),
      "--silent",
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  let diagnostic = "";
  child.stderr.on("data", (s) => {
    diagnostic = (diagnostic + s).slice(-1200);
  });
  try {
    const local = rpc("http://127.0.0.1:" + port);
    let ready = false;
    for (let i = 0; i < 90 && child.exitCode === null; i++) {
      try {
        ready = (await local.getChainId()) === 4663;
        if (ready) break;
      } catch {}
      await delay(350);
    }
    assert.ok(ready, "Local fork startup failed. " + diagnostic);
    assert.equal(
      (await local.getBlock({ blockNumber: block })).hash,
      direct[0].hash,
    );
    const response = await local.request({
      method: "eth_call",
      params: [
        { to: probe, data: payload, gas: "0x2faf080" },
        "latest",
        {
          [probe]: {
            code: "0x" + harness.evm.deployedBytecode.object,
            balance: toHex(10n * W),
          },
        },
      ],
    });
    const result = decodeFunctionResult({
      abi: harness.abi,
      functionName: "run",
      data: response,
    });
    const { code, getterWords, ...r } = result;
    const words = Object.fromEntries(
      getters.map((key, i) => [key, getterWords[i]]),
    );
    assert.deepEqual(
      [
        "VIRTUAL_ETH",
        "GRADUATION_BACKING",
        "TRADE_FEE_BPS",
        "executionVersion",
        "totalSupply",
        "virtualToken",
        "graduationSold",
      ].map((k) => BigInt(words[k])),
      [eth, 2n * W, 100n, 1n, supply, virtual, 600n * M],
    );
    const curveHash = bindRuntime(curveName, code, words);
    assert.ok(r.eligibleBeforeGraduate);
    assert.equal(r.lpOwner.toLowerCase(), engine.toLowerCase());
    const [sqrt, liq, usedEth, usedTokens] = direct[0].funding;
    assert.deepEqual(
      [
        r.sqrtPriceX96,
        r.liquidity,
        2n * W - r.nativeDust,
        400n * M - r.tokenDust,
      ],
      [sqrt, liq, usedEth, usedTokens],
    );
    assert.equal(r.poolFee, 3000);
    const table = targets.map((s, i) => {
      const q = r.buys[i],
        budget = budgets[i],
        n = (budget * 99n) / 100n;
      const actual = virtual - ceil(eth * virtual, eth + n);
      const backing = potential(actual);
      assert.equal(q.tokens, actual);
      assert.equal(q.gross, gross(backing));
      assert.equal(q.fee, q.gross - backing);
      assert.equal(q.refund, budget - q.gross);
      return {
        targetAtomic: s,
        ...q,
        netBackingWei: backing,
        marginalWeiPerToken: {
          numerator: eth * virtual * W,
          denominator: (virtual - actual) ** 2n,
        },
        eligible: actual === 600n * M,
      };
    });
    const terminal = r.buys.at(-1);
    assert.equal(terminal.refund, 3n * W - gross(2n * W));
    const released = 2n * W - potential(500n * M);
    assert.deepEqual(r.sellBack, [
      released - ceil(released, 100n),
      released,
      ceil(released, 100n),
    ]);
    assert.equal(r.backingAfterSell, potential(500n * M));
    assert.equal(r.refill.tokens, 100n * M);
    const fees = terminal.fee + r.sellBack[2] + r.refill.fee,
      platform = fees / 10n;
    assert.deepEqual(r.feeBuckets, [
      fees - platform,
      0n,
      platform / 2n,
      platform - platform / 2n,
    ]);
    return { curveHash, words, table, ...r };
  } finally {
    child.kill();
  }
}
const runs = [];
for (const endpoint of providers) {
  console.log("Reading local fork of " + endpoint);
  runs.push(await runFork(endpoint));
}
assert.deepEqual(runs[0], runs[1]);
const report = {
  chainId: 4663,
  block,
  providers,
  observedAt: new Date(),
  compilerInputSha256: inputHash,
  compilerVersion: factoryRequest.fields.compilerversion,
  factory,
  engine,
  initcodeHash: keccak256(
    "0x" +
      artifact(factoryName).evm.bytecode.object +
      factoryRequest.fields.constructorArguments.replace(/^0x/, ""),
  ),
  curveCreationTemplateHash: keccak256(
    "0x" + artifact(curveName).evm.bytecode.object,
  ),
  direct: direct[0],
  forksAgreed: true,
  simulation: runs[0],
  stateChangesOnPublicProviders: 0,
};
assert.equal(report.initcodeHash, factoryRequest.initcodeHash);
writeFileSync(
  values.output,
  JSON.stringify(report, (_, x) => (typeof x === "bigint" ? String(x) : x), 2) +
    "\n",
);
console.log(
  "Both forks and live getter/bytecode checks passed at block " + block,
);
