import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { reviewOrigin } from "../../../lib/server/public-review";
import { TokenMarket, type ReplayFrame } from "../../_components/token-market";
import proof from "../../../../../docs/evidence/token-market/market-replay.json";
export const dynamic = "force-dynamic";
export default async function MarketReview() {
  const incoming = await headers();
  if (
    !reviewOrigin(incoming) &&
    !/^127\.0\.0\.1:\d+$/.test(incoming.get("host") ?? "")
  )
    notFound();
  const replay = [...proof.frames] as unknown as ReplayFrame[];
  // A reverted fork branch is a separate checkpoint. Never mix its fills into canonical candles.
  return (
    <>
      <header className="lpPageHeading">
        <div>
          <h1>
            Market rehearsal <small>ECON</small>
          </h1>
          <p>
            Robinhood Chain fork · recorded trades · base block {proof.base}
          </p>
        </div>
      </header>
      <TokenMarket
        token={proof.token}
        symbol="ECON"
        replay={[
          {
            ...proof.pending,
            label: "Alternate fork · graduation pending",
          } as unknown as ReplayFrame,
          ...replay,
        ]}
      />
    </>
  );
}
