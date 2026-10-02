#!/usr/bin/env node
// Baut .tools/ansicht/vendor/brain-mesh/brain-mesh.js aus einer echten, MRT-basierten Gehirnoberfläche.
// Quelle: AOMIC-ID1000 (OpenNeuro ds003097, Lizenz CC0), Proband sub-0001, FreeSurfer-Ableitungen
// (Pial-Oberflächen, Sulkustiefe, Kurvatur, Lappen-Parzellierung, Volumen-Segmentierung).
// Ablauf (reproduzierbar):
//   1. Rohdateien laden (einmalig, Cache außerhalb des Repos; ~13 MB)
//   2. Kleinhirn + Hirnstamm aus der Segmentierung per Marching Cubes vernetzen
//   3. Oberflächen flächengewichtet abtasten (dichter auf Windungskuppen), Schattierung je Punkt aus Sulkustiefe/Kurvatur
//   4. Hülle (Belegung) + Lappen-Karte als 64³-Raster
//   5. Alles kompakt (quantisiert, base64) nach vendor/brain-mesh/brain-mesh.js schreiben (per <script> ladbar, auch über file://)
// Aufruf: node .tools/ansicht/build/build-brain.mjs   (Umgebung: BRAIN_FS_CACHE=<ordner> optional; Standard-Cache
// liegt unter os.tmpdir(), nie im Repo). Nur zum Neubauen des Meshs nötig — die Ansicht selbst braucht es nicht.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { readSurf, readCurv, readAnnot, readMgz } from "./fs-read.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR = join(HERE, "..", "vendor"); // .tools/ansicht/vendor
const SRC = "https://s3.amazonaws.com/openneuro.org/ds003097/derivatives/freesurfer/sub-0001";
const FILES = ["surf/lh.pial", "surf/rh.pial", "surf/lh.sulc", "surf/rh.sulc", "surf/lh.curv", "surf/rh.curv", "label/lh.aparc.annot", "label/rh.aparc.annot", "mri/aseg.mgz"];
const CACHE = process.env.BRAIN_FS_CACHE || join(tmpdir(), "brain3d-ds003097-sub-0001");
mkdirSync(CACHE, { recursive: true });
for (const f of FILES) {
  const out = join(CACHE, f.split("/").pop());
  if (existsSync(out)) continue;
  process.stdout.write("lade " + f + " … ");
  const r = await fetch(SRC + "/" + f);
  if (!r.ok) throw new Error(f + ": HTTP " + r.status);
  writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  console.log("ok");
}
const rd = (n) => readFileSync(join(CACHE, n));

// three.js (Marching Cubes) aus dem mitgelieferten Bundle
const ctx = { console, self: {}, window: {} }; vm.createContext(ctx);
vm.runInContext(readFileSync(join(VENDOR, "three.bundle.js"), "utf8") + ";globalThis.THREE=THREE;", ctx);
const { MarchingCubes, MeshBasicMaterial } = ctx.THREE;

// ---------- deterministischer Zufall + Rauschen
let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
function noise3(x, y, z) { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y, z) { // glattes Wertrauschen
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) r += (a ? u : 1 - u) * (b ? v : 1 - v) * (c ? w : 1 - w) * noise3(xi + a, yi + b, zi + c);
  return r * 2 - 1;
}

// ---------- Koordinaten: FreeSurfer tkrRAS (mm; x rechts, y vorn, z oben) -> App (x vorn, y oben, z rechts)
const S = 2.0 / 172;
let OFF = [0, 0, 0];
const toApp = (rx, ry, rz) => [ry * S + OFF[0], rz * S + OFF[1], rx * S + OFF[2]];

// ---------- Lappen-Codes
const LOBE = { none: 0, frontal: 1, parietal: 2, temporal: 3, occipital: 4, limbic: 5, insula: 6, deep: 7, cerebellum: 8, stem: 9, callosum: 10 };
const PARC = {
  frontal: "superiorfrontal rostralmiddlefrontal caudalmiddlefrontal parsopercularis parstriangularis parsorbitalis lateralorbitofrontal medialorbitofrontal precentral paracentral frontalpole",
  parietal: "superiorparietal inferiorparietal supramarginal postcentral precuneus",
  temporal: "superiortemporal middletemporal inferiortemporal bankssts fusiform transversetemporal entorhinal temporalpole parahippocampal",
  occipital: "lateraloccipital lingual cuneus pericalcarine",
  limbic: "rostralanteriorcingulate caudalanteriorcingulate posteriorcingulate isthmuscingulate",
  insula: "insula",
};
const parcLobe = new Map(); for (const [l, s] of Object.entries(PARC)) for (const n of s.split(" ")) parcLobe.set(n, LOBE[l]);

