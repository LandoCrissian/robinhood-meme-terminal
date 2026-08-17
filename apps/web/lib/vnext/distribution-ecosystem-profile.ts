import { type Address } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { CCFF00_COLLECTION } from "./distribution-ccff00";

export type EcosystemProjectLink = {
  label: string;
  url: string;
};

export type EcosystemProjectProfile = {
  id: string;
  projectName: string;
  collectionLabel: string;
  networkName: string;
  description: string;
  collectionAddress: Address;
  explorerAddressUrl: string;
  xProfiles: readonly EcosystemProjectLink[];
  website?: EcosystemProjectLink;
  disclosure: string;
};

export type EcosystemProgramProfile = {
  programLabel: string;
  canaryStatus: string;
  canaryCohort: number;
};

const EXPLORER_BASE_URL = robinhoodChain.blockExplorers.default.url;

export const HOODSTREET_CCFF00_PROFILE: EcosystemProjectProfile = {
  id: "hoodstreet-ccff00",
  projectName: "HoodStreet",
  collectionLabel: "CCFF00 Membership",
  networkName: "Robinhood Chain",
  description: "CCFF00 planning support for distribution recipient review and manifest pre-checks.",
  collectionAddress: CCFF00_COLLECTION,
  explorerAddressUrl: `${EXPLORER_BASE_URL}/address/${CCFF00_COLLECTION}`,
  xProfiles: [
    { label: "HoodStreet X", url: "https://x.com/HoodStreetCap" },
    { label: "CCFF00 X", url: "https://x.com/CCFF00club" }
  ],
  disclosure: "Independent ecosystem support by RMT. No affiliation or endorsement implied."
};

export const HOODSTREET_CCFF00_PROGRAM: EcosystemProgramProfile = {
  programLabel: "Program #001",
  canaryStatus: "unproven",
  canaryCohort: 3
};
