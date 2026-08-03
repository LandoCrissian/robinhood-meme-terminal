import type { ExternalMarket } from "./external-market";

export const UNISWAP_LAUNCHES_ANNOUNCEMENT_URL =
  "https://blog.uniswap.org/launch-aggregator-explore-top-uniswap-launchpads-in-one-place";
export const UNISWAP_ROBINHOOD_ANNOUNCEMENT_URL =
  "https://blog.uniswap.org/robinhood-chain-is-live";
export const UNISWAP_LAUNCHPAD_DEPLOYMENTS_URL =
  "https://developers.uniswap.org/docs/liquidity/liquidity-launchpad/deployments";

export type LaunchDistributionVenue = "uniswap" | "sushi" | "other";
export type LaunchDistributionState =
  | "recognized-source-market"
  | "market-live"
  | "announced-watch"
  | "unverified";
export type MarketPassportTone = "verified" | "candidate" | "watch" | "unknown";

export type MarketPassportStep = {
  id: "origin" | "market" | "distribution";
  label: string;
  value: string;
  detail: string;
  tone: MarketPassportTone;
  evidenceUrl?: string;
  evidenceLabel?: string;
};

export type MarketDistributionPassport = {
  venue: LaunchDistributionVenue;
  state: LaunchDistributionState;
  isAttributedLaunch: boolean;
  summary: string;
  shortLabel: string;
  steps: MarketPassportStep[];
};

const UNISWAP_RECOGNIZED_SOURCE_IDS = new Set(["pons", "bankr", "long"]);

export function launchDistributionVenue(
  market: Pick<ExternalMarket, "dexId" | "venue">
): LaunchDistributionVenue {
  if (market.venue.kind !== "dex") return "other";
  const dexId = market.dexId.trim().toLowerCase();
  if (dexId === "uniswap" || dexId.startsWith("uniswap-")) return "uniswap";
  if (dexId.includes("sushi")) return "sushi";
  return "other";
}

function originStep(market: ExternalMarket): MarketPassportStep {
  if (market.project) {
    return {
      id: "origin",
      label: "Launch origin",
      value: `${market.project.sourceName} attributed`,
      detail: market.project.provenance === "public-api-and-dex-pool-cross-checked"
        ? "Project identity is attached only after the documented source record, token, and live DEX pool agree."
        : "Project identity is attached only after RMT cross-checks its source records against the live token.",
      tone: "verified"
    };
  }
  if (market.origin.kind === "rmt-v6") {
    return {
      id: "origin",
      label: "Launch origin",
      value: "RMT V6 verified",
      detail: "The active RMT factory and exact launch event establish this token's protocol origin.",
      tone: "verified"
    };
  }
  if (market.origin.state === "disputed") {
    return {
      id: "origin",
      label: "Launch origin",
      value: "Conflicting claims",
      detail: "RMT found incompatible origin evidence and does not attribute this token to a launchpad.",
      tone: "watch"
    };
  }
  return {
    id: "origin",
    label: "Launch origin",
    value: "Not attributed",
    detail: "A live market does not prove which platform created the token. RMT keeps the origin unknown.",
    tone: "unknown"
  };
}

function marketStep(market: ExternalMarket, venue: LaunchDistributionVenue): MarketPassportStep {
  if (market.venue.kind !== "dex") {
    return {
      id: "market",
      label: "Liquidity market",
      value: "Pre-DEX launch market",
      detail: "The token has not been matched to a qualified DEX pool in this snapshot.",
      tone: "watch"
    };
  }
  if (venue === "uniswap") {
    return {
      id: "market",
      label: "Liquidity market",
      value: `${market.dexId} pool live`,
      detail: "RMT matched the displayed token and pool to a live Robinhood Chain Uniswap market.",
      tone: "verified",
      evidenceUrl: UNISWAP_ROBINHOOD_ANNOUNCEMENT_URL,
      evidenceLabel: "Uniswap on Robinhood Chain"
    };
  }
  if (venue === "sushi") {
    return {
      id: "market",
      label: "Liquidity market",
      value: `${market.dexId} pool live`,
      detail: "RMT matched the displayed token and pool to a live Robinhood Chain Sushi market.",
      tone: "verified"
    };
  }
  return {
    id: "market",
    label: "Liquidity market",
    value: `${market.dexId} market live`,
    detail: "The displayed token and market are matched, but this venue is not an RMT in-site execution provider.",
    tone: "candidate"
  };
}

