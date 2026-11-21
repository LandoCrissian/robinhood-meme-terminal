import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return { rules: [
    { userAgent: ["Twitterbot", "facebookexternalhit", "LinkedInBot", "Slackbot-LinkExpanding", "Discordbot", "WhatsApp"],
      allow: ["/u/", "/creator/", "/launches/", "/share/"], disallow: "/" },
    { userAgent: "*", disallow: "/" },
  ] };
}
