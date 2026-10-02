# INSTALL.md

You are an AI agent installing a second brain (a local, Markdown-based knowledge vault with agent-neutral
tooling) for the person you're talking to. This file is addressed to you, not to them. Follow it in order.
Every `node ...` command below is the same in a Unix shell, PowerShell and cmd.exe — copy it exactly as
written (including quotes). If `node` isn't on the PATH (typical right after the bootstrap fetched a private
copy), use that copy's full path instead of `node`: `~/.brain-kit/node/bin/node` on macOS/Linux,
`%USERPROFILE%\.brain-kit\node\node.exe` on Windows. After setup, the vault's `AGENTS.md` names the exact
absolute Node (and git) path to use for every command. A handful of steps use a plain shell utility (`curl`, `printf`, `rm`) that
doesn't exist in PowerShell; those always come with a PowerShell line right next to them.

## If the person is not technical

Ask **exactly two questions**, in plain language, each with a suggested default:

1. "Where should your brain live?" (suggestion: `Documents/Brain` — a folder in their home directory)
2. "Should your brain also be backed up online, at GitHub? (yes / no / later)"

Everything else is decided for them: language from their system locale, search profile from whether the
better search can actually be installed on their machine (chosen at install time, not from RAM), agent
adapter from the app they're talking to you in. Never ask
them to open a terminal or type a command — you run everything yourself and translate what happens into
plain sentences ("I'm downloading the search technology now, this takes about a minute…"). Announce any
download before it starts, with its rough size (the first-time search setup is ~300 MB; it only happens
once).

Run the one-line bootstrap for their system (step 2 below) with `--ziel <their folder>` and
`--backup keins|github` depending on their answer, then continue with steps 3–6 below (doctor, probe
ingest, probe search, secrets probe) exactly as written — just translate the output, never show them raw
command output or ask them to run anything.

When you're done, say only these three sentences, nothing else: "Just tell me 'remember this' when you
want to save something. Ask me what you know about something, anytime. Say 'update my brain' when there's
a new version."

## If the person is technical

Ask these **five questions** before you start (skip any they already answered, use the default otherwise):

1. Vault path (default: `~/Documents/Brain`)
2. Language: `de` or `en` (default: auto-detected from the system locale)
3. Search profile: `minimal` (plain text search, no downloads), `leicht` (local embeddings, ~300 MB
   one-time download, recommended for most machines), or `voll` (adds a reranker + query expansion,
   ~2 GB total, needs ≥ 8 GB RAM, opt-in only — not available on Windows in this release)
4. Agent adapter: `claude-code`, `codex`, or `keiner` (none)
5. Backup: `github` (private repo, pushed automatically), `ordner:<path>` (a folder — USB stick, external
   drive, cloud-synced folder; a dated bundle file goes there once a day, last 7 kept), or `keins` (local
   git history only)

Then run the steps below in order.

---

## Step 1 — Check prerequisites

**Command:**
```
node -v
```
**Expected output:** `v20.x.x` or higher (any v20/v21/v22/… is fine).
**If it fails:** `node` is missing or too old. Either run the bootstrap in step 2 (it fetches a private
copy of Node automatically, no admin rights needed), or ask the person to install Node 20+ themselves from
nodejs.org and re-run this step.

## Step 2 — Get the kit and install

**For a non-technical person, or anyone without git installed (recommended path):**

