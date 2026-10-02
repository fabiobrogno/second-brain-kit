<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo.svg">
    <img alt="Second Brain Kit" src="assets/logo.svg" width="440">
  </picture>
</p>

<p align="center"><b>A local second brain that gives every AI the right knowledge — with proof.</b></p>

<p align="center">
  <a href="https://github.com/fbrogno/second-brain-kit/actions/workflows/test.yml"><img alt="Tests" src="https://github.com/fbrogno/second-brain-kit/actions/workflows/test.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-4F46E5"></a>
  <a href="CHANGELOG.md"><img alt="Version 0.2.0" src="https://img.shields.io/badge/version-0.2.0-4F46E5"></a>
  <img alt="macOS | Windows | Linux" src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-0E7490">
  <img alt="Claude · Codex · Gemini · Cursor" src="https://img.shields.io/badge/Claude%20%C2%B7%20Codex%20%C2%B7%20Gemini%20%C2%B7%20Cursor-0E7490">
</p>

Your AI apps forget everything between chats, and when they do remember, you can't tell where a fact
came from. This kit sets up a folder of plain Markdown files on your own computer that your AI reads
before it answers and writes to when you say "remember this". Every page names its sources, contradictions
stay visible instead of being quietly overwritten, and nothing leaves your machine unless you want a backup.

> **Status:** v0.2 — an early public release, now with a 3D view of your brain. It works and is tested on
> all three systems, but expect rough edges. Feedback is very welcome.

## Quick start — for everyone

Open your AI app, paste this sentence, and send it:

```text
Set up the second brain from github.com/fbrogno/second-brain-kit for me.
```

Auf Deutsch:

```text
Richte mir das Second Brain von github.com/fbrogno/second-brain-kit ein.
```

Your AI will ask you at most two things — where the brain should live (suggestion: `Documents/Brain`)
and whether you also want an online backup at GitHub (yes / no / later). Everything else it works out
by itself. You never have to open a terminal. It takes about 10–20 minutes, most of it a one-time
download for the search (~300 MB, announced before it starts).

When it's done, you only need four sentences:

- *"Remember this: …"* — saves something.
- *"What do I know about …?"* — searches your brain and answers with the source.
- *"Show me my brain."* — opens your brain in 3D.
- *"Update my brain."* — installs a new version when one is out.

**Which app?** Your AI needs to be able to run commands and read files on your computer. That means
**Claude Code** (in the terminal, or in the **Code** or **Cowork** tab of the Claude Desktop app — both
need a paid plan), the **Codex** app or CLI, **Gemini CLI**, or **Cursor**. The regular chat in Claude
Desktop or in a browser can't install anything — use the Code or Cowork tab or the Codex app instead.

## See your brain in 3D

<p align="center"><img alt="The 3D brain view: every page is a point of light, an open page shows its sources and links" src="assets/gehirn-3d.png" width="880"></p>

Say *"show me my brain"* to your AI (or run `node .tools/brain.mjs zeig` in your brain folder) and it opens in the browser:
an anatomically shaped brain with every page as a point of light, grouped by your areas and connected by
their links. Search flies to the best match, a click opens the page with its sources, conflicts and pages
that need review light up, and a timeline replays how your brain grew. It's a local file — no server, no
internet, nothing is changed. The picture above shows made-up example pages.

## Quick start — for developers

One line, no admin rights, no git needed (it fetches a private copy of Node.js into `~/.brain-kit/`):

**macOS / Linux**
```sh
curl -fsSL https://raw.githubusercontent.com/fbrogno/second-brain-kit/main/bootstrap.sh | bash
```

**Windows (PowerShell)**
```powershell
irm https://raw.githubusercontent.com/fbrogno/second-brain-kit/main/bootstrap.ps1 | iex
```

