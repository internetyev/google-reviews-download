// Shared FAQ — single source of truth for both the home page (L3.3) and the
// SEO variant pages (L3.2b JSON-LD).
//
// Each item carries two views of the same answer:
//   - `a`    rich JSX (with <code> etc.) for on-page rendering
//   - `text` a plain-string mirror for the FAQPage JSON-LD
// They are kept side by side here so the visible copy and the structured-data
// copy cannot drift apart. Google requires FAQPage markup to match FAQ content
// that is actually visible on the page, which is why <FaqSection /> and
// faqJsonLd() are derived from the same array.

import type { ReactNode } from "react";

interface FaqItem {
  readonly q: string;
  readonly a: ReactNode;
  /** Plain-text equivalent of `a`, for the FAQPage JSON-LD answer body. */
  readonly text: string;
}

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    q: "How does it work?",
    a: (
      <>
        Paste a Google Maps place URL or a raw <code>place_id</code> (
        <code>ChIJ…</code>) and pick a format. We normalise the input,
        walk every page of reviews via the SemanticForce API (up to a
        5,000-review safety cap), and stream the result back as the
        format you chose. Repeat downloads of the same place within 24
        hours are served from cache so you don&apos;t re-pay the
        upstream call.
      </>
    ),
    text:
      "Paste a Google Maps place URL or a raw place_id (ChIJ…) and pick a " +
      "format. We normalise the input, walk every page of reviews via the " +
      "SemanticForce API (up to a 5,000-review safety cap), and stream the " +
      "result back as the format you chose. Repeat downloads of the same " +
      "place within 24 hours are served from cache so you don't re-pay the " +
      "upstream call.",
  },
  {
    q: "Is this allowed by Google?",
    a: (
      <>
        We don&apos;t scrape Google. Reviews come through SemanticForce,
        a third-party data provider whose terms cover redistribution of
        the public review data Google exposes on Maps and Search. The
        tool is intended for business owners pulling their own reviews
        for backup or analysis, and for consultants doing the same on
        behalf of their clients. We are not affiliated with Google, and
        Google&apos;s logo and branding are deliberately absent from
        this page.
      </>
    ),
    text:
      "We don't scrape Google. Reviews come through SemanticForce, a " +
      "third-party data provider whose terms cover redistribution of the " +
      "public review data Google exposes on Maps and Search. The tool is " +
      "intended for business owners pulling their own reviews for backup or " +
      "analysis, and for consultants doing the same on behalf of their " +
      "clients. We are not affiliated with Google, and Google's logo and " +
      "branding are deliberately absent from this page.",
  },
  {
    q: "What about rate limits?",
    a: (
      <>
        The API endpoint is capped at 10 requests per minute per IP. If
        you hit the cap you&apos;ll get a <code>429</code> with a
        <code> Retry-After</code> header — wait a few seconds and try
        again. Most users never see it; this is here to keep the
        upstream bill predictable.
      </>
    ),
    text:
      "The API endpoint is capped at 10 requests per minute per IP. If you " +
      "hit the cap you'll get a 429 with a Retry-After header — wait a few " +
      "seconds and try again. Most users never see it; this is here to keep " +
      "the upstream bill predictable.",
  },
] as const;

/**
 * FAQPage structured data built from FAQ_ITEMS. Stringify into a
 * <script type="application/ld+json"> tag. Answers use the plain-text
 * `text` field so the markup matches the rendered <FaqSection />.
 */
export function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.text,
      },
    })),
  };
}

/** Visible FAQ accordion, shared by the home page and variant pages. */
export function FaqSection() {
  return (
    <section
      aria-labelledby="faq-heading"
      className="flex w-full flex-col gap-4"
    >
      <h2
        id="faq-heading"
        className="text-xl font-semibold tracking-tight"
      >
        FAQ
      </h2>
      <div className="flex flex-col gap-3">
        {FAQ_ITEMS.map((item) => (
          <details
            key={item.q}
            className="group rounded-md border border-border bg-card p-4 shadow-sm"
          >
            <summary className="cursor-pointer list-none text-sm font-medium text-foreground marker:hidden [&::-webkit-details-marker]:hidden">
              <span className="mr-2 inline-block transition-transform group-open:rotate-90">
                ›
              </span>
              {item.q}
            </summary>
            <p className="mt-3 text-sm text-muted-foreground">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
