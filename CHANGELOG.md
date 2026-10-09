# Changelog

All notable changes to this project are documented here.

## [0.5.0] - 2026-10-09
"Learning loop" — the brain now learns which page answers which of your questions, and tells you how well its
hints fit. As before, everything new that calls an AI is off by default; with every new switch at its default,
the brain behaves like 0.4.

### Added
- **Pages know their questions.** A wiki page can carry `fragen: ["…", "…"]` — 2–6 typical questions in your
  own words (at most 6, each up to 160 characters). They go into the page's search card, so the brain hint
  fires exactly on those questions; pages without the field keep a byte-identical card. `brain-lint` reports a
  malformed list as `FRAGEN` (blocking in the pre-commit check, like `AUCH`). The **ingest** skill adds 2–4
  questions when it creates or reworks a page.
- **Learning loop** (0 tokens, only while `luecken` is on). If your AI reads a wiki page the hint did not name
  within 10 minutes of a knowledge question (and before the next prompt), that "question → page" pair becomes
  a candidate. Once a week, at most five of them arrive as maintenance suggestions (`befund: frage`) to add to
  the page's `fragen`. Each pair is suggested only once; questions already listed are skipped. Same privacy as
  the gap log: keywords only, secret filter, no prompt text in `hint.log`. `brain lernschleife` lists the
  candidates.
- **Threshold check.** `brain analyse` and the Analysis tab compare "hint stayed silent, but a page was read
  right after" (too strict) with "hint named pages nobody read" (too loose) and, from 20 cases each, recommend
  a looser or stricter hint level, sharper cards (`fragen`), or "fits". Never applied automatically.
- **Answer benchmark** (opt-in, `antwortMesslatte: aus | monatlich`, off by default, cost label in the
  settings). Test questions in `<wiki>/_antworten.json` (`[{ frage, seite, kernfakten }]`) are answered by a
  lean Haiku call from the named page only (frontmatter and secrets stripped); the key facts are checked
  locally. Results go to `.logs/antwort-messlatte.log` and show up in the analysis. By hand: `brain antworten`.

### Changed
- The Claude Code status line refreshes every 10 seconds, so idle terminals also show changes made by other
  sessions (a refresh interval you set yourself is kept).
- Brain status (waiting sources, conflicts, open suggestions, last ingest) is counted in one place
  (`brain-stand.mjs`) for the status line.

## [0.4.0] - 2026-10-03
"Self-maintenance and looks" — the brain now tells you what in it needs attention, lets you resolve
contradictions with one click, and is easier to read at a glance. As before, everything new that calls an
AI is off (or local-only) by default; with every new switch at its default, the brain behaves like 0.3.

### Added
- **Knowledge gets an expiry date.** A page can carry `stand: YYYY-MM-DD` (as of when) and
  `pruefen_bis: YYYY-MM-DD` (a hard deadline) in its frontmatter, in addition to the existing `verfall:
  <days>`. Once the stricter of the two is passed, `brain-lint` reports it as `ABGELAUFEN` (replacing the
  old `VERFALL` wording) and the 3D brain marks the page with an amber ring; an "Expired" filter and the
  page panel show "as of …, check by …". Pages without these fields behave exactly as before. The **ingest**
  skill sets `pruefen_bis` for fast-changing facts (90 days by default, 30 for prices).
- **Resolve contradictions in one click.** The brain reads every `[!KONFLIKT]` box on a page and, in its new
  **Maintenance** tab, shows A and B side by side with their sources. "A is right" / "B is right" / "both
  apply (different cases)" / "later", plus an optional note, write a decision order into
  `inbox/_entscheidungen/` — the wiki itself is never touched from the click, only your AI resolves it on
  the next ingest, which now works through any open decisions first. Changing your mind before that ingest
  simply replaces the earlier order; neither counts as an unprocessed inbox note.
- **Maintenance report.** `brain pflege` (also the **Maintenance** tab) lists, each with a count, a short
  list and a next step in plain language: expired/soon-expiring pages, open conflicts (and incomplete
  conflict boxes) and decisions, open suggestions, lessons and upkeep tasks, orphaned pages, pages nobody has read in 30 days, likely duplicates, pages over
  150 lines, unworked imports, and the benchmark trend. Once a week, the session start names what's open in
  one line ("Brain week: 3 expired · 1 conflict · 2 duplicates — see Maintenance in the brain"); the line
  can be turned off (`wochenbericht`).
