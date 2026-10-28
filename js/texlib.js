'use strict';
// ============================================================
//  Procedural PBR texture toolkit
//  Tileable gradient noise, cellular noise and a small pixel
//  pipeline that turns height + colour layers into albedo,
//  normal (Sobel), ORM (AO / roughness / metalness) and
//  emissive canvases. Coordinates: u right, v up, both in [0,1).
// ============================================================
const TEX = 128, TEXN = TEX * TEX;
function ihash(x, y, s) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
// periodic 2D gradient noise: n(x, y, px, py) repeats every px cells in x and py cells in y
function tileNoise(seed) {
  const r = mulberry32(seed * 977 + 13), perm = new Uint16Array(1024), gx = new Float32Array(512), gy = new Float32Array(512), p = [];
  for (let i = 0; i < 512; i++) p.push(i);
  for (let i = 511; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 1024; i++) perm[i] = p[i & 511];
  for (let i = 0; i < 512; i++) { const a = r() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  return function (x, y, px, py = px) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py, x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const h00 = perm[perm[x0] + y0], h10 = perm[perm[x1] + y0], h01 = perm[perm[x0] + y1], h11 = perm[perm[x1] + y1];
    const a = gx[h00] * xf + gy[h00] * yf, b = gx[h10] * (xf - 1) + gy[h10] * yf, c = gx[h01] * xf + gy[h01] * (yf - 1), d = gx[h11] * (xf - 1) + gy[h11] * (yf - 1);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.414;
  };
}
// fractal sums; fx, fy are integer base frequencies so every octave still tiles
function tfbm(n, u, v, fx, oct, fy = fx, gain = 0.5) { let s = 0, a = 1, t = 0; for (let i = 0; i < oct; i++) { s += a * n(u * fx, v * fy, fx, fy); t += a; a *= gain; fx *= 2; fy *= 2; } return s / t; }
function tridged(n, u, v, fx, oct, fy = fx) { let s = 0, a = 1, t = 0; for (let i = 0; i < oct; i++) { const r = 1 - Math.abs(n(u * fx, v * fy, fx, fy)); s += a * r * r; t += a; a *= 0.5; fx *= 2; fy *= 2; } return s / t; }
// periodic Worley noise: writes f1, f2, id (0..1 per cell), cx, cy (cell point in uv) into out
function tileCells(seed, jitter = 0.85) {
  return function (u, v, fx, out, fy = fx) {
    const x = u * fx, y = v * fy, xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9, id = 0, bx = 0, by = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = xi + i, gy = yi + j, wx = ((gx % fx) + fx) % fx, wy = ((gy % fy) + fy) % fy;
      const h1 = ihash(wx, wy, seed), h2 = ihash(wx + 71, wy + 13, seed), h3 = ihash(wx + 7, wy + 191, seed);
      const px = gx + 0.5 + (h1 - 0.5) * jitter, py = gy + 0.5 + (h2 - 0.5) * jitter, dx = px - x, dy = py - y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; id = h3; bx = px; by = py; } else if (d < f2) f2 = d;
    }
    out.f1 = f1; out.f2 = f2; out.id = id; out.cx = bx / fx; out.cy = by / fy; out.dx = x - bx; out.dy = y - by;
    return out;
  };
}
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hexc = h => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// ---------- pixel layers ----------
// h: height 0..1, c: sRGB colour 0..1, a: alpha, r: roughness multiplier (<=1), m: metal mask, e: emissive colour
function newLayers(emissive) {
  return { h: new Float32Array(TEXN), c: new Float32Array(TEXN * 3), a: new Float32Array(TEXN).fill(1), r: new Float32Array(TEXN).fill(1), m: new Float32Array(TEXN), e: emissive ? new Float32Array(TEXN * 3) : null };
}
// run fn(u, v, px, k) for every pixel; px holds the pixel's current values and is written back
function each(L, fn) {
  const px = { h: 0, c: null, a: 1, r: 1, m: 0, e: null }, cb = [0, 0, 0], eb = [0, 0, 0];
  for (let j = 0; j < TEX; j++) for (let i = 0; i < TEX; i++) {
    const k = j * TEX + i;
    px.c = cb; px.e = eb; // fn may assign new arrays; reading back into our own buffers never mutates them
    px.h = L.h[k]; px.c[0] = L.c[k * 3]; px.c[1] = L.c[k * 3 + 1]; px.c[2] = L.c[k * 3 + 2]; px.a = L.a[k]; px.r = L.r[k]; px.m = L.m[k];
    if (L.e) { px.e[0] = L.e[k * 3]; px.e[1] = L.e[k * 3 + 1]; px.e[2] = L.e[k * 3 + 2]; }
    fn((i + 0.5) / TEX, (j + 0.5) / TEX, px, k);
    L.h[k] = px.h; L.c[k * 3] = px.c[0]; L.c[k * 3 + 1] = px.c[1]; L.c[k * 3 + 2] = px.c[2]; L.a[k] = px.a; L.r[k] = px.r; L.m[k] = px.m;
    if (L.e) { L.e[k * 3] = px.e[0]; L.e[k * 3 + 1] = px.e[1]; L.e[k * 3 + 2] = px.e[2]; }
  }
}
function copyLayers(L) { return { h: L.h.slice(), c: L.c.slice(), a: L.a.slice(), r: L.r.slice(), m: L.m.slice(), e: L.e ? L.e.slice() : null }; }
// 2D-canvas drawing used as a mask (shapes, text); returns alpha 0..1 per pixel in u/v order
function drawMask(draw) {
  const c = document.createElement('canvas'); c.width = c.height = TEX; const x = c.getContext('2d');
  draw(x); const d = x.getImageData(0, 0, TEX, TEX).data, m = new Float32Array(TEXN);
  for (let j = 0; j < TEX; j++) for (let i = 0; i < TEX; i++) m[j * TEX + i] = d[((TEX - 1 - j) * TEX + i) * 4 + 3] / 255;
  return m;
}
function blurField(f, rad, wrap) {
  let src = f;
  for (const horiz of [true, false]) {
    const o = new Float32Array(TEXN);
    for (let j = 0; j < TEX; j++) for (let i = 0; i < TEX; i++) {
      let s = 0, n = 0;
      for (let d = -rad; d <= rad; d++) {
        let x = horiz ? i + d : i, y = horiz ? j : j + d;
        if (wrap) { x = (x + TEX) % TEX; y = (y + TEX) % TEX; } else if (x < 0 || y < 0 || x >= TEX || y >= TEX) continue;
        s += src[y * TEX + x]; n++;
      }
      o[j * TEX + i] = s / n;
    }
    src = o;
  }
  return src;
}
const canvasOf = () => { const c = document.createElement('canvas'); c.width = c.height = TEX; return c; };
// bake layers into GPU-ready RGBA bytes (row 0 = v 0, for DataTextures) plus an albedo canvas for icons.
// Raw bytes rather than canvases keep the colour of transparent texels (canvases premultiply alpha),
// which lets cut-out edges bleed the right colour into their mipmaps instead of black.
function bakeLayers(L, o) {
  const wrap = o.wrap !== false, bump = o.bump ?? 3, aoK = o.ao ?? 2.5;
  const H = L.h, get = (i, j) => { if (wrap) { i = (i + TEX) % TEX; j = (j + TEX) % TEX; } else { i = clamp(i, 0, TEX - 1); j = clamp(j, 0, TEX - 1); } return H[j * TEX + i]; };
  const blurred = blurField(H, 4, wrap);
  const A = new Uint8Array(TEXN * 4), Nm = new Uint8Array(TEXN * 4), O = new Uint8Array(TEXN * 4), E = L.e ? new Uint8Array(TEXN * 4) : null;
  // colour bleed: transparent texels take the average of opaque neighbours, grown outward a few rings
  const col = L.c.slice(), known = new Uint8Array(TEXN);
  let sr = 0, sg = 0, sb = 0, cnt = 0, rk = 0;
  for (let k = 0; k < TEXN; k++) { rk = Math.max(rk, L.r[k]); if (L.a[k] > 0.5) { known[k] = 1; sr += col[k * 3]; sg += col[k * 3 + 1]; sb += col[k * 3 + 2]; cnt++; } }
  const avg = cnt ? [sr / cnt, sg / cnt, sb / cnt] : [1, 1, 1];
  if (cnt < TEXN) for (let pass = 0; pass < 6; pass++) {
    const add = [];
    for (let j = 0; j < TEX; j++) for (let i = 0; i < TEX; i++) {
      const k = j * TEX + i; if (known[k]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = ((j + dj + TEX) % TEX) * TEX + (i + di + TEX) % TEX; if (known[q] === 1) { r += col[q * 3]; g += col[q * 3 + 1]; b += col[q * 3 + 2]; n++; } }
      if (n) add.push(k, r / n, g / n, b / n);
    }
    for (let q = 0; q < add.length; q += 4) { const k = add[q]; col[k * 3] = add[q + 1]; col[k * 3 + 1] = add[q + 2]; col[k * 3 + 2] = add[q + 3]; known[k] = 2; }
    for (let k = 0; k < TEXN; k++) if (known[k] === 2) known[k] = 1;
  }
  for (let k = 0; k < TEXN; k++) if (!known[k]) { col[k * 3] = avg[0]; col[k * 3 + 1] = avg[1]; col[k * 3 + 2] = avg[2]; }
  rk = rk || 1;
  const ac = canvasOf(), ai = new ImageData(TEX, TEX);
  for (let j = 0; j < TEX; j++) for (let i = 0; i < TEX; i++) {
    const k = j * TEX + i, p = k * 4, pc = ((TEX - 1 - j) * TEX + i) * 4;
    const gx = (get(i + 1, j - 1) + 2 * get(i + 1, j) + get(i + 1, j + 1)) - (get(i - 1, j - 1) + 2 * get(i - 1, j) + get(i - 1, j + 1));
    const gy = (get(i - 1, j + 1) + 2 * get(i, j + 1) + get(i + 1, j + 1)) - (get(i - 1, j - 1) + 2 * get(i, j - 1) + get(i + 1, j - 1));
    let nx = -gx * bump, ny = -gy * bump, nz = 1; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
    Nm[p] = (nx * .5 + .5) * 255; Nm[p + 1] = (ny * .5 + .5) * 255; Nm[p + 2] = (nz * .5 + .5) * 255; Nm[p + 3] = 255;
    const a = clamp(L.a[k], 0, 1) * 255;
    for (let c = 0; c < 3; c++) { A[p + c] = clamp(col[k * 3 + c], 0, 1) * 255; ai.data[pc + c] = clamp(L.c[k * 3 + c], 0, 1) * 255; }
    A[p + 3] = ai.data[pc + 3] = a;
    // R: cavity occlusion from the height field, G: roughness relative to the tile's roughest texel, B: metal mask
    const ao = clamp(1 - Math.max(0, blurred[k] - H[k]) * aoK, 0.45, 1);
    O[p] = ao * 255; O[p + 1] = clamp(L.r[k] / rk, 0, 1) * 255; O[p + 2] = clamp(L.m[k], 0, 1) * 255; O[p + 3] = 255;
    if (E) { E[p] = clamp(L.e[k * 3], 0, 1) * 255; E[p + 1] = clamp(L.e[k * 3 + 1], 0, 1) * 255; E[p + 2] = clamp(L.e[k * 3 + 2], 0, 1) * 255; E[p + 3] = 255; }
  }
  ac.getContext('2d').putImageData(ai, 0, 0);
  return { albedo: A, normal: Nm, orm: O, emissive: E, canvas: ac, avg, rk };
}
