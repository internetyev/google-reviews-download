// Long-tail SEO variant landing pages (L3.1a infrastructure).
//
// One dynamic route renders every published variant: custom above-the-fold
// copy from the registry, then the shared review tool below the fold —
// "same tool below the fold, custom intro/explainer above" (L3.1).
//
// `generateStaticParams` + `dynamicParams = false` means only variants with
// `published: true` exist; everything else is a hard 404. The full candidate
// list is wired but inert until L3.1b flips the corgi-picked top 5
// (`docs/seo-variants.md`, after the L1.6b volume pass).

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReviewToolForm } from "@/app/_components/review-tool-form";
import {
  findPublishedVariant,
  publishedVariants,
} from "@/lib/seo/variants";

export const dynamicParams = false;

export function generateStaticParams(): { variant: string }[] {
  return publishedVariants().map((v) => ({ variant: v.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ variant: string }>;
}): Promise<Metadata> {
  const { variant: slug } = await params;
  const variant = findPublishedVariant(slug);
  if (!variant) return {};
  return {
    title: variant.metaTitle,
    description: variant.metaDescription,
    alternates: { canonical: `/${variant.slug}` },
    openGraph: {
      title: variant.metaTitle,
      description: variant.metaDescription,
    },
  };
}

export default async function VariantPage({
  params,
}: {
  params: Promise<{ variant: string }>;
}) {
  const { variant: slug } = await params;
  const variant = findPublishedVariant(slug);
  if (!variant) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 px-6 py-16">
      <header className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          {variant.h1}
        </h1>
        {variant.intro.map((para) => (
          <p key={para} className="text-base text-muted-foreground">
            {para}
          </p>
        ))}
      </header>

      <ReviewToolForm />

      <p className="text-xs text-muted-foreground">
        Result preview (first 5 reviews + total count) ships in L2.5. Until
        then the API response opens in a new browser tab.
      </p>
    </main>
  );
}
