import { ReviewToolForm } from "@/app/_components/review-tool-form";
import { FaqSection } from "@/app/_components/faq";

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

      <FaqSection />
    </main>
  );
}
