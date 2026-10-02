/* Brain 3D — Ansicht des Second Brain. Liest nur window.BRAIN_DATA (<vault>/.logs/ansicht/data.js, gebaut von
   daten.mjs), schreibt nie. three.js kommt lokal aus vendor/three.bundle.js (window.THREE), kein CDN zur Laufzeit.
   Bereiche, Farben und Hirnregionen kommen aus BRAIN_DATA.areas (config-gesteuert), nicht aus festen Namen. */
(function () {
  "use strict";
  const T = window.THREE;
  if (!window.BRAIN_DATA) { fail("Noch keine Daten — sag ‚zeig mir mein Brain‘", true); return; }
  if (!T || !window.BRAIN_MESH) { fail("three.js oder das Gehirn-Modell fehlt"); return; }
  if (!window.BrainMarkdown || !window.BrainSuche) { fail("markdown.js oder suche.js fehlt"); return; }
  const { OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, MarchingCubes } = T;

  const params = new URLSearchParams(location.search);
  const SHOT = params.get("shot");
  const $ = (s) => document.querySelector(s);
  const mqMobile = matchMedia("(max-width: 720px)");
  const isMobile = () => mqMobile.matches;
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches || params.has("still");
  const root = document.documentElement;
  if (params.get("theme") === "light" || SHOT === "light") root.dataset.theme = "light";
  if (params.has("bare")) document.body.classList.add("bare");
  try { const t = localStorage.getItem("brain3d-theme"); if (t && !SHOT && !params.get("theme")) root.dataset.theme = t; } catch {}

  // ================================================================== data
  const RAW = window.BRAIN_DATA;
  const D = { areas: (RAW.areas || []).slice(), nodes: (RAW.nodes || []).map((n) => ({ ...n })), edges: (RAW.edges || []).slice(), inbox: RAW.inbox || 0, first: RAW.first, last: RAW.last };
  // Bereiche: aus den Daten; unbekannte Bereiche eines Knotens landen im Zentrum (nie ein Absturz wegen alter data.js)
  const FIXED = { zentrum: { id: "zentrum", name: "Überblick", farbe: "neutral", region: "tief" }, archiv: { id: "archiv", name: "Archiv", farbe: "grau", region: "kleinhirn" }, inbox: { id: "inbox", name: "Inbox", farbe: "lila", region: "wolke" } };
  for (const k of Object.keys(FIXED)) if (!D.areas.some((a) => a.id === k)) D.areas.push(FIXED[k]);
  const AREAS = Object.fromEntries(D.areas.map((a) => [a.id, a]));
  D.nodes.forEach((n) => { if (!AREAS[n.area]) n.area = "zentrum"; });
  const synth = Number(params.get("synthetic") || 0);
  if (synth) addSynthetic(synth);
  const N = D.nodes.length;
  const idx = new Map(D.nodes.map((n, i) => [n.id, i]));
  const byName = new Map();
  D.nodes.forEach((n, i) => { if (n.name) byName.set(n.name.toLowerCase(), i); byName.set(n.title.toLowerCase(), i); });
  D.edges = D.edges.filter((e) => idx.has(e.s) && idx.has(e.t));
  const E = D.edges.length;
  const out = D.nodes.map(() => []), inn = D.nodes.map(() => []), adj = D.nodes.map(() => new Set());
  D.edges.forEach((e, k) => { const a = idx.get(e.s), b = idx.get(e.t); e.a = a; e.b = b; out[a].push(k); inn[b].push(k); adj[a].add(b); adj[b].add(a); });
  const DAY = 86400000;
  const toT = (d) => (d ? Date.parse(d + "T12:00:00Z") : null);
  const tLast = toT(D.last) ?? toT(new Date().toISOString().slice(0, 10)), tFirst = toT(D.first) ?? tLast - DAY; // ohne Daten: Zeitleiste endet heute
  const days = Math.max(1, Math.round((tLast - tFirst) / DAY));
  D.nodes.forEach((n) => {
    n.t = toT(n.added) ?? tFirst;
    n.fresh = tLast - Math.max(n.t, toT(n.changed) ?? n.t) <= DAY;
    n.day = Math.round((n.t - tFirst) / DAY);
  });
  const DENSE = Math.min(1, Math.sqrt(300 / Math.max(N, 1)));    // 1 bei kleinen Brains, kleiner bei vielen Seiten

  const TYPES = { thema: "Thema", entitaet: "Steckbrief", quelle: "Quelle", synthese: "Synthese", ueberblick: "Überblick", notiz: "Notiz" };
  const css = (v) => getComputedStyle(root).getPropertyValue(v).trim();
  // Farbe je Bereich aus der festen Palette (style.css: --c-blau, --c-orange, … --c-neutral)
  const areaColor = (a) => css("--c-" + (AREAS[a]?.farbe || "neutral")) || css("--c-neutral") || "#ffffff";

  // ================================================================== noise + rng
  const noise3 = (() => {
    const g = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
    const p = new Uint8Array(256); for (let i = 0; i < 256; i++) p[i] = i;
    let s = 2024; for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); const t = p[i]; p[i] = p[j]; p[j] = t; }
    const perm = new Uint8Array(512), pm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm[i] = perm[i] % 12; }
    const F3 = 1 / 3, G3 = 1 / 6;
    const c = (gi, x, y, z, t) => { if (t < 0) return 0; t *= t; const q = g[gi]; return t * t * (q[0] * x + q[1] * y + q[2] * z); };
    return (xin, yin, zin) => {
      const s = (xin + yin + zin) * F3, i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
      const t = (i + j + k) * G3, x0 = xin - i + t, y0 = yin - j + t, z0 = zin - k + t;
      let i1, j1, k1, i2, j2, k2;
      if (x0 >= y0) { if (y0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=1;k2=0; } else if (x0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=0;k2=1; } else { i1=0;j1=0;k1=1;i2=1;j2=0;k2=1; } }
      else { if (y0 < z0) { i1=0;j1=0;k1=1;i2=0;j2=1;k2=1; } else if (x0 < z0) { i1=0;j1=1;k1=0;i2=0;j2=1;k2=1; } else { i1=0;j1=1;k1=0;i2=1;j2=1;k2=0; } }
      const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3, x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3, x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
      const ii = i & 255, jj = j & 255, kk = k & 255;
      return 32 * (c(pm[ii + perm[jj + perm[kk]]], x0, y0, z0, 0.6 - x0*x0 - y0*y0 - z0*z0)
        + c(pm[ii + i1 + perm[jj + j1 + perm[kk + k1]]], x1, y1, z1, 0.6 - x1*x1 - y1*y1 - z1*z1)
        + c(pm[ii + i2 + perm[jj + j2 + perm[kk + k2]]], x2, y2, z2, 0.6 - x2*x2 - y2*y2 - z2*z2)
        + c(pm[ii + 1 + perm[jj + 1 + perm[kk + 1]]], x3, y3, z3, 0.6 - x3*x3 - y3*y3 - z3*z3));
    };
  })();
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; };

  // ================================================================== Gehirn aus MRT-Daten (vendor/brain-mesh, CC0)
  // Punkte, Normalen, Schattierung (Sulkustiefe) und Lappen-Karte kommen vorberechnet aus build-brain.mjs.
  const BM = window.BRAIN_MESH;
  const LOBE = BM.lobes;
  const BIN = (() => { const s = atob(BM.b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; })();
  const GRID = BM.grid, G = GRID.G, G3 = G * G * G;
  const OCC = BIN.subarray(BM.n * 10, BM.n * 10 + G3), LAB = BIN.subarray(BM.n * 10 + G3, BM.n * 10 + 2 * G3);
  function decodeCloud(keep) {
    const n = BM.n, qp = new Uint16Array(BIN.buffer, 0, n * 3), qn = new Int8Array(BIN.buffer, n * 6, n * 2), qs = BIN.subarray(n * 8, n * 9), ql = BIN.subarray(n * 9, n * 10);
    const idx = []; for (let i = 0; i < n; i++) if (keep >= 1 || rnd() < keep) idx.push(i);
    const m = idx.length, pos = new Float32Array(m * 3), nor = new Float32Array(m * 3), shade = new Float32Array(m), part = new Float32Array(m);
    idx.forEach((i, o) => {
      for (let k = 0; k < 3; k++) pos[o*3+k] = BM.bmin[k] + (qp[i*3+k] / 65535) * (BM.bmax[k] - BM.bmin[k]);
      let x = qn[i*2] / 127, y = qn[i*2+1] / 127, z = 1 - Math.abs(x) - Math.abs(y);
      if (z < 0) { const ox = x; x = (1 - Math.abs(y)) * Math.sign(ox || 1); y = (1 - Math.abs(ox)) * Math.sign(y || 1); }
      const l = Math.hypot(x, y, z) || 1; nor[o*3] = x / l; nor[o*3+1] = y / l; nor[o*3+2] = z / l;
      shade[o] = qs[i] / 255; part[o] = ql[i] === LOBE.cerebellum ? 1 : ql[i] === LOBE.stem ? 2 : 0;
    });
    return { pos, nor, shade, part };
  }
  const cellOf = (x, y, z) => {
    const i = Math.floor((x - GRID.origin[0]) / GRID.step), j = Math.floor((y - GRID.origin[1]) / GRID.step), k = Math.floor((z - GRID.origin[2]) / GRID.step);
    return i < 0 || j < 0 || k < 0 || i >= G || j >= G || k >= G ? -1 : i + j * G + k * G * G;
  };
  const cellCenter = (q, out = [0, 0, 0]) => { const i = q % G, j = Math.floor(q / G) % G, k = Math.floor(q / (G * G)); out[0] = GRID.origin[0] + (i + 0.5) * GRID.step; out[1] = GRID.origin[1] + (j + 0.5) * GRID.step; out[2] = GRID.origin[2] + (k + 0.5) * GRID.step; return out; };

  // ================================================================== regions + layout (Bereich -> echter Hirnlappen)
  // Region (aus BRAIN_DATA.areas[].region) -> echte Hirnlappen. Das Zentrum (Wiki ohne Cluster) liegt im Balken +
  // Tiefe, damit es sich nicht mit einem Cluster in der Region „tief“ deckt.
  const REGION_LOBES = {
    frontal: [LOBE.frontal], temporal: [LOBE.temporal], parietal: [LOBE.parietal], tief: [LOBE.deep, LOBE.limbic],
    okzipital: [LOBE.occipital], kleinhirn: [LOBE.cerebellum],
  };
  const lobesOf = (a) => (a === "zentrum" ? [LOBE.callosum, LOBE.deep] : REGION_LOBES[AREAS[a]?.region] || [LOBE.deep]);
  const isWolke = (a) => AREAS[a]?.region === "wolke";
  const beidseitig = (a) => AREAS[a]?.region === "temporal"; // Schläfenlappen: zwei Hälften, je Seite ein Knotenpunkt
  const REG = { inbox: { c: [1.3, 0.75, 0.15], r: [0.18, 0.12, 0.18] } };
  const areaInfo = {};
  function buildArea(a) {
    if (areaInfo[a]) return areaInfo[a];
    const set = new Set(lobesOf(a));
    const valid = new Uint8Array(G3), list = [];
    for (let q = 0; q < G3; q++) if (set.has(LAB[q]) && OCC[q] >= 175) { valid[q] = 1; list.push(q); }
    // nächstgelegene gültige Zelle für jede Zelle (BFS, 6er-Nachbarschaft)
    const near = new Int32Array(G3).fill(-1), queue = new Int32Array(G3); let h = 0, t = 0;
    for (const q of list) { near[q] = q; queue[t++] = q; }
    while (h < t) {
      const q = queue[h++], i = q % G, j = Math.floor(q / G) % G, k = Math.floor(q / (G * G));
      const nb = [i > 0 ? q - 1 : -1, i < G - 1 ? q + 1 : -1, j > 0 ? q - G : -1, j < G - 1 ? q + G : -1, k > 0 ? q - G * G : -1, k < G - 1 ? q + G * G : -1];
      for (const r of nb) if (r >= 0 && near[r] < 0) { near[r] = near[q]; queue[t++] = r; }
    }
    const c = [0, 0, 0], side = { "-1": [0, 0, 0, 0], "1": [0, 0, 0, 0] }, tmp = [0, 0, 0];
    for (const q of list) { cellCenter(q, tmp); for (let k = 0; k < 3; k++) c[k] += tmp[k] / list.length; const sd = side[tmp[2] < 0 ? "-1" : "1"]; sd[0] += tmp[0]; sd[1] += tmp[1]; sd[2] += tmp[2]; sd[3]++; }
    const sideC = (s) => { const v = side[s]; return v[3] ? [v[0] / v[3], v[1] / v[3], v[2] / v[3]] : c; };
    return (areaInfo[a] = { valid, list, near, c, sideC, vol: list.length * GRID.step ** 3 });
  }
  function keepIn(P, i, A) {
    const q = cellOf(P[i*3], P[i*3+1], P[i*3+2]);
    if (q >= 0 && A.valid[q]) return;
    const target = q >= 0 ? A.near[q] : A.list[0]; if (target < 0) return;
    const cc = cellCenter(target), hs = GRID.step * 0.45;
    for (let k = 0; k < 3; k++) P[i*3+k] = cc[k] + Math.max(-hs, Math.min(hs, P[i*3+k] - cc[k]));
  }
  const nodeSide = new Int8Array(N), nodeHub = [];
  function layout() {
    const P = new Float32Array(N * 3);
    const cnt = {}; D.nodes.forEach((n) => (cnt[n.area] = (cnt[n.area] || 0) + 1));
    const sp = D.nodes.map((n) => isWolke(n.area) ? 0.08 : 0.8 * Math.cbrt(buildArea(n.area).vol / cnt[n.area]));
    const groups = new Map(), tmp = [0, 0, 0];
    D.nodes.forEach((n, i) => {
      const gk = n.area + "|" + n.group;
      if (!groups.has(gk)) {
        if (isWolke(n.area)) { const R = REG.inbox; groups.set(gk, [R.c[0] + (hash(gk) - 0.5) * R.r[0], R.c[1] + (hash(gk + "y") - 0.5) * R.r[1], R.c[2] + (hash(gk + "z") - 0.5) * R.r[2]]); }
        else { const A = buildArea(n.area); const q = A.list[Math.floor(hash(gk) * A.list.length)] ?? A.list[0]; groups.set(gk, cellCenter(q, [0, 0, 0])); }
      }
      n._g = groups.get(gk);
      for (let k = 0; k < 3; k++) P[i*3+k] = n._g[k] + (rnd() - 0.5) * sp[i] * 2;
      if (!isWolke(n.area)) keepIn(P, i, buildArea(n.area));
    });
    const CELL = Math.max(0.05, Math.max(0, ...sp) * 1.7);
    const F = new Float32Array(N * 3);
    const iters = N > 1200 ? 110 : N > 300 ? 180 : 320;
    const sameArea = D.edges.filter((e) => D.nodes[e.a].area === D.nodes[e.b].area);
    for (let it = 0; it < iters; it++) {
      F.fill(0);
      const cool = 1 - it / iters, grid = new Map();
      for (let i = 0; i < N; i++) { const k = Math.floor(P[i*3] / CELL) + "," + Math.floor(P[i*3+1] / CELL) + "," + Math.floor(P[i*3+2] / CELL); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i); }
      for (let i = 0; i < N; i++) {
        const cx = Math.floor(P[i*3] / CELL), cy = Math.floor(P[i*3+1] / CELL), cz = Math.floor(P[i*3+2] / CELL), R0 = sp[i] * 1.6;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const a = grid.get((cx + dx) + "," + (cy + dy) + "," + (cz + dz)); if (!a) continue;
          for (const j of a) {
            if (j <= i) continue;
            const ex = P[i*3] - P[j*3], ey = P[i*3+1] - P[j*3+1], ez = P[i*3+2] - P[j*3+2];
            const d = Math.sqrt(ex * ex + ey * ey + ez * ez) + 1e-6, R = Math.max(R0, sp[j] * 1.6);
            if (d >= R) continue;
            const f = (0.5 * (R - d)) / d;
            F[i*3] += ex * f; F[i*3+1] += ey * f; F[i*3+2] += ez * f; F[j*3] -= ex * f; F[j*3+1] -= ey * f; F[j*3+2] -= ez * f;
          }
        }
      }
      for (const e of sameArea) {
        const i = e.a, j = e.b, ex = P[j*3] - P[i*3], ey = P[j*3+1] - P[i*3+1], ez = P[j*3+2] - P[i*3+2];
        const d = Math.sqrt(ex * ex + ey * ey + ez * ez) + 1e-6, rest = (sp[i] + sp[j]) * 0.9, f = ((d - rest) * 0.05) / d;
        F[i*3] += ex * f; F[i*3+1] += ey * f; F[i*3+2] += ez * f; F[j*3] -= ex * f; F[j*3+1] -= ey * f; F[j*3+2] -= ez * f;
      }
      for (let i = 0; i < N; i++) {
        const g = D.nodes[i]._g, lim = sp[i] * 0.6;
        for (let k = 0; k < 3; k++) { F[i*3+k] += (g[k] - P[i*3+k]) * 0.006; P[i*3+k] += Math.max(-lim, Math.min(lim, F[i*3+k])) * (0.35 + 0.65 * cool); }
        if (!isWolke(D.nodes[i].area)) keepIn(P, i, buildArea(D.nodes[i].area));
      }
    }
    D.nodes.forEach((n, i) => {
      nodeSide[i] = P[i*3+2] < 0 ? -1 : 1;
      nodeHub[i] = isWolke(n.area) ? REG.inbox.c : beidseitig(n.area) ? buildArea(n.area).sideC(String(nodeSide[i])) : buildArea(n.area).c;
    });
    return P;
  }
  // Etiketten-Anker: Schwerpunkt des Lappens (Schläfenlappen: rechte, kameranahe Seite), Richtung nach außen.
  // Ein Etikett je Bereich außer dem Zentrum; teilen sich zwei Bereiche eine Region, wird die Richtung leicht gedreht.
  const REGION_DIR = { frontal: [1, 0.25, 0], parietal: [-0.3, 1, 0], temporal: [0.45, -1, 0], tief: [-0.55, -1, 0], okzipital: [-1, 0.15, 0], kleinhirn: [-1, -0.7, 0], wolke: [0, 1, 0] };
  function regionLabelCfg() {
    const cfg = {}, used = {};
    for (const a of D.areas) {
      if (a.id === "zentrum") continue;
      const k = used[a.region] = (used[a.region] || 0) + 1, d = (REGION_DIR[a.region] || [0, -1, 0]).slice();
      if (k > 1) { d[1] += 0.45 * (k - 1); }
      if (isWolke(a.id)) cfg[a.id] = { at: REG.inbox.c, dir: d, free: true };
      else cfg[a.id] = { at: beidseitig(a.id) ? buildArea(a.id).sideC("1") : buildArea(a.id).c, dir: d };
    }
    return cfg;
  }

  // ================================================================== three setup
  const canvas = $("#gl");
  const renderer = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  const DPR = Math.min(window.devicePixelRatio || 1, isMobile() ? 1.5 : 2);
  renderer.setPixelRatio(DPR);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(32, 1, 0.05, 50);
  const HOME = { pos: new T.Vector3(1.5, 1.7, 4.35), target: new T.Vector3(-0.02, -0.1, 0) };
  if (isMobile()) HOME.pos.multiplyScalar(1.5);
  camera.position.copy(HOME.pos);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(HOME.target);
  controls.enableDamping = true; controls.dampingFactor = 0.07; controls.rotateSpeed = 0.6; controls.zoomSpeed = 0.8;
  controls.minDistance = 0.9; controls.maxDistance = 11; controls.screenSpacePanning = true;
  controls.autoRotateSpeed = 0.32;
  controls.update();

  function bgTexture(light) {
    const c = document.createElement("canvas"); c.width = 1024; c.height = 1024;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(560, 460, 30, 512, 512, 720);
    if (light) { gr.addColorStop(0, "#ffffff"); gr.addColorStop(0.55, "#eef1f7"); gr.addColorStop(1, "#dfe3ec"); }
    else { gr.addColorStop(0, "#0d1426"); gr.addColorStop(0.45, "#070b16"); gr.addColorStop(1, "#020308"); }
    g.fillStyle = gr; g.fillRect(0, 0, 1024, 1024);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new T.Vector2(256, 256), 0.5 * (0.6 + 0.4 * DENSE), 0.45, 0.24);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const U = { uTime: { value: 0 }, uPR: { value: DPR }, uLight: { value: 0 }, uScale: { value: 1 }, uMotion: { value: RM ? 0 : 1 } };

  // --- Hülle (Marching Cubes aus dem SDF, nach innen versetzt): verdeckt die Rückseite und leuchtet am Rand
  const SHELL_ISO = 0.78;
  const shellMat = new T.ShaderMaterial({
    uniforms: { ...U, uCol: { value: new T.Color() }, uDim: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uCol; uniform float uLight, uDim; varying vec3 vN; varying vec3 vV;
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float rim = pow(f, 2.6);
        if (uLight > 0.5) { gl_FragColor = vec4(mix(vec3(0.955,0.96,0.975), vec3(0.74,0.77,0.86), rim), 0.78); return; }
        vec3 base = vec3(0.012, 0.018, 0.04);
        vec3 c = base + uCol * (0.02 + 0.06 * rim) * (1.0 - 0.5 * uDim); gl_FragColor = vec4(c, 0.9); }`,
    transparent: true, depthWrite: true, blending: T.NormalBlending,
  });
  const shell = new MarchingCubes(G, shellMat, false, false, 300000);
  shell.isolation = 0;
  for (let q = 0; q < G3; q++) shell.field[q] = OCC[q] / 255 - SHELL_ISO;
  shell.update();
  shell.position.set(...GRID.origin.map((o) => o + (G / 2 + 0.5) * GRID.step)); shell.scale.setScalar((G / 2) * GRID.step);
  shell.renderOrder = 0; shell.frustumCulled = false;
  scene.add(shell);

  // --- Rinde als Punktwolke (tiefengetestet: nur sichtbare Oberfläche) + schwacher Durchschein der Rückseite
  const cloud = decodeCloud(isMobile() ? 0.8 : 1);
  const brainGeo = new T.BufferGeometry();
  brainGeo.setAttribute("position", new T.BufferAttribute(cloud.pos, 3));
  brainGeo.setAttribute("normal", new T.BufferAttribute(cloud.nor, 3));
  brainGeo.setAttribute("shade", new T.BufferAttribute(cloud.shade, 1));
  brainGeo.setAttribute("part", new T.BufferAttribute(cloud.part, 1));
  const brainVS = `
      attribute float shade; attribute float part;
      uniform float uPR, uScale, uDim, uGhost; uniform vec3 uColA, uColB;
      varying float vA; varying vec3 vC;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vec3 v = normalize(-mv.xyz);
        float f = dot(n, v);
        mv.xyz += v * 0.03;   // gegen die Hülle leicht nach vorn (wie Polygon-Offset)
        float rim = pow(1.0 - abs(f), 3.0);
        if (part < 0.5) rim *= smoothstep(0.08, 0.5, abs(position.z));
        float s = shade;
        float a = (0.58 + 0.3 * rim) * (0.03 + 0.97 * pow(s, 2.2));
        if (uGhost > 0.0) a = (f < 0.0 ? uGhost : 0.0) * (0.2 + 0.8 * s);
        float cz = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
        a *= 1.0 - 0.45 * smoothstep(-0.2, 0.7, cz - mv.z);
        a *= 1.0 - 0.6 * uDim;
        vA = a;
        vC = mix(uColA, uColB, clamp(s * 0.72 + rim * 0.3, 0.0, 1.0));
        gl_PointSize = min(uPR * uScale * (1.5 + 1.7 * s) * (4.2 / -mv.z), uPR * 4.5);
        gl_Position = projectionMatrix * mv;
      }`;
  const pointFS = `uniform float uOpacity; varying float vA; varying vec3 vC;
      void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.05, d) * uOpacity); }`;
  const brainUniforms = { ...U, uColA: { value: new T.Color() }, uColB: { value: new T.Color() }, uOpacity: { value: 1 }, uDim: { value: 0 } };
  const brainMat = new T.ShaderMaterial({ uniforms: { ...brainUniforms, uGhost: { value: 0 } }, vertexShader: brainVS, fragmentShader: pointFS, transparent: true, depthWrite: false, depthTest: true, blending: T.AdditiveBlending });
  const ghostMat = new T.ShaderMaterial({ uniforms: { ...brainUniforms, uGhost: { value: 0.035 } }, vertexShader: brainVS, fragmentShader: pointFS, transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending });
  const brain = new T.Points(brainGeo, brainMat); brain.renderOrder = 1; scene.add(brain);
  const ghost = new T.Points(brainGeo, ghostMat); ghost.renderOrder = 1; scene.add(ghost);

  // --- Innenleben: dünner Nebel im Volumen (lichter innen, dichter an der Oberfläche)
  const hazeGeo = new T.BufferGeometry();
  { const a = [], tmp = [0, 0, 0]; for (let q = 0; q < G3 && a.length < 21000; q++) if (OCC[q] > 235 && rnd() < 0.12) { cellCenter(q, tmp); a.push(tmp[0] + (rnd() - 0.5) * GRID.step, tmp[1] + (rnd() - 0.5) * GRID.step, tmp[2] + (rnd() - 0.5) * GRID.step); } hazeGeo.setAttribute("position", new T.Float32BufferAttribute(a, 3)); }
  const hazeMat = new T.PointsMaterial({ size: 0.006, color: 0x6f8cff, transparent: true, opacity: 0.07, depthWrite: false, depthTest: false, blending: T.AdditiveBlending, sizeAttenuation: true });
  const haze = new T.Points(hazeGeo, hazeMat); haze.renderOrder = 1; scene.add(haze);
  const glowMat = new T.SpriteMaterial({ map: radialTex(), color: 0x3a5fd9, transparent: true, opacity: 0.12, depthWrite: false, depthTest: false, blending: T.AdditiveBlending });
  const glow = new T.Sprite(glowMat); glow.scale.set(3.4, 2.8, 1); glow.position.set(-0.05, -0.05, 0); glow.renderOrder = -1; scene.add(glow);
  function radialTex() {
    const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return new T.CanvasTexture(c);
  }

  // --- Inbox-Wolke
  const inboxGeo = new T.BufferGeometry();
  { const a = []; const R = REG.inbox; for (let i = 0; i < 700; i++) { const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), g = Math.pow(rnd(), 0.9); a.push(R.c[0] + R.r[0] * g * Math.sin(ph) * Math.cos(th) * 1.5, R.c[1] + R.r[1] * g * Math.cos(ph) * 1.5, R.c[2] + R.r[2] * g * Math.sin(ph) * Math.sin(th) * 1.5); } inboxGeo.setAttribute("position", new T.Float32BufferAttribute(a, 3)); }
  const inboxMat = new T.PointsMaterial({ size: 0.008, color: 0xb8a4ff, transparent: true, opacity: 0.3, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true });
  scene.add(new T.Points(inboxGeo, inboxMat));

  // --- Knoten
  const P = layout();
  const nodeGeo = new T.BufferGeometry();
  const nCol = new Float32Array(N * 3), nSize = new Float32Array(N), nVis = new Float32Array(N), nHl = new Float32Array(N), nRing = new Float32Array(N), nPulse = new Float32Array(N), nPhase = new Float32Array(N);
  const sizeK = Math.max(0.5, Math.min(1, Math.sqrt(250 / N)));
  D.nodes.forEach((n, i) => {
    nSize[i] = sizeK * (n.wiki ? 1.0 : 0.62) * (0.75 + 0.32 * Math.log10(Math.max(n.size || 1000, 500) / 500));
    if (n.type === "ueberblick") nSize[i] = 1.25;
    nRing[i] = n.status === "konflikt" ? 2 : n.status === "pruef" ? 1 : 0;
    nPulse[i] = n.fresh ? 1 : 0; nPhase[i] = rnd() * 6.28; nVis[i] = 1;
  });
  nodeGeo.setAttribute("position", new T.BufferAttribute(P, 3));
  const aCol = new T.BufferAttribute(nCol, 3), aVis = new T.BufferAttribute(nVis, 1), aHl = new T.BufferAttribute(nHl, 1);
  nodeGeo.setAttribute("color", aCol); nodeGeo.setAttribute("size", new T.BufferAttribute(nSize, 1)); nodeGeo.setAttribute("vis", aVis); nodeGeo.setAttribute("hl", aHl);
  nodeGeo.setAttribute("ring", new T.BufferAttribute(nRing, 1)); nodeGeo.setAttribute("pulse", new T.BufferAttribute(nPulse, 1)); nodeGeo.setAttribute("phase", new T.BufferAttribute(nPhase, 1));
  const nodeMat = new T.ShaderMaterial({
    uniforms: { ...U, uRingK: { value: new T.Color() }, uRingP: { value: new T.Color() }, uCare: { value: 0 }, uHalo: { value: 0.4 + 0.6 * DENSE } },
    vertexShader: `
      attribute vec3 color; attribute float size, vis, hl, ring, pulse, phase;
      uniform float uPR, uTime, uScale, uCare, uMotion; varying vec3 vC; varying float vA, vRing, vHl, vPulse;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float p = pulse > 0.5 ? (uMotion > 0.5 ? 0.5 + 0.5 * sin(uTime * 2.4 + phase) : 0.6) : 0.0;
        vPulse = p;
        float s = size * (1.0 + 0.55 * hl + 0.3 * p) * (ring > 0.5 ? 1.0 + 0.6 * uCare : 1.0);
        gl_PointSize = uPR * uScale * s * 70.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
        vC = color; vA = vis; vRing = ring; vHl = hl;
      }`,
    fragmentShader: `
      uniform vec3 uRingK, uRingP; uniform float uLight, uCare, uHalo; varying vec3 vC; varying float vA, vRing, vHl, vPulse;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float core = smoothstep(0.3, 0.16, d);
        float halo = (exp(-d * d * 7.0) * (0.5 + 0.5 * vHl) + vPulse * exp(-d * d * 3.0) * 0.5) * uHalo;
        vec3 c = vC * halo * 1.1 + mix(vC, vec3(1.0), 0.75) * core;
        float a = max(core, halo);
        if (uLight > 0.5) { c = mix(vC, vec3(1.0), core * 0.25); a = max(core, halo * 0.3); }
        if (vRing > 0.5) {
          vec3 rc = vRing > 1.5 ? uRingK : uRingP;
          float r = smoothstep(0.11, 0.0, abs(d - 0.66)) * (0.75 + 0.25 * uCare);
          c = mix(c, rc * (uLight > 0.5 ? 1.0 : 1.6), r); a = max(a, r);
        }
        gl_FragColor = vec4(c, a * vA);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending,
  });
  const nodes = new T.Points(nodeGeo, nodeMat); nodes.renderOrder = 3; scene.add(nodes);

  // --- Nervenbahnen: gebündelt über Regions-Knotenpunkte, mit gelegentlichen Impulsen
  const SEG = N > 1000 ? 16 : 22;
  const ePos = new Float32Array(E * SEG * 6), eCol = new Float32Array(E * SEG * 6), eT = new Float32Array(E * SEG * 2), eA = new Float32Array(E * SEG * 2), eHl = new Float32Array(E * SEG * 2), ePh = new Float32Array(E * SEG * 2);
  const eBase = new Float32Array(E), eVisCur = new Float32Array(E), eHlCur = new Float32Array(E), eVisT = new Float32Array(E), eHlT = new Float32Array(E);
  const CENTER = new T.Vector3(-0.08, 0.05, 0);
  const hubOf = (i) => new T.Vector3(...nodeHub[i]).lerp(CENTER, 0.35);
  D.edges.forEach((e, k) => {
    const a = new T.Vector3(P[e.a*3], P[e.a*3+1], P[e.a*3+2]), b = new T.Vector3(P[e.b*3], P[e.b*3+1], P[e.b*3+2]);
    let curve;
    if (D.nodes[e.a].area !== D.nodes[e.b].area || (beidseitig(D.nodes[e.a].area) && nodeSide[e.a] !== nodeSide[e.b])) {
      const ha = hubOf(e.a), hb = hubOf(e.b);
      const lift = new T.Vector3(0, 0.12 + a.distanceTo(b) * 0.1, 0);
      curve = new T.CubicBezierCurve3(a, a.clone().lerp(ha, 0.8).add(lift), b.clone().lerp(hb, 0.8).add(lift), b);
    } else {
      const mid = a.clone().add(b).multiplyScalar(0.5), dist = a.distanceTo(b);
      const ctrl = mid.lerp(new T.Vector3(...(D.nodes[e.a]._g || [0, 0, 0])), 0.35); ctrl.y += dist * 0.15;
      curve = new T.QuadraticBezierCurve3(a, ctrl, b);
    }
    const pts = curve.getPoints(SEG), ph = rnd();
    eBase[k] = e.kind === "quelle" ? 0.55 : 1; eVisCur[k] = eVisT[k] = 1;
    for (let s = 0; s < SEG; s++) for (let h = 0; h < 2; h++) {
      const p = pts[s + h], v = (k * SEG + s) * 2 + h;
      ePos[v*3] = p.x; ePos[v*3+1] = p.y; ePos[v*3+2] = p.z;
      eT[v] = (s + h) / SEG; ePh[v] = ph; eA[v] = 1;
    }
  });
  const edgeGeo = new T.BufferGeometry();
  edgeGeo.setAttribute("position", new T.BufferAttribute(ePos, 3));
  const aeCol = new T.BufferAttribute(eCol, 3), aeA = new T.BufferAttribute(eA, 1), aeHl = new T.BufferAttribute(eHl, 1);
  edgeGeo.setAttribute("color", aeCol); edgeGeo.setAttribute("t", new T.BufferAttribute(eT, 1)); edgeGeo.setAttribute("ea", aeA); edgeGeo.setAttribute("ehl", aeHl); edgeGeo.setAttribute("ph", new T.BufferAttribute(ePh, 1));
  const edgeMat = new T.ShaderMaterial({
    uniforms: { ...U, uBase: { value: 0.12 }, uSignal: { value: 1 } },
    vertexShader: `
      attribute vec3 color; attribute float t, ea, ehl, ph; varying vec3 vC; varying float vA;
      uniform float uTime, uBase, uSignal, uMotion;
      void main(){
        float cyc = uTime * 0.13 + ph * 7.0;
        float s = fract(cyc);
        float gate = step(0.8, fract(sin(floor(cyc) * 12.9898 + ph * 78.233) * 43758.5453));
        float sig = smoothstep(0.07, 0.0, abs(t - s)) * uSignal * uMotion * clamp(gate + ehl, 0.0, 1.0);
        float ends = smoothstep(0.0, 0.12, t) * smoothstep(1.0, 0.88, t);
        vA = ea * (uBase * (0.35 + 0.65 * ends) * (1.0 + 2.6 * ehl) + sig * (0.5 + 0.9 * ehl));
        vC = color * (1.0 + 0.6 * ehl);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ gl_FragColor = vec4(vC, vA); }`,
    transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending,
  });
  const edges = new T.LineSegments(edgeGeo, edgeMat); edges.renderOrder = 2; edges.frustumCulled = false; scene.add(edges);

  // ================================================================== theme
  let light = false;
  function applyTheme() {
    light = root.dataset.theme === "light";
    U.uLight.value = light ? 1 : 0;
    scene.background = bgTexture(light);
    const blend = light ? T.NormalBlending : T.AdditiveBlending;
    [brainMat, ghostMat, nodeMat, edgeMat, hazeMat, inboxMat, glowMat].forEach((m) => { m.blending = blend; m.needsUpdate = true; });
    shellMat.uniforms.uCol.value.set("#5a7dff");
    brainUniforms.uColA.value.set(light ? "#9aa5c4" : "#27357a");
    brainUniforms.uColB.value.set(light ? "#2c3654" : "#c8d2f0");
    brainUniforms.uOpacity.value = light ? 1.1 : 1;
    ghostMat.uniforms.uGhost.value = light ? 0.0 : 0.035;
    hazeMat.opacity = light ? 0 : 0.07; glowMat.opacity = light ? 0 : 0.07;
    inboxMat.color.set(light ? "#6e55d8" : "#b8a4ff");
    edgeMat.uniforms.uBase.value = (light ? 0.22 : 0.12) * DENSE;
    nodeMat.uniforms.uRingK.value.set(css("--konflikt")); nodeMat.uniforms.uRingP.value.set(css("--pruef"));
    bloom.enabled = !light;
    D.nodes.forEach((n, i) => { const c = new T.Color(areaColor(n.area)); nCol[i*3] = c.r; nCol[i*3+1] = c.g; nCol[i*3+2] = c.b; });
    aCol.needsUpdate = true;
    const mixC = new T.Color(light ? "#33405f" : "#c9d6ff");
    D.edges.forEach((e, k) => {
      const ca = new T.Color(areaColor(D.nodes[e.a].area)), cb = new T.Color(areaColor(D.nodes[e.b].area));
      for (let s = 0; s < SEG; s++) for (let h = 0; h < 2; h++) {
        const v = (k * SEG + s) * 2 + h, c = ca.clone().lerp(cb, (s + h) / SEG).lerp(mixC, 0.35);
        eCol[v*3] = c.r; eCol[v*3+1] = c.g; eCol[v*3+2] = c.b;
      }
    });
    aeCol.needsUpdate = true;
    buildRegionLabels(); drawHist();
  }

  // ================================================================== state
  const S = { areas: new Set(Object.keys(AREAS)), types: new Set(Object.keys(TYPES)), status: new Set(["ok", "pruef", "konflikt"]), day: days, selected: -1, hover: -1, hits: [], query: "", pathA: -1, path: [], care: false, mode: "none", tVis: new Float32Array(N), tHl: new Float32Array(N) };
  const nodeOn = new Uint8Array(N);
  function recompute() {
    for (let i = 0; i < N; i++) { const n = D.nodes[i]; nodeOn[i] = S.areas.has(n.area) && S.types.has(n.type in TYPES ? n.type : "thema") && S.status.has(n.status) && n.day <= S.day ? 1 : 0; }
    const focus = new Map();
    let mode = "none";
    if (S.path.length) { mode = "path"; S.path.forEach((i) => focus.set(i, 1)); }
    else if (S.selected >= 0) { mode = "sel"; focus.set(S.selected, 1); adj[S.selected].forEach((j) => focus.set(j, 0.7)); }
    else if (S.hits.length) { mode = "search"; S.hits.forEach((h, r) => focus.set(h.i, r === 0 ? 1 : 0.75)); }
    else if (S.care) { mode = "care"; D.nodes.forEach((n, i) => { if (n.status !== "ok") focus.set(i, 1); }); }
    S.mode = mode; S.focus = focus;
    for (let i = 0; i < N; i++) { const f = focus.get(i); S.tVis[i] = nodeOn[i] ? (mode === "none" ? 0.92 : f !== undefined ? 1 : 0.12) : 0; S.tHl[i] = nodeOn[i] && f !== undefined ? f : 0; }
    const pathEdge = new Set();
    for (let k = 0; k + 1 < S.path.length; k++) { const a = S.path[k], b = S.path[k + 1]; for (const ei of out[a].concat(inn[a])) { const e = D.edges[ei]; if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) pathEdge.add(ei); } }
    D.edges.forEach((e, k) => {
      const on = nodeOn[e.a] && nodeOn[e.b];
      let v = on ? eBase[k] : 0, h = 0;
      if (on && mode === "sel") { if (e.a === S.selected || e.b === S.selected) h = 1; else v *= 0.06; }
      else if (on && mode === "path") { if (pathEdge.has(k)) h = 1.4; else v *= 0.04; }
      else if (on && mode === "search") { const fa = focus.has(e.a), fb = focus.has(e.b); if (fa && fb) h = 0.6; else v *= fa || fb ? 0.3 : 0.06; }
      else if (on && mode === "care") v *= 0.12;
      eVisT[k] = v; eHlT[k] = h;
    });
    const dim = mode === "none" ? 0 : 0.75;
    brainUniforms.uDim.value = dim; shellMat.uniforms.uDim.value = dim;
    nodeMat.uniforms.uCare.value = S.care ? 1 : 0;
    edgeMat.uniforms.uSignal.value = (mode === "none" ? 1 : 0.7) * DENSE;
    updateLabelsSet(); updateStats();
    for (const r of regionEls) if (!isWolke(r.a)) r.b.textContent = D.nodes.filter((n, i) => nodeOn[i] && n.area === r.a).length;
  }
  let snap = !!SHOT;
  function animateState(dt) {
    const k = snap || RM ? 1 : 1 - Math.pow(0.0008, dt);
    let ch = false;
    for (let i = 0; i < N; i++) {
      const v = nVis[i] + (S.tVis[i] - nVis[i]) * k, h = nHl[i] + (S.tHl[i] - nHl[i]) * k;
      if (Math.abs(v - nVis[i]) > 1e-4 || Math.abs(h - nHl[i]) > 1e-4) ch = true;
      nVis[i] = v; nHl[i] = h;
    }
    if (ch) { aVis.needsUpdate = true; aHl.needsUpdate = true; }
    let ce = false;
    for (let e = 0; e < E; e++) {
      const v = eVisCur[e] + (eVisT[e] - eVisCur[e]) * k, h = eHlCur[e] + (eHlT[e] - eHlCur[e]) * k;
      if (Math.abs(v - eVisCur[e]) > 1e-4 || Math.abs(h - eHlCur[e]) > 1e-4) {
        ce = true; eVisCur[e] = v; eHlCur[e] = h;
        const o = e * SEG * 2; for (let s = 0; s < SEG * 2; s++) { eA[o + s] = v; eHl[o + s] = h; }
      }
    }
    if (ce) { aeA.needsUpdate = true; aeHl.needsUpdate = true; }
  }

  // ================================================================== camera
  let fly = null, lastInput = performance.now();
  function touch() { lastInput = performance.now(); controls.autoRotate = false; }
  function flyTo(target, dist, dirOverride) {
    const to = new T.Vector3().copy(target);
    const dir = (dirOverride || camera.position.clone().sub(controls.target)).normalize();
    const pos = to.clone().add(dir.multiplyScalar(dist));
    controls.autoRotate = false; lastInput = performance.now();
    if (snap || RM) { camera.position.copy(pos); controls.target.copy(to); controls.update(); return; }
    fly = { t: 0, dur: 1.1, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: to };
  }
  const nodePos = (i) => new T.Vector3(P[i*3], P[i*3+1], P[i*3+2]);
  function flyToNode(i) { flyTo(nodePos(i), isMobile() ? 4.2 : 3.3); }
  function frameNode(i) {
    const box = new T.Box3().expandByPoint(nodePos(i));
    adj[i].forEach((j) => { if (nodeOn[j]) box.expandByPoint(nodePos(j)); });
    const c = box.getCenter(new T.Vector3()).lerp(nodePos(i), 0.5), r = box.getSize(new T.Vector3()).length();
    flyTo(c, Math.max(isMobile() ? 2.6 : 1.9, r * 1.9));
  }
  function flyHome() { flyTo(HOME.target, HOME.pos.distanceTo(HOME.target), HOME.pos.clone().sub(HOME.target)); }

  // ================================================================== labels
  const labelsEl = $("#labels");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("class", "leaders"); labelsEl.appendChild(svg);
  const labelPool = new Map();
  function updateLabelsSet() {
    const L = new Map();
    const add = (i, cls) => { if (i < 0 || !nodeOn[i]) return; if (!L.has(i) || cls === "main") L.set(i, cls); };
    if (S.mode === "sel") { [...adj[S.selected]].filter((j) => nodeOn[j]).sort((a, b) => nSize[b] - nSize[a]).slice(0, isMobile() ? 4 : 12).forEach((j) => add(j, "minor")); add(S.selected, "main"); }
    if (S.mode === "path") S.path.forEach((i, k) => add(i, k === 0 || k === S.path.length - 1 ? "main" : ""));
    if (S.mode === "search") S.hits.slice(0, isMobile() ? 3 : 7).forEach((h, r) => add(h.i, r === 0 ? "main" : ""));
    if (S.mode === "care") D.nodes.forEach((n, i) => { if (n.status !== "ok") add(i, ""); });
    if (S.pathA >= 0 && !S.path.length) add(S.pathA, "main");
    if (S.hover >= 0) add(S.hover, L.get(S.hover) === "main" ? "main" : "hover");
    const keep = new Set(L.keys());
    for (const [i, el] of labelPool) if (!keep.has(i)) { el.remove(); labelPool.delete(i); }
    for (const [i, cls] of L) {
      let el = labelPool.get(i);
      if (!el) { el = document.createElement("div"); labelsEl.appendChild(el); labelPool.set(i, el); el.textContent = D.nodes[i].title; }
      if (el._cls !== cls) { el.className = "lbl " + cls; el._cls = cls; el._w = 0; }
    }
  }
  let regionEls = [];
  function buildRegionLabels() {
    regionEls.forEach((r) => { r.el.remove(); r.line.remove(); r.dot.remove(); });
    const count = {}; D.nodes.forEach((n) => (count[n.area] = (count[n.area] || 0) + 1));
    regionEls = Object.entries(regionLabelCfg()).map(([a, cfg]) => {
      const el = document.createElement("div"); el.className = "region"; el.style.color = areaColor(a);
      el.innerHTML = `${esc(AREAS[a].name)}<b>${isWolke(a) ? (D.inbox ? D.inbox : "leer") : count[a] || 0}</b>`;
      labelsEl.appendChild(el);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line"); line.setAttribute("stroke", areaColor(a)); svg.appendChild(line);
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle"); dot.setAttribute("r", "2.2"); dot.setAttribute("fill", areaColor(a)); svg.appendChild(dot);
      return { a, el, line, dot, b: el.querySelector("b"), at: new T.Vector3(...cfg.at), dir: new T.Vector3(...cfg.dir).normalize(), free: !!cfg.free };
    });
  }
  // Silhouette im Bildschirm: max. Radius je Winkelsektor (aus einer Stichprobe der Rindenpunkte)
  const SIL_N = 900, silIdx = Array.from({ length: SIL_N }, (_, k) => Math.floor((k / SIL_N) * cloud.pos.length / 3));
  const BINS = 72, silR = new Float32Array(BINS);
  const v3 = new T.Vector3(), w3 = new T.Vector3();
  function toScreen(v, w, h) { v3.copy(v).project(camera); return { x: (v3.x * 0.5 + 0.5) * w, y: (-v3.y * 0.5 + 0.5) * h, z: v3.z }; }
  const rank = (el) => (el._cls === "main" ? 0 : el._cls === "hover" ? 1 : el._cls === "minor" ? 3 : 2);
  function placeLabels() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    // Hindernisse: hervorgehobene Lichtpunkte
    const obstacles = [];
    if (S.mode !== "none") for (const i of S.focus.keys()) { if (!nodeOn[i]) continue; const p = toScreen(w3.set(P[i*3], P[i*3+1], P[i*3+2]), w, h); obstacles.push([p.x - 7, p.y - 7, p.x + 7, p.y + 7, i]); }
    const placed = [];
    for (const sel of ["#results.open", "#panel:not([hidden])", "#filters", "#care:not([hidden])", ".top .search", "#timeline"]) { const el = document.querySelector(sel); if (el && el.offsetParent !== null) { const b = el.getBoundingClientRect(); if (b.width) placed.push([b.left - 4, b.top - 4, b.right + 4, b.bottom + 4]); } }
    const ov = (r, self) => placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) || obstacles.some((q) => q[4] !== self && r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
    const camD = camera.position.distanceTo(controls.target);
    const order = [...labelPool.entries()].sort((a, b) => rank(a[1]) - rank(b[1]));
    for (const [i, el] of order) {
      const p = toScreen(w3.set(P[i*3], P[i*3+1], P[i*3+2]), w, h);
      if (p.z > 1 || !nodeOn[i]) { el.style.opacity = 0; continue; }
      const bw = el._w || (el._w = el.offsetWidth), bh = el._cls === "main" ? 26 : 22, g = 9;
      const cands = [[p.x - bw / 2, p.y - g - bh], [p.x - bw / 2, p.y + g], [p.x + g + 2, p.y - bh / 2], [p.x - g - 2 - bw, p.y - bh / 2]];
      let ok = null;
      for (const [x, y] of cands) { const r = [x - 3, y - 2, x + bw + 3, y + bh + 2]; if (!ov(r, i) && x > 4 && x + bw < w - 4) { ok = [x, y, r]; break; } }
      if (!ok && el._cls === "main") { const [x, y] = cands[0]; ok = [x, y, [x, y, x + bw, y + bh]]; }
      let op = ok ? 1 : 0;
      if (el._cls === "minor") op *= Math.max(0, Math.min(1, (6.5 - camD) / 2.5));
      el.style.opacity = op;
      if (ok) { el.style.transform = `translate(${ok[0].toFixed(1)}px, ${ok[1].toFixed(1)}px)`; if (op > 0.05) placed.push(ok[2]); }
    }
    // Bereichs-Etiketten außerhalb der Silhouette mit Führungslinie
    const showRegions = S.mode === "none" && !isMobile() && !document.body.classList.contains("bare");
    svg.setAttribute("width", w); svg.setAttribute("height", h);
    if (!showRegions) { for (const r of regionEls) { r.el.style.opacity = 0; r.line.style.opacity = 0; r.dot.style.opacity = 0; } return; }
    const c = toScreen(w3.set(-0.05, -0.12, 0), w, h);
    silR.fill(0);
    for (const k of silIdx) {
      const p = toScreen(w3.set(cloud.pos[k*3], cloud.pos[k*3+1], cloud.pos[k*3+2]), w, h);
      const dx = p.x - c.x, dy = p.y - c.y, b = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
      const rr = Math.hypot(dx, dy); if (rr > silR[b]) silR[b] = rr;
    }
    const regPlaced = [];
    for (const r of regionEls) {
      const on = S.areas.has(r.a);
      const pa = toScreen(r.at, w, h);
      const pd = toScreen(w3.copy(r.at).addScaledVector(r.dir, 0.6), w, h);
      let ang = Math.atan2(pd.y - pa.y, pd.x - pa.x);
      const bw = r.el._w || (r.el._w = r.el.offsetWidth), bh = 16;
      let lx, ly;
      if (r.free) { lx = pa.x - bw / 2; ly = pa.y - 92; }
      else {
        // vom Bildschirm-Mittelpunkt aus in Richtung des Etiketts bis hinter die Silhouette
        const ax = pa.x - c.x, ay = pa.y - c.y;
        const ang2 = Math.atan2(ay + Math.sin(ang) * 400, ax + Math.cos(ang) * 400);
        let b = Math.floor(((ang2 + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
        const rad = Math.max(silR[b], silR[(b + 1) % BINS], silR[(b + BINS - 1) % BINS]) + 30;
        let ex = c.x + Math.cos(ang2) * rad, ey = c.y + Math.sin(ang2) * rad;
        lx = Math.cos(ang2) >= 0 ? ex + 4 : ex - bw - 4; ly = ey - bh / 2;
        for (let t = 0; t < 6 && regPlaced.some((q) => lx < q[2] && lx + bw > q[0] && ly < q[3] && ly + bh > q[1]); t++) { ly += Math.sin(ang2) >= 0 ? 18 : -18; }
        r.line.setAttribute("x1", pa.x); r.line.setAttribute("y1", pa.y); r.line.setAttribute("x2", Math.cos(ang2) >= 0 ? lx - 4 : lx + bw + 4); r.line.setAttribute("y2", ly + bh / 2);
        r.dot.setAttribute("cx", pa.x); r.dot.setAttribute("cy", pa.y);
      }
      regPlaced.push([lx, ly, lx + bw, ly + bh]);
      r.el.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px)`;
      const op = on ? 1 : 0;
      r.el.style.opacity = op * 0.92; r.line.style.opacity = r.free ? 0 : op * 0.4; r.dot.style.opacity = r.free ? 0 : op * 0.8;
    }
  }

  // ================================================================== picking + input
  function pick(cx, cy, radius = 16) {
    const rect = canvas.getBoundingClientRect(), w = rect.width, h = rect.height;
    let best = -1, bd = radius * radius;
    for (let i = 0; i < N; i++) {
      if (!nodeOn[i] || nVis[i] < 0.08) continue;
      v3.set(P[i*3], P[i*3+1], P[i*3+2]).project(camera);
      if (v3.z > 1) continue;
      const x = (v3.x * 0.5 + 0.5) * w + rect.left, y = (-v3.y * 0.5 + 0.5) * h + rect.top;
      const d = (x - cx) ** 2 + (y - cy) ** 2 - (nHl[i] > 0.5 ? 60 : 0);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  let down = null;
  canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; touch(); hideHint(); });
  canvas.addEventListener("wheel", touch, { passive: true });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || e.buttons) return;
    const i = pick(e.clientX, e.clientY);
    if (i !== S.hover) { S.hover = i; canvas.style.cursor = i >= 0 ? "pointer" : ""; updateLabelsSet(); }
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const i = pick(e.clientX, e.clientY, e.pointerType === "mouse" ? 16 : 26);
    if (e.shiftKey && i >= 0) return pathClick(i);
    if (i >= 0) select(i); else if (S.selected >= 0 || S.path.length) clearSelection();
  });
  canvas.addEventListener("dblclick", (e) => { if (pick(e.clientX, e.clientY) < 0) resetAll(); });

  // ================================================================== markdown (markdown.js: alles escaped, nur eigene Tags, nur #seite=/http(s)-Links)
  const esc = window.BrainMarkdown.escape;
  // Wiki-Link-Ziel → Knoten. Zuerst die von daten.mjs per resolveLink vorberechneten Ziele der Seite (dieselbe
  // Auflösung wie Kanten und Lint: exakt, +.md, <wiki>/…, Teilpfad; Wiki-Ordner bevorzugt), danach als Zusatz
  // Titel/Name (byName). Fehlt linkZiele (alte data.js), gilt Pfad-ID und byName. Bereichsfarbe als Klasse.
  const FARB_KLASSE = new Set(["blau", "orange", "gruen", "gelb", "rot", "lila", "grau", "neutral"]);
  const eigen = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
  function linkZielFuer(seite) {
    return (name) => {
      let j = eigen(seite.linkZiele, name) ? idx.get(seite.linkZiele[name]) : undefined;
      if (j === undefined && !seite.linkZiele) j = idx.get(name) ?? idx.get(name + ".md");
      if (j === undefined) j = byName.get(String(name).toLowerCase());
      if (j === undefined) return null;
      const n = D.nodes[j], farbe = AREAS[n.area]?.farbe;
      return { id: n.id, text: n.title, klasse: "f-" + (FARB_KLASSE.has(farbe) ? farbe : "neutral") };
    };
  }
  const renderMarkdown = (n) => window.BrainMarkdown.render(n.body, linkZielFuer(n), { titel: n.title });

  // ================================================================== selection + panel
  const panel = $("#panel"), panelBody = $("#panelBody");
  let tab = "seite";
  const fmtDate = (d) => (d ? d.slice(8, 10) + "." + d.slice(5, 7) + "." + d.slice(0, 4) : "—");
  function linkItem(j, extra = "") {
    const n = D.nodes[j];
    return `<li data-i="${j}"><span class="dotc" style="color:${areaColor(n.area)}"></span><span class="t">${esc(n.title)}</span><span class="k">${extra || esc(TYPES[n.type] || n.type)}</span></li>`;
  }
  // Ausstehende entprellte Suche und verzögerten Suchflug verwerfen — eine Auswahl/ein Weg hat Vorrang
  function stopSearchTimers() { clearTimeout(qTimer); qTimer = 0; clearTimeout(flyTimer); flyTimer = 0; }
  function select(i, opts = {}) {
    stopSearchTimers();
    S.selected = i; S.path = []; S.pathA = -1;
    if (!opts.keepHits) S.hits = [];
    recompute(); renderPanel(); if (!opts.noFly) flyToNode(i);
    closeResults(); setHash(D.nodes[i].id);
  }
  function clearSelection() { S.selected = -1; S.path = []; S.pathA = -1; panel.hidden = true; careEl.hidden = !S.care; setHash(null); recompute(); }
  function setHash(id) { if (SHOT) return; try { history.replaceState(null, "", id ? "#seite=" + encodeURIComponent(id) : location.pathname + location.search); } catch {} }
  function renderPanel() {
    if (S.path.length) return renderPathPanel();
    const i = S.selected; if (i < 0) { panel.hidden = true; return; }
    const n = D.nodes[i];
    const outs = out[i].filter((k) => D.edges[k].kind === "link").map((k) => D.edges[k].b);
    const ins = inn[i].filter((k) => D.edges[k].kind === "link").map((k) => D.edges[k].a);
    const srcs = n.quellen.map((q) => idx.get(q)).filter((j) => j !== undefined);
    const used = (n.usedIn || []).map((q) => idx.get(q)).filter((j) => j !== undefined);
    const conn = (n.wiki ? srcs.length : used.length) + outs.length + ins.length;
    const list = (title, arr, extra) => `<div class="links"><h4><span>${title}</span><span>${arr.length}</span></h4>${arr.length ? `<ul>${arr.map((j) => linkItem(j, extra && extra(j))).join("")}</ul>` : `<div class="muted">keine</div>`}</div>`;
    const status = n.status !== "ok" ? `<div class="status-box ${n.status}"><span class="ring"></span><div><b>${n.status === "konflikt" ? "Offener Konflikt" : "Prüfbedürftig"}</b><br>${esc(n.statusNote || "")}</div></div>` : "";
    const body = n.body ? renderMarkdown(n) : `<p class="muted">${esc(n.desc || "")}</p>`;
    panelBody.innerHTML = `
      <div class="p-kicker"><span class="area" style="color:${areaColor(n.area)}"><span class="dotc" style="width:6px;height:6px"></span>${esc(AREAS[n.area]?.name || n.area)}</span><span class="sep">/</span><span>${esc(TYPES[n.type] || n.type)}</span>${n.fresh ? '<span class="sep">/</span><span class="fresh">frisch</span>' : ""}</div>
      <h2>${esc(n.title)}</h2>
      ${n.wiki && n.desc ? `<p class="desc">${esc(n.desc)}</p>` : ""}
      ${status}
      <dl class="facts"><div><dt>Stand</dt><dd>${n.rev ? "rev " + n.rev : "—"}</dd></div><div><dt>Seit</dt><dd>${fmtDate(n.added)}</dd></div><div><dt>Geändert</dt><dd>${fmtDate(n.changed)}</dd></div></dl>
      <div class="p-actions"><button class="btn" id="btnFocus"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><circle cx="12" cy="12" r="2.5"/></svg>Fokus</button><span class="path" title="${esc(n.id)}">${esc(n.id.length > 52 ? "…" + n.id.slice(-51) : n.id)}</span></div>
      <div class="tabs" role="tablist"><button role="tab" data-tab="seite" aria-selected="${tab === "seite"}">Seite</button><button role="tab" data-tab="links" aria-selected="${tab === "links"}">Verbindungen <span>${conn}</span></button></div>
      <div class="tabpane" ${tab === "seite" ? "" : "hidden"}><article class="md">${body}</article></div>
      <div class="tabpane" ${tab === "links" ? "" : "hidden"}>
        ${n.wiki ? list("Quellen", srcs, () => "Rohquelle") : list("Eingearbeitet in", used)}
        ${list("Verweist auf", outs)}
        ${list("Verlinkt von", ins)}
      </div>
      <div class="p-foot"><span><kbd>Shift</kbd>Klick: Weg zu einer zweiten Seite</span><span><kbd>Esc</kbd>zurück</span></div>`;
    panel.hidden = false; panel.scrollTop = 0; careEl.hidden = true;
  }
  panelBody.addEventListener("click", (e) => {
    const tb = e.target.closest("[data-tab]"); if (tb) { tab = tb.dataset.tab; renderPanel(); return; }
    if (e.target.closest("#btnFocus")) { if (S.selected >= 0) frameNode(S.selected); return; }
    // Wiki-Links aus markdown.js: <a class="wl" href="#seite=…"> — direkt auswählen statt über den Hash
    const wl = e.target.closest('a.wl[href^="#seite="]');
    if (wl) {
      e.preventDefault();
      let id = null; try { id = decodeURIComponent(wl.getAttribute("href").slice("#seite=".length)); } catch {}
      const j = id === null ? undefined : idx.get(id); if (j !== undefined) select(j);
      return;
    }
    const li = e.target.closest("[data-i]"); if (li) { e.preventDefault(); select(Number(li.dataset.i)); }
  });
  $("#panelClose").addEventListener("click", () => clearSelection());

  function shortest(a, b) {
    const prev = new Int32Array(N).fill(-1); prev[a] = a; const q = [a];
    while (q.length) { const x = q.shift(); if (x === b) break; for (const y of adj[x]) if (prev[y] < 0 && nodeOn[y]) { prev[y] = x; q.push(y); } }
    if (prev[b] < 0) return [];
    const p = [b]; let x = b; while (x !== a) { x = prev[x]; p.push(x); } return p.reverse();
  }
  function pathClick(i) {
    const a = S.selected >= 0 ? S.selected : S.pathA;
    if (a < 0 || a === i) { S.pathA = i; S.selected = -1; S.path = []; recompute(); return; }
    setPath(a, i);
  }
  function setPath(a, b) {
    stopSearchTimers();
    S.path = shortest(a, b); S.pathEnds = [a, b]; S.selected = -1; S.pathA = -1;
    recompute(); renderPathPanel();
    if (S.path.length) {
      const box = new T.Box3(); S.path.forEach((i) => box.expandByPoint(nodePos(i)));
      flyTo(box.getCenter(new T.Vector3()), Math.max(isMobile() ? 4.4 : 3.6, box.getSize(new T.Vector3()).length() * 2.2));
    }
  }
  function renderPathPanel() {
    const [a, b] = S.pathEnds, p = S.path;
    panelBody.innerHTML = `
      <div class="p-kicker"><span>Weg</span><span class="sep">/</span><span>${p.length ? p.length - 1 + " Schritte" : "keine Verbindung"}</span></div>
      <h2>${esc(D.nodes[a].title)} <span class="arrow">→</span> ${esc(D.nodes[b].title)}</h2>
      <p class="desc">${p.length ? "Kürzeste Verbindung über Links und Quellen." : "Zwischen diesen Seiten gibt es im sichtbaren Bereich keine Verbindung."}</p>
      <div class="links"><ul class="route">${p.map((j) => linkItem(j)).join("")}</ul></div>
      <div class="p-foot"><span><kbd>Esc</kbd>zurück</span></div>`;
    panel.hidden = false; careEl.hidden = true;
  }

  // ================================================================== search (suche.js: BM25 wie brain search, Tippfehler + Präfix beim Tippen)
  const qEl = $("#q"), resEl = $("#results");
  // Treffer → Knotenindex; filter blendet ausgeblendete Knoten vor dem Kürzen aus
  function search(query, n, filter) {
    return window.BrainSuche.suche(D.nodes, query, n, filter ? { filter: (_, i) => filter(i) } : undefined)
      .map((h) => ({ i: idx.get(h.id), s: h.score, auszug: h.auszug, begriffe: h.begriffe }))
      .filter((h) => h.i !== undefined);
  }
  const hl = (text, h) => window.BrainSuche.hervorheben(text, h.begriffe);
  let active = 0, flyTimer = 0, qTimer = 0;

  function runSearch(q, { fly = true } = {}) {
    clearTimeout(qTimer); qTimer = 0; // ein direkter Aufruf ersetzt eine wartende entprellte Suche
    S.query = q.trim();
    S.hits = S.query ? search(S.query, 60, (i) => nodeOn[i]) : [];
    active = 0;
    if (S.query) { S.selected = -1; S.path = []; panel.hidden = true; }
    recompute(); renderResults();
    clearTimeout(flyTimer);
    if (fly && S.hits.length) {
      const go = () => {
        if (!S.hits.length) return; // inzwischen ausgewählt oder Suche geleert
        const top = S.hits.slice(0, 6).map((h) => nodePos(h.i));
        const box = new T.Box3().setFromPoints(top), c = box.getCenter(new T.Vector3()).lerp(nodePos(S.hits[0].i), 0.5);
        flyTo(c, Math.max(isMobile() ? 4.2 : 3.4, box.getSize(new T.Vector3()).length() * 2.4));
      };
      snap ? go() : (flyTimer = setTimeout(go, 280));
    }
  }
  function renderResults() {
    if (!S.query) { resEl.classList.remove("open"); return; }
    const top = S.hits.slice(0, 7);
    resEl.innerHTML = top.length
      ? top.map((h, r) => { const n = D.nodes[h.i]; return `<li role="option" data-i="${h.i}" aria-selected="${r === active}"><span class="dotc" style="color:${areaColor(n.area)}"></span><span class="t">${hl(n.title, h)}</span><span class="k">${esc(TYPES[n.type] || n.type)}</span><span class="sn">${hl(h.auszug, h)}</span></li>`; }).join("") + (S.hits.length > 7 ? `<li class="empty">${S.hits.length - 7} weitere leuchten im Brain</li>` : "")
      : `<li class="empty">Kein Treffer</li>`;
    resEl.classList.add("open");
  }
  function closeResults() { resEl.classList.remove("open"); }
  // Entprellt: Suche erst 120 ms nach dem letzten Tastendruck (Enter/Pfeile holen sie sofort nach)
  qEl.addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => runSearch(qEl.value), 120); });
  qEl.addEventListener("focus", () => { if (S.query) renderResults(); hideHint(); touch(); });
  qEl.addEventListener("keydown", (e) => {
    if (qTimer && (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp")) runSearch(qEl.value);
    const n = Math.min(7, S.hits.length);
    if (e.key === "ArrowDown") { active = (active + 1) % Math.max(1, n); renderResults(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = (active - 1 + n) % Math.max(1, n); renderResults(); e.preventDefault(); }
    else if (e.key === "Enter" && S.hits[active]) { select(S.hits[active].i); qEl.blur(); }
  });
  resEl.addEventListener("pointerdown", (e) => { const li = e.target.closest("li[data-i]"); if (li) { e.preventDefault(); select(Number(li.dataset.i)); qEl.blur(); } });
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#search")) closeResults(); });

  // ================================================================== filters, care, timeline
  function chip(label, color, count, pressed, onClick, wide) {
    const b = document.createElement("button");
    b.className = "chip" + (wide ? " wide" : ""); b.setAttribute("aria-pressed", pressed);
    b.innerHTML = `<span>${color ? `<span class="sw" style="color:${color}"></span>` : ""}${label}</span>${count !== null ? `<span class="n">${count}</span>` : ""}`;
    b.addEventListener("click", () => onClick(b));
    return b;
  }
  function toggleSet(set, key, b) { if (set.has(key)) set.delete(key); else set.add(key); b.setAttribute("aria-pressed", set.has(key)); recompute(); if (S.query) runSearch(qEl.value, { fly: false }); }
  function buildFilters() {
    const cnt = (f) => D.nodes.filter(f).length;
    const fa = $("#fArea"); fa.innerHTML = "";
    // Zentrum nur, wenn es Seiten hat; Reihenfolge wie in den Daten (Cluster aus der Config, dann Archiv, Inbox)
    D.areas.filter((a) => a.id !== "zentrum" || cnt((n) => n.area === "zentrum")).forEach(({ id: a }) => fa.appendChild(chip(esc(AREAS[a].name), areaColor(a), isWolke(a) ? D.inbox : cnt((n) => n.area === a), S.areas.has(a), (b) => toggleSet(S.areas, a, b), true)));
    const ft = $("#fType"); ft.innerHTML = "";
    ["thema", "entitaet", "quelle", "synthese", "notiz"].forEach((t) => ft.appendChild(chip(TYPES[t], null, cnt((n) => n.type === t), S.types.has(t), (b) => toggleSet(S.types, t, b))));
    const fs = $("#fStatus"); fs.innerHTML = "";
    [["konflikt", "Konflikt", "--konflikt"], ["pruef", "Prüfbedürftig", "--pruef"], ["ok", "In Ordnung", "--fg-3"]].forEach(([k, l, v]) => fs.appendChild(chip(l, css(v), cnt((n) => n.status === k), S.status.has(k), (b) => toggleSet(S.status, k, b), true)));
  }
  $("#btnFilter").addEventListener("click", (e) => { const f = $("#filters"); f.classList.toggle("open"); e.currentTarget.setAttribute("aria-pressed", f.classList.contains("open")); });

  const careEl = $("#care");
  function buildCare() {
    const items = D.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.status !== "ok").sort((a) => (a.n.status === "konflikt" ? -1 : 1));
    $("#careList").innerHTML = items.length ? items.map(({ n, i }) => `<li data-i="${i}"><span class="ring" style="color:${css(n.status === "konflikt" ? "--konflikt" : "--pruef")}"></span><span>${esc(n.title)}<small>${n.status === "konflikt" ? "Konflikt offen" : "prüfbedürftig"}</small></span></li>`).join("") : `<li class="none">Keine offenen Befunde</li>`;
    $("#careFresh").textContent = `${D.nodes.filter((n) => n.fresh).length} Seiten in den letzten 2 Tagen eingearbeitet — sie pulsieren.`;
    const dot = $("#careDot"); dot.classList.toggle("on", items.length > 0); dot.classList.toggle("red", items.some(({ n }) => n.status === "konflikt"));
  }
  $("#careList").addEventListener("click", (e) => { const li = e.target.closest("li[data-i]"); if (li) select(Number(li.dataset.i)); });
  function setCare(on) {
    S.care = on; careEl.hidden = !on; $("#btnCare").setAttribute("aria-pressed", on);
    if (on) { stopSearchTimers(); S.selected = -1; S.path = []; panel.hidden = true; S.hits = []; S.query = ""; qEl.value = ""; closeResults(); flyHome(); }
    recompute();
  }
  $("#btnCare").addEventListener("click", () => setCare(!S.care));

  const tl = $("#tl"), tlEl = $("#timeline");
  tl.max = days; tl.value = days;
  $("#tlFirst").textContent = fmtDate(D.first).slice(0, 6); $("#tlLast").textContent = fmtDate(D.last).slice(0, 6);
  function drawHist() {
    const c = $("#tlHist"); const w = c.clientWidth || 400, h = c.clientHeight || 22; c.width = w * DPR; c.height = h * DPR;
    const g = c.getContext("2d"); g.scale(DPR, DPR); g.clearRect(0, 0, w, h);
    const per = new Array(days + 1).fill(0); D.nodes.forEach((n) => per[Math.min(days, Math.max(0, n.day))]++);
    const mx = Math.max(...per, 1), bw = w / (days + 1);
    per.forEach((v, d) => { if (!v) return; const bh = Math.max(2, (v / mx) * (h - 2)); g.fillStyle = d <= S.day ? css("--fg-2") : css("--line-2"); g.globalAlpha = d <= S.day ? 0.75 : 1; g.fillRect(d * bw + bw * 0.2, h - bh, Math.max(1.5, bw * 0.6), bh); });
  }
  function setDay(d) {
    S.day = d; tl.value = d; tl.style.setProperty("--p", (d / days) * 100 + "%");
    $("#tlDate").textContent = fmtDate(new Date(tFirst + d * DAY).toISOString().slice(0, 10));
    $("#tlCount").textContent = `${D.nodes.filter((n) => n.day <= d).length} von ${N} Seiten`;
    recompute(); drawHist();
  }
  tl.addEventListener("input", () => { stopPlay(); setDay(Number(tl.value)); });
  let playing = null;
  function stopPlay() { if (playing) { clearInterval(playing); playing = null; tlEl.classList.remove("playing"); } }
  $("#tlPlay").addEventListener("click", () => {
    if (playing) return stopPlay();
    if (S.day >= days) setDay(0);
    tlEl.classList.add("playing");
    playing = setInterval(() => { if (S.day >= days) return stopPlay(); setDay(S.day + 1); }, 140);
  });

  // ================================================================== misc ui
  function updateStats() { $("#stats").textContent = `${nodeOn.reduce((a, v) => a + v, 0)} Seiten · ${D.edges.filter((e) => nodeOn[e.a] && nodeOn[e.b]).length} Verbindungen`; }
  let hintTimer = setTimeout(hideHint, 9000);
  function hideHint() { $("#hint").classList.add("gone"); clearTimeout(hintTimer); }
  $("#btnReset").addEventListener("click", () => resetAll());
  function resetAll() { stopPlay(); S.hits = []; S.query = ""; qEl.value = ""; closeResults(); S.selected = -1; S.path = []; S.pathA = -1; panel.hidden = true; setHash(null); if (S.care) setCare(false); setDay(days); flyHome(); }
  $("#btnTheme").addEventListener("click", () => { root.dataset.theme = light ? "dark" : "light"; try { localStorage.setItem("brain3d-theme", root.dataset.theme); } catch {} applyTheme(); buildFilters(); buildCare(); renderPanel(); renderResults(); });
  document.addEventListener("keydown", (e) => {
    touch();
    const typing = document.activeElement === qEl;
    if (e.key === "/" && !typing) { e.preventDefault(); qEl.focus(); qEl.select(); return; }
    if (e.key === "Escape") {
      if (typing) { if (qEl.value) { qEl.value = ""; runSearch(""); } else qEl.blur(); return; }
      if (S.path.length || S.pathA >= 0) { S.path = []; S.pathA = -1; panel.hidden = true; recompute(); return; }
      if (S.selected >= 0) { clearSelection(); if (S.query) { qEl.value = S.query; runSearch(S.query); } return; }
      if (S.care) { setCare(false); return; }
      if (S.query) { qEl.value = ""; runSearch(""); return; }
      flyHome(); return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "r" || e.key === "R") resetAll();
    if (e.key === "t" || e.key === "T") $("#btnTheme").click();
    if (e.key === "p" || e.key === "P") setCare(!S.care);
    if ((e.key === "f" || e.key === "F") && S.selected >= 0) frameNode(S.selected);
  });
  function fromHash() {
    const m = location.hash.match(/seite=([^&]+)/); if (!m) return;
    let id; try { id = decodeURIComponent(m[1]); } catch { return; } // kaputter Hash (z. B. %E0%A4) legt den Start nicht lahm
    const i = idx.get(id); if (i !== undefined && i !== S.selected) select(i);
  }
  window.addEventListener("hashchange", fromHash);

  // ================================================================== resize + loop
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h); bloom.resolution.set(w / 2, h / 2);
    camera.aspect = w / h; camera.fov = w / h < 0.8 ? 46 : 32; camera.updateProjectionMatrix();
    U.uScale.value = Math.min(1.25, Math.max(0.7, h / 1000));
    drawHist(); regionEls.forEach((r) => (r.el._w = 0));
  }
  window.addEventListener("resize", resize);
  mqMobile.addEventListener?.("change", resize);

  let viewOff = 0, viewOffY = 0, frames = 0, fpsT = 0;
  const clock = new T.Clock();
  function tick() {
    const dt = Math.min(0.05, clock.getDelta());
    U.uTime.value += dt;
    if (fly) {
      fly.t += dt / fly.dur; const k = fly.t >= 1 ? 1 : 1 - Math.pow(1 - fly.t, 3);
      camera.position.lerpVectors(fly.p0, fly.p1, k); controls.target.lerpVectors(fly.t0, fly.t1, k);
      if (fly.t >= 1) fly = null;
    }
    // Leerlauf: langsam drehen, sobald 8 s nichts passiert (nicht bei reduzierter Bewegung)
    if (!SHOT && !RM && !fly && !controls.autoRotate && performance.now() - lastInput > 8000 && document.activeElement !== qEl) controls.autoRotate = true;
    controls.update();
    const open = !panel.hidden, mob = isMobile();
    const wantX = open && !mob ? (panel.offsetWidth + 22) / 2 : 0, wantY = open && mob ? panel.offsetHeight / 2 - 40 : 0;
    const kk = snap || RM ? 1 : Math.min(1, dt * 6);
    viewOff += (wantX - viewOff) * kk; viewOffY += (wantY - viewOffY) * kk;
    if (Math.abs(viewOff) > 0.5 || Math.abs(viewOffY) > 0.5) { const w = canvas.clientWidth, h = canvas.clientHeight; camera.setViewOffset(w + viewOff * 2, h + viewOffY * 2, viewOff * 2, viewOffY * 2, w, h); } else camera.clearViewOffset();
    animateState(dt);
    if (!RM) { const br = 1 + Math.sin(U.uTime.value * 0.6) * 0.003; brain.scale.setScalar(br); ghost.scale.setScalar(br); }
    placeLabels();
    if (light) renderer.render(scene, camera); else composer.render();
    frames++; fpsT += dt; if (fpsT > 1) { window.__fps = frames / fpsT; frames = 0; fpsT = 0; }
    requestAnimationFrame(tick);
  }

  // ================================================================== boot
  resize(); applyTheme(); buildFilters(); buildCare(); setDay(days);
  if (!N) $("#emptyNote").hidden = false;
  if (SHOT) applyShot(); else fromHash();
  requestAnimationFrame(() => { $("#loading").classList.add("done"); snap = !!SHOT; });
  requestAnimationFrame(tick);
  window.__brain = { S, D, select, runSearch, setPath, setCare, setDay, search: (q) => search(q, 10).map((h) => D.nodes[h.i].title) };

  function applyShot() {
    hideHint();
    const id = (s) => D.nodes.findIndex((n) => n.id.includes(s));
    const q = params.get("q");
    if (q) { qEl.value = q; runSearch(qEl.value); }
    if (["select", "mobile-select", "light", "read"].includes(SHOT) && params.get("node")) { const i = id(params.get("node")); if (i >= 0) select(i); }
    if (SHOT === "links") { tab = "links"; renderPanel(); }
    if (SHOT === "path" && params.get("von") && params.get("nach")) setPath(id(params.get("von")), id(params.get("nach")));
    if (SHOT === "conflict") setCare(true);
    if (SHOT === "timeline") setDay(Math.round(days * 0.62));
    if (SHOT === "focus" && params.get("node")) { const i = id(params.get("node")); if (i >= 0) { select(i); frameNode(i); } }
    const az = params.get("az"), el = params.get("el");
    if (az || el) {
      const a = (Number(az || 22) * Math.PI) / 180, b = (Number(el || 14) * Math.PI) / 180, d = camera.position.distanceTo(controls.target) / Number(params.get("zoom") || 1);
      camera.position.set(controls.target.x + Math.sin(a) * Math.cos(b) * d, controls.target.y + Math.sin(b) * d, controls.target.z + Math.cos(a) * Math.cos(b) * d); controls.update();
    }
  }

  function addSynthetic(n) {
    const areas = D.areas.filter((x) => !FIXED[x.id]).map((x) => x.id), base = D.nodes.length;
    if (!areas.length) areas.push("zentrum");
    for (let i = 0; i < n; i++) {
      const a = areas[i % areas.length], g = a + "/s" + ((i >> 2) % 17);
      D.nodes.push({ id: `synth/${a}/${i}.md`, name: `test-${i}`, title: `Testseite ${i}`, area: a, group: g, wiki: i % 3 === 0, type: i % 3 === 0 ? "thema" : "notiz", desc: "", body: "", size: 2000, quellen: [], usedIn: [], added: D.first, changed: D.first, status: "ok" });
    }
    let r = 99; const rr = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
    for (let i = 0; i < n * 1.5; i++) {
      const x = base + Math.floor(rr() * n), nx = D.nodes[x];
      let y;
      if (rr() < 0.85) { do { y = base + Math.floor(rr() * n); } while (D.nodes[y].group !== nx.group); }
      else y = base + Math.floor(rr() * n);
      if (x !== y) D.edges.push({ s: nx.id, t: D.nodes[y].id, kind: "link" });
    }
  }
  function fail(msg, plain) { const l = document.getElementById("loading"); if (l) l.innerHTML = `<p style="color:#a7afc3;font:14px system-ui">${plain ? msg : "3D-Ansicht konnte nicht starten: " + msg + "."}</p>`; }
})();
