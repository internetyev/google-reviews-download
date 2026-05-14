# Launch posts — drafts

_Status: drafts for human review. Numbers / dates / links left as `<TODO>` until deploy lands (L5.2). Tone goal: useful first, promotional second. Do not post any of these until `docs/launch-checklist.md` is signed off._

Audience per PLAN.md:
- **Primary:** local-SEO consultants and agency analysts pulling reviews for client work.
- **Secondary:** SMB owners who want a backup of their reviews; marketing teams pulling quotes for case studies.

Anti-audience: bulk scrapers. None of these posts should imply the tool will pull reviews for places the poster doesn't own or work with.

---

## ProductHunt

**Title (60 char max):** `Google Reviews Download — one field, one click, one file`

**Tagline (one line):** `Export any Google business's reviews to CSV, JSON, or XLSX. No signup.`

**First comment (post-as-maker):**

> I kept watching local-SEO friends paste reviews into spreadsheets one cell at a time, or hunt for the one browser extension that still works this week. So I built the smallest possible fix.
>
> Paste a Google Place ID, pick a format, get a file. That's it.
>
> - **CSV** is Excel-friendly out of the box — UTF-8 BOM, CRLF line endings, every field quoted — so smart quotes and accented characters don't blow up when your client opens it in Excel for Windows.
> - **XLSX** has a frozen header row and column widths tuned for review text, so you can read it without resizing.
> - **JSON** is the same shape the API returns, for anyone piping into a sentiment tool or warehouse.
>
> Backed by SemanticForce for the underlying data. Cache is 24h per place so repeat downloads don't re-hit the API. No login, no quota dialog, no "upgrade to export more than 10 rows."
>
> Things I haven't built (deliberately): batch multi-place export, sentiment scoring, monitoring, white-label. This is a download button. If those things matter to you, there are already good products doing them.
>
> Free while it's small. If usage gets expensive I'll cap free downloads per month and charge for the cap, not for features. Happy to answer anything about the SemanticForce side or the Excel-CSV quirks.

**Topics:** Productivity, SEO, Marketing, Developer Tools

---

## Indie Hackers

**Title:** `I shipped a one-button Google Reviews exporter — here's what the SERP actually looks like`

**Body:**

> I'd been telling myself the search query "google reviews download" was an open lane — weak SERP, mostly blog spam and agency lead-magnets, no purpose-built tool at #1. Then I actually pulled the SERP and the picture was less rosy: three purpose-built competitors in the top 10 (ExportComments, PhantomLocal, Outscraper), plus a Google Help thread and a Reddit result. Not an empty lane — a defensible mid-rank lane.
>
> I shipped anyway, with a narrower thesis: own the **long-tail variant pages** ("export google reviews to excel", "google business reviews csv", "save google reviews", etc.) where none of the top-10 are purpose-built landing pages. The head term is a #4–7 outcome at best; the long-tail is where the real wins are.
>
> Stack: Next.js 15 + TypeScript on Vercel, Vercel KV for a 24h cache keyed by place_id, SemanticForce for the actual reviews. The tool itself is one input field, one format toggle, one download button. CSV writer is UTF-8 BOM + CRLF + QUOTE_ALL so Excel for Windows behaves; XLSX is SheetJS with a frozen header.
>
> Things I'd do differently if I started over:
> - Pull the SERP **before** writing the plan, not after.
> - Treat "no incumbent at #1" and "no incumbents at all" as very different signals.
> - Build the long-tail pages first, head-term page last.
>
> Link: <TODO live URL after L5.2>. Happy to talk shop on local-SEO tooling, Excel-CSV gotchas, or why I deliberately said no to multi-place batch export.

**Group/tag:** Launch · SEO · Indie tools

---

## LinkedIn (founder personal account)

**Post (≤1300 chars target — short enough to fit above the "see more" fold for most viewers):**

> Shipping a tiny thing today: <TODO live URL>.
>
> Paste a Google Place ID, get a clean export of that business's reviews — CSV, JSON, or XLSX. No signup, no quota dialog, no "free trial."
>
> Built for the people I kept watching do this the hard way: local-SEO consultants, agency analysts, SMB owners who want a backup. If you've ever tried to copy review text out of the Google Business profile UI and watched smart quotes turn into ? in Excel, this is for you. The CSV writer is configured so Excel-for-Windows opens the file correctly the first time.
>
> What it is not: a competitor-review scraper, a batch tool, a sentiment platform. Pull reviews for businesses you own or work with. That's the whole product.
>
> If you do local-SEO client work and want to kick the tires, the link is up there. Feedback welcome — especially edge cases where the export breaks.

**Hashtags:** `#LocalSEO #SmallBusiness #IndieHackers`

---

## Cross-post checklist (do not skip)

- [ ] All `<TODO>` placeholders replaced (live URL, screenshots, demo Place ID if you include one)
- [ ] Demo Place ID is for a business that has consented to being the demo — do not screenshot a stranger's reviews
- [ ] "Not affiliated with Google" disclaimer is visible on the live site before the first post goes up
- [ ] Plausible analytics enabled in production (env var `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` set per L2.10)
- [ ] Rate-limit middleware live (L2.8) — launch traffic will probe it
- [ ] One channel per day, in this order: ProductHunt → Indie Hackers → LinkedIn. Spacing gives the support thread on each channel time to breathe.
