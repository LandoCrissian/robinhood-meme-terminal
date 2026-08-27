import { getAddress } from "viem";
import { RMT_SEAPORT_1_6_ADDRESS } from "@rmt/shared/nft/marketplace-evidence";
export const ROBINHOOD_CHAIN_ID = 4663 as const;
export const OPENSEA_CHAIN = "robinhood" as const;
export const SEAPORT_1_6_ADDRESS = getAddress(
  RMT_SEAPORT_1_6_ADDRESS,
);
export const ROBINHOOD_WETH_ADDRESS = getAddress(
  "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
);
export const ZERO_ADDRESS = getAddress(
  "0x0000000000000000000000000000000000000000",
);
