# Autonomous Routine — google-reviews-download

_How each scheduled local run is expected to behave._

## Schedule

The routine fires only at **night** — daytime is reserved for the human's own work. There are two intensities:

- **Burn (full speed, hourly).** The weekend depletion window: **Friday 23:30 → Monday 04:00**, with daytime gaps Sat 04:00–22:00 and Sun 04:00–22:00. google-reviews-download fires on the hour (`:00`); halflife fires on the half-hour (`:30`); the two repos alternate every 30 min so there is at most one routine running at a time. Last fire each night is at 04:00 (gr-d). Token-use cap per fire: `$3.00` via `--max-budget-usd` (a Max-quota proxy, not real cash — see the spend note below).
- **Weeknight (50% intensity, every 4h).** Mon–Fri nights at 22:00/22:30 and 02:00/02:30 (last fire ≤ 04:00). Token-use cap per fire: `$1.00` — about ⅓ of a burn fire, leaving at least half the user's weekly Max plan quota free for their own work.

Other scheduling facts:
- **Driver:** macOS `launchd`. Two plists per repo, one per intensity:
  `~/Library/LaunchAgents/com.google-reviews-download.routine.burn.plist`,
  `~/Library/LaunchAgents/com.google-reviews-download.routine.weeknight.plist`.
  Both call `~/bin/run-claude-routine.sh google-reviews-download <intensity>` headlessly with `claude -p --max-budget-usd <cap> --dangerously-skip-permissions`.
- **Working tree:** `~/PROJ/google-reviews-download` (resolves to `/Users/andrei/PROJ/google-reviews-download` on one laptop, `/Users/andriy/PROJ/google-reviews-download` on the other).
- **Remote:** `https://github.com/internetyev/google-reviews-download`.
- **Mirror:** `~/Library/CloudStorage/Dropbox/DropsyncFiles/Obsidian Vault/GOOGLE-REVIEWS-DOWNLOAD/` (if the directory exists on this laptop; otherwise skip the mirror step and note it in the commit body).

> **Spend model — read this before changing budgets.** Claude prompt token use is paid by the user's Claude.ai Max subscription; it is *not* real cash and does *not* count toward the `$1/week` LEDGER cap. The `$3.00` (burn) and `$1.00` (weeknight) numbers are Max-quota proxies — `--max-budget-usd` is the only knob the CLI exposes for capping per-run agent work, so we use its dollar value as a token-use limiter. Real cash spend in this routine comes only from `corgi` CLI calls (DataForSEO API), which the LEDGER tracks against a $1/week cap.

> **Note:** This routine used to run as a cloud agent on a daily 04:00 schedule. The cloud agent stopped landing commits, so the routine moved to local execution. Any reference below to "the wrapper" or "the cloud platform" is historical — it is the local launchd job and the local `git push` that publishes work now.

## Hard constraints

1. **Per-run token-use cap (Max-quota proxy, not real cash):** `$3.00` for burn fires, `$1.00` for weeknight fires (passed to `claude -p` as `--max-budget-usd`). Pace yourself within the cap; on weeknights especially, prefer one small leaf or a leaf-split over heroics.
2. **Real-cash cap: ≤ $1 USD/week total `corgi` CLI spend** (DataForSEO calls). Cumulative tracked in `LEDGER.md`. If the running 7-day total would exceed $1, defer the corgi step and pick a different leaf. **This is the only spend that costs the human real money.**
3. **No production deploys, no domain purchases, no API-key commits, no destructive git operations** (no force-push, no `reset --hard` against a remote, no remote-branch deletion).
4. **No `npm install` / `pnpm install` / `pip install`** — installs are human steps. Commit manifests and config; do not run package managers.
5. **No interactive commands.** Every command must run non-interactively to completion.
6. **Push to a `claude/<timestamp>-<leaf-id>` branch only — never directly to `main`.** The `.github/workflows/auto-merge-claude.yml` workflow squash-merges any PR opened from a `claude/*` branch. If `gh` is not authenticated on this laptop, push the branch and stop — leave PR creation for the human.

## The run, step by step

### 1. Orient

- `cd ~/PROJ/google-reviews-download`
- `git status && git fetch origin && git log --oneline -10` — confirm clean state.
- If the working tree is dirty with someone else's changes, **abort** — write a one-line note to `BLOCKED.md` and stop.
- **Re-baseline to the remote.** A previous run may have left HEAD on a stale `claude/*` branch whose PR never merged (conflict). Before doing anything else: `git checkout main && git merge --ff-only origin/main`. If the ff-only merge fails, local `main` has diverged — **abort** and write `BLOCKED.md`; do not branch off a diverged base. (This is the guard against the cascading-conflict failure mode where every new branch is cut from an ever-diverging tree and no PR can ever auto-merge.)
- **Check the open-PR queue.** `gh pr list --state open --json number,mergeable` (if `gh` is authed). If there are ≥3 open `claude/*` PRs or any is `CONFLICTING`, the pipeline is stuck — do **not** add more leaf PRs. Instead, this run's job is to rebuild the stuck work cleanly off `origin/main` (cherry-pick the net-new commits onto a fresh branch from `main`, resolve `ROADMAP.md`/`DECISIONS.md` text conflicts, one consolidated PR) and stop.
- Read `ROADMAP.md` and `BLOCKED.md` (if present).

### 2. Pick a leaf

