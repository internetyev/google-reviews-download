import { ReviewToolForm } from "@/app/_components/review-tool-form";

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

      <ReviewToolForm />

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
