type CoinbaseSpotResponse = {
  data?: {
    amount?: string;
    currency?: string;
  };
};

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
      headers: { Accept: "application/json" },
      next: { revalidate: 30 }
    });
    if (!response.ok) throw new Error("Price provider unavailable.");
    const payload = await response.json() as CoinbaseSpotResponse;
    const usd = Number(payload.data?.amount);
    if (!Number.isFinite(usd) || usd <= 0 || payload.data?.currency !== "USD") {
      throw new Error("Invalid ETH price.");
    }
    return Response.json(
      { usd, source: "Coinbase spot", updatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } }
    );
  } catch {
    return Response.json(
      { error: "ETH/USD estimate is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
