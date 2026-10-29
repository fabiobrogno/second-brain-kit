// .tools/tests/verlauf-fixture.mjs — Hilfen für Verlaufs-Tests (Temp-Ordner, JSONL schreiben). KEIN Test.
import { mkdtempSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

export const tempOrdner = (name = "verlauf") => mkdtempSync(join(tmpdir(), `${name}-`));
export const tempVault = (name = "Ernte Vault") => tempOrdner(name);
export function schreibeVerlauf(datei, eintraege) {
  writeFileSync(datei, eintraege.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return datei;
}

export const TEMP_HOME = mkdtempSync(join(tmpdir(), "verlauf-home-"));
export const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Verlaufszeilen im Format von Claude Code (erfundene Inhalte).
export const nutzer = (text, { uuid, zeit, cwd, isSidechain } = {}) => ({
  type: "user", ...(uuid ? { uuid } : {}), ...(zeit ? { timestamp: zeit } : {}), ...(cwd ? { cwd } : {}), ...(isSidechain ? { isSidechain: true } : {}),
  message: { role: "user", content: text },
});
export const assistent = (text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
export const hinweis = (text, ereignis = "UserPromptSubmit") => ({ type: "attachment", attachment: { type: "hook_success", hookEvent: ereignis, content: text } });
