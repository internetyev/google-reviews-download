// Blog index — lists published posts grouped by cluster. Internal-links into
// every article (and the home tool), so it's a hub for the L5 content cluster.

import type { Metadata } from "next";
import Link from "next/link";
import { publishedPosts } from "@/lib/blog/index";
import type { BlogCluster } from "@/lib/blog/types";

export const metadata: Metadata = {
  title: "Google Reviews Guides & How-Tos — Blog",
  description:
    "Guides on downloading, exporting, backing up, and managing your Google reviews — CSV, Excel, JSON, and the API.",
  alternates: { canonical: "/blog" },
};

const CLUSTER_LABEL: Record<BlogCluster, string> = {
  "how-to": "How-to guides",
  "use-case": "Use cases",
  adjacent: "Managing your reviews",
};

const CLUSTER_ORDER: BlogCluster[] = ["how-to", "use-case", "adjacent"];

export default function BlogIndexPage() {
  const posts = publishedPosts();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          Google reviews guides &amp; how-tos
        </h1>
        <p className="text-base text-muted-foreground">
          Everything about getting your Google reviews out of Google — and what to
          do with them. Or skip straight to the{" "}
          <Link href="/" className="text-primary underline underline-offset-2">
            download tool
          </Link>
          .
        </p>
      </header>

      {CLUSTER_ORDER.map((cluster) => {
        const inCluster = posts.filter((p) => p.cluster === cluster);
        if (inCluster.length === 0) return null;
        return (
          <section key={cluster} className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {CLUSTER_LABEL[cluster]}
            </h2>
            <ul className="flex flex-col gap-4">
              {inCluster.map((p) => (
                <li key={p.slug}>
                  <Link href={`/blog/${p.slug}`} className="group flex flex-col gap-1">
                    <span className="text-lg font-medium group-hover:text-primary group-hover:underline">
                      {p.title}
                    </span>
                    <span className="text-sm text-muted-foreground">{p.excerpt}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
