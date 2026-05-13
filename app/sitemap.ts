import type { MetadataRoute } from "next";

const FALLBACK_SITE_URL = "https://googlereviewsdownload.com";

function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return FALLBACK_SITE_URL;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const now = new Date();
  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
