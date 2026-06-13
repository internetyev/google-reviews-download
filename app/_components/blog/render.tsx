// Renders BlogPost content blocks → React, with a tiny safe inline parser
// (links / bold / code). No dangerouslySetInnerHTML, no markdown dependency.

import type { ReactNode } from "react";
import Link from "next/link";
import type { Block } from "@/lib/blog/types";

// --- inline parser: [label](href), **bold**, `code` ----------------------

const INLINE_RE = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;

export function InlineText({ text }: { text: string }): ReactNode {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const href = m[2];
      const internal = href.startsWith("/");
      nodes.push(
        internal ? (
          <Link key={key++} href={href} className="text-primary underline underline-offset-2">
            {m[1]}
          </Link>
        ) : (
          <a
            key={key++}
            href={href}
            className="text-primary underline underline-offset-2"
            rel="noopener noreferrer"
            target="_blank"
          >
            {m[1]}
          </a>
        ),
      );
    } else if (m[3] !== undefined) {
      nodes.push(<strong key={key++}>{m[3]}</strong>);
    } else if (m[4] !== undefined) {
      nodes.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 text-sm">
          {m[4]}
        </code>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

// --- block renderer -------------------------------------------------------

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function PostBody({ blocks }: { blocks: readonly Block[] }) {
  return (
    <div className="flex flex-col gap-5">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}

export function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "h2":
      return (
        <h2
          id={slugifyHeading(block.text)}
          className="mt-4 text-2xl font-semibold tracking-tight"
        >
          {block.text}
        </h2>
      );
    case "h3":
      return <h3 className="mt-2 text-xl font-semibold">{block.text}</h3>;
    case "p":
      return (
        <p className="text-base leading-7 text-foreground/90">
          <InlineText text={block.text} />
        </p>
      );
    case "ul":
      return (
        <ul className="list-disc space-y-1 pl-6 text-foreground/90">
          {block.items.map((it, i) => (
            <li key={i}>
              <InlineText text={it} />
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="list-decimal space-y-1 pl-6 text-foreground/90">
          {block.items.map((it, i) => (
            <li key={i}>
              <InlineText text={it} />
            </li>
          ))}
        </ol>
      );
    case "callout":
      return (
        <aside className="rounded-md border-l-4 border-primary bg-muted/50 px-4 py-3 text-sm text-foreground/90">
          <InlineText text={block.text} />
        </aside>
      );
    case "stat":
      return (
        <figure className="rounded-md border border-border bg-card px-4 py-3">
          <blockquote className="text-base text-foreground/90">
            <InlineText text={block.text} />
          </blockquote>
          <figcaption className="mt-1 text-xs text-muted-foreground">
            Source:{" "}
            <a href={block.url} className="underline" rel="noopener noreferrer" target="_blank">
              {block.source}
            </a>
          </figcaption>
        </figure>
      );
    case "cta":
      return (
        <Link
          href={block.href}
          className="inline-flex w-fit items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
        >
          {block.label}
        </Link>
      );
  }
}
