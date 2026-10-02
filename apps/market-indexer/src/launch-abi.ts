// Read-only subset of the official StonkBrokers integration ABI; no execution methods.
export const stonkPadAbi = [
  {
    type: "function",
    name: "launchCount",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quote",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IERC20",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "CurveClosed",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "raisedQuote",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "finalPriceQuoteWei",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "mcapUsd8",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LaunchAborted",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "tokensSwept",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LaunchArmed",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "supply",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "vQuote0",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "quoteUsd8",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
      {
        name: "deadline",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LaunchBonded",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "raisedQuote",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "burnedTokens",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LaunchCreated",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "token",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "creator",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "externalToken",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LegBonded",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "asset",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "pool",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "lockTokenId",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "legQuote",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
] as const;
export const stonkLensAbi = [
  {
    type: "function",
    name: "viewLaunch",
    inputs: [
      {
        name: "pad",
        type: "address",
        internalType: "contract StonkSafeLaunchpadV2",
      },
      {
        name: "id",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "v",
        type: "tuple",
        internalType: "struct SafeLaunchLensV2.LaunchView",
        components: [
          {
            name: "id",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "core",
            type: "tuple",
            internalType: "struct StonkSafeLaunchpadV2.Launch",
            components: [
              {
                name: "token",
                type: "address",
                internalType: "address",
              },
              {
                name: "creator",
                type: "address",
                internalType: "address",
              },
              {
                name: "startMcapUsd8",
                type: "uint64",
                internalType: "uint64",
              },
              {
                name: "gradMcapUsd8",
                type: "uint64",
                internalType: "uint64",
              },
              {
                name: "startTaxBps",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "decayPerMinuteBps",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "creatorFeeBpsSnap",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "protocolFeeBpsSnap",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "windowSecs",
                type: "uint32",
                internalType: "uint32",
              },
              {
                name: "startTime",
                type: "uint64",
                internalType: "uint64",
              },
              {
                name: "deadline",
                type: "uint64",
                internalType: "uint64",
              },
              {
                name: "externalToken",
                type: "bool",
                internalType: "bool",
              },
              {
                name: "sellsEnabled",
                type: "bool",
                internalType: "bool",
              },
              {
                name: "armed",
                type: "bool",
                internalType: "bool",
              },
              {
                name: "graduated",
                type: "bool",
                internalType: "bool",
              },
              {
                name: "bonded",
                type: "bool",
                internalType: "bool",
              },
              {
                name: "aborted",
                type: "bool",
                internalType: "bool",
              },
              {
                name: "loadedSupply",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "vQuote",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "vToken",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "realQuote",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "buyCount",
                type: "uint256",
                internalType: "uint256",
              },
            ],
          },
          {
            name: "taxBps",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "mcapUsd8Now",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "tokensSold",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "oracleFresh",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "legs",
            type: "address[]",
            internalType: "address[]",
          },
          {
            name: "pools",
            type: "address[]",
            internalType: "address[]",
          },
          {
            name: "lockIds",
            type: "uint256[]",
            internalType: "uint256[]",
          },
          {
            name: "lpQuote",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "lpFeeBpsSnap",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "closedAtTs",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "bufferSecs",
            type: "uint32",
            internalType: "uint32",
          },
          {
            name: "unsoldMode",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "eoaOnly",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "openEnded",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "postTaxBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "bondVenue",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "maxBuyPpm",
            type: "uint32",
            internalType: "uint32",
          },
          {
            name: "icoBoost",
            type: "bool",
            internalType: "bool",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;