- **Opt-in AI maintenance run** (`pflegeLauf`, off by default; weekly or on demand via a button). Feeds the
  maintenance report plus the usual review candidates to a lean, headless Haiku run (same sandboxing as the
  background harvest) and writes up to 8 suggestions (merge, split, outdated, contradiction, gap) — it never
  edits the wiki itself. Cost shown measured, like the harvest. An accepted suggestion becomes an upkeep
  task in `inbox/_pflege/` — a task to check, never a source: the **review**/**ingest** skills verify it
  against the page's real raw sources, and it is never cited in `quellen:`.
- **Local benchmark.** `brain messlatte` runs the existing search evaluation (kit questions plus your own
  `_messlatte.json`) through the real hint hook and logs a run; the analysis tab shows the trend.
- **Lesson suggestions from Claude Code sessions** (`lektionen`, default `lokal`, no AI call). Spots a
  correction repeated about the same thing, or the same tool failing the same way twice, in your session
  transcripts, and turns each into a suggestion to save as a lesson — in **Memory** (Claude Code, feedback
  format) or `wiki/_lektionen.md` (other agents, short list, read by `AGENTS.md`), or a skill draft under
  review. With `mit-ki`, Haiku words the rule/why/how; with the switch `aus`, nothing is collected. The new
  **lektion** skill (`brain-lektion`) files an accepted suggestion at the right place and archives it.
  Session start names how many lessons are waiting.
- **MCP servers get their real logo.** ~46 Simple Icons (CC0), matched to a server by its normalized name,
  with a monogram fallback for anything unmatched; drawn locally into a texture atlas, no network access.
  Servers in the brain stem are grouped by where they're configured (Claude.ai, Claude Code, Desktop,
  Cursor, Codex, Gemini).
- **A more readable brain.** Each area gets a soft color glow on its own pages (stronger on hover/selection,
  others dimmed); point size now reflects a page's importance (links plus how often it's read) and shape
  reflects its type; connections between two areas bundle into a single weighted arc instead of a tangle,
  while connections inside the selection stay fully drawn; what's labeled changes smoothly with zoom (areas
  far out, titles at medium range, everything up close).

### Changed
- `brain-lint`'s `VERFALL` finding is now `ABGELAUFEN` (covers both `pruefen_bis` and `verfall`, same
  not-blocking behaviour). Decision, lesson and upkeep orders in `inbox/_entscheidungen/`,
  `inbox/_lektionen/` and `inbox/_pflege/` no longer count as unprocessed inbox notes — they're tasks for the
  **ingest**/**lektion**/**review** skills, not raw material to work in.
- The **ingest** skill works through any open decision orders before the actual source, and sets
  `pruefen_bis` for fast-changing facts as it writes a page.

### Security
- Decisions and the maintenance run reuse the existing secrets filter and path/id checks (fail closed, same
  rules as suggestions); a decision note over 300 characters or containing something that looks like a
  credential is rejected before it's written.

### Breaking changes
- None expected. Existing pages, settings and suggestions keep working unchanged; the new `automatik` keys
  (`wochenbericht` on, `pflegeLauf` and `lektionen`'s AI step off) are added the first time any setting is
  saved. `migrations/0.4.0.md` re-renders `AGENTS.md` and re-runs the Claude Code adapter if it is installed
  — no data migration.

## [0.3.0] - 2026-10-02
"Control center" — the 3D brain becomes the place where you steer it. Everything new that uses AI is off by
default; with all switches off, the brain behaves like 0.2.

### Added
- **Local view service.** `brain zeig` now starts a small service for the 3D brain (Node's `http` only, no
  new dependency) instead of opening a file, reuses it while it runs, stops it after 30 minutes without use
  and with `brain zeig --stopp`. If it can't start, the view opens read-only from `file://` as before.
- **Control center** inside the view, in English and German:
  - **Settings** (gear): every automation as a switch with one sentence, a cost label and a "Claude Code
    only" badge where it applies; "all off" restores the 0.2 behaviour. Stored only in the new section
    `automatik` of `brain.config.json` (atomic write, copy of the previous file in `.logs/`). Also from the
    terminal: `brain einstellungen [key=value …]`.
  - **Suggestions:** accept (→ inbox) or discard (→ `archiv/vorschlaege-verworfen/`) with one click; nothing
    is deleted.
  - **Analysis tab** and `brain analyse [--json]`: hint hit rate per day, whether the AI read the suggested
    page, latest benchmark run, never-read / most-read / unlinked pages, open conflicts, pages that need
    review, import status and a token estimate for today and 7 days. Optional gaps log (`luecken`):
    searches without a result, at most 120 characters, secrets dropped, kept 30 days.
  - **MCP area:** the MCP servers known to Claude Code, Claude Desktop, Cursor, Codex and Gemini CLI plus
    the connectors actually used, as a region of the brain ("brain stem"), linked to pages via the new
    optional frontmatter `mcp: [...]` or a matching name. Only names are read. Turn off with
    `"ansicht": { "mcp": false }`.
  - **Live glow:** pages and MCP tools the AI reads light up for 8 seconds.
- **Import of old brains:** `brain import <folder|zip> [--name x]` and the new skill **import** ("import my old
  brain from <folder>"). Detects Obsidian, Notion exports (zip), Logseq and plain folders (`.md`, `.txt`,
  `.pdf`). The source is only read; notes are copied to `<inbox>/_import/<name>/`. A local check (0 tokens)
  writes `_bericht.md`: exact duplicates (skipped, also against the existing brain), near duplicates
  (≥ 80 % alike), contradiction candidates (numbers, dates, amounts, versions, yes/no — also against the
  existing wiki, newer one marked), overlaps with existing pages, and a plan in packages with a token
  estimate. Asks first above 2,000 notes or 50 MB. The **ingest** skill works imports in one page per
  near-duplicate group and never decides a contradiction silently.
- **Background harvest (opt-in, Claude Code):** "save the state every 1/2/4 hours" and "collect facts at
  session end" (`SessionEnd`/`PreCompact`). Runs Claude Haiku headless in an empty temp folder, outside the
  session, on at most 24,000 characters of the transcript; results arrive as suggestions in
  `<inbox>/_vorschlaege/`. Skips sessions under 5 prompts, one run at a time, 120 s limit, never in folders
  listed in `automatik.ernteNichtIn`.
- **"Me" card:** optional `wiki/ich.md` (template included, at most 1,500 characters — `lint` warns above).
  With `ichKarte` on, the Claude Code session start adds it, and `AGENTS.md` tells other agents to read it
  first.
- **Project page:** at session start, Claude Code gets one line "Projektseite: <path>" when a wiki page
  matches the current folder or git repo (new optional frontmatter `repo:` / `pfade:`).
- Session start shows "N new suggestions" when there are some.
- Tool log for the live glow: a Claude Code `PreToolUse` hook writes which vault page or MCP tool was used to
  `.logs/werkzeug.log`. It never writes anything into the conversation (0 tokens) and never logs paths
  outside the vault.
- Hint level `hinweise` (`aus`, `niedrig`, `mittel`, `hoch`); `hint.log` records the injected characters for
  the token estimate.
- `brain doctor` reports the view service, the 0.3 hooks, whether `claude` was found for the harvest, and
  the number of open suggestions.

### Security
- The view service listens only on `127.0.0.1` on a random port. Every API request needs a random 32-byte
  key that is passed in the URL fragment and changes on every start; the `Host` header must match (against
  DNS rebinding), writes also need the page's own `Origin`, requests from other sites (`Sec-Fetch-Site`) are
  refused, there is no CORS, bodies are limited to 64 KB, and a strict Content-Security-Policy applies.
  Brain data is only served as JSON to that key, never as a script file — another website in the same
  browser cannot read it.
- Extended secret detection, used everywhere from one place (`secrets-muster.mjs`): Anthropic and OpenAI
  style keys, GitHub, AWS and Slack tokens, JWTs, private key blocks, password/Kennwort assignments and
  connection URLs with credentials. The harvest, suggestions, gaps log and import report filter with it and
  fail closed.
- The MCP area never reads `command`, `args`, `env`, `url` or `headers` from any config — names only; broken
  or huge config files are skipped.
- All hooks do nothing while the harvest itself runs (`BRAIN_ERNTE=1`), so the harvest can't trigger itself.

### Changed
- `brain zeig` opens `http://127.0.0.1:<port>/` instead of the file; `--nur-daten` and `--nicht-oeffnen` still
  work without the service. The view loads large brains much faster (5,000 pages in under half a second on
  the reference machine); above 1,500 pages the overview only draws the links of the selection or search.
- Emphasis in the page panel nests correctly (`**a *b** c*`), and `a*b*c` is now italic as in CommonMark.
- A UTF-8 byte order mark (BOM) is tolerated everywhere — indexer, lint, commit check, search.
- The Claude Code adapter registers the new hooks by merging, without duplicates; other hooks stay untouched.

### Breaking changes
- None expected. Notes, wiki pages and existing settings stay as they are; the `automatik` section is
  optional and only created when a setting is saved. `migrations/0.3.0.md` re-renders `AGENTS.md`, adds
  `ich.md` if it is missing (never overwrites) and re-runs the Claude Code adapter if it is installed.

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
