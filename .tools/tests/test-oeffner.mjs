// .tools/tests/test-oeffner.mjs — welches Programm `brain zeig` zum Öffnen nutzt (ohne etwas zu öffnen).
import { test } from "node:test";
import assert from "node:assert/strict";
import { oeffnerAufruf } from "../oeffner.mjs";

const winDatei = "D:\\Daten\\Müller, Anna\\Brain\\.tools\\ansicht\\index.html";
const winUrl = "file:///D:/Daten/M%C3%BCller,%20Anna/Brain/.tools/ansicht/index.html";

test("Windows: rundll32 url.dll,FileProtocolHandler mit der URL statt explorer.exe mit dem Pfad", () => {
  const { cmd, args } = oeffnerAufruf({ datei: winDatei, url: winUrl }, "win32");
  assert.equal(cmd, "rundll32.exe");
  assert.equal(args[0], "url.dll,FileProtocolHandler");
  assert.equal(args.length, 2);
  assert.ok(args[1].startsWith("file:///D:/"), args[1]);
});

test("Windows: Komma im Vault-Pfad steht nicht mehr auf der Kommandozeile (als %2C kodiert)", () => {
  const { args } = oeffnerAufruf({ datei: winDatei, url: winUrl }, "win32");
  assert.doesNotMatch(args[1], /,/);
  assert.equal(args[1], "file:///D:/Daten/M%C3%BCller%2C%20Anna/Brain/.tools/ansicht/index.html");
});

test("macOS/Linux: open bzw. xdg-open mit dem Dateipfad", () => {
  assert.deepEqual(oeffnerAufruf({ datei: "/a, b/index.html", url: "file:///a,%20b/index.html" }, "darwin"), { cmd: "open", args: ["/a, b/index.html"] });
  assert.deepEqual(oeffnerAufruf({ datei: "/x/index.html", url: "file:///x/index.html" }, "linux"), { cmd: "xdg-open", args: ["/x/index.html"] });
});

test("Testhaken BRAIN_OEFFNER ersetzt das Programm auf jedem System und bekommt den Dateipfad", () => {
  for (const p of ["win32", "darwin", "linux"]) {
    assert.deepEqual(oeffnerAufruf({ datei: "D", url: "file:///D" }, p, "/bin/mein-oeffner"), { cmd: "/bin/mein-oeffner", args: ["D"] });
  }
});
