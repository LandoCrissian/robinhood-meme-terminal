import type { Metadata } from "next";
import { RMT_SITE_NAME } from "./site-identity";

export function buildPublicProjectMetadata(_address: string): Metadata {
  return {
    title: `Historical project record | ${RMT_SITE_NAME}`,
    description: "Historical launchpad project records are not current RMT product markets or release requirements.",
    robots: { index: false, follow: false }
  };
}

export function buildLegacyTokenMetadata(_address: string): Metadata {
  return {
    title: `Historical token record | ${RMT_SITE_NAME}`,
    description: "Historical launchpad token records are not current RMT product markets or release requirements.",
    robots: { index: false, follow: false }
  };
}
