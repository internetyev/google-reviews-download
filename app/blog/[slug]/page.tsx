// Blog article route. One template renders every published post from the
// registry: H1 + dek, Key Takeaways block, body, then Article (+ HowTo + FAQ)
// JSON-LD. dynamicParams=false → only published slugs exist; everything else
// is a hard 404.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { findPublishedPost, publishedPosts } from "@/lib/blog/index";
import { PostBody, InlineText } from "@/app/_components/blog/render";
import { postJsonLd } from "@/lib/blog/jsonld";

export const dynamicParams = false;

const FALLBACK_SITE_URL = "https://googlereviewsdownload.com";

function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return FALLBACK_SITE_URL;
  return raw.replace(/\/+$/, "");
}

export function generateStaticParams(): { slug: string }[] {
  return publishedPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = findPublishedPost(slug);
  if (!post) return {};
  return {
    title: post.metaTitle,
    description: post.metaDescription,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.metaTitle,
      description: post.metaDescription,
      publishedTime: post.datePublished,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = findPublishedPost(slug);
  if (!post) notFound();

  const jsonLd = postJsonLd(post, siteUrl());

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-16">
      {jsonLd.map((block, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(block) }}
        />
      ))}

      <nav className="text-sm text-muted-foreground">
        <Link href="/blog" className="underline underline-offset-2">
          ← All articles
        </Link>
      </nav>

      <article className="flex flex-col gap-6">
        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{post.title}</h1>
          <p className="text-lg text-muted-foreground">{post.excerpt}</p>
          <time
            dateTime={post.datePublished}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            {post.datePublished}
          </time>
        </header>

        <section
          aria-labelledby="key-takeaways"
          className="rounded-lg border border-border bg-card p-5"
        >
          <h2 id="key-takeaways" className="mb-2 text-sm font-semibold uppercase tracking-wide">
            Key takeaways
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/90">
            {post.keyTakeaways.map((t, i) => (
              <li key={i}>
                <InlineText text={t} />
              </li>
            ))}
          </ul>
        </section>

        <PostBody blocks={post.body} />

        {post.faq && post.faq.length > 0 && (
          <section aria-labelledby="faq" className="mt-4 flex flex-col gap-4">
            <h2 id="faq" className="text-2xl font-semibold tracking-tight">
              Frequently asked questions
            </h2>
            {post.faq.map((f, i) => (
              <details key={i} className="rounded-md border border-border px-4 py-3">
                <summary className="cursor-pointer font-medium">{f.q}</summary>
                <p className="mt-2 text-sm text-foreground/90">
                  <InlineText text={f.a} />
                </p>
              </details>
            ))}
          </section>
        )}
      </article>
    </main>
  );
}
