/** Presentation intelligence only. Neither launch admission nor state authorizes a swap. */
export type LaunchSource = "PONS" | "STONKBROKERS";
export type LaunchState =
  | "LAUNCHED"
  | "BONDING"
  | "GRADUATING"
  | "GRADUATED"
  | "ABORTED"
  | "RESCUED";
export type LaunchEvidence = {
  chainId: 4663;
  launchId: string;
  sourceId: string;
  source: LaunchSource;
  sourceVersion: "V1" | "V2" | "V2_R2";
  sourceContract: `0x${string}`;
  token: `0x${string}`;
  quoteAsset: `0x${string}` | null;
  creator: `0x${string}`;
  curve: `0x${string}` | null;
  initialMarket: `0x${string}` | null;
  liquidityDestination: `0x${string}` | null;
  relationship: "TOKEN_CREATED" | "TOKEN_ENROLLED";
  launchTransaction: `0x${string}`;
  launchBlock: string;
  launchBlockHash: `0x${string}`;
  logIndex: number;
  launchTime: string;
  state: LaunchState;
  /** A source read or confirmed event, never inferred from a ticker/provider label. */
  sourcePhase: string;
  progressBps: number | null;
  creatorTaxBps: number | null;
  /** Source Lens observation, independent of token/market execution authority. */
  marketCapUsd8?: string | null;
  /** An independently verified Project Graph relationship, never inferred here. */
  projectId?: string | null;
  graduatedMarkets: `0x${string}`[];
  graduationTransaction: `0x${string}` | null;
  graduationBlock: string | null;
  observedBlock: string;
  observedBlockHash: `0x${string}`;
  observedAt: string;
  identity: {
    name: string | null;
    symbol: string | null;
    decimals: number | null;
    artwork: string | null;
  };
  identityObservations?: Partial<
    Record<
      "name" | "symbol" | "decimals" | "artwork",
      { block: string; blockHash: `0x${string}`; observedAt: string }
    >
  >;
  evidenceClass: "ONCHAIN_VERIFIED";
};
export type LaunchDirectory = {
  chainId: 4663;
  status: "ready" | "partial" | "unavailable";
  entries: LaunchEvidence[];
  nextCursor: string | null;
  sources: {
    sourceId: string;
    indexedThrough: string | null;
    historicalFrom: string | null;
    status: "indexing" | "ready" | "unavailable";
  }[];
};

/** Official, onchain-verified launch authorities. Admission is intelligence only.
 * Runtime hashes/checkpoints belong to the producer manifest. */
export const RMT_LAUNCH_AUTHORITIES = [
  {
    id: "pons-v1",
    source: "PONS",
    version: "V1",
    contract: "0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb",
  },
  {
    id: "pons-v1-legacy",
    source: "PONS",
    version: "V1",
    contract: "0x0c37a24f5d23a486fa692d1500881d698b1f77a4",
  },
  {
    id: "pons-v2",
    source: "PONS",
    version: "V2",
    contract: "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
  },
  {
    id: "stonk-v2-weth",
    source: "STONKBROKERS",
    version: "V2",
    contract: "0xfcd61b25bbf3abd6cf0070d6328e351cc30eec9f",
  },
  {
    id: "stonk-v2-stonk",
    source: "STONKBROKERS",
    version: "V2",
    contract: "0x8f6782c5aa37804d08a9b7bf3984ff3245fd6cd4",
  },
  {
    id: "stonk-v2-usdg",
    source: "STONKBROKERS",
    version: "V2",
    contract: "0xd4f20033586977a2511f4a2db4af7c79a340d70a",
  },
  {
    id: "stonk-v2-gme",
    source: "STONKBROKERS",
    version: "V2",
    contract: "0x4b9dcd6ccfaef0f6d23065dd78e79d5e20ec8cfd",
  },
  {
    id: "stonk-v2-nvda",
    source: "STONKBROKERS",
    version: "V2",
    contract: "0xee96d955d5634813374ece4c74f2c0ff71b1f9fb",
  },
  {
    id: "stonk-v2-aapl",
    source: "STONKBROKERS",
    version: "V2",
    contract: "0xb0453a81cbf963903409fff18ad92941e1c7a864",
  },
  {
    id: "stonk-v2-spcx",
    source: "STONKBROKERS",
    version: "V2",
    contract: "0x0c3b4eded41696eff0ed70841f132b519d81c947",
  },
  {
    id: "stonk-v2-uso",
    source: "STONKBROKERS",
    version: "V2",
    contract: "0xdb3c81c841ff88db6cdfbddb0ee049d162a6053b",
  },
  {
    id: "stonk-v2-ybtc",
    source: "STONKBROKERS",
    version: "V2",
    contract: "0x472a1ab6aeb77e3479193fbe83b718f9bf5f8604",
  },
  {
    id: "stonk-v2-r2-weth",
    source: "STONKBROKERS",
    version: "V2_R2",
    contract: "0x5bceefba6fdf437a7388adc5c9056c827baca3b3",
  },
  {
    id: "stonk-v2-r2-stonk",
    source: "STONKBROKERS",
    version: "V2_R2",
    contract: "0x406fd0b957bb8cf1dd57c78540d009578e971131",
  },
  {
    id: "stonk-v2-r2-usdg",
    source: "STONKBROKERS",
    version: "V2_R2",
    contract: "0xf0a06ac7bbb0cc3049b68c257c3ee27ccea40eea",
  },
  {
    id: "stonk-v2-r2-gme",
    source: "STONKBROKERS",
    version: "V2_R2",
    contract: "0x5b21f8a5ef81586627b4725844ad447325d0992b",
  },
  {
    id: "stonk-v2-r2-nvda",
    source: "STONKBROKERS",
    version: "V2_R2",
    contract: "0xdf03953dca8db733345278a0c5fd2e81fa2a9b54",
  },
  {
    id: "stonk-v2-r2-aapl",
    source: "STONKBROKERS",
    version: "V2_R2",
    contract: "0xc522dfae0d1a140257702392b665183a6de7657f",
  },
  {
    id: "stonk-v2-r2-spcx",
    source: "STONKBROKERS",
    version: "V2_R2",
    contract: "0xd82da1d8ef59959b170b59147283ab1f2f1ca86a",
  },
  {
    id: "stonk-v2-r2-uso",
    source: "STONKBROKERS",
    version: "V2_R2",
    contract: "0x644b19512052a1b6d38d7b16c6c3fb1d3f7270d2",
  },
  {
    id: "stonk-v2-r2-ybtc",
    source: "STONKBROKERS",
    version: "V2_R2",
    contract: "0x2bd7f90cca4660da82aa693cf352ddb6275c76da",
  },
] as const;
