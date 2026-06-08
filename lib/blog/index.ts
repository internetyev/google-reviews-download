// Blog post registry. Each article is a typed module under ./posts; this file
// is the single source of truth for the published set (mirrors the SEO variant
// registry pattern). Add a post by importing it and listing it in POSTS.

import type { BlogPost } from "@/lib/blog/types";
import { post as howToDownloadGoogleReviews } from "@/lib/blog/posts/how-to-download-google-reviews";

const POSTS: readonly BlogPost[] = [howToDownloadGoogleReviews];

/** All registered posts (published or not). */
export function allPosts(): readonly BlogPost[] {
  return POSTS;
}

/** Live posts, newest first. */
export function publishedPosts(): readonly BlogPost[] {
  return POSTS.filter((p) => p.published).slice().sort((a, b) =>
    b.datePublished.localeCompare(a.datePublished),
  );
}

/** Find a published post by slug; undefined if unknown or unpublished. */
export function findPublishedPost(slug: string): BlogPost | undefined {
  return POSTS.find((p) => p.slug === slug && p.published);
}
