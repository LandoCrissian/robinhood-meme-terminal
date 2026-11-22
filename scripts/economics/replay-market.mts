// Only loopback forks receive impersonated transactions. Remote endpoints serve read-only fork state.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { setTimeout as wait } from "node:timers/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { encodeTestV4Swap } from "../../apps/launch-website/lib/test-v4.ts";
import {
  selectors,
  tradeEvent,
  marketFill,
  addMarketFill,
  marketIntervals,
  graduationEvent,
  saleTarget,
  backingTarget,
} from "../../apps/indexer/src/market-candles.ts";
const require = createRequire(
  new URL("../../apps/launch-website/package.json", import.meta.url),
);
const {
  createPublicClient,
  http,
  parseAbi,
  encodeFunctionData,
  keccak256,
  stringToHex,
  decodeEventLog,
  parseEther,
  toHex,
  zeroAddress,
} = require("viem");
const endpoints = [
  "https://rpc.mainnet.chain.robinhood.com",
  "https://robinhood.api.pocket.network",
];
const factory = "0x7281e1F9D8764Ae6533b374DFd08AB2ECbC273c3",
  manager = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const guard = "0x998F3C0CE20cFF92655D495a159B1Ca37c162000",
  router = "0x204FAca1764B154221e35c0d20aBb3c525710498",
  permit = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const actor = "0x0000000000000000000000000000000000ec0190",
  clients = endpoints.map((url) =>
    createPublicClient({ transport: http(url), cacheTime: 0 }),
  );
const heads = await Promise.all(clients.map((r) => r.getBlockNumber()));
const base = (heads[0] < heads[1] ? heads[0] : heads[1]) - 24n;
const headers = await Promise.all(
  clients.map((r) => r.getBlock({ blockNumber: base })),
);
assert.equal(headers[0].hash, headers[1].hash);
const quoter = "0x8dc178efb8111bb0973dd9d722ebeff267c98f94";
const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256 amountOut,uint256 gasEstimate)",
]);
const abi = parseAbi([
  "function create(string,string,string,address,uint16,bytes32,uint256) payable returns(address,address)",
  "event CurveCreated(address indexed token,address indexed curve,address indexed creator,bytes32 intentId,uint256 supply,address revenueLedger,address treasury,uint16 treasuryShareBps,string name,string symbol,string projectURI)",
  "function buy(uint256,uint256) payable returns(uint256)",
  "function buyAndGraduate(uint256,uint256) payable returns(uint256)",
  "function graduate(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function sell(uint256,uint256,uint256) returns(uint256)",
  "function quoteBuy(uint256) view returns(uint256,uint256,uint256,uint256)",
  "function quoteSell(uint256) view returns(uint256,uint256,uint256)",
  "function sold() view returns(uint256)",
  "function backingReserve() view returns(uint256)",
  "function graduated() view returns(bool)",
  "function poolId() view returns(bytes32)",
  "function balanceOf(address) view returns(uint256)",
]);
const out = resolve(process.argv[3]);
mkdirSync(out, { recursive: true });
const stringify = (v: any) =>
  JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2) +
  "\n";
