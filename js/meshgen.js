'use strict';
// ============================================================
//  Chunk mesh generation as a pure function of a padded block
//  volume and a few tables, so it runs in the mesh Web Worker
//  (meshworker.js) or, as a fallback, on the main thread.
// ============================================================
// vertex ambient occlusion: per corner, 0 = both sides and the diagonal blocked .. 3 = open; multiplied into the albedo
const AO_CURVE = [0.45, 0.65, 0.85, 1.0];
// grass and leaf colour drift across the world: drier and warmer in some places, lusher in others
const TINT = { blockVar: 0.07, regional: 1.2, dry: [1.15, 1.05, 0.75], lush: [0.86, 1.02, 0.9] };
const MESH = { skyFalloff: 0.8 }; // set from LIGHTING.skyFalloff on the main thread and sent to the worker
const levelLight = l => l > 0 ? Math.pow(0.82, 15 - l) : 0;
// sky light level (may be a corner average) -> share of the indirect sky light that reaches the surface
const skyLight = l => l > 0 ? Math.pow(MESH.skyFalloff, 15 - l) : 0;
// texture orientation per face, from a hash: 'rot' turns in 90 degree steps and mirrors, 'flip' mirrors sideways,
// 'flipxy' mirrors on either axis, 'none' keeps the tile as painted
function orientUV(mode, h, u, v, out) {
  let a = u, b = v;
  if (mode === 'rot') { const r = (h * 8) | 0; for (let i = 0; i < (r & 3); i++) { const t = a; a = b; b = 1 - t; } if (r & 4) a = 1 - a; }
  else if (mode === 'flip') { if (h < .5) a = 1 - a; }
  else if (mode === 'flipxy') { const r = (h * 4) | 0; if (r & 1) a = 1 - a; if (r & 2) b = 1 - b; }
  out[0] = a; out[1] = b; return out;
}

