// Coverage for the blog feature (lib/blog/* + app/blog/[slug]). Offline,
// no react-dom — React element trees are walked structurally (the D-050
// pattern). The load-bearing contracts: JSON-LD shape (Article always, HowTo +
// FAQ when present), the safe inline parser (links/bold/code, no raw HTML),
// the registry publish gate, and the route rendering published vs 404ing not.

import { describe, it, expect } from "vitest";
import {
  allPosts,
  publishedPosts,
  findPublishedPost,
} from "@/lib/blog/index";
import {
  articleJsonLd,
  howToJsonLd,
  blogFaqJsonLd,
  postJsonLd,
  plain,
} from "@/lib/blog/jsonld";
import Link from "next/link";
import { InlineText, BlockView } from "@/app/_components/blog/render";
import BlogPostPage, {
  generateStaticParams,
  generateMetadata,
} from "@/app/blog/[slug]/page";

const SAMPLE = "how-to-download-google-reviews";

// --- structural walk (no react-dom) --------------------------------------
type El = { type: unknown; props?: { children?: unknown } };
function isEl(n: unknown): n is El {
  return typeof n === "object" && n !== null && "type" in (n as object);
}
function walk(node: unknown, visit: (el: El) => void) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (isEl(node)) {
    visit(node);
    walk(node.props?.children, visit);
  }
}
function typeName(t: unknown): string {
  if (typeof t === "string") return t;
  if (typeof t === "function") return (t as { name?: string }).name ?? "";
  return "";
}
function countTag(node: unknown, tag: string): number {
  let n = 0;
  walk(node, (el) => {
    if (typeName(el.type) === tag) n++;
  });
  return n;
}
// next/link is a forwardRef object with no usable .name — match by reference.
function countRef(node: unknown, ref: unknown): number {
  let n = 0;
  walk(node, (el) => {
    if (el.type === ref) n++;
  });
  return n;
}
function collectText(node: unknown): string {
  let s = "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (isEl(node)) return collectText(node.props?.children);
  return s;
}
const mk = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe("blog registry", () => {
  it("the sample article is published and findable", () => {
    expect(findPublishedPost(SAMPLE)?.slug).toBe(SAMPLE);
    expect(publishedPosts().some((p) => p.slug === SAMPLE)).toBe(true);
  });
  it("findPublishedPost returns undefined for unknown / unpublished", () => {
    expect(findPublishedPost("no-such-post")).toBeUndefined();
  });
  it("every registered post has SERP-bounded meta + the render fields", () => {
    for (const p of allPosts()) {
      expect(p.metaTitle.length).toBeGreaterThan(0);
      expect(p.metaTitle.length).toBeLessThanOrEqual(60);
      expect(p.metaDescription.length).toBeLessThanOrEqual(160);
      expect(p.keyTakeaways.length).toBeGreaterThan(0);
      expect(p.body.length).toBeGreaterThan(0);
      // every post links down to its money/hub target
      expect(p.linksTo.startsWith("/")).toBe(true);
    }
  });
});

describe("blog JSON-LD", () => {
  const post = findPublishedPost(SAMPLE)!;
  it("articleJsonLd is a schema.org Article with the canonical url", () => {
    const a = articleJsonLd(post, "https://x.test");
    expect(a["@type"]).toBe("Article");
    expect(a.mainEntityOfPage["@id"]).toBe(`https://x.test/blog/${SAMPLE}`);
    expect(a.datePublished).toBe(post.datePublished);
  });
  it("howToJsonLd emits positioned steps when howTo present", () => {
    const h = howToJsonLd(post)!;
    expect(h["@type"]).toBe("HowTo");
    expect(h.step[0].position).toBe(1);
    expect(h.step.length).toBe(post.howTo!.steps.length);
  });
  it("blogFaqJsonLd emits a FAQPage; plain() strips inline syntax", () => {
    const f = blogFaqJsonLd(post)!;
    expect(f["@type"]).toBe("FAQPage");
    // answers must be plain text (no [..](..) markup) for the schema
    for (const q of f.mainEntity) {
      expect(q.acceptedAnswer.text).not.toMatch(/\]\(/);
    }
    expect(plain("see [the tool](/) and **this**")).toBe("see the tool and this");
  });
  it("postJsonLd returns Article + HowTo + FAQ for this post (3 blocks)", () => {
    expect(postJsonLd(post, "https://x.test")).toHaveLength(3);
  });
  it("a post with no howTo/faq yields only the Article block", () => {
    const bare = { ...post, howTo: undefined, faq: undefined };
    expect(postJsonLd(bare, "https://x.test")).toHaveLength(1);
  });
});

describe("InlineText safe parser", () => {
  it("renders an internal link as a next/link and external as <a>", () => {
    const internal = InlineText({ text: "go [here](/export-google-reviews-to-csv) now" });
    expect(countRef(internal, Link)).toBe(1);
    const external = InlineText({ text: "see [docs](https://example.com/x)" });
    expect(countTag(external, "a")).toBe(1);
  });
  it("renders bold and code, and preserves surrounding text", () => {
    const node = InlineText({ text: "a **b** and `c` end" });
    expect(countTag(node, "strong")).toBe(1);
    expect(countTag(node, "code")).toBe(1);
    expect(collectText(node)).toContain("end");
  });
  it("does not interpret raw HTML (no markup injection)", () => {
    const node = InlineText({ text: "<script>x</script>" });
    // the angle-bracket text survives as a plain string, not an element
    expect(collectText(node)).toBe("<script>x</script>");
    expect(countTag(node, "script")).toBe(0);
  });
});

describe("blog article route", () => {
  it("generateStaticParams enumerates published slugs", async () => {
    const params = generateStaticParams();
    expect(params).toEqual(publishedPosts().map((p) => ({ slug: p.slug })));
    expect(params.length).toBeGreaterThan(0);
  });
  it("generateMetadata returns title for a published slug, {} for unknown", async () => {
    expect((await generateMetadata(mk(SAMPLE))).title).toBeTruthy();
    expect(await generateMetadata(mk("nope"))).toEqual({});
  });
  it("renders H1 + a Key Takeaways region and wires the post body", async () => {
    const tree = await BlogPostPage(mk(SAMPLE));
    expect(countTag(tree, "h1")).toBe(1);
    // "Key takeaways" is literal page JSX (not behind a component) → collected.
    expect(collectText(tree)).toContain("Key takeaways");
    // The body is handed to <PostBody blocks={post.body} /> — find that element
    // and assert it carries the post's blocks (structural, no react-dom render).
    let bodyWired = false;
    walk(tree, (el) => {
      if (typeName(el.type) === "PostBody") {
        const blocks = (el.props as { blocks?: unknown[] }).blocks;
        if (Array.isArray(blocks) && blocks.length === findPublishedPost(SAMPLE)!.body.length) {
          bodyWired = true;
        }
      }
    });
    expect(bodyWired).toBe(true);
  });

  it("BlockView renders a cta block as a link with the label", () => {
    const node = BlockView({ block: { type: "cta", href: "/", label: "Download now" } });
    expect(countRef(node, Link)).toBe(1);
    expect(collectText(node)).toContain("Download now");
  });
  it("404s an unknown slug", async () => {
    let threw = false;
    try {
      await BlogPostPage(mk("not-a-real-post"));
    } catch (e) {
      threw = true;
      expect(String((e as { digest?: string })?.digest ?? e)).toMatch(/NOT_FOUND|404/);
    }
    expect(threw).toBe(true);
  });
});
