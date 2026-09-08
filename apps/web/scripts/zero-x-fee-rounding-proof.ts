import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, zeroAddress } from "viem";
import { createZeroXSwapDiagnosticAdapter } from "../lib/server/vnext-zero-x-adapter";
import type { ZeroXPriceDiagnostic } from "../lib/server/vnext-zero-x-response-diagnostics";
import { zeroXIntegratorFeeAmount } from "../lib/vnext/zero-x-settlement";

async function main() {
  if (!process.env.RMT_ZEROX_API_KEY) process.loadEnvFile(".env.local");
  if (!process.env.RMT_ZEROX_API_KEY) throw new Error();
  const peep = getAddress("0xf0821f2bf570ca4e7499a9ed9db7c788fed9946f");
  const usdg = getAddress("0x5fc5360d0400a0fd4f2af552add042d716f1d168");
  const recipient = getAddress("0x1111111111111111111111111111111111111111");
  const rows: Record<string, unknown>[] = [];
  const seen: ZeroXPriceDiagnostic[] = [];
  const adapter = createZeroXSwapDiagnosticAdapter(value => seen.push(value));
  const originals = [
    { asset: zeroAddress, output: usdg, symbol: "ETH", decimals: 18, base: 500000000000000n },
    { asset: peep, output: usdg, symbol: "PEEP", decimals: 18, base: 46344563744511694555600n },
    { asset: usdg, output: peep, symbol: "USDG", decimals: 6, base: 1000000n }
  ];
  for (let observation = 1; observation <= 2; observation++) for (const input of originals) {
    const amounts = [0n, 1n, 199n, 200n, 201n, 399n, 600n].map(offset => input.base + offset);
    if (input.symbol === "PEEP") amounts.push(46344563744511694555819n);
    for (const amount of amounts) {
      seen.length = 0;
      const attempt = await adapter.quote({ chainId: 4663, inputAsset: input.asset, outputAsset: input.output,
        inputAmountAtomic: amount.toString(), amountIn: amount, recipient,
        inputIdentity: { address: input.asset, symbol: input.symbol, decimals: input.decimals },
        outputIdentity: { address: input.output, symbol: input.output === usdg ? "USDG" : "PEEP", decimals: input.output === usdg ? 6 : 18 } });
      const numerator = amount * 25n, floor = numerator / 10000n, ceil = (numerator + 9999n) / 10000n;
      const nearest = BigInt(zeroXIntegratorFeeAmount(amount.toString()));
      const bankers = numerator % 10000n === 5000n ? floor + floor % 2n : nearest;
      const returned = seen[0]?.economics.integratorFee?.amount ?? null;
      rows.push({ observation, symbol: input.symbol, assetContract: input.asset, outputAsset: input.output, decimals: input.decimals,
        sellAmount: amount.toString(), exactNumerator: numerator.toString(), denominator: "10000", remainder: (numerator % 10000n).toString(),
        integerFloor: floor.toString(), integerCeil: ceil.toString(), nearestHalfUp: nearest.toString(), nearestHalfEven: bankers.toString(),
        zeroXReturnedAmount: returned, floorMatch: returned === floor.toString(), ceilMatch: returned === ceil.toString(),
        nearestHalfUpMatch: returned === nearest.toString(), nearestHalfEvenMatch: returned === bankers.toString(),
        differenceFromFloor: returned === null ? null : (BigInt(returned) - floor).toString(),
        deviationNumerator: returned === null ? null : (BigInt(returned) * 10000n - numerator).toString(),
        status: attempt.status, reason: seen[0]?.reason ?? null });
    }
  }
  const out = resolve("../../evidence/trading-hardening/sell-response-closure"); mkdirSync(out, { recursive: true });
  const report = { observedAt: new Date().toISOString(), chainId: 4663, requestFeeBps: 25, requestSlippagePpm: 9900,
    feeAdmissionChanged: true, atomicPolicy: "OWNER_AUTHORIZED_NEAREST_INTEGER_HALF_UP", officialDocumentation: "https://docs.0x.org/evm/0x-swap-api/guides/monetize-your-app-using-swap",
    documentationFinding: "Formula documented; no explicit integer tie/rounding rule found. Live observations are not a contractual specification.",
    rows, walletRequests: 0, signatures: 0, transactions: 0 };
  writeFileSync(resolve(out, "fee-rounding.json"), JSON.stringify(report, null, 2) + "\n");
  const columns = Object.keys(rows[0]);
  writeFileSync(resolve(out, "fee-rounding.csv"), [columns.join(","), ...rows.map(row => columns.map(key => String(row[key] ?? "")).join(","))].join("\n") + "\n");
  const observed = rows.filter(row => row.zeroXReturnedAmount !== null);
  console.log(JSON.stringify({ cases: rows.length, observed: observed.length, floorMatches: observed.filter(row => row.floorMatch).length,
    ceilMatches: observed.filter(row => row.ceilMatch).length, halfUpMatches: observed.filter(row => row.nearestHalfUpMatch).length,
    halfEvenMatches: observed.filter(row => row.nearestHalfEvenMatch).length, feeAdmissionChanged: true }));
}
void main().catch(() => { console.error("ROUNDING_PROOF_UNAVAILABLE_NO_RAW_ERROR_RETAINED"); process.exitCode = 1; });
