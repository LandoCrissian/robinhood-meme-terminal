import type { RmtProjectIdentity } from "./project-identity.js";

// Owner-supplied candidates independently checked against exact chain-4663
// contracts. Full technical, artwork and unresolved evidence is retained in
// docs/projects/nft-project-batch-evidence.json. No NFT indexer admission.
export const NFT_PROJECT_BATCH_EVIDENCE: readonly RmtProjectIdentity[] = [
  {
    "projectId": "receipts",
    "displayName": "RECEIPTS",
    "discovery": "VERIFIED",
    "officialEvidence": [],
    "links": [
      {
        "label": "OpenSea",
        "url": "https://opensea.io/collection/rcpts",
        "evidence": [
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/rcpts",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      },
      {
        "label": "X",
        "url": "https://x.com/TheRCPTS",
        "evidence": [
          {
            "class": "DERIVED",
            "source": "https://opensea.io/collection/rcpts",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      }
    ],
    "artwork": null,
    "assets": [
      {
        "chainId": 4663,
        "contract": "0x7d90c589aaaf37f2fd0e4231a5f4aa089cc91555",
        "kind": "ERC721",
        "relationship": "OWNER_APPROVED_COLLECTION",
        "observedAt": "2026-10-03T00:54:51.784Z",
        "verification": "VERIFIED",
        "name": "RECEIPTS",
        "symbol": "RCPTS",
        "evidence": [
          {
            "class": "OWNER_SUPPLIED_CANDIDATE",
            "source": "RMT_PROJECTS_SCANNER_AND_NFT_PROJECT_BATCH_V1: https://opensea.io/collection/rcpts",
            "observedAt": "2026-10-03T00:54:51.784Z"
          },
          {
            "class": "ONCHAIN_VERIFIED",
            "source": "https://rpc.mainnet.chain.robinhood.com/",
            "observedAt": "2026-10-03T00:54:51.784Z",
            "blockNumber": "78675838"
          },
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/rcpts",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ],
        "destinations": [
          {
            "kind": "MARKETPLACE",
            "label": "OpenSea",
            "url": "https://opensea.io/collection/rcpts",
            "evidence": [
              {
                "class": "PROVIDER_VERIFIED",
                "source": "https://opensea.io/collection/rcpts",
                "observedAt": "2026-10-03T00:54:51.784Z"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "projectId": "gogh-punks",
    "displayName": "Gogh Punks",
    "discovery": "VERIFIED",
    "officialEvidence": [],
    "links": [
      {
        "label": "OpenSea",
        "url": "https://opensea.io/collection/gogh-punks-255843210",
        "evidence": [
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/gogh-punks-255843210",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      },
      {
        "label": "Website",
        "url": "https://goghpunks.xyz/",
        "evidence": [
          {
            "class": "DERIVED",
            "source": "https://opensea.io/collection/gogh-punks-255843210",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      },
      {
        "label": "X",
        "url": "https://x.com/goghpunks",
        "evidence": [
          {
            "class": "DERIVED",
            "source": "https://opensea.io/collection/gogh-punks-255843210",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      }
    ],
    "artwork": null,
    "assets": [
      {
        "chainId": 4663,
        "contract": "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6",
        "kind": "ERC721",
        "relationship": "OWNER_APPROVED_COLLECTION",
        "observedAt": "2026-10-03T00:54:51.784Z",
        "verification": "VERIFIED",
        "name": "Gogh Punks",
        "symbol": "GOGH",
        "evidence": [
          {
            "class": "OWNER_SUPPLIED_CANDIDATE",
            "source": "RMT_PROJECTS_SCANNER_AND_NFT_PROJECT_BATCH_V1: https://opensea.io/collection/gogh-punks-255843210",
            "observedAt": "2026-10-03T00:54:51.784Z"
          },
          {
            "class": "ONCHAIN_VERIFIED",
            "source": "https://rpc.mainnet.chain.robinhood.com/",
            "observedAt": "2026-10-03T00:54:51.784Z",
            "blockNumber": "78675838"
          },
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/gogh-punks-255843210",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ],
        "destinations": [
          {
            "kind": "MARKETPLACE",
            "label": "OpenSea",
            "url": "https://opensea.io/collection/gogh-punks-255843210",
            "evidence": [
              {
                "class": "PROVIDER_VERIFIED",
                "source": "https://opensea.io/collection/gogh-punks-255843210",
                "observedAt": "2026-10-03T00:54:51.784Z"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "projectId": "pixel-hood",
    "displayName": "Pixel Hood",
    "discovery": "VERIFIED",
    "officialEvidence": [],
    "links": [
      {
        "label": "Pixel Hood Minis · OpenSea",
        "url": "https://opensea.io/collection/pixelhoodminis",
        "evidence": [
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/pixelhoodminis",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      },
      {
        "label": "X",
        "url": "https://x.com/pixelord",
        "evidence": [
          {
            "class": "DERIVED",
            "source": "https://opensea.io/collection/pixelhoodminis",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      },
      {
        "label": "Pixel Hood Clan · OpenSea",
        "url": "https://opensea.io/collection/pixelhoodclan",
        "evidence": [
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/pixelhoodclan",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      },
      {
        "label": "Website",
        "url": "https://linktr.ee/pixelord",
        "evidence": [
          {
            "class": "DERIVED",
            "source": "https://opensea.io/collection/pixelhoodclan",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      }
    ],
    "artwork": null,
    "assets": [
      {
        "chainId": 4663,
        "contract": "0x745c261680aebabe4a0e0ab9e0a2e8a7aa756871",
        "kind": "ERC721",
        "relationship": "OWNER_APPROVED_COLLECTION",
        "observedAt": "2026-10-03T00:54:51.784Z",
        "verification": "VERIFIED",
        "name": "Pixel Hood Clan",
        "symbol": "PIXELHOOD",
        "evidence": [
          {
            "class": "OWNER_SUPPLIED_CANDIDATE",
            "source": "RMT_PROJECTS_SCANNER_AND_NFT_PROJECT_BATCH_V1: https://opensea.io/collection/pixelhoodclan",
            "observedAt": "2026-10-03T00:54:51.784Z"
          },
          {
            "class": "ONCHAIN_VERIFIED",
            "source": "https://rpc.mainnet.chain.robinhood.com/",
            "observedAt": "2026-10-03T00:54:51.784Z",
            "blockNumber": "78675838"
          },
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/pixelhoodclan",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ],
        "destinations": [
          {
            "kind": "MARKETPLACE",
            "label": "OpenSea",
            "url": "https://opensea.io/collection/pixelhoodclan",
            "evidence": [
              {
                "class": "PROVIDER_VERIFIED",
                "source": "https://opensea.io/collection/pixelhoodclan",
                "observedAt": "2026-10-03T00:54:51.784Z"
              }
            ]
          }
        ]
      },
      {
        "chainId": 4663,
        "contract": "0x8215824669c453136cabe59a079c32aca2f87cd5",
        "kind": "ERC721",
        "relationship": "OWNER_APPROVED_COLLECTION",
        "observedAt": "2026-10-03T00:54:51.784Z",
        "verification": "VERIFIED",
        "name": "Pixel Hood Minis",
        "symbol": "PXLHOODMINIS",
        "evidence": [
          {
            "class": "OWNER_SUPPLIED_CANDIDATE",
            "source": "RMT_PROJECTS_SCANNER_AND_NFT_PROJECT_BATCH_V1: https://opensea.io/collection/pixelhoodminis",
            "observedAt": "2026-10-03T00:54:51.784Z"
          },
          {
            "class": "ONCHAIN_VERIFIED",
            "source": "https://rpc.mainnet.chain.robinhood.com/",
            "observedAt": "2026-10-03T00:54:51.784Z",
            "blockNumber": "78675838"
          },
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/pixelhoodminis",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ],
        "destinations": [
          {
            "kind": "MARKETPLACE",
            "label": "OpenSea",
            "url": "https://opensea.io/collection/pixelhoodminis",
            "evidence": [
              {
                "class": "PROVIDER_VERIFIED",
                "source": "https://opensea.io/collection/pixelhoodminis",
                "observedAt": "2026-10-03T00:54:51.784Z"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "projectId": "sknots-go-down",
    "displayName": "Sknots Go Down",
    "discovery": "VERIFIED",
    "officialEvidence": [],
    "links": [
      {
        "label": "OpenSea",
        "url": "https://opensea.io/collection/sknots-go-down",
        "evidence": [
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/sknots-go-down",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      },
      {
        "label": "X",
        "url": "https://x.com/RealCashpig",
        "evidence": [
          {
            "class": "DERIVED",
            "source": "https://opensea.io/collection/sknots-go-down",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      }
    ],
    "artwork": null,
    "assets": [
      {
        "chainId": 4663,
        "contract": "0x496f1e53ef6c1af48341b9d0a03249108cf26543",
        "kind": "ERC721",
        "relationship": "OWNER_APPROVED_COLLECTION",
        "observedAt": "2026-10-03T00:54:51.784Z",
        "verification": "VERIFIED",
        "name": "SKNOTS",
        "symbol": "SKNOTS",
        "evidence": [
          {
            "class": "OWNER_SUPPLIED_CANDIDATE",
            "source": "RMT_PROJECTS_SCANNER_AND_NFT_PROJECT_BATCH_V1: https://opensea.io/collection/sknots-go-down",
            "observedAt": "2026-10-03T00:54:51.784Z"
          },
          {
            "class": "ONCHAIN_VERIFIED",
            "source": "https://rpc.mainnet.chain.robinhood.com/",
            "observedAt": "2026-10-03T00:54:51.784Z",
            "blockNumber": "78675838"
          },
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/sknots-go-down",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ],
        "destinations": [
          {
            "kind": "MARKETPLACE",
            "label": "OpenSea",
            "url": "https://opensea.io/collection/sknots-go-down",
            "evidence": [
              {
                "class": "PROVIDER_VERIFIED",
                "source": "https://opensea.io/collection/sknots-go-down",
                "observedAt": "2026-10-03T00:54:51.784Z"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "projectId": "robinhood-bear",
    "displayName": "Robinhood Bear",
    "discovery": "VERIFIED",
    "officialEvidence": [],
    "links": [
      {
        "label": "OpenSea",
        "url": "https://opensea.io/collection/robinhoodbear",
        "evidence": [
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/robinhoodbear",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      },
      {
        "label": "X",
        "url": "https://x.com/Robinhood_Bear",
        "evidence": [
          {
            "class": "DERIVED",
            "source": "https://opensea.io/collection/robinhoodbear",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      }
    ],
    "artwork": null,
    "assets": [
      {
        "chainId": 4663,
        "contract": "0x0084e3f586dfd424b959e80537208cef4cbcee21",
        "kind": "ERC721",
        "relationship": "OWNER_APPROVED_COLLECTION",
        "observedAt": "2026-10-03T00:54:51.784Z",
        "verification": "VERIFIED",
        "name": "Robinhood Bear",
        "symbol": "RHB",
        "evidence": [
          {
            "class": "OWNER_SUPPLIED_CANDIDATE",
            "source": "RMT_PROJECTS_SCANNER_AND_NFT_PROJECT_BATCH_V1: https://opensea.io/collection/robinhoodbear",
            "observedAt": "2026-10-03T00:54:51.784Z"
          },
          {
            "class": "ONCHAIN_VERIFIED",
            "source": "https://rpc.mainnet.chain.robinhood.com/",
            "observedAt": "2026-10-03T00:54:51.784Z",
            "blockNumber": "78675838"
          },
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/robinhoodbear",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ],
        "destinations": [
          {
            "kind": "MARKETPLACE",
            "label": "OpenSea",
            "url": "https://opensea.io/collection/robinhoodbear",
            "evidence": [
              {
                "class": "PROVIDER_VERIFIED",
                "source": "https://opensea.io/collection/robinhoodbear",
                "observedAt": "2026-10-03T00:54:51.784Z"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "projectId": "suited-ape-society",
    "displayName": "Suited Ape Society",
    "discovery": "VERIFIED",
    "officialEvidence": [],
    "links": [
      {
        "label": "OpenSea",
        "url": "https://opensea.io/collection/suited-ape-society",
        "evidence": [
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/suited-ape-society",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      },
      {
        "label": "Website",
        "url": "https://suitedapes.com/",
        "evidence": [
          {
            "class": "DERIVED",
            "source": "https://opensea.io/collection/suited-ape-society",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      },
      {
        "label": "X",
        "url": "https://x.com/TheSuitedApes",
        "evidence": [
          {
            "class": "DERIVED",
            "source": "https://opensea.io/collection/suited-ape-society",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      }
    ],
    "artwork": null,
    "assets": [
      {
        "chainId": 4663,
        "contract": "0xe638f58c87258ece6c0eddc46f70327663635c69",
        "kind": "ERC721",
        "relationship": "OWNER_APPROVED_COLLECTION",
        "observedAt": "2026-10-03T00:54:51.784Z",
        "verification": "VERIFIED",
        "name": "Suited Ape Society",
        "symbol": "SUITEDAPES",
        "evidence": [
          {
            "class": "OWNER_SUPPLIED_CANDIDATE",
            "source": "RMT_PROJECTS_SCANNER_AND_NFT_PROJECT_BATCH_V1: https://opensea.io/collection/suited-ape-society",
            "observedAt": "2026-10-03T00:54:51.784Z"
          },
          {
            "class": "ONCHAIN_VERIFIED",
            "source": "https://rpc.mainnet.chain.robinhood.com/",
            "observedAt": "2026-10-03T00:54:51.784Z",
            "blockNumber": "78675838"
          },
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/suited-ape-society",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ],
        "destinations": [
          {
            "kind": "MARKETPLACE",
            "label": "OpenSea",
            "url": "https://opensea.io/collection/suited-ape-society",
            "evidence": [
              {
                "class": "PROVIDER_VERIFIED",
                "source": "https://opensea.io/collection/suited-ape-society",
                "observedAt": "2026-10-03T00:54:51.784Z"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "projectId": "claystonkz",
    "displayName": "Clay StonKz",
    "discovery": "VERIFIED",
    "officialEvidence": [],
    "links": [
      {
        "label": "OpenSea",
        "url": "https://opensea.io/collection/claystonkz",
        "evidence": [
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/claystonkz",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      },
      {
        "label": "Website",
        "url": "https://claystonkz.com/",
        "evidence": [
          {
            "class": "DERIVED",
            "source": "https://opensea.io/collection/claystonkz",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      },
      {
        "label": "X",
        "url": "https://x.com/Brrrbon_",
        "evidence": [
          {
            "class": "DERIVED",
            "source": "https://opensea.io/collection/claystonkz",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      }
    ],
    "artwork": null,
    "assets": [
      {
        "chainId": 4663,
        "contract": "0xde0acefc89d4cf5f4ce45a4fb8a51aa355091b44",
        "kind": "ERC721",
        "relationship": "OWNER_APPROVED_COLLECTION",
        "observedAt": "2026-10-03T00:54:51.784Z",
        "verification": "VERIFIED",
        "name": "Clay StonKz",
        "symbol": "CLAYZ",
        "evidence": [
          {
            "class": "OWNER_SUPPLIED_CANDIDATE",
            "source": "RMT_PROJECTS_SCANNER_AND_NFT_PROJECT_BATCH_V1: https://opensea.io/collection/claystonkz",
            "observedAt": "2026-10-03T00:54:51.784Z"
          },
          {
            "class": "ONCHAIN_VERIFIED",
            "source": "https://rpc.mainnet.chain.robinhood.com/",
            "observedAt": "2026-10-03T00:54:51.784Z",
            "blockNumber": "78675838"
          },
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/claystonkz",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ],
        "destinations": [
          {
            "kind": "MARKETPLACE",
            "label": "OpenSea",
            "url": "https://opensea.io/collection/claystonkz",
            "evidence": [
              {
                "class": "PROVIDER_VERIFIED",
                "source": "https://opensea.io/collection/claystonkz",
                "observedAt": "2026-10-03T00:54:51.784Z"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "projectId": "spawnhood",
    "displayName": "Spawnhood",
    "discovery": "VERIFIED",
    "officialEvidence": [],
    "links": [
      {
        "label": "OpenSea",
        "url": "https://opensea.io/collection/spawnhood",
        "evidence": [
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/spawnhood",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      },
      {
        "label": "Website",
        "url": "https://spawnhood.com/",
        "evidence": [
          {
            "class": "DERIVED",
            "source": "https://opensea.io/collection/spawnhood",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      },
      {
        "label": "X",
        "url": "https://x.com/Spawntoshi",
        "evidence": [
          {
            "class": "DERIVED",
            "source": "https://opensea.io/collection/spawnhood",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      }
    ],
    "artwork": null,
    "assets": [
      {
        "chainId": 4663,
        "contract": "0xdb7cf5bb66efbf995545e5335cb107ed32866d29",
        "kind": "ERC721",
        "relationship": "OWNER_APPROVED_COLLECTION",
        "observedAt": "2026-10-03T00:54:51.784Z",
        "verification": "VERIFIED",
        "name": "SPAWNHOOD Genesis",
        "symbol": "SPWN",
        "evidence": [
          {
            "class": "OWNER_SUPPLIED_CANDIDATE",
            "source": "RMT_PROJECTS_SCANNER_AND_NFT_PROJECT_BATCH_V1: https://opensea.io/collection/spawnhood",
            "observedAt": "2026-10-03T00:54:51.784Z"
          },
          {
            "class": "ONCHAIN_VERIFIED",
            "source": "https://rpc.mainnet.chain.robinhood.com/",
            "observedAt": "2026-10-03T00:54:51.784Z",
            "blockNumber": "78675838"
          },
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/spawnhood",
            "observedAt": "2026-10-03T00:54:51.784Z"
          },
          {
            "class": "PROJECT_OFFICIAL",
            "source": "https://spawnhood.com/contract.json",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ],
        "destinations": [
          {
            "kind": "MARKETPLACE",
            "label": "OpenSea",
            "url": "https://opensea.io/collection/spawnhood",
            "evidence": [
              {
                "class": "PROVIDER_VERIFIED",
                "source": "https://opensea.io/collection/spawnhood",
                "observedAt": "2026-10-03T00:54:51.784Z"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "projectId": "stray-cars",
    "displayName": "Stray Cars",
    "discovery": "VERIFIED",
    "officialEvidence": [],
    "links": [
      {
        "label": "OpenSea",
        "url": "https://opensea.io/collection/stray-cars",
        "evidence": [
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/stray-cars",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      },
      {
        "label": "X",
        "url": "https://x.com/proofofcar",
        "evidence": [
          {
            "class": "DERIVED",
            "source": "https://opensea.io/collection/stray-cars",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      }
    ],
    "artwork": null,
    "assets": [
      {
        "chainId": 4663,
        "contract": "0xd0350532006a2e858487411606376fa04c76468c",
        "kind": "ERC721",
        "relationship": "OWNER_APPROVED_COLLECTION",
        "observedAt": "2026-10-03T00:54:51.784Z",
        "verification": "VERIFIED",
        "name": "Stray Cars",
        "symbol": "Stray",
        "evidence": [
          {
            "class": "OWNER_SUPPLIED_CANDIDATE",
            "source": "RMT_PROJECTS_SCANNER_AND_NFT_PROJECT_BATCH_V1: https://opensea.io/collection/stray-cars",
            "observedAt": "2026-10-03T00:54:51.784Z"
          },
          {
            "class": "ONCHAIN_VERIFIED",
            "source": "https://rpc.mainnet.chain.robinhood.com/",
            "observedAt": "2026-10-03T00:54:51.784Z",
            "blockNumber": "78675838"
          },
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/stray-cars",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ],
        "destinations": [
          {
            "kind": "MARKETPLACE",
            "label": "OpenSea",
            "url": "https://opensea.io/collection/stray-cars",
            "evidence": [
              {
                "class": "PROVIDER_VERIFIED",
                "source": "https://opensea.io/collection/stray-cars",
                "observedAt": "2026-10-03T00:54:51.784Z"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "projectId": "the-undeadz",
    "displayName": "THE UNDEADZ",
    "discovery": "VERIFIED",
    "officialEvidence": [],
    "links": [
      {
        "label": "OpenSea",
        "url": "https://opensea.io/collection/0xc180f7bb3a73edad6d30cf22813f2eba0ff3042d",
        "evidence": [
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/0xc180f7bb3a73edad6d30cf22813f2eba0ff3042d",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      },
      {
        "label": "Website",
        "url": "https://www.theundeadz.online/",
        "evidence": [
          {
            "class": "DERIVED",
            "source": "https://opensea.io/collection/0xc180f7bb3a73edad6d30cf22813f2eba0ff3042d",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      },
      {
        "label": "X",
        "url": "https://x.com/THEUNDEADZ0",
        "evidence": [
          {
            "class": "DERIVED",
            "source": "https://opensea.io/collection/0xc180f7bb3a73edad6d30cf22813f2eba0ff3042d",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      }
    ],
    "artwork": null,
    "assets": [
      {
        "chainId": 4663,
        "contract": "0xc180f7bb3a73edad6d30cf22813f2eba0ff3042d",
        "kind": "ERC721",
        "relationship": "OWNER_APPROVED_COLLECTION",
        "observedAt": "2026-10-03T00:54:51.784Z",
        "verification": "VERIFIED",
        "name": "THE UNDEADZ",
        "symbol": "TUZ",
        "evidence": [
          {
            "class": "OWNER_SUPPLIED_CANDIDATE",
            "source": "RMT_PROJECTS_SCANNER_AND_NFT_PROJECT_BATCH_V1: https://opensea.io/collection/0xc180f7bb3a73edad6d30cf22813f2eba0ff3042d",
            "observedAt": "2026-10-03T00:54:51.784Z"
          },
          {
            "class": "ONCHAIN_VERIFIED",
            "source": "https://rpc.mainnet.chain.robinhood.com/",
            "observedAt": "2026-10-03T00:54:51.784Z",
            "blockNumber": "78675838"
          },
          {
            "class": "PROVIDER_VERIFIED",
            "source": "https://opensea.io/collection/0xc180f7bb3a73edad6d30cf22813f2eba0ff3042d",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ],
        "destinations": [
          {
            "kind": "MARKETPLACE",
            "label": "OpenSea",
            "url": "https://opensea.io/collection/0xc180f7bb3a73edad6d30cf22813f2eba0ff3042d",
            "evidence": [
              {
                "class": "PROVIDER_VERIFIED",
                "source": "https://opensea.io/collection/0xc180f7bb3a73edad6d30cf22813f2eba0ff3042d",
                "observedAt": "2026-10-03T00:54:51.784Z"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "projectId": "robin-rabbits",
    "displayName": "Robin Rabbits",
    "discovery": "VERIFIED",
    "officialEvidence": [
      {
        "kind": "PROJECT_OFFICIAL",
        "url": "https://robinrabbits.com/court"
      }
    ],
    "links": [
      {
        "label": "Website",
        "url": "https://robinrabbits.com/",
        "evidence": [
          {
            "class": "PROJECT_OFFICIAL",
            "source": "https://robinrabbits.com/",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ]
      }
    ],
    "artwork": null,
    "assets": [
      {
        "chainId": 4663,
        "contract": "0xb87522e093858d992b7555077ff3541597deb34e",
        "kind": "ERC721",
        "relationship": "OWNER_APPROVED_COLLECTION",
        "observedAt": "2026-10-03T00:54:51.784Z",
        "verification": "VERIFIED",
        "name": "Robin Rabbits",
        "symbol": "MOON",
        "evidence": [
          {
            "class": "OWNER_SUPPLIED_CANDIDATE",
            "source": "RMT_PROJECTS_SCANNER_AND_NFT_PROJECT_BATCH_V1: https://robinrabbits.com/",
            "observedAt": "2026-10-03T00:54:51.784Z"
          },
          {
            "class": "ONCHAIN_VERIFIED",
            "source": "https://rpc.mainnet.chain.robinhood.com/",
            "observedAt": "2026-10-03T00:54:51.784Z",
            "blockNumber": "78675838"
          },
          {
            "class": "PROJECT_OFFICIAL",
            "source": "https://robinrabbits.com/court",
            "observedAt": "2026-10-03T00:54:51.784Z"
          }
        ],
        "destinations": [
          {
            "kind": "OFFICIAL_COLLECTION",
            "label": "Official collection",
            "url": "https://robinrabbits.com/court",
            "evidence": [
              {
                "class": "PROJECT_OFFICIAL",
                "source": "https://robinrabbits.com/court",
                "observedAt": "2026-10-03T00:54:51.784Z"
              }
            ]
          }
        ]
      }
    ],
    "pendingRelationships": [
      {
        "type": "PROJECT_HAS_NFT_COLLECTION",
        "reason": "SECOND_COLLECTION_CONTRACT_NOT_ESTABLISHED"
      }
    ]
  }
];
