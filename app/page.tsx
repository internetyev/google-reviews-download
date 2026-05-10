export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">
        google-reviews-download
      </h1>
      <p className="text-center text-base text-muted-foreground">
        Paste a Google Maps place URL or Place ID and download every review as
        CSV, JSON, or XLSX.
      </p>
      <p className="text-sm text-muted-foreground">
        Scaffold only — input form ships in L2.4.
      </p>
    </main>
  );
}
