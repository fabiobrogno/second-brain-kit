// .tools/tests/test-secrets-muster.mjs — jedes Credential-Muster positiv und negativ.
// Köderwerte werden ERST ZUR LAUFZEIT zusammengesetzt (publish-check/Commit-Prüfung sehen im Quelltext nie
// ein vollständiges Muster).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SECRET_MUSTER, findeSecrets, ohneSecrets, zeilenMitSecrets } from "../secrets-muster.mjs";

const j = (...t) => t.join("");
const wdh = (z, n) => z.repeat(n);
const trifft = (s) => SECRET_MUSTER.test(s);

const faelle = [
  // [Name, positiv, negativ]
  ["sk-ant", j("Key: ", "sk-", "ant-", "api03-", "Ab1Cd2Ef3Gh4"), "Das sk-ant Präfix ist bekannt"],
  ["sk- generisch ab 20", j("nimm ", "sk-", "proj", "1234567890abcdefghij"), j("task-", "1234567890abcdefghijk und sk-kurz12")],
  ["ghp_", j("ghp", "_", wdh("A1", 18)), "ghp_ allein ist kein Schlüssel"],
  ["gho_", j("gho", "_", wdh("b2", 18)), "gho_kurz"],
  ["github_pat_", j("github", "_pat_", wdh("C3d", 9)), "github_pat_ steht in der Doku"],
  ["AKIA", j("AK", "IA", "ABCDEFGH12345678"), j("AK", "IA", "abc und AKIAKURZ")],
  ["xox[bpas]-", j("xo", "xb-", "1234567890-abc"), "xoxo- Grüße"],
  ["JWT", j("ey", "J", "hbGciOiJIUzI1", ".", "eyJzdWIiOiIx", ".", "SflKxwRJSMeK"), "eyJ allein ohne Punkte"],
  ["Passwort lautet", j("Mein Pass", "wort lautet: ", "Sommer", "2025!"), "das Passwort-Feld ist leer"],
  ["Kennwort ist", j("Ken", "nwort ist ", "Hundekuchen7"), "Das Kennwort ist zu kurz."],
  ["password is", j("the pass", "word is ", "hunter2x"), "the password is required"],
  ["Passwort Doppelpunkt", j("Pass", "wort: ", "Geheim99"), "Passwortmanager benutzen"],
  ["Connection-String", j("redis", "x://", "nutzer", ":", "geheim", "@host:6379"), "https://example.org/pfad@version"],
  ["curl -u Nutzer und Wert", j("curl -u ", "admin", ":", "Sup3r", "Geheim https://x.invalid"), "git push -u origin main"],
  ["--user Nutzer und Wert", j("curl --user ", "admin", ":", "Sup3r", "Geheim"), "curl --user-agent Gartenbot/1.0"],
  ["-u direkt mit Nutzer und Wert", j("mysql -u", "root", ":", "Sup3r", "Geheim"), "sort -u liste.txt"],
  ["Schlüssel-Header", j("curl -H 'X-Api-", "Key: ", "abc123'"), "curl -H 'Content-Type: application/json'"],
  ["Connection-String mit Port", j("ftp", "://", "anna", ":", "s3cret", "@ftp.example.org"), "http://localhost:8080/a@b"],
];

for (const [name, pos, neg] of faelle) {
  test(`Muster ${name}: trifft den Köder`, () => assert.equal(trifft(pos), true, name));
  test(`Muster ${name}: harmloser Satz trifft nicht`, () => assert.equal(trifft(neg), false, `${name}: ${neg}`));
}

test("Alltagssätze ohne Zugangsdaten schlagen nicht an", () => {
  for (const s of [
    "das Passwort-Feld ist leer",
    "Das Passwort ist im Passwort-Manager hinterlegt.",
    "Token liegt im Passwort-Manager",
    "Bitte das Kennwort ändern.",
    "Die Zugangsdaten stehen in Infisical.",
    "Commit 9f9db98 gemergt; Hash 0123456789abcdef0123456789abcdef01234567",
    "skills-build.mjs baut die Skill-Liste",
  ]) assert.equal(trifft(s), false, s);
});

test("privater Schlüssel: der GANZE Block (BEGIN bis END) wird erkannt und entfernt", () => {
  const kopf = j("-----BEGIN ", "OPENSSH PRIVATE", " KEY-----");
  const fuss = j("-----END ", "OPENSSH PRIVATE", " KEY-----");
  const text = ["vorher", kopf, "b3BlbnNzaC1rZXktdjEAAAAABG5vbmU", "AAAAAAABAAAAMwAAAAtzc2gtZWQyNTUx", fuss, "nachher"].join("\n");
  const { treffer } = zeilenMitSecrets(text);
  assert.deepEqual([...treffer].sort(), [1, 2, 3, 4]);
  assert.equal(ohneSecrets(text), "vorher\nnachher");
  const f = findeSecrets(text);
  assert.equal(f.length, 1);
  assert.equal(f[0].zeile, 2);
  // Ohne END: Rest des Texts gilt als Schlüssel
  assert.equal(ohneSecrets(["a", kopf, "x1", "x2"].join("\r\n")), "a");
  // Öffentlicher Schlüssel ist kein Fund
  assert.equal(trifft(j("-----BEGIN ", "PUBLIC KEY-----")), false);
});

test("findeSecrets: höchstens 5 Fundstellen, Zeilennummern 1-basiert, CRLF", () => {
  const z = j("pass", "word: ", "abc123");
  const f = findeSecrets(["ok", z, z, z, z, z, z].join("\r\n"));
  assert.equal(f.length, 5);
  assert.equal(f[0].zeile, 2);
});

test("Zugangsdaten über Zeilengrenzen: hatSecretsImKontext prüft auch den zusammengezogenen Text", async () => {
  const { hatSecretsImKontext } = await import("../secrets-muster.mjs");
  assert.equal(findeSecrets(j("pass", "wort:\n", "Geheim", "Xy99")).length, 0, "zeilenweise allein sieht es nicht");
  assert.equal(hatSecretsImKontext(j("pass", "wort:\n", "Geheim", "Xy99")), true);
  assert.equal(hatSecretsImKontext("Das Passwort-Feld ist leer.\nAlles gut."), false);
});