// ---------- Hemisphären laden
const hemis = ["lh", "rh"].map((h) => {
  const s = readSurf(rd(h + ".pial")), sulc = readCurv(rd(h + ".sulc")), curv = readCurv(rd(h + ".curv")), an = readAnnot(rd(h + ".aparc.annot"));
  const lobe = new Uint8Array(s.nv); for (let i = 0; i < s.nv; i++) lobe[i] = parcLobe.get(an.names.get(an.lab[i])) || 0;
  return { h, ...s, sulc, curv, lobe };
});
// ---------- Segmentierung
const aseg = readMgz(rd("aseg.mgz"));
const A = (c, r, s) => (c < 0 || r < 0 || s < 0 || c >= 256 || r >= 256 || s >= 256 ? 0 : aseg.data[c + r * 256 + s * 65536]);
const rasToVox = (x, y, z) => [128 - x, 128 - z, y + 128]; // conformed 256³, 1 mm
const voxToRas = (c, r, s) => [128 - c, s - 128, 128 - r];

// Ausrichtung: Mitte des Großhirns auf (-0.03, ?, 0), Scheitel auf y = 0.80
{ let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const H of hemis) for (let i = 0; i < H.nv; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], H.v[i*3+k]); mx[k] = Math.max(mx[k], H.v[i*3+k]); }
  OFF = [-0.03 - ((mn[1] + mx[1]) / 2) * S, 0.8 - mx[2] * S, -((mn[0] + mx[0]) / 2) * S];
}

// ---------- Kleinhirn + Stamm vernetzen (Marching Cubes auf geglätteter Maske)
function meshFromLabels(labels, res) {
  let mn = [256, 256, 256], mx = [0, 0, 0];
  for (let s = 0; s < 256; s++) for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) if (labels.has(A(c, r, s))) { mn = [Math.min(mn[0], c), Math.min(mn[1], r), Math.min(mn[2], s)]; mx = [Math.max(mx[0], c), Math.max(mx[1], r), Math.max(mx[2], s)]; }
  const ext = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) + 8, ctr = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  const mc = new MarchingCubes(res, new MeshBasicMaterial(), false, false, 400000);
  const half = res / 2, step = ext / res;
  const val = (c, r, s) => { // geglättete Belegung (3x3x3-Mittel)
    let t = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) t += labels.has(A(Math.round(c) + a, Math.round(r) + b, Math.round(s) + d)) ? 1 : 0;
    return t / 27;
  };
  for (let k = 0; k < res; k++) for (let j = 0; j < res; j++) for (let i = 0; i < res; i++)
    mc.field[i + j * res + k * res * res] = val(ctr[0] + (i - half) * step, ctr[1] + (j - half) * step, ctr[2] + (k - half) * step);
  mc.isolation = 0.5; mc.update();
  const pos = mc.geometry.getAttribute("position").array, nor = mc.geometry.getAttribute("normal").array, n = mc.count;
  const v = new Float32Array(n * 3), nn = new Float32Array(n * 3);
  for (let q = 0; q < n; q++) {
    const c = ctr[0] + pos[q*3] * half * step, r = ctr[1] + pos[q*3+1] * half * step, s = ctr[2] + pos[q*3+2] * half * step;
    const [x, y, z] = voxToRas(c, r, s); v.set([x, y, z], q * 3);
    // Normale (Feld steigt nach innen; Achsen c->-x, r->-z, s->+y)
    const nc = nor[q*3], nr = nor[q*3+1], ns = nor[q*3+2];
    const ox = -nc, oy = ns, oz = -nr, l = Math.hypot(ox, oy, oz) || 1; nn.set([ox / l, oy / l, oz / l], q * 3);
  }
  return { v, nn, ntri: n / 3 };
}
const cereb = meshFromLabels(new Set([7, 8, 46, 47]), 120);
const stem = meshFromLabels(new Set([16, 28, 60]), 96);
console.log("Kleinhirn-Dreiecke", cereb.ntri, "Stamm-Dreiecke", stem.ntri);