async function rehearse(url: string) {
  const socket = createServer();
  await new Promise<void>((r) => socket.listen(0, "127.0.0.1", r));
  const port = (socket.address() as any).port;
  await new Promise<void>((r) => socket.close(() => r()));
  const child = spawn(
    resolve(process.argv[2]),
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--fork-url",
      url,
      "--fork-block-number",
      String(base),
      "--accounts",
      "0",
      "--chain-id",
      "4663",
      "--no-storage-caching",
      "--silent",
      "--hardfork",
      "prague",
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  try {
    const rpc = createPublicClient({
      transport: http("http://127.0.0.1:" + port, {
        retryCount: 0,
        timeout: 90000,
      }),
      cacheTime: 0,
    });
    for (let i = 0; ; i++) {
      try {
        assert.equal(await rpc.getChainId(), 4663);
        break;
      } catch (e) {
        if (i > 70) throw e;
        await wait(250);
      }
    }
    const call = (method: string, params: any[] = []) =>
      rpc.request({ method, params });
    assert.equal(
      (await rpc.getBlock({ blockNumber: base })).hash,
      headers[0].hash,
    );
    assert.equal(
      keccak256(await rpc.getCode({ address: factory })),
      "0x519d55e694263866896e05023834b124829173f13f42c5aea7e3ca2200c5a091",
    );
    await call("anvil_impersonateAccount", [actor]);
    await call("anvil_setBalance", [actor, toHex(parseEther("30"))]);
    let token = "",
      curve = "",
      poolId: null | string = null,
      seq = 0,
      cutoff = headers[0].timestamp + 180n;
    const receipts: any[] = [],
      fills: any[] = [],
      frames: any[] = [],
      checks: string[] = [];
    async function tx(
      to: string,
      data: string,
      value = 0n,
      expect = "success",
    ) {
      await call("evm_setNextBlockTimestamp", [
        Math.floor(Number(headers[0].timestamp) / 60) * 60 +
          60 +
          ++seq * 18 +
          Math.floor(seq / 16) * 90,
      ]);
      const hash = await call("eth_sendTransaction", [
        { from: actor, to, data, value: toHex(value), gas: "0xb71b00" },
      ]);
      const receipt = await rpc.waitForTransactionReceipt({
        hash,
        pollingInterval: 150,
        timeout: 75000,
      });
      assert.equal(receipt.status, expect);
      const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
      assert.equal(block.hash, receipt.blockHash);
      cutoff = block.timestamp + 180n;
      receipts.push({
        hash,
        block: block.number,
        blockHash: block.hash,
        time: Number(block.timestamp),
        status: receipt.status,
        logs: receipt.logs
          .filter((l: any) => Object.values(selectors).includes(l.topics[0]))
          .map((l: any) => ({
            address: l.address,
            topics: l.topics,
            data: l.data,
            ordinal: l.logIndex,
          })),
      });
      return receipt;
    }
    const enc = (name: string, args: any[] = []) =>
      encodeFunctionData({ abi, functionName: name, args });
    const read = (address: string, functionName: string, args: any[] = []) =>
      rpc.readContract({ abi, address, functionName, args });
    const cr = await tx(
      factory,
      enc("create", [
        "Market rehearsal",
        "ECON",
        "",
        zeroAddress,
        0,
        keccak256(stringToHex("isolated market lifecycle")),
        cutoff,
      ]),
      parseEther("0.0004"),
    );
    for (const log of cr.logs) {
      try {
        const e = decodeEventLog({ abi, data: log.data, topics: log.topics });
        if (e.eventName === "CurveCreated") {
          token = e.args.token.toLowerCase();
          curve = e.args.curve.toLowerCase();
        }
      } catch {}
    }
    assert.ok(token && curve);
    const key = {
      currency0: zeroAddress,
      currency1: token,
      fee: 3000,
      tickSpacing: 60,
      hooks: guard,
    } as any;
    const poolQuote = async (buy: boolean, amount: bigint) => {
      const { result } = await rpc.simulateContract({
        abi: quoterAbi,
        address: quoter,
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey: key,
            zeroForOne: buy,
            exactAmount: amount,
            hookData: "0x",
          },
        ],
      });
      return result[0] as bigint;
    };
    let graduation: any = null;
    async function frame(label: string) {
      const [sold, backing, graduated, id] = await Promise.all(
        ["sold", "backingReserve", "graduated", "poolId"].map((n) =>
          read(curve, n),
        ),
      );
      const last = receipts.at(-1);
      if (graduated) poolId = id;
      for (const log of last.logs) {
        if (
          log.address.toLowerCase() === curve &&
          log.topics[0] === selectors.graduation
        ) {
          const { args } = decodeEventLog({
            abi: [graduationEvent],
            data: log.data,
            topics: log.topics,
          });
          assert.equal(args.poolId, id);
          assert.equal(args.nativeUsed + args.nativeDust, backingTarget);
          graduation = {
            time: last.time,
            poolId: id,
            nativeUsedWei: String(args.nativeUsed),
          };
        }
        if (
          log.address.toLowerCase() === curve &&
          log.topics[0] === selectors.curve
        ) {
          const { args: t } = decodeEventLog({
            abi: [tradeEvent],
            topics: log.topics,
            data: log.data,
          });
          assert.equal(t.sold, sold);
          assert.equal(t.backingReserve, graduated ? backingTarget : backing);
        }
        const fill = marketFill(log, { curves: [curve], manager, poolId });
        if (fill)
          fills.push({
            time: last.time,
            ...fill,
            hash: last.hash,
            ordinal: log.ordinal,
          });
      }
      const charts = Object.fromEntries(
        marketIntervals.map((interval) => {
          const buckets = new Map();
          for (const f of [...fills].reverse())
            addMarketFill(buckets, f.time, interval, f);
          return [interval, [...buckets.values()].reverse()];
        }),
      );
      const quotes = [];
      for (const [side, inputs] of [
        ["Buy", ["0.01", "0.05", "0.1"]],
        ["Sell", ["100000", "1000000", "5000000"]],
      ] as const) {
        for (const input of inputs) {
          const amount = parseEther(input),
            buy = side === "Buy";
          if (!graduated && (buy ? sold === saleTarget : amount > sold))
            continue;
          let output,
            refund = 0n;
          if (graduated) output = await poolQuote(buy, amount);
          else if (buy) {
            const q = await read(curve, "quoteBuy", [amount]);
            output = q[0];
            refund = q[3];
          } else output = (await read(curve, "quoteSell", [amount]))[0];
          quotes.push({
            side,
            input,
            outputWei: String(output),
            refundWei: String(refund),
          });
        }
      }
      frames.push({
        quotes,
        label,
        token,
        factory,
        checkpoint: {
          blockNumber: String(last.block),
          blockHash: last.blockHash,
          timestamp: new Date(last.time * 1000).toISOString(),
        },
        soldWei: String(sold),
        backingWei: String(backing),
        phase: graduated
          ? "graduated"
          : sold === saleTarget
            ? "eligible"
            : "curve",
        graduation,
        charts,
      });
    }
    await frame("Opening");
    const quote = (eth: bigint) => read(curve, "quoteBuy", [eth]);
    const buy = async (s: string, atomic = false) => {
      const value = parseEther(s),
        [output] = await quote(value);
      await tx(
        curve,
        enc(atomic ? "buyAndGraduate" : "buy", [output, cutoff]),
        value,
      );
    };
    const sell = async (amount: bigint) => {
      await tx(token, enc("approve", [curve, amount]));
      const [net] = await read(curve, "quoteSell", [amount]);
      await tx(curve, enc("sell", [amount, net, cutoff]));
    };
    for (const [i, size] of [
      "0.10",
      "0.17",
      "0.21",
      "0.08",
      "0.29",
      "0.14",
      "0.04",
      "0.19",
      "0.22",
      "0.15",
      "0.16",
    ].entries()) {
      await buy(size);
      await frame("Curve buy " + (i + 1));
      if (i === 3 || i === 7) {
        const prior = BigInt(frames.at(-1).soldWei);
        await sell(12_000_000n * 10n ** 18n);
        await frame("Curve sell " + (i + 1));
        assert.ok(BigInt(frames.at(-1).soldWei) < prior);
      }
    }
    const snapshot = await call("evm_snapshot");
    const oldLength = receipts.length;
    await buy("3");
    await frame("Pending graduation");
    assert.equal(frames.at(-1).phase, "eligible");
    const pending = frames.pop();
    const removed = fills.pop();
    await tx(curve, enc("graduate", [cutoff]));
    assert.equal(await read(curve, "graduated"), true);
    assert.ok(await call("evm_revert", [snapshot]));
    assert.equal(await read(curve, "graduated"), false);
    assert.equal(
      await rpc.getTransactionReceipt({ hash: removed.hash }).catch(() => null),
      null,
    );
    const orphaned = receipts.splice(oldLength);
    checks.push(
      "Standalone graduation and orphaned final buy rolled back before canonical replay",
    );
    const prior = await read(curve, "sold");
    await tx(
      curve,
      enc("buyAndGraduate", [1n, cutoff]),
      parseEther("0.00001"),
      "reverted",
    );
    assert.equal(await read(curve, "sold"), prior);
    checks.push("Underfunded atomic final buy reverted without changing sold");
    await buy("3", true);
    await frame("Atomic graduation");
    assert.equal(frames.at(-1).phase, "graduated");
    const checkSize = parseEther("0.01"),
      balance = await read(token, "balanceOf", [actor]);
    await tx(
      router,
      await encodeTestV4Swap(
        key,
        true,
        checkSize,
        ((await poolQuote(true, checkSize)) * 11n) / 10n,
        cutoff,
      ),
      checkSize,
      "reverted",
    );
    assert.equal(await read(token, "balanceOf", [actor]), balance);
    checks.push("Out-of-limit v4 purchase reverted with no token movement");
    for (const [i, size] of [
      "0.018",
      "0.031",
      "0.012",
      "0.023",
      "0.009",
      "0.04",
      "0.02",
      "0.05",
      "0.03",
      "0.01",
      "0.07",
      "0.02",
      "0.03",
      "0.01",
    ].entries()) {
      const amount = parseEther(size);
      await tx(
        router,
        await encodeTestV4Swap(
          key,
          true,
          amount,
          ((await poolQuote(true, amount)) * 99n) / 100n,
          cutoff,
        ),
        amount,
      );
      await frame("Pool buy " + (i + 1));
      if (i % 2 === 1) {
        const sale = (i % 4 === 1 ? 14_000_000n : 2_000_000n) * 10n ** 18n;
        await tx(token, enc("approve", [permit, sale]));
        const permitAbi = parseAbi([
          "function approve(address,address,uint160,uint48)",
        ]);
        await tx(
          permit,
          encodeFunctionData({
            abi: permitAbi,
            functionName: "approve",
            args: [token, router, sale, Number(cutoff)],
          }),
        );
        await tx(
          router,
          await encodeTestV4Swap(
            key,
            false,
            sale,
            ((await poolQuote(false, sale)) * 99n) / 100n,
            cutoff,
          ),
        );
        await frame("Pool sell " + (i + 1));
      }
    }
    assert.ok(fills.length === 35 && graduation);
    checks.push(
      "Curve buys and sells, atomic graduation and both v4 swap directions settled",
    );
    return {
      frames,
      pending,
      receipts,
      orphaned,
      checks,
      token,
      curve,
      poolId,
      fills,
    };
  } finally {
    child.kill();
  }
}
const both = await Promise.all(endpoints.map(rehearse));
function comparable(r: any) {
  return r.frames.map((f: any) => ({
    sold: f.soldWei,
    backing: f.backingWei,
    phase: f.phase,
    charts: f.charts,
    quotes: f.quotes,
    graduation: f.graduation,
  }));
}
assert.deepEqual(comparable(both[0]), comparable(both[1]));
writeFileSync(
  join(out, "receipts.json"),
  stringify({
    base: String(base),
    baseHash: headers[0].hash,
    providers: endpoints,
    primary: both[0].receipts,
    secondary: both[1].receipts,
    orphanedBranch: both[0].orphaned,
    checks: both[0].checks,
  }),
);
writeFileSync(
  join(out, "market-replay.json"),
  stringify({
    base: String(base),
    token: both[0].token,
    curve: both[0].curve,
    poolId: both[0].poolId,
    frames: both[0].frames,
    pending: both[0].pending,
  }),
);
console.log(
  JSON.stringify({
    base: String(base),
    canonicalReceipts: both[0].receipts.length,
    canonicalFills: both[0].fills.length,
    pool: both[0].poolId,
    checks: both[0].checks,
  }),
);
