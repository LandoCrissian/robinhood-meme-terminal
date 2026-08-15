import type { MetadataRoute } from "next";

const appUrl = "https://www.rmtlaunch.fun";
const officialToken = "0xdBa33be56C89CC9fc014c4459028d7e5c7878671";
export const revalidate = 300;

const publicRoutes = [
  ["/", "hourly", 1],
  ["/explore", "hourly", 0.9],
  [`/project/${officialToken}`, "hourly", 0.9],
  ["/status", "hourly", 0.8],
  ["/sources", "daily", 0.7],
  ["/sushi", "daily", 0.8],
  ["/support", "monthly", 0.5],
  ["/risks", "monthly", 0.6],
  ["/terms", "monthly", 0.4],
  ["/privacy", "monthly", 0.4],
  ["/experience", "monthly", 0.5]
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
