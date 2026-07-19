import type { MetadataRoute } from "next";

const appUrl = "https://www.rmtlaunch.fun";
const officialToken = "0xdBa33be56C89CC9fc014c4459028d7e5c7878671";

const publicRoutes = [
  ["/", "hourly", 1],
  ["/runners", "hourly", 0.9],
  ["/launch", "weekly", 0.9],
  [`/token/${officialToken}`, "hourly", 0.9],
  ["/status", "hourly", 0.8],
  ["/sources", "daily", 0.7],
  ["/sushi", "daily", 0.8],
  ["/rescue", "weekly", 0.6],
  ["/support", "monthly", 0.5],
  ["/risks", "monthly", 0.6],
  ["/terms", "monthly", 0.4],
  ["/privacy", "monthly", 0.4]
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return publicRoutes.map(([path, changeFrequency, priority]) => ({
    url: `${appUrl}${path}`,
    changeFrequency,
    priority
  }));
}
