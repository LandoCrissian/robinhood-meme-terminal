import { ImageResponse } from "next/og";

export const alt = "Historical RMT launchpad project record preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function ProjectOpenGraphImage({
  params
}: {
  params: Promise<{ address: string }>;
}) {
  await params;
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
          background: "linear-gradient(135deg, #050806 0%, #08140b 56%, #12331b 100%)",
          fontFamily: "Arial, sans-serif"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
            <div
              style={{
                width: "76px",
                height: "76px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid #55ee76",
                borderRadius: "18px",
                color: "#55ee76",
                fontSize: "27px",
                fontWeight: 900
              }}
            >
              RMT
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "28px", fontWeight: 900 }}>RMT LAUNCH</span>
              <span style={{ marginTop: "5px", color: "#8ca392", fontSize: "18px", letterSpacing: "0.12em" }}>
                CREATOR ECOSYSTEM
              </span>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              padding: "12px 18px",
              border: "1px solid #31553a",
              borderRadius: "999px",
              color: "#aab6ad",
              fontSize: "17px",
              fontWeight: 800
            }}
          >
            HISTORICAL · PUBLIC REVIEW CLOSED
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ color: "#55ee76", fontSize: "21px", fontWeight: 800, letterSpacing: "0.12em" }}>
            RMT-NATIVE PROJECT PAGE
          </span>
          <span style={{ marginTop: "17px", fontSize: "70px", fontWeight: 900, letterSpacing: "-0.045em" }}>
            Historical project record
          </span>
          <span style={{ marginTop: "10px", color: "#9caf9f", fontSize: "34px", fontWeight: 800 }}>
            RETIRED LAUNCHPAD
          </span>
        </div>

        <div style={{ display: "flex", gap: "12px" }}>
          {["ONCHAIN RECORD", "HISTORICAL PROVENANCE", "NO RELEASE REQUIREMENT", "PUBLIC REVIEW CLOSED"].map((label) => (
            <span
              key={label}
              style={{
                display: "flex",
                padding: "14px 18px",
                border: "1px solid #294531",
                borderRadius: "10px",
                background: "rgba(9, 18, 11, 0.72)",
                color: "#c9d5cc",
                fontSize: "16px",
                fontWeight: 800,
                letterSpacing: "0.06em"
              }}
            >
              {label}
            </span>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", color: "#809086", fontSize: "16px" }}>
          <span>ORIGIN · ACTIVITY · REWARDS · RISK EVIDENCE</span>
          <span>ROBINHOOD CHAIN · MAINNET</span>
        </div>
      </div>
    ),
    size
  );
}