// ---------- Abtasten
const P = [], Nn = [], Sh = [], Pt = [], Lb = [];
function vnormals(H) {
  const n = new Float32Array(H.nv * 3);
  for (let f = 0; f < H.nf; f++) {
    const a = H.f[f*3], b = H.f[f*3+1], c = H.f[f*3+2];
    const ux = H.v[b*3] - H.v[a*3], uy = H.v[b*3+1] - H.v[a*3+1], uz = H.v[b*3+2] - H.v[a*3+2], wx = H.v[c*3] - H.v[a*3], wy = H.v[c*3+1] - H.v[a*3+1], wz = H.v[c*3+2] - H.v[a*3+2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    for (const v of [a, b, c]) { n[v*3] += nx; n[v*3+1] += ny; n[v*3+2] += nz; }
  }
  for (let i = 0; i < H.nv; i++) { const l = Math.hypot(n[i*3], n[i*3+1], n[i*3+2]) || 1; n[i*3] /= l; n[i*3+1] /= l; n[i*3+2] /= l; }
  return n;
}
// Kopfneigung im Scanner ausgleichen: Stirn um PITCH Grad absenken (Drehung um die Querachse)
const PITCH = (Number(process.env.BRAIN_PITCH ?? 11) * Math.PI) / 180, PC = Math.cos(PITCH), PS = Math.sin(PITCH);
const rot = (x, y) => [x * PC + y * PS, -x * PS + y * PC];
function push(rx, ry, rz, nx, ny, nz, shade, part, lobe) {
  const [ax, ay, az] = toApp(rx, ry, rz), [px, py] = rot(ax, ay), [qx, qy] = rot(ny, nz);
  P.push(px, py, az); Nn.push(qx, qy, nx); Sh.push(shade); Pt.push(part); Lb.push(lobe);
}
const DENS = Number(process.env.BRAIN_DENSITY || 1.0);
// Großhirn: Dichte je mm² so gewählt, dass ~210 000 Punkte entstehen; Kuppen dichter als Furchengründe
for (const H of hemis) {
  const vn = vnormals(H);
  let area = 0; const areas = new Float32Array(H.nf);
  for (let f = 0; f < H.nf; f++) {
    const a = H.f[f*3], b = H.f[f*3+1], c = H.f[f*3+2];
    const ux = H.v[b*3] - H.v[a*3], uy = H.v[b*3+1] - H.v[a*3+1], uz = H.v[b*3+2] - H.v[a*3+2], wx = H.v[c*3] - H.v[a*3], wy = H.v[c*3+1] - H.v[a*3+1], wz = H.v[c*3+2] - H.v[a*3+2];
    areas[f] = 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx); area += areas[f];
  }
  const target = 64000 * DENS, perMm = target / area;
  for (let f = 0; f < H.nf; f++) {
    const a = H.f[f*3], b = H.f[f*3+1], c = H.f[f*3+2];
    const depthN = Math.min(1, Math.max(0, ((H.sulc[a] + H.sulc[b] + H.sulc[c]) / 3 + 7) / 14)); // 0 Kuppe .. 1 Grund
    let k = areas[f] * perMm * (1.25 - 0.85 * depthN);
    while (k > 0) {
      if (k < 1 && rnd() > k) break; k -= 1;
      let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; } const w = 1 - u - v;
      const x = H.v[a*3] * w + H.v[b*3] * u + H.v[c*3] * v, y = H.v[a*3+1] * w + H.v[b*3+1] * u + H.v[c*3+1] * v, z = H.v[a*3+2] * w + H.v[b*3+2] * u + H.v[c*3+2] * v;
      let nx = vn[a*3] * w + vn[b*3] * u + vn[c*3] * v, ny = vn[a*3+1] * w + vn[b*3+1] * u + vn[c*3+1] * v, nz = vn[a*3+2] * w + vn[b*3+2] * u + vn[c*3+2] * v;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const sulc = H.sulc[a] * w + H.sulc[b] * u + H.sulc[c] * v, curv = H.curv[a] * w + H.curv[b] * u + H.curv[c] * v;
      const t = Math.min(1, Math.max(0, (sulc + 6) / 12));                   // Sulkustiefe -> 0 (Kuppe) .. 1 (Grund)
      let s = 1 - t; s = s * s * (3 - 2 * s);
      s *= 1 - 0.45 * Math.min(1, Math.max(0, curv * 4));                     // konkave Stellen zusätzlich dunkler
      const lobe = w > u && w > v ? H.lobe[a] : u > v ? H.lobe[b] : H.lobe[c];
      push(x, y, z, nx, ny, nz, Math.max(0.03, s), 0, lobe);
    }
  }
}
// Kleinhirn (Folia als parallele, leicht gebogene Linien) und Stamm
function sampleMesh(M, target, part, lobe, shadeFn) {
  let area = 0; const areas = new Float32Array(M.ntri);
  for (let t = 0; t < M.ntri; t++) {
    const o = t * 9, ux = M.v[o+3] - M.v[o], uy = M.v[o+4] - M.v[o+1], uz = M.v[o+5] - M.v[o+2], wx = M.v[o+6] - M.v[o], wy = M.v[o+7] - M.v[o+1], wz = M.v[o+8] - M.v[o+2];
    areas[t] = 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx); area += areas[t];
  }
  const perMm = target / area;
  for (let t = 0; t < M.ntri; t++) {
    let k = areas[t] * perMm;
    while (k > 0) {
      if (k < 1 && rnd() > k) break; k -= 1;
      let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; } const w = 1 - u - v, o = t * 9;
      const x = M.v[o] * w + M.v[o+3] * u + M.v[o+6] * v, y = M.v[o+1] * w + M.v[o+4] * u + M.v[o+7] * v, z = M.v[o+2] * w + M.v[o+5] * u + M.v[o+8] * v;
      let nx = M.nn[o] * w + M.nn[o+3] * u + M.nn[o+6] * v, ny = M.nn[o+1] * w + M.nn[o+4] * u + M.nn[o+7] * v, nz = M.nn[o+2] * w + M.nn[o+5] * u + M.nn[o+8] * v;
      const l = Math.hypot(nx, ny, nz) || 1;
      push(x, y, z, nx / l, ny / l, nz / l, shadeFn(x, y, z), part, lobe);
    }
  }
}
let cy0 = 0; { let s = 0; for (let i = 1; i < cereb.v.length; i += 3) s += cereb.v[i]; cy0 = s / (cereb.v.length / 3); }
sampleMesh(cereb, 30000 * DENS, 1, LOBE.cerebellum, (x, y, z) => {
  // y = vorn/hinten, z = oben/unten (RAS). Folia: parallele Bänder in der Höhe, zur Seite und nach hinten leicht gebogen
  const u = z + 0.012 * x * x + 0.12 * (y - cy0) + 2.2 * vnoise(x * 0.08, y * 0.08, z * 0.08);
  const f = 0.5 + 0.5 * Math.cos(u * 2 * Math.PI / 2.6);
  return 0.18 + 0.82 * Math.pow(f, 1.6);
});
sampleMesh(stem, 9000 * DENS, 2, LOBE.stem, (x, y, z) => 0.5 + 0.2 * Math.cos(Math.atan2(x, y) * 10) + 0.1 * vnoise(x * 0.3, y * 0.3, z * 0.3));
const n = Sh.length;
console.log("Punkte", n);

