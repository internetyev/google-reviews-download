// Long-tail SEO variant registry.
//
// Source of truth for the candidate list is `docs/seo-variants.md` (L1.6a).
// Every variant a human/corgi has *vetted for volume* gets `published: true`
// (L3.1b, after the L1.6b corgi pass); until then the route and sitemap treat
// the page as nonexistent, so the infrastructure ships inert and nothing goes
// live before it has been volume-checked.
//
// Picking which 5 to publish is deliberately NOT done here — it needs the
// corgi `volume x (1 - competition)` score from L1.6b. This file only models
// the candidate set and the above-the-fold copy each page would render.

export type VariantIntent = "export";

export interface SeoVariant {
  /** Stable id from the docs/seo-variants.md table (A1, B2, C3, ...). */
  readonly id: string;
  /** URL slug under `/` — must match the `Maps to` column in the doc. */
  readonly slug: string;
  /** Search intent class, kept for apples-to-apples grouping/analytics. */
  readonly intent: VariantIntent;
  /** <title> / OG title. Mirrors the literal query the page targets. */
  readonly metaTitle: string;
  /** <meta name="description">. One sentence, action-led. */
  readonly metaDescription: string;
  /** Visible <h1>. The query phrased as a page heading. */
  readonly h1: string;
  /** Above-the-fold explainer paragraphs (rendered before the tool). */
  readonly intro: readonly string[];
  /**
   * Live only when a corgi volume pass (L1.6b) has cleared this variant.
   * All `false` until L3.1b flips the top-5 by score. While `false` the
   * variant is excluded from `generateStaticParams` and the sitemap, and
   * the dynamic route returns 404 — the page effectively does not exist.
   */
  readonly published: boolean;
}

/**
 * All ten L1.6a candidates. Order matches `docs/seo-variants.md`
 * (Group A format-named, Group B verb-led, Group C surface/source).
 * `published` stays `false` for every entry until L3.1b.
 */
