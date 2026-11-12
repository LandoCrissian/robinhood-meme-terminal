import type { MetadataRoute } from "next";

const appUrl = "https://www.rmtlaunch.fun";
export const revalidate = 300;

const publicRoutes = [
  ["/", "hourly", 1],
  ["/rmt", "monthly", 0.9],
  ["/status", "hourly", 0.8],
  ["/sources", "daily", 0.7],
  ["/support", "monthly", 0.5],
  ["/risks", "monthly", 0.6],
  ["/terms", "monthly", 0.4],
  ["/privacy", "monthly", 0.4]
] as const;

export function staticPublicSitemap(): MetadataRoute.Sitemap {
  return publicRoutes.map(([path, changeFrequency, priority]) => ({
    url: `${appUrl}${path}`,
    changeFrequency,
    priority
  }));
}

export default function sitemap(): MetadataRoute.Sitemap {
  return staticPublicSitemap();
}
