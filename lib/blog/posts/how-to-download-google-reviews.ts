import type { BlogPost } from "@/lib/blog/types";

export const post: BlogPost = {
  slug: "how-to-download-google-reviews",
  title: "How to Download Google Reviews (2026 Guide)",
  metaTitle: "How to Download Google Reviews (2026 Guide)",
  metaDescription:
    "Three ways to download your Google reviews — a free no-signup tool, the Business Profile dashboard, and the API. Get every review as CSV, JSON, or Excel.",
  datePublished: "2026-06-08",
  primaryKeyword: "how to download google reviews",
  cluster: "how-to",
  linksTo: "/",
  excerpt:
    "Google gives you no “export” button. Here are the three real ways to get your reviews out as a file — and which one to use.",
  keyTakeaways: [
    "Google has **no built-in “download reviews” button** — you need a tool, the API, or manual copy-paste.",
    "The fastest route is a free tool: paste your business name or Place ID and get a **CSV, JSON, or XLSX** file in one click.",
    "“All” your reviews means walking every page — the Google Business Profile screen and most browser extensions stop at the first batch.",
    "Download a copy on a schedule: reviews can vanish with a profile merge, suspension, or removal.",
  ],
  body: [
    {
      type: "p",
      text: "Your Google reviews are one of your most valuable marketing assets — and one of the few you do not actually control. There is no “Export reviews” button in Google Business Profile, so getting them out as a spreadsheet you can keep, analyze, or report on takes a workaround. This guide covers the three that actually work in 2026, from fastest to most technical.",
    },
    { type: "h2", text: "Method 1: Use a free Google reviews download tool (fastest)" },
    {
      type: "p",
      text: "The quickest path is a purpose-built tool that takes a business and hands back a file. Paste a business name, a Google Maps URL, or a Place ID, choose a format, and download. No account, no browser extension, no scraping of other people's data.",
    },
    {
      type: "ol",
      items: [
        "Open the [Google reviews download tool](/) and paste your business name or its Google Maps link.",
        "Choose a format: **CSV** (opens in Excel), **XLSX** (a real workbook), or **JSON** (for developers).",
        "Click download. You get every review — author, rating, text, date, and owner replies — not just the handful visible on the Maps panel.",
      ],
    },
    {
      type: "callout",
      text: "Want it straight in a spreadsheet? Pick CSV — ours is written so it [opens in Excel](/export-google-reviews-to-excel) cleanly with no import wizard, even when reviews contain emoji or non-Latin text.",
    },
    { type: "h2", text: "Method 2: The Google Business Profile dashboard (manual)" },
    {
      type: "p",
      text: "If you own the profile, you can read your reviews in Google Business Profile (search your business name while signed in to the owner account, then open the Reviews panel). Google does not offer a download here, so this method means copying review text by hand — workable for a handful of recent reviews, painful past a dozen, and it will not give you a structured file.",
    },
    {
      type: "p",
      text: "Google Takeout, which exports a lot of your Google data, does **not** include Business Profile reviews you have *received* — only reviews you have *written* as a user. That surprises a lot of owners, so it is worth stating plainly.",
    },
    { type: "h2", text: "Method 3: The Google Business Profile API (for developers)" },
    {
      type: "p",
      text: "Google exposes reviews through the Business Profile API. It returns structured data and is the “official” route, but it requires a Google Cloud project, OAuth, approved API access tied to the locations you manage, and code to page through results. If you manage your own locations and already have engineering time, it is solid. If you just want a file today, it is overkill — see [the Google reviews API explained](/blog/google-reviews-api-explained) for when it is and isn't worth it.",
    },
    { type: "h2", text: "Which method should you use?" },
    {
      type: "ul",
      items: [
        "**Just want a file now?** Method 1 — paste, pick a format, download.",
        "**Only need to read a few recent reviews?** Method 2 in the dashboard.",
        "**Building an integration or syncing continuously?** Method 3, the API.",
      ],
    },
    { type: "h2", text: "Download a backup on a schedule" },
    {
      type: "p",
      text: "Reviews disappear more often than owners expect — a profile merge, a policy suspension, or a competitor's successful “report” can take them with little warning, and once gone they are usually gone for good. A monthly export gives you a copy you control. It takes under a minute with Method 1; see [how to back up your Google reviews](/blog/how-to-backup-google-reviews) for a simple routine.",
    },
    {
      type: "stat",
      text: "Reviews are a major purchase factor: BrightLocal's Local Consumer Review Survey reports that the large majority of consumers read online reviews for local businesses before choosing them.",
      source: "BrightLocal — Local Consumer Review Survey",
      url: "https://www.brightlocal.com/research/local-consumer-review-survey/",
    },
    {
      type: "cta",
      href: "/",
      label: "Download your Google reviews — free, no signup",
    },
  ],
  howTo: {
    name: "How to download Google reviews",
    steps: [
      {
        name: "Open the tool and paste your business",
        text: "Open the Google reviews download tool and paste your business name, Google Maps URL, or Place ID.",
      },
      {
        name: "Choose a format",
        text: "Choose CSV, XLSX, or JSON depending on whether you want a spreadsheet, an Excel workbook, or raw data.",
      },
      {
        name: "Download the file",
        text: "Click download to get every review as a file, including author, rating, text, date, and owner replies.",
      },
    ],
  },
  faq: [
    {
      q: "Can you download all of your Google reviews?",
      a: "Yes. A tool that walks every page returns the complete set, not just the first batch the Business Profile screen shows. See [can you export all of your Google reviews](/blog/can-you-export-all-google-reviews).",
    },
    {
      q: "Does Google Takeout include my business reviews?",
      a: "No. Takeout exports reviews you have written as a user, not the reviews your business has received. Use a download tool or the Business Profile API for received reviews.",
    },
    {
      q: "Is downloading my Google reviews allowed?",
      a: "Downloading your own business's public reviews for backup or analysis is a normal, legitimate use. Bulk-scraping other businesses' reviews at scale is a different activity with its own rules.",
    },
  ],
  published: true,
};
