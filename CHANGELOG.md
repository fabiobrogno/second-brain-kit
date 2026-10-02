# Changelog

All notable changes to this project are documented here.

## [0.2.0] - 2026-10-02
### Added
- **3D brain view.** Say "show me my brain" (or run `node .tools/brain.mjs zeig`) and your brain opens in the
  browser: an anatomically shaped brain with every page as a point of light, grouped by the areas
  (`clusters`) in `brain.config.json`. Live search that flies to the best match, page panel with Markdown,
  sources and links, conflicts and pages that need review highlighted, a timeline from your git history.
  View only and fully local — three.js, fonts and the brain model ship with the kit (`.tools/ansicht/`,
  licenses in `.tools/ansicht/DRITTANBIETER.md`). The view's data is written to `.logs/ansicht/data.js`,
  which is never committed or backed up.
- `brain zeig --nur-daten` (only build the data) and `--nicht-oeffnen` (print the path instead of opening a browser).
- The search in the view ranks like `brain search` (same tokenizer, BM25, description weighted higher) and
  tolerates small typos.
- `brain zeig` prints warnings (broken `brain.config.json`, duplicate or reserved area IDs) instead of silently
  falling back to default areas.

### Changed
- Updating now regenerates `AGENTS.md` (and, with Codex, `.agents/skills/`) every time — before, only the
  installer and the Claude Code session start did, so Codex, Gemini or Cursor kept the old instructions. With
  Claude Code, the update also renews the commands in `~/.claude/commands/` (copies of the skills), so
  Claude Code no longer keeps running an old update skill. The 0.2.0 migration does both once for
  installations coming from 0.1.0. `brain doctor` now points to "update my
  brain" for an outdated `AGENTS.md` instead of promising an automatic refresh.

### Fixed
- The plain-text search (`brain search` without qmd, profile `minimal`) and the 3D view tolerate a UTF-8 byte
  order mark (BOM) at the start of a file, as written by Windows PowerShell 5.1 — the frontmatter of such
  pages is no longer read as text.
- Tests no longer inherit `GIT_*` environment variables (e.g. when started from a git hook), so they can
  never touch the repository they were started from.
- The default version in `bootstrap.sh` / `bootstrap.ps1` now follows the release (checked by a test).
- Migration check commands take the vault and kit paths as arguments instead of inside JavaScript strings, so
  Windows paths (`C:\Users\…\v0.2.0`) and paths with an apostrophe no longer make the update stop.
- Windows: the brain view opens in the default browser even if the vault path contains a comma.

## [0.1.0] - 2026-10-02
- Initial public kit export: vault skeleton, agent-neutral CLI and skills, publish-check safety net.
