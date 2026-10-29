// .tools/tests/verlauf-fixture.mjs — Hilfen für Verlaufs-Tests (Temp-Ordner, JSONL schreiben). KEIN Test.
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const tempOrdner = (name = "verlauf") => mkdtempSync(join(tmpdir(), `${name}-`));
export const tempVault = (name = "Ernte Vault") => tempOrdner(name);
export function schreibeVerlauf(datei, eintraege) {
  writeFileSync(datei, eintraege.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return datei;
}