- Choose the **first unchecked `[ ]` leaf** in `ROADMAP.md` (top-down, phase-by-phase).
- If the leaf is marked `(deferred: needs local corgi pass)` or otherwise human-gated, **skip it** and pick the next.
- If the leaf would clearly exceed this run's token-use cap (`$3.00` burn / `$1.00` weeknight), **split it** by writing sub-leaves into `ROADMAP.md` (L1.4 → L1.4a, L1.4b). Splitting itself is a valid productive run.

### 3. Work in place

- Create a fresh working branch **explicitly off the fetched remote tip**: `git checkout -b claude/$(date -u +%Y%m%dT%H%M%SZ)-<leaf-id> origin/main` (e.g. `claude/20260509T140000Z-L1.3`). Always pass `origin/main` as the base — never let the branch inherit a previous run's `claude/*` HEAD, which is what caused the cascading-conflict pile-up of PRs #23/#27/#29/#30/#31.
- Do the smallest amount of work that completes the leaf.
- Update `ROADMAP.md`: mark the leaf `[~]` (draft, wants review) or `[x]` (ready to merge).
- Append a one-line entry to `DECISIONS.md` if a non-obvious choice was made.
- Append the corgi spend (if any) to `LEDGER.md` — date, USD, reason.

### 4. Mirror (if available)

- If `~/Library/CloudStorage/Dropbox/DropsyncFiles/Obsidian Vault/GOOGLE-REVIEWS-DOWNLOAD/` exists, copy any new/changed `*.md` and `*.csv` files under `docs/`, `mocks/`, plus the top-level planning docs (`PLAN.md`, `ROADMAP.md`, `ROUTINE.md`, `DECISIONS.md`, `BLOCKED.md`, `LEDGER.md`) into it. Preserve relative paths under that root.
- If the directory does not exist on this laptop, skip and note `mirror: skipped (vault not on this laptop)` in the commit body.

### 5. Commit + push to a `claude/*` branch — workflow auto-merges

- Commit message format: `<phase-id>: <leaf-id> <imperative summary>` (e.g., `phase-1: L1.3 add fixture data for mid-size business`).
- **Your PRs auto-merge.** A `.github/workflows/auto-merge-claude.yml` workflow squash-merges any PR opened from a `claude/*` branch as soon as it is created. There is no human review gate. **That means your commit body becomes the merged PR description and lives in the repo's history forever — write it as if a future maintainer (possibly you, in a different session) is the only person who will ever read it.**
- Commit body must include these structured fields, in this order:
  - **Leaf:** the line copied verbatim from `ROADMAP.md` (id + description).
  - **Why:** one sentence on why this leaf, now. Skip if the answer is "it was the next unchecked leaf" — only write Why when there's context worth preserving.
  - **What changed:** 2–4 bullets that name files and concepts, not just verbs. "Adds `lib/semanticforce/types.ts` with the `Review` and `PlaceMeta` types matching `docs/semanticforce-api.md`" beats "Adds types".
  - **Design notes:** any non-obvious choice — a tradeoff, a deferred concern, a thing the next run should know. Skip if there are none.
  - **Cost:** corgi USD spent in this run + Claude prompt cost estimate (e.g. `$0.00 corgi, ~$0.05 prompt`).
  - **Mirror:** list of new/changed `*.md` and `*.csv` paths under `docs/`, `mocks/`, plus the top-level planning docs. (Or `mirror: skipped (vault not on this laptop)`.)
  - **Next:** the leaf id and short description of what the next run will likely pick.
- Push the branch: `git push -u origin HEAD`.
- If `gh` is authenticated on this laptop, open the PR: `gh pr create --fill --base main --head <branch>`. The auto-merge workflow handles the rest.
- If `gh` is **not** authenticated, stop after the push and leave a note in the run log — the human will open the PR. Do not attempt `gh auth login` from the routine.

### 6. If blocked

If the leaf cannot be completed without human input (need a credential, need a decision, hit an unexpected error twice), stop and write `BLOCKED.md`:

```
# BLOCKED — <date>

**Leaf:** <leaf-id>
**What I tried:**
**What I need from you:**
**Suggested next action:**
```

Commit on a `claude/blocked-<leaf-id>` branch and push. Subject: `BLOCKED: <leaf-id> needs human input`.

Do **not** write `BLOCKED.md` for run-budget exhaustion or for corgi-deferred leaves — those are normal stops.

## Cost discipline

- Prefer free tools (Read, grep, file edits) over web/API calls.
- Before any `corgi-cli` call, estimate spend; if a single call > $0.20, write the rationale in the commit body.
- Mock-first: do not call any real third-party API from the routine. SemanticForce is mocked via fixtures committed in `mocks/semanticforce/`. Real-creds work happens in a human-gated Phase 4 leaf.

## Stop conditions (any one fires → end run gracefully)

- This run's token-use cap is exhausted (`$3.00` burn / `$1.00` weeknight).
- A test or `git push` fails twice.
- Working tree has unrelated changes from another session — abort, do not touch them, write a one-line note in `BLOCKED.md`.
- A leaf would require buying a domain, deploying, sending an email, or posting publicly.

## Per-run output expectation

A normal run produces exactly one of:
- ✅ Merged PR (one leaf done)
- 🟡 Pushed branch awaiting human PR creation (`gh` not authed) or human review
- 🔴 `BLOCKED.md` PR with a clear ask
- 🛠️ A roadmap-split PR (the leaf was too big; sub-leaves added)

Empty runs are a smell. If no actionable leaf is available, the routine opens a roadmap-adjustment PR — that's still a productive run.
