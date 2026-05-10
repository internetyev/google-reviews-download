const FORMATS = [
  { value: "json", label: "JSON", hint: "available today" },
  { value: "csv", label: "CSV", hint: "ships in L2.6" },
  { value: "xlsx", label: "XLSX", hint: "ships in L2.7" },
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
            CSV and XLSX selections currently return HTTP 501 from the API
            until the writers land in L2.6 / L2.7.
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
    </main>
  );
}
