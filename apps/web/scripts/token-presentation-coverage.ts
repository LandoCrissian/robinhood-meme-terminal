import { writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tokenChartReader } from "../lib/server/token-chart-market";
import { readTokenPresentationCategory } from "../lib/server/token-presentation-reader";
import { tokenArtwork } from "../lib/server/token-artwork-reader";
import { rmtCuratedMarketByToken } from "../lib/vnext/curated-market-registry";
import { projectsForContract } from "@rmt/shared/project-identity";

// Opt-in bounded public read-only sampling. No authenticated owner endpoints,
// provider keys, transaction requests, writes, or guessed NFT associations.
async function main() {
  const output = process.argv[2]; if (!output) throw new Error("Supply evidence output directory.");
  const inputs = [
    ["STONKBROKER", "0xe934e36a439c94017b64a3fece66af12099abf50", "known market"],
    ["SHCAT", "0x14c51bb55592372eac7141a1d0527d1dd7fbd42f", "no reviewed RMT canonical market; actual index membership not inferred"],
    ["CANNACAT", "0x1139d423c1706bdead91f03507f521635591ed92", "future project candidate; NFT relationship unverified"],
    ["HOPIUM", "0xb6ce51925c2e397ebf1a443b343d19267b3d4225", "future project candidate; NFT relationship unverified"],
    ["PEEP", "0xf0821f2bf570ca4e7499a9ed9db7c788fed9946f", "reviewed PEEP contract; not assumed to establish PEEPS/Founding Feathers"],
    ["USDG", "0x5fc5360d0400a0fd4f2af552add042d716f1d168", "stablecoin"],
    ["SPCX", "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea", "Stock Token view-only control"],
    ["CASHCAT", "0x020bfc650a365f8bb26819deaabf3e21291018b4", "known market control"],
    ["NEW_THIN_CONTROL", "0xe4a7e6fb649756ee70994fa53d575acbcc5a7adc", "Exact provider new-pool discovery at 2026-09-30T14:58:40Z; observed pool liquidity 0.5361 USD. Pool age is not token creation authority."]
  ];
  const results = [];
  for (const [index, [label, contract, category]] of inputs.entries()) {
    if (index > 0) await new Promise(resolve => setTimeout(resolve, 21_000));
    const started = Date.now();
    const [visual, market] = await Promise.all([readTokenPresentationCategory(contract, "visual"), readTokenPresentationCategory(contract, "market")]);
    const chart = await tokenChartReader.chart(contract, null, "1H", null).then(data => ({ coverage: data.coverage, pool: data.pair, candles: data.candles.length, stale: data.stale, observedAt: data.updatedAt })).catch(error => ({ coverage: "UNAVAILABLE", cause: error?.code ?? "UNAVAILABLE", httpStatus: error?.status ?? null }));
    const art = await tokenArtwork(contract, null).then(data => data ? { coverage: "AVAILABLE", contentType: data.type, bytes: data.bytes.length } : { coverage: "MONOGRAM_FALLBACK" });
    const identityUrl = `https://www.rmtlaunch.fun/api/vnext/asset-identity?address=${contract}`;
    const identity = await fetch(identityUrl, { signal: AbortSignal.timeout(12_000) }).then(async response => ({ status: response.status, body: await response.json() })).catch(() => ({ status: null, body: null }));
    const search = await fetch(`https://www.rmtlaunch.fun/api/vnext/market-search?q=${contract}`, { signal: AbortSignal.timeout(12_000) }).then(async response => ({ status: response.status, body: await response.json() })).catch(() => ({ status: null, body: null }));
    results.push({ label, contract, category, visual, market, chart, artwork: art, identity, search, latencyMs: Date.now() - started, reviewedCanonicalMarket: Boolean(rmtCuratedMarketByToken(contract)), canonicalProjectEdges: projectsForContract(contract).length });
    console.log(JSON.stringify({ label, visual: visual.state, market: market.state, chart, artwork: art.coverage, identity: identity.status, search: search.status }));
  }
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/real-provider-coverage.json`, JSON.stringify({ evidence: "LIVE_READ_ONLY_PUBLIC_PROVIDER_AND_SIGNED_OUT_RMT_READS", sampledAt: new Date().toISOString(), head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sourceDirty: Boolean(execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim()), productionMutations: 0, financialActions: 0, results, limitations: ["Provider observations are not onchain execution identity", "No owner-authenticated swap acceptance", "No inferred Token/NFT pairs", "Indexed-pool absence is not established by reviewed-catalog absence", "Mobile/desktop rendering is recorded separately in controlled browser evidence"] }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.name : "Coverage probe failed"); process.exitCode = 1; });
