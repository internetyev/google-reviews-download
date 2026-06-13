// Structured-data builders for blog posts (pure → unit-testable). Emitted into
// each article as <script type="application/ld+json">. Article always; HowTo
// and FAQPage only when the post carries those fields.

import type { BlogPost } from "@/lib/blog/types";

const ORG_NAME = "Google Reviews Download";

/** Strip the inline syntax ([x](y), **x**, `x`) to plain text for schema fields. */
export function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

export function articleJsonLd(post: BlogPost, siteUrl: string) {
  const url = `${siteUrl}/blog/${post.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.metaDescription,
    datePublished: post.datePublished,
    dateModified: post.dateModified ?? post.datePublished,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    author: { "@type": "Organization", name: ORG_NAME },
    publisher: { "@type": "Organization", name: ORG_NAME },
  };
}

export function howToJsonLd(post: BlogPost) {
  if (!post.howTo) return null;
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: post.howTo.name,
    step: post.howTo.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
}

export function blogFaqJsonLd(post: BlogPost) {
  if (!post.faq || post.faq.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: post.faq.map((f) => ({
      "@type": "Question",
      name: plain(f.q),
      acceptedAnswer: { "@type": "Answer", text: plain(f.a) },
    })),
  };
}

/** All JSON-LD blocks for a post, in render order (filtered of nulls). */
export function postJsonLd(post: BlogPost, siteUrl: string): object[] {
  const blocks: Array<object | null> = [
    articleJsonLd(post, siteUrl),
    howToJsonLd(post),
    blogFaqJsonLd(post),
  ];
  return blocks.filter((x): x is object => x !== null);
}
