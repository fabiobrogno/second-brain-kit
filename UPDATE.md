# UPDATE.md

How a vault built from this kit moves to a newer kit version. This is addressed to the AI agent carrying
it out (via the **update** skill, `.tools/skills/update/SKILL.md`), not to the person directly.

## When this runs

- On request: the person says "update my brain" (or the German equivalent, "update mein Brain").
- Automatically, if `brain.config.json` has `update.auto: true`: once a day, at session start, the Brain
  checks for a newer release (`brain doctor` and the session-start status line both show this — see
  §3.9 of the design spec). If a newer version was found and `update.auto` is on, a marker file
  (`.logs/update-bereit`) is written and the status line says "Update vX wird beim nächsten Start
  eingespielt" ("v... will be installed at the next start"). **No code executes the update itself** —
  seeing that line is the agent's cue to run the `update` skill right away, in that same session, before
  doing anything else the person asked for.
- Manually, any time: `node .tools/brain.mjs update-check` prints whether a newer version exists, without
  installing anything.
- Never, if `brain.config.json` has `"update": { "pruefen": false }` — then no version check goes out at all
  (neither at session start nor in `brain doctor`); `update-check` just says the check is switched off.
- Never in the kit's development vault (the one containing `.tools/kit/export.mjs`): the update skill and
  `install.mjs` both refuse it.

## What an update touches

**Only system files** — `.tools/`, and the system-managed fields of `brain.config.json` (`systemVersion`,
and whatever a specific migration explicitly says to change). **Never** your notes, wiki pages, or
`_log.md` history. If a release changes the wiki's own file format, the migration for that version does it
mechanically, with a git commit immediately before, so nothing is ever unrecoverable.

## What it does NOT do

- It never auto-runs without a person (or the `update.auto` opt-in) asking for it.
- It never requires a GitHub account — the release archive is public.
- It never skips a version's migration, even if you're several releases behind: every intermediate
  `migrations/<version>.md` runs in order.

## Troubleshooting

- "Du hast schon die neueste Version." ("You already have the latest version.") — nothing to do.
- Offline, or GitHub unreachable: `update-check` and the session-start check both fail silently (no
  internet is a completely normal, expected state — not an error). Try again later, or run `update-check`
  manually once you're back online.
- A migration's check command fails: stop there, don't continue to the next migration. The git commit from
  right before that migration is your rollback point — undo just that step's changes with
  `git -C "<vault>" checkout -- .tools brain.config.json` (scoped to system files only; never
  `reset --hard`, which would also discard any uncommitted note/wiki edits the person made since their
  last ingest — notes/wiki are never touched by an update regardless, and this keeps the rollback itself
  from being the thing that touches them).

Migrations in this release:
- `migrations/0.1.0.md` — moving a pre-kit, hand-built brain onto the kit's structure (not relevant if you
  installed fresh).
- `migrations/0.2.0.md` — notes, wiki and settings stay as they are; the 3D brain view (`brain zeig`) arrives
  with the system files, and `AGENTS.md` (plus the Codex skills, if used) is generated again so every agent
  knows "show me my brain".
- `migrations/0.3.0.md` — notes, wiki and settings stay as they are; the control center, the importer and the
  background harvest arrive with the system files (all AI-based extras off by default). `AGENTS.md` is
  generated again, the "me" card template `ich.md` is added only if it is missing, and the Claude Code
  adapter (if installed) is re-run so it registers the new hooks.

Placeholders in a migration (`<vault>`, `<kit-klon>`) are always filled in as absolute paths, without `~`.
From 0.2.0 on, the **update** skill also regenerates `AGENTS.md` (and `.agents/skills/` for Codex) every time
it replaces `.tools`, and re-runs the Claude Code adapter if it is installed, so the Claude Code commands
(copies of the skills) never stay on an old version.
