export const RMT_SITE_URL = "https://www.rmtlaunch.fun";
export const RMT_SITE_NAME = "RMT Launch";
export const RMT_SITE_ALTERNATE_NAME = "Robinhood Meme Terminal";
export const RMT_SITE_DESCRIPTION =
  "A mobile-first, non-custodial Robinhood Chain terminal for discovering, comparing, and trading markets across the ecosystem.";

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