export const SEO_VARIANTS: readonly SeoVariant[] = [
  {
    id: "A1",
    slug: "export-google-reviews-to-csv",
    intent: "export",
    metaTitle: "Export Google Reviews to CSV — free, no signup",
    metaDescription:
      "Paste a Google place and download every review as an Excel-ready CSV. No account, no install, no scraping.",
    h1: "Export Google reviews to CSV",
    intro: [
      "Paste a Google Maps place URL or a raw Place ID and get every review back as a CSV file in one click — no account, no spreadsheet import wizard.",
      "The CSV is written UTF-8 BOM, CRLF, fully quoted, so it double-clicks straight into Excel on Windows even when reviews contain emoji or non-Latin text. Most generic tools hand you a file Excel mangles; this one doesn't.",
    ],
    published: false,
  },
  {
    id: "A2",
    slug: "download-google-reviews-as-excel",
    intent: "export",
    metaTitle: "Download Google Reviews as Excel (XLSX) — free tool",
    metaDescription:
      "Get a Google business's reviews as a ready-to-open Excel workbook: one row per review, frozen header, tuned columns.",
    h1: "Download Google reviews as Excel",
    intro: [
      "Pick the XLSX format and you get a real Excel workbook, not a CSV you have to coax into columns: one row per review, a frozen header row, and column widths already tuned for reading.",
      "Paste the place below, choose XLSX, and the file downloads. Nothing to install and no Google account involved.",
    ],
    published: false,
  },
  {
    id: "A3",
    slug: "google-reviews-to-xlsx",
    intent: "export",
    metaTitle: "Google Reviews to XLSX — direct .xlsx export",
    metaDescription:
      "Convert a Google place's reviews straight to a .xlsx file. One row per review, frozen header, no signup.",
    h1: "Google reviews to XLSX",
    intro: [
      "If you already know you want a .xlsx file, this is the short path: paste the place, leave the format on XLSX, download.",
      "The workbook is one row per review with a frozen header and sensible column widths — open it and start filtering, no cleanup pass needed.",
    ],
    published: false,
  },
  {
    id: "A4",
    slug: "google-business-reviews-csv-export",
    intent: "export",
    metaTitle: "Google Business Reviews CSV Export — for owners",
    metaDescription:
      "Export your Google Business Profile reviews to CSV for backup or analysis. No signup, no scraping, Excel-ready output.",
    h1: "Google business reviews CSV export",
    intro: [
      "Built for the business owner or consultant who wants their own Google Business Profile reviews out as a CSV — for a backup, a report, or a sentiment pass in a spreadsheet.",
      "Paste the business's place below. The CSV comes back Excel-ready (UTF-8 BOM, CRLF, fully quoted) so it opens cleanly with no import dance.",
    ],
    published: false,
  },
  {
    id: "B1",
    slug: "save-google-reviews-to-file",
    intent: "export",
    metaTitle: "Save Google Reviews to a File — CSV, JSON or XLSX",
    metaDescription:
      "Save any Google place's reviews to a file. Choose CSV, JSON, or XLSX. No account, no install.",
    h1: "Save Google reviews to a file",
    intro: [
      "Haven't decided on a format? Paste the place and pick CSV, JSON, or XLSX at download time — the choice is right there on the form.",
      "CSV is Excel-ready, XLSX is a real workbook, JSON is the raw response envelope for anything you want to script against.",
    ],
    published: false,
  },
  {
    id: "B2",
    slug: "extract-google-reviews",
    intent: "export",
    metaTitle: "Extract Google Reviews — your business, any format",
    metaDescription:
      "Extract a Google business's reviews to CSV, JSON, or XLSX. For owners and consultants pulling their own data — not a scraper.",
    h1: "Extract Google reviews",
    intro: [
      "This extracts your business's reviews — the ones you'd pull for a backup, an audit, or a client report. It is not a bulk scraper and it does not scrape Google; data comes through the SemanticForce API.",
      "Paste the place, choose a format, download. No account, no install.",
    ],
    published: false,
  },
  {
    id: "B3",
    slug: "backup-google-reviews",
    intent: "export",
    metaTitle: "Backup Google Reviews — keep your own copy",
    metaDescription:
      "Download a permanent copy of your Google reviews before anything happens to them. CSV, JSON, or XLSX. No signup.",
    h1: "Backup your Google reviews",
    intro: [
      "Reviews are an asset you don't actually control — a profile merge, a suspension, or a flagged review can take them with little warning. This keeps your own copy.",
      "Paste the place, pick a format, and save the file somewhere you control. Run it again any time; same-place pulls within 24 hours are served from cache.",
    ],
    published: false,
  },
  {
    id: "C1",
    slug: "download-google-maps-reviews",
    intent: "export",
    metaTitle: "Download Google Maps Reviews — no install, no signup",
    metaDescription:
      "Download all reviews for a Google Maps place as CSV, JSON, or XLSX. No browser extension, no account.",
    h1: "Download Google Maps reviews",
    intro: [
      "Paste a Google Maps place URL or Place ID and download every review — no Chrome extension to install and no account to create.",
      "You get the full set, not just the handful visible on the Maps panel, capped at a 5,000-review safety limit.",
    ],
    published: false,
  },
  {
    id: "C2",
    slug: "google-business-profile-reviews-download",
    intent: "export",
    metaTitle: "Google Business Profile Reviews Download (2026)",
    metaDescription:
      "Download Google Business Profile reviews — the current Google branding — to CSV, JSON, or XLSX. No signup.",
    h1: "Google Business Profile reviews download",
    intro: [
      "Google Business Profile is the current name for what used to be Google My Business. The reviews are the same; this downloads them as a file.",
      "Paste the profile's place below, pick a format, and the file downloads. No account, no install, no scraping.",
    ],
    published: false,
  },
  {
    id: "C3",
    slug: "download-all-reviews-from-google",
    intent: "export",
    metaTitle: "Download ALL Reviews From Google — every page",
    metaDescription:
      "Get every Google review for a place, not just the first page. CSV, JSON, or XLSX. No signup, no install.",
    h1: "Download all reviews from Google",
    intro: [
      "“All” means all: the tool walks every page of reviews up to a 5,000-review safety cap, not just the visible first page that extensions and Google Takeout stop at.",
      "Paste the place, choose a format, and download the complete set.",
    ],
    published: false,
  },
] as const;

/** Variants cleared for production (post-L3.1b). Empty until then. */
export function publishedVariants(): readonly SeoVariant[] {
  return SEO_VARIANTS.filter((v) => v.published);
}

/** Look up a published variant by slug; `undefined` if unknown or unpublished. */
export function findPublishedVariant(slug: string): SeoVariant | undefined {
  return SEO_VARIANTS.find((v) => v.slug === slug && v.published);
}
