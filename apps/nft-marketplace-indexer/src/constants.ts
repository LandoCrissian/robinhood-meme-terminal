import { getAddress } from "viem";
export const ROBINHOOD_CHAIN_ID = 4663 as const;
export const OPENSEA_CHAIN = "robinhood" as const;
export const SEAPORT_1_6_ADDRESS = getAddress(
  "0x0000000000000068F116a894984e2DB1123eB395",
);
export const ROBINHOOD_WETH_ADDRESS = getAddress(
  "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
);
export const ZERO_ADDRESS = getAddress(
  "0x0000000000000000000000000000000000000000",
);
