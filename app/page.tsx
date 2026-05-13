const FORMATS = [
  { value: "json", label: "JSON", hint: "available today" },
  { value: "csv", label: "CSV", hint: "available today" },
  { value: "xlsx", label: "XLSX", hint: "available today" },
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 px-6 py-16">
      <header className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          google-reviews-download
        </h1>
        <p className="text-base text-muted-foreground">
          Paste a Google Maps place URL or a raw Place ID and download every
          review as CSV, JSON, or XLSX.
        </p>
      </header>

      <form
        action="/api/reviews"
        method="GET"
        target="_blank"
        rel="noopener"
        className="flex w-full flex-col gap-5 rounded-lg border border-border bg-card p-6 shadow-sm"
      >
        <label className="flex flex-col gap-2 text-sm" htmlFor="placeId">
          <span className="font-medium">Place URL or Place ID</span>
          <input
            id="placeId"
            type="text"
            name="placeId"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="https://maps.google.com/...   or   ChIJ..."
            className="rounded-md border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">
            Accepts a Google Maps place URL, a <code>place_id</code> (
            <code>ChIJ…</code>), or a numeric CID. Normalisation rules:
            see <code>docs/methodology.md</code> §1.
          </span>
        </label>

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="font-medium">Export format</legend>
          <div className="flex flex-wrap gap-2">
            {FORMATS.map((f, i) => (
              <label
                key={f.value}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2"
              >
                <input
                  type="radio"
                  name="format"
                  value={f.value}
                  defaultChecked={i === 0}
                />
                <span>{f.label}</span>
                <span className="text-xs text-muted-foreground">
                  ({f.hint})
                </span>
              </label>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            CSV opens in Excel without an import wizard (UTF-8 BOM, CRLF,
            QUOTE_ALL); XLSX gets a frozen header row and tuned column
            widths. JSON returns the raw <code>GetReviewsResponse</code>
            envelope.
          </span>
        </fieldset>

        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Download reviews
        </button>
      </form>

      <p className="text-xs text-muted-foreground">
        Result preview (first 5 reviews + total count) ships in L2.5. Until
        then the API response opens in a new browser tab.
      </p>

      <section
        aria-labelledby="faq-heading"
        className="flex w-full flex-col gap-3"
      >
        <h2
          id="faq-heading"
          className="text-lg font-semibold tracking-tight"
        >
          FAQ
        </h2>

        <details className="group rounded-md border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium">
            How it works
          </summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Paste a Google Maps place URL or a raw Place ID. We extract
              and normalise the ID (see <code>docs/methodology.md</code>
              §1); short <code>maps.app.goo.gl</code> links are not
              resolved in v1.
            </li>
            <li>
              We page through every review for that place via a licensed
              third-party reviews API (max 100 per request, hard cap 5,000
              reviews / 50 pages). Results are cached for 24h per
              normalised place so a repeat download is instant.
            </li>
            <li>
              You pick CSV, XLSX, or JSON and the browser downloads the
              file. CSV opens in Excel without an import wizard (UTF-8
              BOM, CRLF, QUOTE_ALL); XLSX has a frozen header row.
            </li>
          </ol>
        </details>

        <details className="group rounded-md border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Is this allowed by Google?
          </summary>
          <div className="mt-3 space-y-2 text-sm text-muted-foreground">
            <p>
              Reviews on Google Maps are public. This tool does not scrape
              Google directly — it queries a licensed third-party reviews
              data provider (SemanticForce) that maintains a Google-Maps
              snapshot under its own data agreements.
            </p>
            <p>
              The export is meant for the business owner or their agency
              to keep an offline copy of their own reviews — for backup,
              sentiment analysis, training data, or republishing
              individual quotes with author credit. Bulk redistribution of
              the raw dataset is not the intent.
            </p>
            <p>
              If you republish individual reviews, keep the author
              attribution. Google&apos;s own attribution requirements
              apply to anything pulled from Maps.
            </p>
          </div>
        </details>
      </section>
    </main>
  );
}
