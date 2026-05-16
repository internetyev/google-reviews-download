// The "paste a place, preview, download" tool.
//
// Single source of truth for the form so the home page (L2.4) and every
// SEO variant page (L3.1) render the identical tool below the fold. Plain
// GET form — no client JS — it navigates to `/preview` (L2.5), which shows
// the first 5 reviews + total count + a download CTA. `format` rides along
// as the *preferred* download format so the preview CTA defaults to it.

const FORMATS = [
  { value: "json", label: "JSON", hint: "available today" },
  { value: "csv", label: "CSV", hint: "available today" },
  { value: "xlsx", label: "XLSX", hint: "available today" },
] as const;

export function ReviewToolForm() {
  return (
    <form
      action="/preview"
      method="GET"
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
        Preview &amp; download reviews
      </button>
    </form>
  );
}
