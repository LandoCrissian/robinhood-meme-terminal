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
  snapshotBlock: "41538389",
  snapshotBlockHash: "0x4b084af7e3ff614aa68c5c9114e0c03b8ef44b4c34bc10ad196dd5491ea497c4",
  snapshotHash: "0x86b8aa2ea3665a5a175bd93afef3c1b9a2cfbd3bd0c92e0b3651df3538bbe043",
  publicMinted: 654,
  reserveMinted: 250,
  totalSupply: 904,
  tokenBoundIdentitiesDiscovered: 654,
  ccff00PerSquare: "10,000",
  canaries: {
    verified: 3,
    total: 3,
    activated: 0,
    rmtDeposited: 0
  },
  canaryRows: [
    {
      tokenId: "470",
      owner: "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA",
      tokenBoundAccount: "0xFd1fDC1d3aA3AeEA37b265C691C7D367cBb20a6e",
      activated: false,
      ccff00Balance: "10,000",
      rmtBalance: "0"
    },
    {
      tokenId: "471",
      owner: "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA",
      tokenBoundAccount: "0xF26b9c1ecA9489A1AdCe201fB82630889cfe6246",
      activated: false,
      ccff00Balance: "10,000",
      rmtBalance: "0"
    },
    {
      tokenId: "472",
      owner: "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA",
      tokenBoundAccount: "0x3b71916De0aE9a4e2303dD6fCe66A8f6555c83D5",
      activated: false,
      ccff00Balance: "10,000",
      rmtBalance: "0"
    }
  ]
} as const;
