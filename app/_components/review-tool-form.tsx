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

// Optional filter controls (L33.3). These post the same query params the HTTP
// API understands (`min_rating`/`max_rating`/`language`/`with_photos`) so the
// preview and the download both honour the slice. A blank/"Any" value omits the
// param (the route + the pure filter layer treat absent as "no constraint"), so
// leaving the whole fieldset untouched is exactly today's unfiltered behaviour.
const RATINGS = [5, 4, 3, 2, 1] as const;

// A short list of the languages the fixtures + most Google review sets use; the
// option `value` is the ISO code the SerpApi/SemanticForce `language` field
// carries, matched case-insensitively by `lib/reviews/filter.ts`.
const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "uk", label: "Ukrainian" },
  { value: "ja", label: "Japanese" },
] as const;

export function ReviewToolForm() {
  return (
    <form
      action="/preview"
      method="GET"
      className="flex w-full flex-col gap-5 rounded-lg border border-border bg-card p-6 shadow-sm"
    >
      <label className="flex flex-col gap-2 text-sm" htmlFor="placeId">
        <span className="font-medium">Business name, Place URL, or Place ID</span>
        <input
          id="placeId"
          type="text"
          name="placeId"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="Blue Bottle Coffee   or   https://maps.google.com/...   or   ChIJ..."
          className="rounded-md border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground">
          Paste a <strong>business name</strong> (e.g. “Blue Bottle Coffee”), a
          Google Maps place URL, or a <code>place_id</code> (<code>ChIJ…</code>).
          Names are matched via Google Maps search.
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

      <fieldset className="flex flex-col gap-3 text-sm">
        <legend className="font-medium">Filter (optional)</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1" htmlFor="min_rating">
            <span className="text-xs text-muted-foreground">Min rating</span>
            <select
              id="min_rating"
              name="min_rating"
              defaultValue=""
              className="rounded-md border border-input bg-background px-3 py-2 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Any</option>
              {RATINGS.map((r) => (
                <option key={r} value={r}>
                  {r}★ &amp; up
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1" htmlFor="max_rating">
            <span className="text-xs text-muted-foreground">Max rating</span>
            <select
              id="max_rating"
              name="max_rating"
              defaultValue=""
              className="rounded-md border border-input bg-background px-3 py-2 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Any</option>
              {RATINGS.map((r) => (
                <option key={r} value={r}>
                  {r}★ &amp; below
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1" htmlFor="language">
            <span className="text-xs text-muted-foreground">Language</span>
            <select
              id="language"
              name="language"
              defaultValue=""
              className="rounded-md border border-input bg-background px-3 py-2 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Any</option>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" name="with_photos" value="1" />
          <span>Only reviews with photos</span>
        </label>

        <span className="text-xs text-muted-foreground">
          Filters apply to the preview <em>and</em> the download. Leave them on
          “Any” to export every review. The preview filters the first reviews it
          samples; the full download filters every review.
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