// v: { cx, cz, maxY, hv, data, meta, light, sky, region } where the four Uint8Arrays cover the chunk plus a one-block
// border from its neighbours, (CS + 2)^2 x hv cells, and region holds the regional tint (-1..1) of each column.
// K: block, tile and face tables (see meshTables in mesher.js). Returns typed arrays for the S (opaque and cut-out),
// W (water surface) and G (glass, ice) meshes, indices grouped per tile with opaque tiles first.
function meshVolume(v, K) {
  const CS = K.CS, PW = CS + 2, hv = v.hv, { data, meta, light, sky: skyV } = v, BL = K.blocks, FACES = K.faces, ID = K.id;
  const at = (x, y, z) => (y * PW + z + 1) * PW + x + 1;
  const mk = () => ({ P: [], U: [], L: [], N: [], C: [], I: {} }), S = mk(), W = mk(), G = mk();
  const ox = v.cx * CS, oz = v.cz * CS;
  const nb = (x, y, z) => y < 0 ? ID.BEDROCK : y >= hv ? ID.AIR : data[at(x, y, z)];
  const nbMeta = (x, y, z) => (y < 0 || y >= hv) ? 0 : meta[at(x, y, z)];
  const sky = (x, y, z) => y >= hv ? 15 : y < 0 ? 0 : skyV[at(x, y, z)];
  const blk = (x, y, z) => (y < 0 || y >= hv) ? 0 : light[at(x, y, z)];
  const occ = (x, y, z) => BL[nb(x, y, z)].occ ? 1 : 0;
  const idx = (A, tile) => A.I[tile] || (A.I[tile] = []);
  const quad = (A, tile, base, flip) => flip ? idx(A, tile).push(base, base + 1, base + 3, base, base + 3, base + 2) : idx(A, tile).push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  const both = (A, tile, b) => idx(A, tile).push(b, b + 1, b + 2, b + 2, b + 1, b + 3, b, b + 2, b + 1, b + 2, b + 3, b + 1);
  const cellLight = (x, y, z) => [skyLight(sky(x, y, z)), levelLight(blk(x, y, z))];
  // blocks of water stacked over a cell: light reaching a surface down there is absorbed on the way (blue-green, darker with depth)
  const wdepth = (x, y, z) => { let n = 0; while (n < 16 && nb(x, y + n, z) === ID.WATER) n++; return n; };
  // fluid surface height of a cell, -1 when it holds a different block
  const fh = (x, y, z, id) => { if (nb(x, y, z) !== id) return -1; if (nb(x, y + 1, z) === id) return 1; const m = nbMeta(x, y, z); return (m === 0 || m >= 8) ? 0.875 : (8 - m) / 9; };
  const cornerH = (x, y, z, cx, cz, id) => { let s = 0, n = 0; for (let a = -1; a <= 0; a++) for (let b = -1; b <= 0; b++) { const h = fh(x + cx + a, y, z + cz + b, id); if (h === 1) return 1; if (h >= 0) { s += h; n++; } } return n ? s / n : 0.875; };
  const faceTile = (bd, fi, m) => { const d = FACES[fi].dir[1]; return d === 1 ? bd.tiles[0] : d === -1 ? bd.tiles[2] : bd.face && fi === (m & 7) ? bd.tiles[3] : bd.tiles[1]; };
  // a block's tint: small random brightness/hue change, times the regional colour for grass and leaves
  const tint = [1, 1, 1], uv = [0, 0];
  const setTint = (X, y, Z, x, z, tile) => {
    const va = TINT.blockVar * (K.tiles[tile].tint ?? 1), h = ihash(X * 31 + y, Z, 7019);
    tint[0] = 1 + (h - .5) * va; tint[1] = 1 + (ihash(X, y * 17 + Z, 7027) - .5) * va * .6 + (h - .5) * va * .4; tint[2] = 1 + (ihash(Z * 13, X + y, 7039) - .5) * va * .6 + (h - .5) * va * .4;
    const k = K.region[tile]; if (!k) return;
    const t = v.region[z * CS + x] * k, c = t < 0 ? TINT.dry : TINT.lush, a = Math.abs(t);
    tint[0] *= 1 + (c[0] - 1) * a; tint[1] *= 1 + (c[1] - 1) * a; tint[2] *= 1 + (c[2] - 1) * a;
  };

  for (let y = 0; y <= v.maxY; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const i = at(x, y, z), id = data[i]; if (!id) continue;
    const bd = BL[id], X = ox + x, Z = oz + z;
    if (bd.shape === 'cross') {
      const [s, b] = cellLight(x, y, z), t = bd.tiles[0], fl = ihash(X, y, Z * 3 + 1) < .5;
      setTint(X, y, Z, x, z, t);
      for (const q of K.plantQuads) { const base = S.P.length / 3; q.forEach((p, k) => { S.P.push(X + p[0], y + p[1], Z + p[2]); S.U.push(fl ? 1 - (k & 1) : k & 1, k >> 1); S.L.push(1, s, b, 0); S.N.push(0, 1, 0); S.C.push(...tint); }); both(S, t, base); }
      continue;
    }
    if (bd.shape === 'torch') {
      const m = meta[i], s = skyLight(sky(x, y, z)), t = bd.tiles[0], a = 7 / 16, w = 2 / 16, h = 10 / 16;
      let bx = 0, bz = 0, lx = 0, lz = 0, lift = 0;
      if (m) { const dir = FACES[m - 1].dir; bx = -dir[0] * .34; bz = -dir[2] * .34; lx = dir[0] * .3; lz = dir[2] * .3; lift = .2; }
      for (const f of FACES) {
        const base = S.P.length / 3;
        for (const c of f.c) {
          S.P.push(X + a + c[0] * w + bx + lx * c[1], y + c[1] * h + lift, Z + a + c[2] * w + bz + lz * c[1]);
          const tv = f.dir[1] === 1 ? 8 / 16 + c[4] * 2 / 16 : f.dir[1] === -1 ? c[4] * 2 / 16 : c[4] * 10 / 16;
          S.U.push(7 / 16 + c[3] * 2 / 16, tv); S.L.push(1, s, 1, 0); S.N.push(...f.dir); S.C.push(1, 1, 1);
        }
        quad(S, t, base, false);
      }
      continue;
    }
    if (bd.shape === 'ladder') {
      const dir = FACES[meta[i]].dir, ax = dir[0] ? 0 : 2, p = (dir[0] || dir[2]) > 0 ? 1 / 16 : 15 / 16, [s, b] = cellLight(x, y, z), base = S.P.length / 3;
      setTint(X, y, Z, x, z, bd.tiles[0]);
      for (let k = 0; k < 4; k++) { const u = k & 1, tv = k >> 1; S.P.push(X + (ax === 0 ? p : u), y + tv, Z + (ax === 0 ? u : p)); S.U.push(u, tv); S.L.push(1, s, b, 0); S.N.push(...dir); S.C.push(...tint); }
      both(S, bd.tiles[0], base);
      continue;
    }
    if (bd.liquid) {
      // fluids use world-space UVs so the surface texture runs on unbroken and can scroll as one sheet
      const A = id === ID.LAVA ? S : W, glow = id === ID.LAVA, t = bd.tiles[0], wx = ((X % 64) + 64) % 64, wz = ((Z % 64) + 64) % 64;
      const ch00 = cornerH(x, y, z, 0, 0, id), ch10 = cornerH(x, y, z, 1, 0, id), ch01 = cornerH(x, y, z, 0, 1, id), ch11 = cornerH(x, y, z, 1, 1, id);
      const topH = (cx, cz) => cx ? (cz ? ch11 : ch10) : (cz ? ch01 : ch00);
      for (const f of FACES) {
        const fx = x + f.dir[0], fy = y + f.dir[1], fz = z + f.dir[2], n = nb(fx, fy, fz);
        if (n === id) continue;
        if (f.dir[1] !== 1 && !BL[n].transparent) continue;
        const base = A.P.length / 3, s = skyLight(sky(fx, fy, fz)), b = glow ? 1 : levelLight(blk(fx, fy, fz));
        for (const c of f.c) {
          const py = c[1] ? topH(c[0], c[2]) : 0;
          A.P.push(X + c[0], y + py, Z + c[2]);
          if (f.dir[1]) A.U.push(wx + c[0], wz + c[2]); else A.U.push(f.dir[0] ? wz + c[2] : wx + c[0], y + py);
          A.L.push(1, s, b, 0); A.N.push(...f.dir); A.C.push(1, 1, 1);
        }
        quad(A, t, base, false);
      }
      continue;
    }
    // cubes: only faces next to a see-through block are built (hidden faces never exist)
    const A = (id === ID.ICE || id === ID.GLASS) ? G : S, m = meta[i];
    for (let fi = 0; fi < 6; fi++) {
      const f = FACES[fi], fx = x + f.dir[0], fy = y + f.dir[1], fz = z + f.dir[2], n = nb(fx, fy, fz), nd = BL[n];
      if (!nd.transparent) continue;
      if (n === id && bd.transparent) continue;
      const tile = faceTile(bd, fi, m), base = A.P.length / 3, ao = [0, 0, 0, 0], mode = K.tiles[tile].uv, h = ihash(X * 7 + fi, y * 3 + Z * 5, 9001), wd = wdepth(fx, fy, fz);
      setTint(X, y, Z, x, z, tile);
      for (let k = 0; k < 4; k++) {
        const c = f.c[k], [o1, o2, o3] = f.ao[k];
        A.P.push(X + c[0], y + c[1], Z + c[2]);
        orientUV(mode, h, c[3], c[4], uv); A.U.push(uv[0], uv[1]);
        const s1 = occ(x + o1[0], y + o1[1], z + o1[2]), s2 = occ(x + o2[0], y + o2[1], z + o2[2]), cr = occ(x + o3[0], y + o3[1], z + o3[2]);
        const a = (s1 && s2) ? 0 : 3 - (s1 + s2 + cr), occl = AO_CURVE[a]; ao[k] = a;
        A.C.push(tint[0] * occl, tint[1] * occl, tint[2] * occl);
        let ss = sky(fx, fy, fz), bl = blk(fx, fy, fz), cnt = 1;
        if (!s1) { ss += sky(x + o1[0], y + o1[1], z + o1[2]); bl += blk(x + o1[0], y + o1[1], z + o1[2]); cnt++; }
        if (!s2) { ss += sky(x + o2[0], y + o2[1], z + o2[2]); bl += blk(x + o2[0], y + o2[1], z + o2[2]); cnt++; }
        if (!cr && !(s1 && s2)) { ss += sky(x + o3[0], y + o3[1], z + o3[2]); bl += blk(x + o3[0], y + o3[1], z + o3[2]); cnt++; }
        A.L.push(occl, skyLight(ss / cnt), levelLight(bl / cnt), wd); A.N.push(...f.dir);
      }
      // split the quad along the brighter diagonal so uneven corners don't interpolate into a streak
      quad(A, tile, base, ao[0] + ao[3] > ao[1] + ao[2]);
    }
  }
  return { S: packMesh(S, K), W: packMesh(W, K), G: packMesh(G, K) };
}
// typed arrays for one mesh; opaque tiles first, cut-outs after, so the shadow twin covers all opaque faces with one range
function packMesh(A, K) {
  if (!A.P.length) return null;
  const tiles = Object.keys(A.I).map(Number).sort((a, b) => (K.tiles[a].cutout ? 1 : 0) - (K.tiles[b].cutout ? 1 : 0) || a - b);
  let n = 0; for (const t of tiles) n += A.I[t].length;
  const I = A.P.length / 3 < 65536 ? new Uint16Array(n) : new Uint32Array(n), groups = [];
  let o = 0, solidEnd = 0;
  for (const t of tiles) { const src = A.I[t]; I.set(src, o); groups.push([o, src.length, t]); o += src.length; if (!K.tiles[t].cutout) solidEnd = o; }
  return { P: new Float32Array(A.P), U: new Float32Array(A.U), L: new Float32Array(A.L), N: new Float32Array(A.N), C: new Float32Array(A.C), I, groups, solidEnd };
}
const meshBuffers = r => [r.S, r.W, r.G].filter(Boolean).flatMap(m => [m.P.buffer, m.U.buffer, m.L.buffer, m.N.buffer, m.C.buffer, m.I.buffer]);