function distributionStep(
  market: ExternalMarket,
  venue: LaunchDistributionVenue
): Pick<MarketDistributionPassport, "state" | "summary" | "shortLabel"> & {
  step: MarketPassportStep;
} {
  const sourceId = market.project?.sourceId;
  if (venue === "uniswap" && sourceId && UNISWAP_RECOGNIZED_SOURCE_IDS.has(sourceId)) {
    return {
      state: "recognized-source-market",
      summary: "Recognized launch source and live Uniswap market. Individual beta-feed inclusion is not independently confirmed.",
      shortLabel: "Uniswap launch path",
      step: {
        id: "distribution",
        label: "Distribution",
        value: "Recognized Uniswap launch path",
        detail: `Uniswap publicly names ${market.project?.sourceName} as a Launches source. RMT verifies this token's source and Uniswap market separately, but does not claim this individual token is present in Uniswap's beta feed.`,
        tone: "candidate",
        evidenceUrl: UNISWAP_LAUNCHES_ANNOUNCEMENT_URL,
        evidenceLabel: "Official Launches announcement"
      }
    };
  }
  if (venue === "uniswap") {
    return {
      state: "market-live",
      summary: "Uniswap market live. Launches feed inclusion has not been independently verified.",
      shortLabel: "Uniswap market",
      step: {
        id: "distribution",
        label: "Distribution",
        value: "Uniswap market live",
        detail: "Liquidity on Uniswap makes this market externally tradeable, but it does not by itself prove inclusion in the Uniswap Launches beta feed.",
        tone: "candidate",
        evidenceUrl: UNISWAP_LAUNCHES_ANNOUNCEMENT_URL,
        evidenceLabel: "How Uniswap Launches works"
      }
    };
  }
  if (venue === "sushi") {
    if (sourceId === "sushi") {
      return {
        state: "recognized-source-market",
        summary: "Sushi Launch origin and its live Sushi V3 market are independently cross-checked.",
        shortLabel: "Sushi Launch verified",
        step: {
          id: "distribution",
          label: "Distribution",
          value: "Sushi Launch market verified",
          detail: "RMT matched Sushi's documented Launch API token, creator, factory and launch pool to the live DEX market. This attribution does not imply a partnership or a safety guarantee.",
          tone: "verified"
        }
      };
    }
    return {
      state: "announced-watch",
      summary: "Sushi market live, but this token has not been matched to a Sushi Launch record.",
      shortLabel: "Sushi market",
      step: {
        id: "distribution",
        label: "Distribution",
        value: "Sushi market only",
        detail: "A Sushi pool does not prove that the token originated through Sushi Launch. RMT keeps the origin separate until the documented launch record and pool agree.",
        tone: "watch"
      }
    };
  }
  return {
    state: "unverified",
    summary: "No supported external launch-distribution channel is independently confirmed.",
    shortLabel: "Distribution unverified",
    step: {
      id: "distribution",
      label: "Distribution",
      value: "Not independently verified",
      detail: "RMT has not confirmed a supported launch aggregator or launch protocol for this market.",
      tone: "unknown"
    }
  };
}

export function marketDistributionPassport(market: ExternalMarket): MarketDistributionPassport {
  const venue = launchDistributionVenue(market);
  const distribution = distributionStep(market, venue);
  return {
    venue,
    state: distribution.state,
    isAttributedLaunch: Boolean(market.project) || market.origin.kind === "rmt-v6",
    summary: distribution.summary,
    shortLabel: distribution.shortLabel,
    steps: [
      originStep(market),
      marketStep(market, venue),
      distribution.step
    ]
  };
}
