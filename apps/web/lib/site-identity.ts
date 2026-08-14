export const RMT_SITE_URL = "https://www.rmtlaunch.fun";
export const RMT_SITE_NAME = "Robinhood Meme Terminal";
export const RMT_SITE_ALTERNATE_NAME = "RMT";
export const RMT_SITE_DESCRIPTION =
  "A mobile-first, non-custodial Robinhood Chain terminal for discovering, comparing, and trading markets across the ecosystem.";

export const RMT_PUBLIC_IDENTITY_URLS = [
  "https://x.com/RMTLaunch",
  "https://github.com/LandoCrissian/robinhood-meme-terminal",
  "https://github.com/LandoCrissian/rmt-transparency"
] as const;

export const rmtWebsiteStructuredData = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${RMT_SITE_URL}/#website`,
  url: `${RMT_SITE_URL}/`,
  name: RMT_SITE_NAME,
  alternateName: RMT_SITE_ALTERNATE_NAME,
  description: RMT_SITE_DESCRIPTION,
  inLanguage: "en-US"
} as const;

export const rmtWebApplicationStructuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "@id": `${RMT_SITE_URL}/#application`,
  url: `${RMT_SITE_URL}/`,
  name: RMT_SITE_NAME,
  alternateName: RMT_SITE_ALTERNATE_NAME,
  description: RMT_SITE_DESCRIPTION,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  browserRequirements: "Requires JavaScript and a modern web browser.",
  isPartOf: { "@id": `${RMT_SITE_URL}/#website` },
  sameAs: RMT_PUBLIC_IDENTITY_URLS
} as const;
