// The "paste several places, preview per-place counts, one combined download"
// tool (L31.3) — the multi-place sibling of ReviewToolForm.
//
// Kept as a SEPARATE component (not folded into ReviewToolForm) so the single-
// place form's heavily-pinned contract is untouched, and so the SEO variant
// pages keep only the single-place tool (single-keyword intent) while the home
// page offers both. Plain GET form — no client JS — it navigates to `/preview`
// with a `places` param (comma/newline-separated), which the preview route
// reads in batch mode: per-place review counts + one combined CSV/XLSX/JSON/MD
// download. `format` rides along as the preferred download format.

const FORMATS = [
  { value: "csv", label: "CSV", hint: "combined file" },
  { value: "xlsx", label: "XLSX", hint: "combined file" },
  { value: "json", label: "JSON", hint: "combined envelope" },
  { value: "md", label: "Markdown", hint: "combined document" },
  { value: "html", label: "HTML", hint: "combined page" },
  { value: "txt", label: "Plain text", hint: "combined file" },
  { value: "jsonld", label: "JSON-LD", hint: "combined document" },
  { value: "rss", label: "RSS", hint: "combined feed" },
  { value: "atom", label: "Atom", hint: "combined feed" },
] as const;

export function BatchReviewToolForm() {
  return (
    <form
      action="/preview"
      method="GET"
      className="flex w-full flex-col gap-5 rounded-lg border border-border bg-card p-6 shadow-sm"
    >
      <label className="flex flex-col gap-2 text-sm" htmlFor="places">
        <span className="font-medium">Batch: several businesses at once</span>
        <textarea
          id="places"
          name="places"
          required
          rows={4}
          autoComplete="off"
          spellCheck={false}
          placeholder={
            "Blue Bottle Coffee\nPhilz Coffee\nChIJ...\n(one per line, or comma-separated)"
          }
          className="rounded-md border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground">
          Paste up to 25 businesses — one per line, or comma-separated. The
          preview shows each place&apos;s review count; the download is a single
          combined file with a <code>place_id</code>/<code>place_name</code>
          column on every row so you can split it back apart later.
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
              <span className="text-xs text-muted-foreground">({f.hint})</span>
            </label>
          ))}
        </div>
      </fieldset>

      <button
        type="submit"
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Preview &amp; download batch
      </button>
    </form>
  );
}
