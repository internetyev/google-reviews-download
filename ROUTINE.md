# Autonomous Routine — google-reviews-download

_How each scheduled 04:00 Madrid run is expected to behave._

## Schedule

- **Cadence:** daily
- **Time:** 04:00 Europe/Madrid (Andrei's local CET/CEST)
- **Cron:** `0 2 * * *` UTC during CEST. Switch to `0 3 * * *` when DST ends in late October.
- **Working tree:** `/Users/andrei/PROJ/google-reviews-download` (Andrei's local mirror; the cloud agent gets a fresh clone)
- **Remote:** `https://github.com/internetyev/google-reviews-download`
- **Mirror:** `/Users/andrei/Library/CloudStorage/Dropbox/DropsyncFiles/Obsidian Vault/GOOGLE-REVIEWS-DOWNLOAD/` (local-only; the cloud agent skips this step)

## Hard constraints

1. **Daily budget depends on day of week.** Check `date -u +%u` (Mon=1..Sun=7) and the Madrid local hour (`TZ='Europe/Madrid' date +%H`) before doing anything else.
   - **Sunday (any hour) and Monday before 09:00 Madrid: UNCAPPED — deplete.** This is the "use it or lose it" window; Andrei's weekly Claude cap resets at Monday 09:00 CET, and Sunday-plus-early-Monday is the last stretch where remaining quota can still be spent on this project. Burn through as many leaves as the session can handle. Stop only when the session limit kicks in or there are no actionable leaves left. Make multiple commits in one session — one per leaf — each in the commit-only-no-push pattern; the wrapper opens a PR per commit and the auto-merge workflow squash-merges them.
   - **Saturday: ≤ 10 tool/command calls per run.** Saturday is the warm-up: take down a chunky leaf or two, but leave headroom for Sunday's depletion sweep.
   - **Tue–Fri (any hour) and Mon at 09:00 or later: ≤ 2 tool/command calls per run.** Tight — usually only enough for a tiny edit or a `ROADMAP.md` split. That is fine. (The 04:00 cron always fires before 09:00 on Monday, so in practice the Monday cron run uses the UNCAPPED rule above; this 2-command rule covers manual / off-schedule fires.)
   Plan the run before starting. A short, clean PR beats a long broken one.
2. **≤ $1 USD/week total `corgi` skill spend.** Cumulative tracked in `LEDGER.md`. If the running 7-day total would exceed $1, defer the corgi step and pick a different leaf. **Note:** the cloud agent has no corgi access — corgi-required leaves are deferred for Andrei's local pass.
3. **No production deploys, no domain purchases, no API-key commits, no destructive git operations** (no force-push, no `reset --hard` against a remote, no remote-branch deletion).
4. **No `npm install` / `pnpm install` / `pip install`** — installs are human steps. Commit manifests and config; do not run package managers.
5. **No interactive commands.** Every command must run non-interactively to completion.
6. **Do not run `git push` or `gh pr create`.** The cloud platform's wrapper publishes the commit to a `claude/...` branch and opens the PR for you. Direct push and direct PR creation are 403'd by the proxy. (Lesson learned from `halflife` — see `halflife/DECISIONS.md` D-006-equivalent.)

## The run, step by step

### 1. Orient (≤ 1 command)

- `git status && git log --oneline -10` — confirm clean state and confirm what branch the platform put you on.
- Read `ROADMAP.md` and `BLOCKED.md` (if present).

### 2. Pick a leaf

- Choose the **first unchecked `[ ]` leaf** in `ROADMAP.md` (top-down, phase-by-phase).
- If the leaf is marked `(deferred: needs local corgi pass)` or otherwise human-gated, **skip it** and pick the next.
- If the chosen leaf would clearly exceed today's budget (2 on Tue–Fri, 10 on Sat, uncapped on Sun + Mon-pre-09:00), **split it** by writing sub-leaves into `ROADMAP.md` (L1.4 → L1.4a, L1.4b). Splitting itself is a valid productive run. On weekdays splitting will be the norm; that is fine. On uncapped days, prefer to do the work rather than split.

### 3. Work in place

- Stay on the workspace branch the platform handed you — do not run `git checkout` to switch branches.
- Do the smallest amount of work that completes the leaf.
- Update `ROADMAP.md`: mark the leaf `[~]` (draft, wants review) or `[x]` (ready to merge).
- Append a one-line entry to `DECISIONS.md` if a non-obvious choice was made.
- Append the corgi spend (if any) to `LEDGER.md` — date, USD, reason.

### 4. Mirror (skipped in cloud)

The cloud agent has no access to Andrei's Obsidian Dropbox folder. The agent must instead include a `Mirror:` section in the commit body listing all new/changed `*.md` and `*.csv` paths so Andrei can `cp` them locally during PR review.

### 5. Commit only — the platform publishes, the workflow auto-merges

- Commit message format: `<phase-id>: <leaf-id> <imperative summary>` (e.g., `phase-1: L1.3 add fixture data for mid-size business`).
- **Your PRs auto-merge.** A `.github/workflows/auto-merge-claude.yml` workflow squash-merges any PR opened from a `claude/*` branch as soon as it is created. There is no human review gate. **That means your commit body becomes the merged PR description and lives in the repo's history forever — write it as if a future maintainer (possibly you, in a different session) is the only person who will ever read it.**
- Commit body must include these structured fields, in this order:
  - **Leaf:** the line copied verbatim from `ROADMAP.md` (id + description).
  - **Why:** one sentence on why this leaf, now. Skip if the answer is "it was the next unchecked leaf" — only write Why when there's context worth preserving.
  - **What changed:** 2–4 bullets that name files and concepts, not just verbs. "Adds `lib/semanticforce/types.ts` with the `Review` and `PlaceMeta` types matching `docs/semanticforce-api.md`" beats "Adds types".
  - **Design notes:** any non-obvious choice — a tradeoff, a deferred concern, a thing the next run should know. Skip if there are none.
  - **Cost:** corgi USD spent in this run + Claude prompt cost estimate (e.g. `$0.00 corgi, ~$0.02 prompt`).
  - **Mirror:** list of new/changed `*.md` and `*.csv` paths under `docs/`, `mocks/`, plus the top-level planning docs. Andrei syncs these to `Obsidian Vault/GOOGLE-REVIEWS-DOWNLOAD/` separately on his Mac — this list is a courtesy index, not a trigger.
  - **Next:** the leaf id and short description of what the next run will likely pick.
- **Do NOT run `git push` or `gh pr create`.** The wrapper publishes the commit to a `claude/...` branch and opens the PR for you.

### 6. If blocked

If the leaf cannot be completed without human input (need a credential, need a decision, hit an unexpected error twice), stop and write `BLOCKED.md`:

```
# BLOCKED — <date>

**Leaf:** <leaf-id>
**What I tried:**
**What I need from you:**
**Suggested next action:**
```

Commit it. The wrapper will publish — make the commit subject `BLOCKED: <leaf-id> needs human input`.

Do **not** write `BLOCKED.md` for run-budget exhaustion or for corgi-deferred leaves — those are normal stops.

## Cost discipline

- Prefer free tools (Read, grep, file edits) over web/API calls.
- Before any `corgi-cli` call, estimate spend; if a single call > $0.20, write the rationale in the commit body.
- Mock-first: do not call any real third-party API from the routine. SemanticForce is mocked via fixtures committed in `mocks/semanticforce/`. Real-creds work happens in a human-gated Phase 4 leaf.

## Stop conditions (any one fires → end run gracefully)

- Today's command budget used (2 on weekdays, 10 on weekend).
- A test or commit fails twice.
- Working tree has unrelated changes from another session — abort, do not touch them, write a one-line note in `BLOCKED.md`.
- A leaf would require buying a domain, deploying, sending an email, or posting publicly.

## Per-run output expectation

A normal day produces exactly one of:
- ✅ Merged PR (one leaf done)
- 🟡 Draft PR awaiting human review
- 🔴 `BLOCKED.md` PR with a clear ask
- 🛠️ A roadmap-split PR (the leaf was too big; sub-leaves added)

Empty days are a smell. If no actionable leaf is available, the routine opens a roadmap-adjustment PR — that's still a productive day.
