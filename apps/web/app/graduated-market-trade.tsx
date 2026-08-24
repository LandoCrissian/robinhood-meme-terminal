import type { Address } from "viem";

export function GraduatedMarketTrade({
  symbol,
  mode
}: {
  tokenAddress: Address;
  symbol: string;
  launchId: bigint;
  mode: "buy" | "sell";
}) {
  return <div className="graduatedTradePanel" role="status">
    <strong>Legacy transaction preparation retired</strong>
    <p>
      The former {mode} flow for {symbol} is unavailable. RMT execution will be available through the verified V2 Terminal path.
    </p>
  </div>;
}
