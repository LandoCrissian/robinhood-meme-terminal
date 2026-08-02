import type { MetadataRoute } from "next";

const appUrl = "https://www.rmtlaunch.fun";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin/",
        "/api/",
        "/portfolio",
        "/profile",
        "/watchlist"
      ]
    },
    host: appUrl,
    sitemap: `${appUrl}/sitemap.xml`
  };
}
