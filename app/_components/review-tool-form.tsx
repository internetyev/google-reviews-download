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

// Optional sort control (L34.3). Posts the `order` param the HTTP API parses
// (`lib/reviews/sort.ts`'s `ReviewOrder` union, aliased as `sort` on the route)
// so the preview and the download apply the same ordering. The empty "" value
// is the default "as listed" identity — the route + the pure sort layer treat
// an absent/unrecognised order as "no sort", so leaving this untouched is
// exactly today's unordered behaviour. The option values are the `ReviewOrder`
// strings verbatim (`parseReviewOrder` lower-cases + trims, so they round-trip).
const ORDERS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "highest", label: "Highest rated" },
  { value: "lowest", label: "Lowest rated" },
] as const;

// Optional column picker (L35.3). Each checkbox posts a `fields` param the HTTP
// API + preview narrow the exported columns by (`lib/reviews/project.ts`'s
// `ReviewField` union, parsed by the shared `lib/reviews/project-params.ts`). A
// no-JS multi-checkbox GET submits repeated `fields=rating&fields=text` params,
// which `parseFieldsParam` collects; leaving every box unchecked submits no
// `fields` param at all → the route/preview keep ALL columns (the identity), so
// the untouched fieldset is exactly today's full-export behaviour. The `value`s
// are the `ReviewField` strings verbatim so each round-trips through the parser.
const COLUMN_FIELDS = [
  { value: "review_id", label: "Review ID" },
  { value: "author_name", label: "Author" },
  { value: "author_url", label: "Author URL" },
  { value: "rating", label: "Rating" },
  { value: "text", label: "Review text" },
  { value: "language", label: "Language" },
  { value: "published_at", label: "Date" },
  { value: "photos", label: "Photos" },
  { value: "owner_response", label: "Owner response" },
] as const;

// Optional privacy / PII-redaction controls (L36.3). Each checkbox posts a
// granular redaction flag the HTTP API + preview parse via the shared
// `lib/reviews/anonymise-params.ts` (`parseAnonymiseOptions`) into an
// `AnonymiseOptions`, applied by the pure `lib/reviews/anonymise.ts` layer. The
// `value="1"` is the truthy token `parseBooleanFlag` accepts; a no-JS checkbox
// submits the param only when checked, so leaving every box unchecked submits no
// redaction param at all → the route/preview keep every field intact (the
// identity), exactly today's full-export behaviour. The `name`s are the granular
// `ANONYMISE_PARAM_KEYS` verbatim so each round-trips through the parser. (The
// `anonymize` umbrella that turns on all three at once stays an API-only switch;
// the form exposes the three redactions individually so a user can mask names
// while keeping photos, etc.)
const PRIVACY_FLAGS = [
  { name: "mask_author", label: "Mask reviewer names (initials only)" },
  { name: "drop_author_url", label: "Remove reviewer profile links" },
  { name: "drop_photos", label: "Remove reviewer photos" },
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
        <legend className="font-medium">Filter &amp; sort (optional)</legend>
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

          <label className="flex flex-col gap-1" htmlFor="order">
            <span className="text-xs text-muted-foreground">Sort order</span>
            <select
              id="order"
              name="order"
              defaultValue=""
              className="rounded-md border border-input bg-background px-3 py-2 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">As listed</option>
              {ORDERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
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
          Filters and sort order apply to the preview <em>and</em> the download.
          Leave them on “Any” / “As listed” to export every review in the order
          Google returns them. The preview filters and orders the first reviews
          it samples; the full download filters and orders every review.
        </span>
      </fieldset>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="font-medium">Columns (optional)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {COLUMN_FIELDS.map((c) => (
            <label
              key={c.value}
              className="flex cursor-pointer items-center gap-2"
            >
              <input type="checkbox" name="fields" value={c.value} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          Pick which columns to export. Leave every box unchecked to include all
          fields (the default). The selection narrows the CSV/XLSX columns and
          the JSON keys of both the preview and the download.
        </span>
      </fieldset>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="font-medium">Privacy (optional)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {PRIVACY_FLAGS.map((p) => (
            <label
              key={p.name}
              className="flex cursor-pointer items-center gap-2"
            >
              <input type="checkbox" name={p.name} value="1" />
              <span>{p.label}</span>
            </label>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          Redact reviewers&apos; personal data before exporting — mask names to
          initials (“John Smith” → “J. S.”), drop profile links, and drop
          reviewer-uploaded photos. Leave every box unchecked to keep the
          reviews untouched (the default). The redaction applies to the preview{" "}
          <em>and</em> the download.
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
