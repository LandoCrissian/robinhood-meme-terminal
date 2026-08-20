export const CCFF00_OFFICIAL_LINKS = {
  ccff00: "https://hoodstreet.capital/ccff00",
  hoodstreet: "https://hoodstreet.capital/",
  myNeon: "https://hoodstreet.capital/my-neon",
  openSea: "https://opensea.io/collection/ccff00-161927574",
  ccff00X: "https://x.com/ccff00club",
  hoodstreetX: "https://x.com/hoodstreetcap"
} as const;

// Presentation-only evidence from the latest approved read-only canary run.
// This is block-bound context, never a live supply constant or execution manifest.
export const CCFF00_PRESENTATION_EVIDENCE = {
  status: "READ-ONLY PROOF IN PROGRESS",
  snapshotBlock: "41423445",
  snapshotBlockHash: "0x729b2eb09d6ca6e65e6de4d65a3f7015595cfb85a1cee4951786b952eb96f07f",
  snapshotHash: "0x1916436dde25ecc99109662b80f3f1e44157dafb951c0b638613201d7811bd21",
  publicMinted: 650,
  reserveMinted: 250,
  totalSupply: 900,
  tokenBoundIdentitiesDiscovered: 650,
  ccff00PerSquare: "10,000",
  canaries: {
    verified: 3,
    total: 3,
    activated: 0,
    rmtDeposited: 0
  }
} as const;
