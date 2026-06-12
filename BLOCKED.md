# BLOCKED — 2026-06-13 (4th encounter; cause UNCHANGED, now with stop-the-churn + backlog-ready guidance)

**Leaf:** pipeline-desync (no autonomous leaf available; `origin/main` and local `main` have diverged by SHA — 19 unpushed local commits vs. 1 origin-only BLOCKED commit)

## TL;DR for the human (this fire added two new, actionable things)

1. **Run the 5-line rebase below** to publish the 19 stranded commits (history intact). That is the *only* fix; the routine is forbidden from pushing to `main`, so it cannot self-heal.
2. **Until you do, pause the routine** (commands in §"Stop the hourly churn") — every fire this weekend lands here, does nothing, and adds one more BLOCKED commit to reconcile.
3. **After the rebase, paste the proposed Phase 30** (§"Ready-to-paste backlog") into `ROADMAP.md` so future fires have real, agent-doable work instead of re-blocking.

## Re-verified this run (2026-06-13)

- `git merge-base main origin/main` = `cc4bedb` (phase-26).
- local `main` = `a7e093a` — **19 commits ahead** of the merge-base (the SerpApi unblock + Phases 27–29 + SEO/blog work; full list below).
- `origin/main` = `47cae65` — **1 commit ahead** of the merge-base: PR #82, the prior BLOCKED note itself.
- `git merge-base --is-ancestor origin/main main` → **false** (true divergence, not "local strictly ahead").
- Open `claude/*` PR queue: **empty**. `gh` is authenticated.
- `ROADMAP.md` on local `main`: every remaining `[ ]` leaf is human-gated/corgi-deferred (`L1.6b` corgi cash, `L3.1b` gated behind it, `L4.1` real SF creds, `L5.1` domain purchase, `L5.2` Vercel deploy). **No agent-doable leaf exists.**

**Why I cannot build anything autonomously, even a roadmap refill:** `origin/main` (`47cae65`) does not contain Phase 27 at all — Phase 27 was opened in `399d64f`, which lives only on local `main`. Any branch cut from `origin/main` (the routine's mandated base) starts from a ROADMAP that has never heard of Phases 27–29, so adding a "Phase 30" there would conflict head-on with the 19 unpushed commits. **Nothing can be safely built until the desync is reconciled.**

## The 19 local commits still only on this laptop

`399d64f` SerpApi unblock → `0d2f940`–`04b9369` Phase 27 (L27.1–L27.8) →
`b4b2524`–`becd2af` Phase 28 (L28.1–L28.4) → `fc37f0c`,`277ab1f` Phase 29 (L29.1) →
`75c8aac`,`f6c1be0`,`a7e093a` SEO/blog (topical map, 8 Tier-1 landing pages, blog engine).
The SerpApi unblock is **proven** — L27.5 made one live E2E call. This is real, valuable work at risk of single-laptop loss; back it up if you won't rebase soon.

## What I need from you

### 1. Publish the 19 commits, preserving history (rebase — recommended)

```sh
git checkout main
git fetch origin
git rebase origin/main            # replays the 19 commits on top of 47cae65
git rm BLOCKED.md                 # drop this resolved note (came in via origin)
git commit -m "chore: clear resolved pipeline-desync BLOCKED.md"
git push origin main              # fast-forwards origin/main; all 19 commits intact, no squash
```

Or a merge commit instead of a rebase:

```sh
git checkout main
git fetch origin
git merge origin/main -m "merge: reconcile origin BLOCKED note with local Phase 27-29 work"
git rm BLOCKED.md && git commit -m "chore: clear resolved pipeline-desync BLOCKED.md"
git push origin main
```

Either path restores the routine's invariant (`origin/main` == local `main`, ff works
again) without routing the 19 commits through a squashing `claude/*` PR (which would
collapse the hand-authored SEO/blog history and re-break the next run's ff re-baseline).
Do **not** `git push --force`; none of the above needs it.

### 2. Stop the hourly churn (do this if you can't rebase right now)

This is a **burn window** (Fri 23:30 → Mon 04:00): the routine fires every hour and each
fire can only land back here, adding one more BLOCKED commit for you to reconcile later.
To pause it until you've rebased:

```sh
launchctl unload ~/Library/LaunchAgents/com.google-reviews-download.routine.burn.plist
launchctl unload ~/Library/LaunchAgents/com.google-reviews-download.routine.weeknight.plist
# re-enable after reconciling + adding Phase 30:
#   launchctl load ~/Library/LaunchAgents/com.google-reviews-download.routine.burn.plist
#   launchctl load ~/Library/LaunchAgents/com.google-reviews-download.routine.weeknight.plist
```

### 3. Ready-to-paste backlog (so the next fire isn't an instant re-block)

After the rebase lands, drop this Phase 30 into `ROADMAP.md` (just above the
"Out-of-scope parking lot"). All five are genuinely agent-doable — **no creds, no
deploy, offline-testable, and NOT test-padding on already-tested modules** (the banned
rut). They are real product/docs/robustness work the project still lacks:

```markdown
## Phase 30 — Product polish & docs (agent-doable, no creds/deploys)

- [ ] L30.1 Top-level `README.md` quickstart covering all three delivery surfaces (web tool, HTTP API, MCP server) — consolidate from `docs/api.md` + the MCP server's tool schema into one onboarding doc with a copy-paste example per surface.
- [ ] L30.2 Friendly error-UX pass on the web form: map each `SemanticForceError` case (quota exceeded, place-not-found, rate-limited, upstream 5xx) to a human-readable message + retry hint; offline component test over the mapping.
- [ ] L30.3 `docs/architecture.md` — the provider-switch design (`REVIEWS_PROVIDER=serpapi|semanticforce|mock`), the `SemanticForceClient` contract boundary, and the two cache namespaces (preview vs. full); diagram in Mermaid.
- [ ] L30.4 Export-parity invariant: assert CSV and XLSX exporters emit identical column set + ordering from the same `Review[]`; add one offline cross-exporter test (this is a real cross-module contract, not single-module padding).
- [ ] L30.5 `/api/reviews` input hardening: clamp `limit` to a sane max, reject/normalise malformed `business-name`, return `400` with a typed error body; offline route tests for each branch.
```

## Suggested next action

Run the rebase (§1), then either pause the routine (§2) until you're ready or paste
Phase 30 (§3) so the next fire has work. _This refresh PR was cut from `origin/main` so
it auto-merges without touching the 19 unpushed local commits; it only updates
`BLOCKED.md` in place._
