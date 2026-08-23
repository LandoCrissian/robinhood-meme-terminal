import type { SourceRegistration } from "../adapters.ts";
import { OPEN_SEA_SEAPORT } from "./opensea-seaport.ts";

export const NFT_SOURCE_REGISTRY: readonly SourceRegistration[] = Object.freeze([
  OPEN_SEA_SEAPORT,
  {
    sourceId: "mintera",
    displayName: "Mintera",
    chainId: 4663,
    admission: "candidate",
    identityState: "candidate",
    capabilities: ["catalogue", "listings", "item_offers", "collection_offers"],
    protocol: null,
    contractAddresses: [],
    apiKind: "none",
    evidence: ["https://mintera.art/"],
    blockers: [
      "Exact secondary-market protocol contract identity is not independently verified.",
      "No stable public developer API or schema has been admitted.",
      "Do not scrape private application endpoints as an execution dependency."
    ]
  },
  {
    sourceId: "hoodmarket",
    displayName: "HoodMarket",
    chainId: 4663,
    admission: "candidate",
    identityState: "candidate",
    capabilities: ["catalogue", "listings", "item_offers", "collection_offers"],
    protocol: null,
    contractAddresses: [],
    apiKind: "private_unsupported",
    evidence: [
      "https://docs.hoodmarket.io/",
      "https://docs.hoodmarket.io/contracts/overview",
      "https://docs.hoodmarket.io/contracts/addresses",
      "https://docs.hoodmarket.io/developers/overview"
    ],
    blockers: [
      "Published core addresses are primary-mint infrastructure, not the secondary trading protocol.",
      "Secondary-market contract identity and ABI must be independently verified before observation authority.",
      "Application endpoints are documented as private implementation details and must not be depended on."
    ]
  },
  {
    sourceId: "nightgarden",
    displayName: "Nightgarden",
    chainId: 4663,
    admission: "catalogue_only",
    identityState: "not_deployed",
    capabilities: ["catalogue"],
    protocol: null,
    contractAddresses: [],
    apiKind: "catalogue",
    evidence: [
      "https://nightgarden.app/docs/how-it-works",
      "https://nightgarden.app/docs/faq",
      "https://nightgarden.app/docs/contracts"
    ],
    blockers: ["Nightgarden documents that its market contract is not deployed; no trading capability may be inferred from catalogue UI."]
  },
  {
    sourceId: "stonkbrokers-anvil",
    displayName: "StonkBrokers / Anvil",
    chainId: 4663,
    admission: "candidate",
    identityState: "candidate",
    capabilities: ["catalogue", "listings", "item_offers"],
    protocol: null,
    contractAddresses: [
      "0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0",
      "0xe934e36a439c94017b64a3fece66af12099abf50",
      "0xe302733accf4800146e55fc45b46b4e4ffc032d2"
    ],
    apiKind: "onchain",
    evidence: [
      "https://www.stonkbrokers.cash/docs",
      "https://robinhoodchain.blockscout.com/address/0xe302733accf4800146e55fc45b46b4e4ffc032d2"
    ],
    blockers: [
      "Official docs and Blockscout anchor the live vault, collection and token addresses, but RMT has not yet pinned deployment boundary, runtime hash, full ABI/events or replay coverage.",
      "Do not infer market protocol from StonkBrokers collection origin or ERC-6551 account behavior."
    ]
  },
  {
    sourceId: "reservoir-hosted",
    displayName: "Reservoir Hosted API",
    chainId: 4663,
    admission: "unsupported",
    identityState: "unsupported",
    capabilities: [],
    protocol: null,
    contractAddresses: [],
    apiKind: "none",
    evidence: ["https://nft.reservoir.tools/reference/supported-chains"],
    blockers: ["Robinhood Chain is not listed among Reservoir hosted API chains as of the research date."]
  }
]);

export function sourceById(sourceId: string) {
  return NFT_SOURCE_REGISTRY.find((source) => source.sourceId === sourceId) ?? null;
}
