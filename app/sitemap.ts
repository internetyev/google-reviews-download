import type { MetadataRoute } from "next";
import { publishedVariants } from "@/lib/seo/variants";
import { publishedPosts } from "@/lib/blog/index";

const FALLBACK_SITE_URL = "https://googlereviewsdownload.com";

function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return FALLBACK_SITE_URL;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const now = new Date();
  const posts = publishedPosts();
  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    // Tier-1 money landing pages (L3.1b).
    ...publishedVariants().map((v) => ({
      url: `${base}/${v.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    // Blog index + published articles (L5 content cluster).
    ...(posts.length > 0
      ? [
          {
            url: `${base}/blog`,
            lastModified: now,
            changeFrequency: "weekly" as const,
            priority: 0.7,
          },
        ]
      : []),
    ...posts.map((p) => ({
      url: `${base}/blog/${p.slug}`,
      lastModified: new Date(p.dateModified ?? p.datePublished),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
