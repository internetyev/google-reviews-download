// Blog content model (SEO blog, 2026-06). Articles are typed data objects
// rendered by a template — dependency-free (no MDX), type-safe, and testable.
// Inline syntax inside `text` fields (paragraphs, list items, takeaways):
//   [label](/path or https://url)  → link (internal "/..." uses next/link)
//   **bold**                       → <strong>
//   `code`                         → <code>
// Nothing else is interpreted (no raw HTML), so content can't inject markup.

export type Block =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "callout"; text: string }
  // A sourced stat — verbatim claim + citation (anti-hallucination, per the
  // /pandadoc-content-brief stat rule). Rendered as a cited blockquote.
  | { type: "stat"; text: string; source: string; url: string }
  // The standard conversion CTA to the tool/home or a money page.
  | { type: "cta"; href: string; label: string };

export type BlogCluster = "how-to" | "use-case" | "adjacent";

export interface BlogFaqItem {
  q: string;
  a: string; // inline syntax allowed
}

export interface HowToStep {
  name: string;
  text: string; // plain text for schema; keep ASCII
}

export interface BlogPost {
  /** URL slug under /blog/. */
  slug: string;
  /** Visible H1 + Article headline. */
  title: string;
  /** <title> — keep <= 60 chars for the SERP. */
  metaTitle: string;
  /** <meta description> — keep <= 160 chars. */
  metaDescription: string;
  /** ISO date (YYYY-MM-DD). */
  datePublished: string;
  /** ISO date; defaults to datePublished when omitted. */
  dateModified?: string;
  /** The single keyword this post targets. */
  primaryKeyword: string;
  /** Sub-cluster from docs/seo/blog-plan.md. */
  cluster: BlogCluster;
  /** The ONE money/hub path this post links down to (anchor = its keyword). */
  linksTo: string;
  /** One-line dek under the title. */
  excerpt: string;
  /** Answer-up-front bullets rendered under the H1 (inline syntax allowed). */
  keyTakeaways: string[];
  /** Article body. */
  body: Block[];
  /** Optional on-page FAQ → also emitted as FAQPage JSON-LD. */
  faq?: BlogFaqItem[];
  /** Optional step list → emitted as HowTo JSON-LD. */
  howTo?: { name: string; steps: HowToStep[] };
  /** Live only when true (mirrors the SEO variant publish gate). */
  published: boolean;
}
