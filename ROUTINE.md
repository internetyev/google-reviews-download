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
   - **Monday before 09:00 Madrid local: UNCAPPED — deplete.** This is the "use it or lose it" run; the weekly Claude cap resets at Monday 09:00 CET, so any quota still on the meter is about to vanish. Burn through as many leaves as the session can handle. Stop only when the session limit kicks in or the work runs out.
   - Days 1–5 (Mon–Fri) at all other times: **≤ 2 tool/command calls per run.** Tight — usually only enough for a tiny edit or a `ROADMAP.md` split. That is fine. (The 04:00 cron always fires before 09:00, so in practice the Monday cron run uses the UNCAPPED rule above; this 2-command rule covers manual / off-schedule fires.)
   - Days 6–7 (Sat–Sun): **≤ 10 tool/command calls per run.** Bigger leaves are possible. Andrei targets ~20 commands across the whole weekend (i.e. ~10/day) — burning what's left of his weekly Claude cap.
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
- If the chosen leaf would clearly exceed today's budget (2 on weekdays, 10 on weekend, uncapped on Monday-pre-reset), **split it** by writing sub-leaves into `ROADMAP.md` (L1.4 → L1.4a, L1.4b). Splitting itself is a valid productive run. On weekdays splitting will be the norm; that is fine.

### 3. Work in place

- Stay on the workspace branch the platform handed you — do not run `git checkout` to switch branches.
- Do the smallest amount of work that completes the leaf.
- Update `ROADMAP.md`: mark the leaf `[~]` (draft, wants review) or `[x]` (ready to merge).
- Append a one-line entry to `DECISIONS.md` if a non-obvious choice was made.
- Append the corgi spend (if any) to `LEDGER.md` — date, USD, reason.

### 4. Mirror (skipped in cloud)

The cloud agent has no access to Andrei's Obsidian Dropbox folder. The agent must instead include a `Mirror:` section in the commit body listing all new/changed `*.md` and `*.csv` paths so Andrei can `cp` them locally during PR review.

### 5. Commit only — the platform publishes

- Commit message format: `<phase-id>: <leaf-id> <imperative summary>` (e.g., `phase-1: L1.3 add fixture data for mid-size business`).
- Commit body must include the structured PR-ready fields the wrapper will lift into the PR description:
  - **Leaf:** the line copied verbatim from `ROADMAP.md`
  - **What changed:** 1–3 bullets
  - **Cost:** corgi USD spent in this run + Claude prompt cost estimate
  - **Mirror:** list of new/changed paths to copy to `Obsidian Vault/GOOGLE-REVIEWS-DOWNLOAD/`
  - **Next:** the leaf id the next run will likely pick
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
