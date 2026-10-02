// Leser für FreeSurfer-Dateiformate (Oberfläche, Kurvatur, Annotation, MGZ) — nur für build-brain.mjs
import { gunzipSync } from "node:zlib";
export function readSurf(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xff || buf[2] !== 0xfe) throw new Error("keine FreeSurfer-Dreiecksfläche");
  let p = 3; while (!(buf[p] === 0x0a && buf[p + 1] === 0x0a)) p++; p += 2;
  const nv = buf.readInt32BE(p), nf = buf.readInt32BE(p + 4); p += 8;
  const v = new Float32Array(nv * 3); for (let i = 0; i < nv * 3; i++, p += 4) v[i] = buf.readFloatBE(p);
  const f = new Uint32Array(nf * 3); for (let i = 0; i < nf * 3; i++, p += 4) f[i] = buf.readInt32BE(p);
  return { v, f, nv, nf };
}
export function readCurv(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xff || buf[2] !== 0xff) throw new Error("kein neues Kurvatur-Format");
  const nv = buf.readInt32BE(3); let p = 15;
  const c = new Float32Array(nv); for (let i = 0; i < nv; i++, p += 4) c[i] = buf.readFloatBE(p);
  return c;
}
export function readAnnot(buf) {
  let p = 0; const rd = () => { const x = buf.readInt32BE(p); p += 4; return x; };
  const nv = rd(); const lab = new Int32Array(nv);
  for (let i = 0; i < nv; i++) { const vno = rd(), l = rd(); lab[vno] = l; }
  const names = new Map();
  if (rd()) {
    let n = rd();
    if (n < 0) { n = rd(); const len = rd(); p += len; const toRead = rd();
      for (let k = 0; k < toRead; k++) { rd(); const ln = rd(); const name = buf.toString("utf8", p, p + ln).replace(/\0+$/, ""); p += ln; const r = rd(), g = rd(), b = rd(), t = rd(); names.set(r + g * 256 + b * 65536 + t * 16777216, name); } }
    else { const len = rd(); p += len; for (let k = 0; k < n; k++) { const ln = rd(); const name = buf.toString("utf8", p, p + ln).replace(/\0+$/, ""); p += ln; const r = rd(), g = rd(), b = rd(), t = rd(); names.set(r + g * 256 + b * 65536 + t * 16777216, name); } }
  }
  return { lab, names };
}
export function readMgz(buf) {
  const b = gunzipSync(buf);
  const w = b.readInt32BE(4), h = b.readInt32BE(8), d = b.readInt32BE(12), type = b.readInt32BE(20);
  const n = w * h * d, out = new Int32Array(n), off = 284;
  const sz = { 0: 1, 1: 4, 3: 4, 4: 2 }[type];
  for (let i = 0; i < n; i++) { const q = off + i * sz; out[i] = type === 0 ? b[q] : type === 1 ? b.readInt32BE(q) : type === 4 ? b.readInt16BE(q) : Math.round(b.readFloatBE(q)); }
  return { w, h, d, data: out };
}
