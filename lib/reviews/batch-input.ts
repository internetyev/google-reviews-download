// Shared multi-place batch-input parsing (L31.2/L31.3).
//
// Used by BOTH the HTTP route (app/api/reviews/route.ts, the `places` param)
// and the web preview (app/preview/page.tsx) so the two surfaces split the same
// pasted list into the same place list — no drift. Drift here would be a silent
// bug: the preview would show a different set of places than the combined
// download produces. Keeping the split/dedupe rule in one place makes that
// impossible.

// Upper bound on places in one batch. A batch resolves + walks each place
// upstream, so the count directly caps quota spend per request; 25 is a generous
// "paste a list" ceiling that still bounds a single request's cost.
export const MAX_BATCH_PLACES = 25;

// Split a comma/newline-separated paste into a clean, de-duplicated list of
// place inputs, preserving first-seen order. Trims each entry and drops blanks.
// Dedupe is by raw trimmed text (a name that resolves to the same place as an
// id is collapsed later, post-resolution, by the caller).
export function parsePlacesList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
