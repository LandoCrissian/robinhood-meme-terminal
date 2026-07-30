import type { Metadata } from "next";
import { getAddress, isAddress } from "viem";
import { OFFICIAL_RMT_V6_TOKEN } from "./project-page";
import { RMT_SITE_NAME } from "./site-identity";

export const OFFICIAL_RMT_PROJECT_NAME = "Robinhood Meme Terminal";
export const OFFICIAL_RMT_PROJECT_SYMBOL = "RMT";
export const OFFICIAL_RMT_PROJECT_DESCRIPTION =
  "Review the official fixed-supply RMT V6 token, factory-verified origin, live native market, transparent launch rules, activity, rewards, and risk evidence.";

export function isPublicRmtProject(address: string) {
  return isAddress(address) && getAddress(address) === OFFICIAL_RMT_V6_TOKEN;
}

export function officialRmtProjectPath() {
  return `/project/${OFFICIAL_RMT_V6_TOKEN}`;
}

export function buildPublicProjectMetadata(address: string): Metadata {
  if (!isPublicRmtProject(address)) {
    return {
      title: `Project review | ${RMT_SITE_NAME}`,
      description: "This project is not currently open for RMT public discovery.",
      robots: { index: false, follow: false }
    };
  }

  const path = officialRmtProjectPath();
  const title = `${OFFICIAL_RMT_PROJECT_NAME} ($${OFFICIAL_RMT_PROJECT_SYMBOL}) | RMT Project`;
  const image = `${path}/opengraph-image`;
  return {
    title,
    description: OFFICIAL_RMT_PROJECT_DESCRIPTION,
    alternates: { canonical: path },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1
      }
    },
    openGraph: {
      type: "website",
      siteName: RMT_SITE_NAME,
      title,
      description: OFFICIAL_RMT_PROJECT_DESCRIPTION,
      url: path,
      images: [{
        url: image,
        width: 1200,
        height: 630,
        alt: "Robinhood Meme Terminal official RMT project"
      }]
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: OFFICIAL_RMT_PROJECT_DESCRIPTION,
      images: [image]
    }
  };
}

export function buildLegacyTokenMetadata(address: string): Metadata {
  if (!isPublicRmtProject(address)) {
    return {
      title: `Token review | ${RMT_SITE_NAME}`,
      robots: { index: false, follow: false }
    };
  }
  const canonical = officialRmtProjectPath();
  return {
    title: `${OFFICIAL_RMT_PROJECT_NAME} ($${OFFICIAL_RMT_PROJECT_SYMBOL}) | RMT Project`,
    description: OFFICIAL_RMT_PROJECT_DESCRIPTION,
    alternates: { canonical },
    robots: { index: false, follow: true },
    openGraph: {
      title: `${OFFICIAL_RMT_PROJECT_NAME} ($${OFFICIAL_RMT_PROJECT_SYMBOL}) | RMT Project`,
      description: OFFICIAL_RMT_PROJECT_DESCRIPTION,
      url: canonical,
      images: [`${canonical}/opengraph-image`]
    }
  };
}