// ---------- Raster 64³ (App-Koordinaten): Belegung (geglättet) + Lappen
const G = 64;
let bmn = [1e9, 1e9, 1e9], bmx = [-1e9, -1e9, -1e9];
for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { bmn[k] = Math.min(bmn[k], P[i*3+k]); bmx[k] = Math.max(bmx[k], P[i*3+k]); }
const gExt = Math.max(bmx[0] - bmn[0], bmx[1] - bmn[1], bmx[2] - bmn[2]) * 1.08;
const gCtr = [(bmn[0] + bmx[0]) / 2, (bmn[1] + bmx[1]) / 2, (bmn[2] + bmx[2]) / 2];
const gStep = gExt / G, gOrigin = gCtr.map((c) => c - gExt / 2);
const appToRas = (x0, y0, z) => { const x = x0 * PC - y0 * PS, y = x0 * PS + y0 * PC; return [(z - OFF[2]) / S, (x - OFF[0]) / S, (y - OFF[1]) / S]; };
// nächste Pial-Ecke (für Lappen) über Raster-Hash
const hashCell = 6, hash = new Map();
hemis.forEach((H, hi) => { for (let i = 0; i < H.nv; i += 3) { const k = Math.floor(H.v[i*3] / hashCell) + "," + Math.floor(H.v[i*3+1] / hashCell) + "," + Math.floor(H.v[i*3+2] / hashCell); let a = hash.get(k); if (!a) hash.set(k, (a = [])); a.push(hi, i); } });
function nearestLobe(x, y, z) {
  const cx = Math.floor(x / hashCell), cy = Math.floor(y / hashCell), cz = Math.floor(z / hashCell);
  for (let r = 1; r <= 6; r++) {
    let best = -1, bd = 1e9;
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
      const arr = hash.get(cx + a + "," + (cy + b) + "," + (cz + c)); if (!arr) continue;
      for (let q = 0; q < arr.length; q += 2) { const H = hemis[arr[q]], i = arr[q + 1]; const d = (H.v[i*3] - x) ** 2 + (H.v[i*3+1] - y) ** 2 + (H.v[i*3+2] - z) ** 2; if (d < bd && H.lobe[i]) { bd = d; best = H.lobe[i]; } }
    }
    if (best >= 0) return best;
  }
  return LOBE.deep;
}
const DEEP = new Set([4, 5, 10, 11, 12, 13, 14, 15, 17, 18, 26, 28, 30, 31, 43, 44, 49, 50, 51, 52, 53, 54, 58, 60, 62, 63, 72, 77, 85]);
const occRaw = new Float32Array(G * G * G), lab = new Uint8Array(G * G * G);
for (let k = 0; k < G; k++) for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
  const x = gOrigin[0] + (i + 0.5) * gStep, y = gOrigin[1] + (j + 0.5) * gStep, z = gOrigin[2] + (k + 0.5) * gStep;
  const [rx, ry, rz] = appToRas(x, y, z);
  // Belegung: Anteil belegter 1-mm-Voxel in der Zelle (Stichprobe 4³)
  let occ = 0, tot = 0; const counts = new Map(); const h = gStep / S;
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) {
    const [vc, vr, vs] = rasToVox(rx + ((a + 0.5) / 4 - 0.5) * h, ry + ((b + 0.5) / 4 - 0.5) * h, rz + ((c + 0.5) / 4 - 0.5) * h);
    const L = A(Math.round(vc), Math.round(vr), Math.round(vs)); tot++;
    if (L && L !== 24) { occ++; counts.set(L, (counts.get(L) || 0) + 1); }
  }
  const q = i + j * G + k * G * G; occRaw[q] = occ / tot;
  if (occ / tot > 0.3) {
    const L = [...counts.entries()].sort((p, r) => r[1] - p[1])[0][0];
    lab[q] = [7, 8, 46, 47].includes(L) ? LOBE.cerebellum : L === 16 ? LOBE.stem : L >= 251 && L <= 255 ? LOBE.callosum : DEEP.has(L) ? LOBE.deep : nearestLobe(rx, ry, rz);
  }
}
// leichte Glättung der Belegung (für eine weiche Hülle)
const occ = new Uint8Array(G * G * G);
for (let k = 0; k < G; k++) for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
  let t = 0, w = 0;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const ii = i + a, jj = j + b, kk = k + c; if (ii < 0 || jj < 0 || kk < 0 || ii >= G || jj >= G || kk >= G) continue;
    const ww = a || b || c ? (Math.abs(a) + Math.abs(b) + Math.abs(c) === 1 ? 0.6 : 0.3) : 1; t += occRaw[ii + jj * G + kk * G * G] * ww; w += ww;
  }
  occ[i + j * G + k * G * G] = Math.round((t / w) * 255);
}

