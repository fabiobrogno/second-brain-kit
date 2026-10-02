#!/usr/bin/env node
// Aufwärmen der Hinweis-Suche (Modell + Index in den Page-Cache), damit der erste Prompt einer Session
// nicht in den 4-s-Timeout läuft. Nur aufrufen, wenn kein embed läuft (search-refresh.mjs sorgt dafür).
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { suche } from "./hint-kind.mjs";
import { frageDienst } from "./dienst-client.mjs";
import { vaultPfad } from "./pfade.mjs";

const vault = vaultPfad();
const t0 = Date.now();
const modul = process.env.BRAIN_HINT_SEARCH_MODULE || fileURLToPath(new URL("./qmd-vector.mjs", import.meta.url));
// Läuft der Suchdienst, ist schon alles warm — kein zweites Modell laden
try { await frageDienst(vault, { query: "aufwärmen", limit: 1, top: 0 }, { antwortMs: 1500 });
  try { appendFileSync(join(vault, ".logs", "hooks.log"), `${new Date().toISOString().slice(0, 19)} warm dienst ms=${Date.now() - t0}\n`); } catch {}
  process.exit(0); } catch {}
let s = "warm ok";
try { await suche(pathToFileURL(modul).href, "brain aufwärmen", { collection: "brainkarten", limit: 20 }, 20000); }
catch (e) { s = `warm fehler=${e.code || e.name || "unbekannt"}`; }
try { mkdirSync(join(vault, ".logs"), { recursive: true }); appendFileSync(join(vault, ".logs", "hooks.log"), `${new Date().toISOString().slice(0, 19)} ${s} ms=${Date.now() - t0}\n`); } catch {}
process.exit(0);