Defaults: brain in `~/Documents/Brain`, no online backup. To choose, pass `--ziel "<path>" --backup github`
(PowerShell: save the script first, then `-Ziel` / `-Backup` — see [INSTALL.md](INSTALL.md#step-2--get-the-kit-and-install)).

**From a clone** (Node.js 20 or newer):
```sh
git clone https://github.com/fbrogno/second-brain-kit.git
cd second-brain-kit
node install.mjs ~/Documents/Brain --agent claude-code --profil leicht --backup keins
node ~/Documents/Brain/.tools/brain.mjs doctor
```

[INSTALL.md](INSTALL.md) is the step-by-step script your AI follows; every step has a check command and the
expected output. Options: `--agent claude-code|codex|keiner`, `--sprache de|en`, `--profil minimal|leicht|voll`,
`--backup keins|github|ordner:<path>`.

## How it works

### One core, several ways in

The brain itself is a folder with Markdown files, a small command-line tool and a git history. Your AI
tools reach it through plain instructions (`AGENTS.md` plus skills), optional adapters for extra comfort,
and — soon — a local MCP server.

```mermaid
flowchart LR
  subgraph core["Your brain · 100 % local"]
    direction TB
    V["Markdown vault<br/>inbox · wiki · notes"]
    C["brain CLI<br/>search · lint · doctor · backup"]
    G["git + pre-commit checks<br/>secrets · revisions · log"]
  end
  A["AGENTS.md + skills<br/>ingest · lint · review · update · backup"]
  D["Adapters (optional)<br/>Claude Code: hints, status line"]
  M["brain-mcp<br/>(planned)"]
  core --> A & D & M
  A --> T1["Claude Code"] & T2["Codex"] & T3["Gemini CLI"] & T4["Cursor"]
  D --> T1
  M -.-> T5["Claude Desktop<br/>and other MCP apps"]
```

Hooks and adapters are comfort, never a requirement: every function also works through `AGENTS.md` and the
skills, and the hard safety checks run in git itself, so they apply no matter which AI is writing.

### The life of a note

```mermaid
flowchart LR
  N["You: “Remember this …”"] --> I["inbox/"]
  I --> K{"ingest"}
  K -->|"secret found"| X["Stopped<br/>nothing is written"]
  K -->|"clean"| W["wiki page<br/>sources + fingerprint<br/>[!KONFLIKT] box if it contradicts"]
  W --> S["local search index"]
  Q["You: “What do I know about …?”"] --> S
  S --> H["hint / best page"]
  H --> R["Answer with source"]
```

1. A new note lands in `inbox/`.
2. **Ingest** first runs the secrets check. If it finds anything that looks like a password or key, it stops
   and writes nothing.
3. The AI works the note into the wiki. Each page lists its sources with a fingerprint (hash) of the exact
   version it was written from. If the new note contradicts an existing page, both claims stay side by side
   in a conflict box until you decide.
4. A git commit records the change. The pre-commit hook blocks secrets (in every staged text file, whatever
   its name), page edits without a new revision number, and any rewrite of the ingest log's history. It
   finds the kit's own Node copy even when it isn't on your PATH, and if it can't run its checks at all, it
   stops the commit instead of letting it through.
5. When you ask something, the AI searches locally, reads the one best page and tells you where the answer
   came from. In Claude Code a hint with the best match appears before each prompt automatically.

### Backup — your choice

```mermaid
flowchart LR
  B["Your brain<br/>(git history, undo always possible)"] --> Q{"Backup?"}
  Q -->|"with GitHub"| GH["Private GitHub repo<br/>pushed after each ingest<br/>and on “back up my brain”"]
  Q -->|"without GitHub"| F["Backup folder<br/>USB stick · external drive · iCloud Drive<br/>one git bundle per day, last 7 kept"]
  Q -->|"none"| L["Local only<br/>git history on this computer"]
```

You can switch any time: *"Set up an online backup"* or *"Set up a backup folder"*. Restoring is one
sentence too: *"Restore my brain from the backup."* A `.git` folder is never placed inside a sync folder —
cloud sync can corrupt it, which is why the folder option uses single bundle files. The backup runs after
each ingest and whenever you say *"Back up my brain"*; with the Claude Code adapter it also runs
automatically at the start of each session (currently only there).

## Features

| | What it means for you | How the kit does it |
|---|---|---|
| **Correct** | Answers come with a source you can check. | Every wiki page lists its sources with a fingerprint; when a source changes, the page is flagged *needs review* (`PRÜFBEDÜRFTIG`). |
| | Contradictions are never silently "fixed". | A `[!KONFLIKT]` box keeps both claims and both sources until you decide. |
| | Old knowledge doesn't pass as fresh. | `lint` finds drift, decay, orphans and open conflicts; `review` (about every 30 days) re-checks only what changed. |
| | Passwords and keys stay out. | Secrets check before every ingest and again in the git pre-commit hook — for every AI, with or without hooks. |
| **Complete** | Saving is one sentence. | "Remember this …" → inbox → ingest; sources can be notes, files or text. |
| | Nothing gets lost. | Full git history, a log of every ingest (`_log.md`), backup to GitHub or a folder. |
| | Mistakes in hints get fixed. | `feedback` records a wrong or missing hint in one line, so search can be tuned. |
| **Always in context** | The AI looks in your brain first. | `AGENTS.md` tells every AI tool to search before answering and read only the best page. |
| | Fast, local search on any machine. | Three profiles: `minimal` (plain text, no download), `leicht` (local embeddings, ~300 MB), `voll` (adds a reranker, ~2 GB, opt-in). The installer picks one once, based on what your computer can run; `brain doctor` checks it later and warns if it doesn't fit. |
| | Hints without asking. | Claude Code adapter: a hint with the best page before each prompt, a status line and a short start-up summary. |
| | Pick up where you left off. | `handoff` saves the state of a piece of work for the next session. |
| | See what you know at a glance. | `brain zeig` builds a 3D view of all pages and links — search, sources, conflicts and a timeline, view only. |

## Privacy

- **Everything runs on your computer.** Notes, wiki, search index and search models stay local. There is no
  account, no server and no telemetry.
- **Your AI app is the only thing that sees your notes** — the same app you already chat with. What it sends
  to its provider depends on that app, not on this kit.
- **Network use, completely listed:**
  - **Setup** downloads what it needs once: Node.js (only if yours is missing or too old), the kit itself,
    the search engine (an npm package, ~300 MB with its parts) and, on Windows, a portable git.
  - **The better search downloads its language models from the internet on first use** (one time; after
    that it works offline). Profile `minimal` downloads nothing.
  - **The backup you chose** (your own private GitHub repo) — nothing if you picked no backup or a folder.
  - **A version check** against the public release list, at most once a day, without an account. Turn it
    off with `"update": { "pruefen": false }` in `brain.config.json`.
  Offline is fine — everything stays silent and the brain keeps working. The 3D view needs no internet at
  all: three.js, fonts and the brain model ship with the kit.
- **Secrets are blocked** before they are written, not cleaned up afterwards.

## Updates

When a new version is out, you hear about it once a day at most — in the session start-up line (Claude
Code) or whenever the AI runs `brain doctor`: *"There's a new version of your brain (vX.Y.Z)."* Say **"Update my brain"** and it installs it. Updates only touch the system files in
`.tools/` — never your notes or wiki pages. A git commit right before each step is your way back.

Prefer it automatic? Set `"update": { "auto": true }` in `brain.config.json` and the AI installs new versions
at the start of the next session and tells you afterwards (currently with the Claude Code adapter). Nothing
updates silently by default — new code never runs without you or that setting asking for it. Details: [UPDATE.md](UPDATE.md) · [CHANGELOG.md](CHANGELOG.md).

## FAQ

**Does it work on Windows?**
Yes. CI tests every change on Windows, macOS and Linux runners. Everything you run is Node.js, so it
behaves the same everywhere. Only the largest search profile (`voll`) isn't available on Windows yet.

**Do I need admin rights?**
No. The kit downloads its own copy of Node.js (and on Windows a portable git) into a folder in your home
directory. On a Mac without developer tools, Apple shows its own "Install command line tools" window once;
your AI tells you before it appears.

**Which AI apps work?**
Any app that can run commands and edit files on your computer: Claude Code (terminal, or the Code or
Cowork tab in Claude Desktop), Codex, Gemini CLI and Cursor. Claude Code gets the extra adapter (hints, status line).
Chat-only apps can't use it yet; the planned local MCP server will bring Claude Desktop and other MCP apps in.

**What does it cost?**
The kit is free and open source (MIT). You need an AI app you already use; some of them require a paid
plan (for example the Code and Cowork tabs in Claude Desktop). GitHub backup works with a free GitHub account.

**Where is my data?**
In the folder you picked during setup (suggestion: `Documents/Brain`) — plain Markdown files you can open
with any editor. Tools and the private Node.js copy live in `~/.brain-kit/`. If you chose a backup, a copy
is in your private GitHub repo or in your backup folder.

**Do I need a GitHub account?**
No. The kit is downloaded as a public release archive. GitHub is only needed if you want the online backup.

**Can I use my existing notes?**
Yes. Put them (or copies) into `inbox/` and say *"Work my inbox into the brain."* Each note goes through the
same checks as a new one.

**How do I uninstall it?**
Delete your brain folder (after a last backup, if you want to keep it) and the `~/.brain-kit/` folder. If
you used the Claude Code adapter, remove the brain entries from `~/.claude/settings.json` — the installer
saved a backup of the original file next to it (`settings.json.bak-…`) — and delete the commands it added
to `~/.claude/commands/` (`ingest.md`, `handoff.md`, `brain-lint.md`, `brain-review.md`, `brain-feedback.md`,
`brain-update.md`, `brain-backup.md`; if one of your own files had the same name, it was saved next to it as
`….bak-…`). The search keeps its index and models in `~/.cache/qmd/`; delete that folder too if no other
tool of yours uses qmd. Nothing else is installed — everything else lives in `~/.brain-kit/` (private
Node.js copy, search engine, downloaded kit versions, install log) and in your brain folder.

## Roadmap

- **v0.1 — done:** core, CLI, safety checks in git, `AGENTS.md` + skills, Claude Code adapter, beginner setup
  with one sentence, backup with or without GitHub, update notices, CI on macOS, Windows and Linux.
- **v0.2 — now:** the **3D brain view** (`brain zeig`) — an anatomically shaped, glowing brain with your pages
  as points of light, live search that flies to the best match, conflicts and pages that need review
  highlighted, a timeline. View only, 100 % local.
- **Next:** `brain-mcp`, a local MCP server so every MCP-capable AI (including Claude Desktop) can search your
  brain; adapters for Gemini CLI and Cursor.
- **Later:** effortless capture (save from anywhere with less friction) and automatic freshness checks that
  tell you which knowledge is getting old.

## Contributing

Issues and pull requests are welcome. Run the tests with `bash .tools/tests/run-all.sh` (Git Bash on
Windows); CI runs them on all three systems plus a publish check that keeps personal data out of the repo.

## License

[MIT](LICENSE). The 3D view bundles three.js (MIT), the Geist fonts (SIL Open Font License 1.1) and a brain
surface derived from the public-domain AOMIC-ID1000 MRI dataset (CC0) — details and full license texts in
[`.tools/ansicht/DRITTANBIETER.md`](.tools/ansicht/DRITTANBIETER.md).