// ---------- packen
const qPos = new Uint16Array(n * 3);
for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) qPos[i*3+k] = Math.round(((P[i*3+k] - bmn[k]) / (bmx[k] - bmn[k])) * 65535);
// Normalen oktaedrisch in 2 Bytes
const qNor = new Int8Array(n * 2);
for (let i = 0; i < n; i++) {
  let x = Nn[i*3], y = Nn[i*3+1], z = Nn[i*3+2]; const l1 = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1; x /= l1; y /= l1; z /= l1;
  if (z < 0) { const ox = x; x = (1 - Math.abs(y)) * Math.sign(ox || 1); y = (1 - Math.abs(ox)) * Math.sign(y || 1); }
  qNor[i*2] = Math.round(x * 127); qNor[i*2+1] = Math.round(y * 127);
}
const qSh = new Uint8Array(n), qLb = new Uint8Array(n);   // Teil (Groß-/Kleinhirn/Stamm) ergibt sich aus dem Lappen
for (let i = 0; i < n; i++) { qSh[i] = Math.round(Sh[i] * 255); qLb[i] = Lb[i]; }
const parts = [qPos, qNor, qSh, qLb, occ, lab].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength));
const bin = Buffer.concat(parts);
const meta = { n, bmin: bmn, bmax: bmx, grid: { G, origin: gOrigin, step: gStep }, lobes: LOBE, source: "AOMIC-ID1000 (OpenNeuro ds003097, CC0), sub-0001, FreeSurfer-Ableitungen" };
mkdirSync(join(VENDOR, "brain-mesh"), { recursive: true });
writeFileSync(join(VENDOR, "brain-mesh", "brain-mesh.js"), "// generiert von build-brain.mjs — Quelle und Lizenz: vendor/brain-mesh/LICENSE-SOURCE.md\nwindow.BRAIN_MESH = " + JSON.stringify(meta) + ";\nwindow.BRAIN_MESH.b64 = \"" + bin.toString("base64") + "\";\n");
console.log("geschrieben:", (bin.length / 1e6).toFixed(2), "MB binär,", ((bin.length * 4) / 3 / 1e6).toFixed(2), "MB als base64");
