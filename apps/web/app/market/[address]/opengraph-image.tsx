import { ImageResponse } from "next/og";
import { fetchPublicMarket } from "../../../lib/server/public-market-catalog";
import { isPublicSearchMarket } from "../../../lib/public-market-discovery";
import { fetchPublicMarketImageDataUri } from "../../../lib/server/public-market-image";

export const alt = "RMT Launch verified Robinhood Chain market preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

function compactUsd(value: number) {
  return "$" + value.toLocaleString("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  });
}

export default async function MarketOpenGraphImage({
  params
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  const market = await fetchPublicMarket(address);
  const eligible = Boolean(market && isPublicSearchMarket(market));
  const name = eligible && market ? market.name : "Market review";
  const symbol = eligible && market ? market.symbol.replaceAll("$", "").slice(0, 20) : "RMT";
  const source = eligible && market?.project ? market.project.sourceName : "Robinhood Chain";
  const projectImage = eligible
    ? await fetchPublicMarketImageDataUri(market?.project?.imageUri)
    : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "58px 68px",
          color: "#f4f8f4",
          background: "linear-gradient(135deg, #050806 0%, #08130b 54%, #0d2414 100%)",
          fontFamily: "Arial, sans-serif"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
            <div
              style={{
                width: "74px",
                height: "74px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid #55ee76",
                borderRadius: "18px",
                color: "#55ee76",
                fontSize: "26px",
                fontWeight: 900
              }}
            >
              RMT
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "27px", fontWeight: 800 }}>RMT LAUNCH</span>
              <span style={{ marginTop: "5px", color: "#8ca392", fontSize: "18px", letterSpacing: "0.12em" }}>
                ROBINHOOD CHAIN MARKET INTELLIGENCE
              </span>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              padding: "12px 18px",
              border: "1px solid #31553a",
              borderRadius: "999px",
              color: eligible ? "#55ee76" : "#aab6ad",
              fontSize: "17px",
              fontWeight: 800
            }}
          >
            {eligible ? "ORIGIN CROSS-CHECKED" : "REVIEW REQUIRED"}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "28px", maxWidth: "1040px" }}>
          <div
            style={{
              width: "104px",
              height: "104px",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              border: "1px solid #31553a",
              borderRadius: "22px",
              background: "#0c1710",
              color: "#55ee76",
              fontSize: "32px",
              fontWeight: 900
            }}
          >
            {projectImage
              ? <img src={projectImage} width="104" height="104" alt="" style={{ objectFit: "cover" }} />
              : symbol.slice(0, 2).toUpperCase()}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ color: "#55ee76", fontSize: "22px", fontWeight: 800, letterSpacing: "0.11em" }}>
            {source.toUpperCase()} · PROJECT + POOL MATCHED
          </span>
          <div style={{ display: "flex", alignItems: "baseline", gap: "24px", marginTop: "16px" }}>
            <span style={{ fontSize: "68px", fontWeight: 900, letterSpacing: "-0.045em" }}>{name}</span>
            <span style={{ color: "#9bb0a0", fontSize: "32px", fontWeight: 800 }}>${symbol}</span>
          </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "14px" }}>
          {eligible && market ? (
            <>
              {[
                ["LIQUIDITY", compactUsd(market.liquidityUsd)],
                ["24H VOLUME", compactUsd(market.volume24h)],
                ["MARKET CAP / FDV", compactUsd(market.marketCapUsd || market.fdvUsd)]
              ].map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    width: "31%",
                    display: "flex",
                    flexDirection: "column",
                    padding: "18px 22px",
                    border: "1px solid #243c2b",
                    borderRadius: "12px",
                    background: "rgba(9, 18, 11, 0.76)"
                  }}
                >
                  <span style={{ color: "#748579", fontSize: "15px", fontWeight: 800, letterSpacing: "0.1em" }}>{label}</span>
                  <span style={{ marginTop: "7px", fontSize: "27px", fontWeight: 900 }}>{value}</span>
                </div>
              ))}
            </>
          ) : (
            <div style={{ display: "flex", color: "#9aaba0", fontSize: "25px" }}>
              Open RMT to review current market eligibility and risk evidence.
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", color: "#809086", fontSize: "16px" }}>
          <span>VERIFIED SNAPSHOT · SELF-CUSTODY · WALLET SIGNS</span>
          <span>MARKET SIGNALS ARE NOT SAFETY GUARANTEES</span>
        </div>
      </div>
    ),
    size
  );
}
