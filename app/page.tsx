const FORMATS = [
  { value: "json", label: "JSON", hint: "available today" },
  { value: "csv", label: "CSV", hint: "available today" },
  { value: "xlsx", label: "XLSX", hint: "available today" },
] as const;

const FAQ = [
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
  },
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
        className="flex w-full flex-col gap-4"
      >
        <h2
          id="faq-heading"
          className="text-xl font-semibold tracking-tight"
        >
          FAQ
        </h2>
        <div className="flex flex-col gap-3">
          {FAQ.map((item) => (
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
    </main>
  );
}