macOS/Linux:
```
curl -fsSL https://raw.githubusercontent.com/fbrogno/second-brain-kit/main/bootstrap.sh | bash -s -- --ziel "<vault-path>" --backup <keins|github>
```
Windows (PowerShell — `irm | iex` can't forward parameters, so save it first, then run it with
`-ExecutionPolicy Bypass`; this only affects the one process you're starting, never changes any system
or user setting, and needs no admin rights):
```
$s = Join-Path $env:TEMP "bootstrap.ps1"; irm https://raw.githubusercontent.com/fbrogno/second-brain-kit/main/bootstrap.ps1 -OutFile $s; powershell -NoProfile -ExecutionPolicy Bypass -File $s -Ziel "<vault-path>" -Backup <keins|github>
```
(No GitHub account needed for either — the script downloads the kit as a public release archive, not
via `git clone`.)
**Expected output:** A short series of plain-language progress lines ("I'm setting up your second brain,
this takes a few minutes…"), ending in the three closing sentences from install.mjs (see Step 8).
**If it fails:** The script prints one plain-language sentence and writes technical details to
`~/.brain-kit/install.log` (`%USERPROFILE%\.brain-kit\install.log` on Windows). Read that log yourself
before asking the person anything — it almost always says exactly what went wrong (network, disk space,
permissions). On Windows specifically: if running `$s` directly (without the `powershell -ExecutionPolicy
Bypass -File` wrapper) fails with something about "running scripts is disabled", that's the default
PowerShell execution policy — always use the wrapper form above, never ask the person to change their
system-wide execution policy.

**For a developer who already cloned this repo or downloaded a release archive:**
```
node install.mjs "<vault-path>" --agent <claude-code|codex|keiner> --sprache <de|en> --profil <minimal|leicht|voll> --backup <keins|github|ordner:<path>>
```
**Expected output:** The same progress lines, ending in the output of `brain doctor` (Step 3) and the three
closing sentences.
**If it fails:** Same as above — read `~/.brain-kit/install.log`. The installer itself never aborts for a
missing `git`/`qmd` — it degrades (search profile `minimal`, a plain-language note) rather than failing, so
a non-zero exit here means something more fundamental (e.g. the vault path isn't writable).

## Step 3 — Confirm the install is healthy

**Command:**
```
node "<vault-path>/.tools/brain.mjs" doctor
```
(`brain.mjs` never infers the vault from your current directory — it uses `BRAIN_VAULT` if set, otherwise
the vault it is installed in (the folder that contains this `.tools/`). Set `BRAIN_VAULT` once per shell if
you want to be explicit while running several commands:
macOS/Linux `export BRAIN_VAULT="<vault-path>"`, PowerShell `$env:BRAIN_VAULT="<vault-path>"`.)
**Expected output:** One line per check (`OK ...`), no line starting with `FEHLT`. `WARN` lines are fine —
they mean something is working in a simpler/degraded way (e.g. the better search isn't installed yet), not
broken.
**If it fails (any `FEHLT` line):** The line itself names the fix in plain language. Apply it, then run
`doctor` again. Never tell the person to run anything themselves — do it and report the result.

From here on, work with `BRAIN_VAULT` set and your shell's current directory inside the vault, so the
commands below can stay short (macOS/Linux: `export BRAIN_VAULT="<vault-path>"; cd "<vault-path>"` —
PowerShell: `$env:BRAIN_VAULT="<vault-path>"; cd "<vault-path>"`).

## Step 4 — Probe ingest (first real walkthrough)

Create this file at `<vault>/inbox/beispiel-notiz.md`:
```
---
titel: Beispielnotiz für die erste Probe
datum:
tags: [beispiel]
---
# Beispielnotiz für die erste Probe

Das Merkwort für die Suche danach: Leuchtturm. Ein Leuchtturm zeigt Schiffen bei Nacht und
schlechter Sicht den Weg zur Küste — genau das soll dieses Brain für dich auch tun.
```
Then work it into the vault using the **ingest** skill (`.tools/skills/ingest/SKILL.md`) exactly as that
skill describes — this is the same path every real note takes, so it exercises the whole chain (secrets
check, wiki placement, logging, git commit).
**Expected output:** A new wiki page is created, `_log.md` gets a new entry, and the commit succeeds (the
pre-commit hook runs and passes).
**If it fails:** Read the failure message from the ingest skill or the pre-commit hook — both speak plain
language and name the fix (e.g. a conflict box to resolve, a missing frontmatter field).

## Step 5 — Probe search

**Command:**
```
node .tools/brain.mjs search "Leuchtturm"
```
**Expected output:** The page created in Step 4 is the top result.
**If it fails:** If the result list is empty or the page isn't on top, run
`node .tools/brain.mjs refresh` once (rebuilds the search index) and search again. Still wrong → note it
and keep going, this doesn't block the rest of the install (the simple fallback search still finds things
by plain text match).

## Step 6 — Secrets probe (the safety net must actually catch something)

**Command:** (split into two printf/string arguments on purpose, so this very file doesn't itself look
like it contains a credential — it still writes the identical line to disk)

macOS/Linux:
```
printf 'api_key%s\n' '=sk-DUMMY' > inbox/probe.md
node .tools/brain.mjs ingest-check inbox/probe.md
```
PowerShell:
```
"api_key" + "=sk-DUMMY" | Set-Content inbox/probe.md
node .tools/brain.mjs ingest-check inbox/probe.md
```
**Expected output:** Exit code `3`, with `SECRETS GEFUNDEN` and the line number printed (never the matched
value itself).
**If it fails (exit 0, or no secrets reported):** The secrets check is broken — this is serious, stop and
report it before telling the person the install is done; don't silently continue.

Then delete the probe file:
```
rm inbox/probe.md
```
(Windows PowerShell: `Remove-Item inbox/probe.md`)

## Step 7 — Set up backup

If you passed `--backup github` in Step 2, `install.mjs` only saved that choice in the config — it printed
"Jetzt richte ich die Online-Sicherung ein — gleich öffnet sich GitHub im Browser." but did not actually
log in yet. Do this step **immediately** after Step 2, before moving on to Step 3: follow the **backup**
skill (`.tools/skills/backup/SKILL.md`) now, its GitHub path. It walks through `gh auth login --web` (a
browser window opens, you tell the person what code to enter — they never touch a terminal).

If the person asked for online backup but you didn't pass `--backup github` in Step 2 (or they decide on
it later), follow the same skill whenever they ask. A folder backup (USB stick, external drive,
cloud-synced folder) is simpler: `node .tools/brain.mjs backup einrichten ordner:"<path>"`.

## Step 8 — Done

`install.mjs` prints three closing sentences at the end of its own run (Step 2) — if you ran it directly
rather than through this walkthrough, print them yourself: "Just tell me 'remember this' when you want to
save something. Ask me what you know about something, anytime. Say 'update my brain' when there's a new
version."

---

## Manual adjustments

None are expected for a standard install on macOS, Windows 10/11 or Linux. If you had to adjust anything
by hand to get a successful install (a path, a permission, a missing package), name it explicitly to the
person here — don't silently patch around it. Known, by-design exceptions in this release:
- Search profile `voll` is not offered automatically and is unavailable as an opt-in on Windows (no
  `sqlite-vec` prebuild for `windows-arm64`, and the installer doesn't build native deps from source).
- `bootstrap.ps1` needs PowerShell 5.1+ (ships with Windows 10/11) — no separate PowerShell Core install.

See `UPDATE.md` for moving an existing installation to a newer version.
