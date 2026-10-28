'use strict';
// ============================================================
//  Chunk meshing and the load / unload queue
// ============================================================
// vertex ambient occlusion: per corner, 0 = both sides and the diagonal blocked .. 3 = open; multiplied into the albedo
const AO_CURVE = [0.45, 0.65, 0.85, 1.0];
const levelLight = l => l > 0 ? Math.pow(0.82, 15 - l) : 0;
// sky light level (may be a corner average) -> share of the indirect sky light that reaches the surface
const skyLight = l => l > 0 ? Math.pow(LIGHTING.skyFalloff, 15 - l) : 0;
// texture orientation per face, from a hash: 'rot' turns in 90 degree steps and mirrors, 'flip' mirrors sideways,
// 'flipxy' mirrors on either axis, 'none' keeps the tile as painted
function orientUV(mode, h, u, v, out) {
  let a = u, b = v;
  if (mode === 'rot') { const r = (h * 8) | 0; for (let i = 0; i < (r & 3); i++) { const t = a; a = b; b = 1 - t; } if (r & 4) a = 1 - a; }
  else if (mode === 'flip') { if (h < .5) a = 1 - a; }
  else if (mode === 'flipxy') { const r = (h * 4) | 0; if (r & 1) a = 1 - a; if (r & 2) b = 1 - b; }
  out[0] = a; out[1] = b; return out;
}
// grass and leaf colour drift across the world: drier and warmer in some places, lusher in others
const TINT = { blockVar: 0.07, regional: 1.2, dry: [1.15, 1.05, 0.75], lush: [0.86, 1.02, 0.9] };
const REGION_TILES = { [T.GRASS_TOP]: 1, [T.GRASS_SIDE]: .6, [T.TALLGRASS]: 1, [T.LEAVES]: .5, [T.BIRCH_LEAVES]: .5 };
function regionTint(X, Z, k, out) {
  const t = clamp((N.wet.noise(X / 90, Z / 90, 5.3) + .5 * N.temp.noise(X / 35, Z / 35, 8.1)) * TINT.regional, -1, 1) * k, c = t < 0 ? TINT.dry : TINT.lush, a = Math.abs(t);
  out[0] *= 1 + (c[0] - 1) * a; out[1] *= 1 + (c[1] - 1) * a; out[2] *= 1 + (c[2] - 1) * a;
}
function buildMesh(ch) {
  // per mesh: positions, uvs, light (ao, sky, block, one-sided), normals, tint colours, and index lists per texture tile
  const S = { P: [], U: [], L: [], N: [], C: [], I: {} }, W = { P: [], U: [], L: [], N: [], C: [], I: {} };
  const ox = ch.cx * CS, oz = ch.cz * CS, d = ch.data, md = ch.meta, lt = ch.light;
  const inside = (x, z) => x >= 0 && x < CS && z >= 0 && z < CS;
  const nb = (x, y, z) => { if (y < 0) return B.BEDROCK; if (y >= H) return B.AIR; return inside(x, z) ? d[(y * CS + z) * CS + x] : getBlock(ox + x, y, oz + z); };
  const nbMeta = (x, y, z) => (y < 0 || y >= H) ? 0 : inside(x, z) ? md[(y * CS + z) * CS + x] : getMeta(ox + x, y, oz + z);
  const sky = (x, y, z) => { if (y >= H) return 15; if (y < 0) return 0; return inside(x, z) ? ch.sky[(y * CS + z) * CS + x] : getSky(ox + x, y, oz + z); };
  const blk = (x, y, z) => (y < 0 || y >= H) ? 0 : inside(x, z) ? lt[(y * CS + z) * CS + x] : getLight(ox + x, y, oz + z);
  const occ = (x, y, z) => BLOCKS[nb(x, y, z)].occ ? 1 : 0;
  const idx = (A, tile) => A.I[tile] || (A.I[tile] = []);
  const quad = (A, tile, base, flip) => flip ? idx(A, tile).push(base, base + 1, base + 3, base, base + 3, base + 2) : idx(A, tile).push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  const both = (A, tile, b) => idx(A, tile).push(b, b + 1, b + 2, b + 2, b + 1, b + 3, b, b + 2, b + 1, b + 2, b + 3, b + 1);
  const cellLight = (x, y, z) => [skyLight(sky(x, y, z)), levelLight(blk(x, y, z))];
  // fluid surface height of a cell, -1 when it holds a different block
  const fh = (x, y, z, id) => { if (nb(x, y, z) !== id) return -1; if (nb(x, y + 1, z) === id) return 1; const m = nbMeta(x, y, z); return (m === 0 || m >= 8) ? 0.875 : (8 - m) / 9; };
  const cornerH = (x, y, z, cx, cz, id) => { let s = 0, n = 0; for (let a = -1; a <= 0; a++) for (let b = -1; b <= 0; b++) { const h = fh(x + cx + a, y, z + cz + b, id); if (h === 1) return 1; if (h >= 0) { s += h; n++; } } return n ? s / n : 0.875; };
  // a block's tint: small random brightness/hue change, times the regional colour for grass and leaves
  const tint = [1, 1, 1], uv = [0, 0];
  const setTint = (X, y, Z, tile) => {
    const v = TINT.blockVar * (TILE_SPEC[tile].tint ?? 1), h = ihash(X * 31 + y, Z, 7019);
    tint[0] = 1 + (h - .5) * v; tint[1] = 1 + (ihash(X, y * 17 + Z, 7027) - .5) * v * .6 + (h - .5) * v * .4; tint[2] = 1 + (ihash(Z * 13, X + y, 7039) - .5) * v * .6 + (h - .5) * v * .4;
    const k = REGION_TILES[tile]; if (k) regionTint(X, Z, k, tint);
  };

  for (let y = 0; y <= ch.maxY; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const i = (y * CS + z) * CS + x, id = d[i]; if (!id) continue;
    const bd = BLOCKS[id], X = ox + x, Z = oz + z;
    if (bd.shape === 'cross') {
      const [s, b] = cellLight(x, y, z), t = bd.tiles[0], fl = ihash(X, y, Z * 3 + 1) < .5;
      setTint(X, y, Z, t);
      for (const q of PLANT_QUADS) { const base = S.P.length / 3; q.forEach((p, k) => { S.P.push(X + p[0], y + p[1], Z + p[2]); S.U.push(fl ? 1 - (k & 1) : k & 1, k >> 1); S.L.push(1, s, b, 0); S.N.push(0, 1, 0); S.C.push(...tint); }); both(S, t, base); }
      continue;
    }
    if (bd.shape === 'torch') {
      const m = md[i], s = skyLight(sky(x, y, z)), t = bd.tiles[0], a = 7 / 16, w = 2 / 16, h = 10 / 16;
      let bx = 0, bz = 0, lx = 0, lz = 0, lift = 0;
      if (m) { const dir = FACES[m - 1].dir; bx = -dir[0] * .34; bz = -dir[2] * .34; lx = dir[0] * .3; lz = dir[2] * .3; lift = .2; }
      for (const f of FACES) {
        const base = S.P.length / 3;
        for (const c of f.c) {
          S.P.push(X + a + c[0] * w + bx + lx * c[1], y + c[1] * h + lift, Z + a + c[2] * w + bz + lz * c[1]);
          const v = f.dir[1] === 1 ? 8 / 16 + c[4] * 2 / 16 : f.dir[1] === -1 ? c[4] * 2 / 16 : c[4] * 10 / 16;
          S.U.push(7 / 16 + c[3] * 2 / 16, v); S.L.push(1, s, 1, 0); S.N.push(...f.dir); S.C.push(1, 1, 1);
        }
        quad(S, t, base, false);
      }
      continue;
    }
    if (bd.shape === 'ladder') {
      const dir = FACES[md[i]].dir, ax = dir[0] ? 0 : 2, p = (dir[0] || dir[2]) > 0 ? 1 / 16 : 15 / 16, [s, b] = cellLight(x, y, z), base = S.P.length / 3;
      setTint(X, y, Z, bd.tiles[0]);
      for (let k = 0; k < 4; k++) { const u = k & 1, v = k >> 1; S.P.push(X + (ax === 0 ? p : u), y + v, Z + (ax === 0 ? u : p)); S.U.push(u, v); S.L.push(1, s, b, 0); S.N.push(...dir); S.C.push(...tint); }
      both(S, bd.tiles[0], base);
      continue;
    }
    if (bd.liquid) {
      // fluids use world-space UVs so the surface texture runs on unbroken and can scroll as one sheet
      const A = id === B.LAVA ? S : W, glow = id === B.LAVA, t = bd.tiles[0], wx = ((X % 64) + 64) % 64, wz = ((Z % 64) + 64) % 64;
      const ch00 = cornerH(x, y, z, 0, 0, id), ch10 = cornerH(x, y, z, 1, 0, id), ch01 = cornerH(x, y, z, 0, 1, id), ch11 = cornerH(x, y, z, 1, 1, id);
      const topH = (cx, cz) => cx ? (cz ? ch11 : ch10) : (cz ? ch01 : ch00);
      for (const f of FACES) {
        const fx = x + f.dir[0], fy = y + f.dir[1], fz = z + f.dir[2], n = nb(fx, fy, fz);
        if (n === id) continue;
        if (f.dir[1] !== 1 && !BLOCKS[n].transparent) continue;
        const base = A.P.length / 3, s = skyLight(sky(fx, fy, fz)), b = glow ? 1 : levelLight(blk(fx, fy, fz));
        for (const c of f.c) {
          const py = c[1] ? topH(c[0], c[2]) : 0;
          A.P.push(X + c[0], y + py, Z + c[2]);
          if (f.dir[1]) A.U.push(wx + c[0], wz + c[2]); else A.U.push(f.dir[0] ? wz + c[2] : wx + c[0], y + py);
          A.L.push(1, s, b, 1); A.N.push(...f.dir); A.C.push(1, 1, 1);
        }
        quad(A, t, base, false);
      }
      continue;
    }
    const A = (id === B.ICE || id === B.GLASS) ? W : S, m = md[i];
    for (let fi = 0; fi < 6; fi++) {
      const f = FACES[fi], fx = x + f.dir[0], fy = y + f.dir[1], fz = z + f.dir[2], n = nb(fx, fy, fz), nd = BLOCKS[n];
      if (!nd.transparent) continue;
      if (n === id && bd.transparent) continue;
      const tile = faceTile(bd, fi, m), base = A.P.length / 3, ao = [0, 0, 0, 0], mode = TILE_SPEC[tile].uv, h = ihash(X * 7 + fi, y * 3 + Z * 5, 9001);
      setTint(X, y, Z, tile);
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
        A.L.push(occl, skyLight(ss / cnt), levelLight(bl / cnt), 1); A.N.push(...f.dir);
      }
      // split the quad along the brighter diagonal so uneven corners don't interpolate into a streak
      quad(A, tile, base, ao[0] + ao[3] > ao[1] + ao[2]);
    }
  }
  disposeChunk(ch);
  if (S.P.length) {
    // the visible mesh draws one group per tile material; a shadow-only twin shares its buffers and
    // draws every opaque tile in a single call, keeping per-tile groups only for alpha cut-outs (leaves, plants)
    const g = chunkGeometry(S);
    ch.mesh = new THREE.Mesh(g, CHUNK_MATS); ch.mesh.receiveShadow = true; scene.add(ch.mesh);
    ch.shadow = shadowOnly(new THREE.Mesh(shadowGeometry(g), SHADOW_MATS)); scene.add(ch.shadow);
  }
  if (W.P.length) { ch.water = new THREE.Mesh(chunkGeometry(W), CHUNK_MATS); ch.water.receiveShadow = true; ch.water.renderOrder = 1; scene.add(ch.water); }
  ch.dirty = false; ch.meshed = true;
}
// opaque tiles first, cut-outs after, so the shadow twin can cover all opaque faces with one range
function chunkGeometry(A) {
  const tiles = Object.keys(A.I).map(Number).sort((a, b) => (TILE_SPEC[a].cutout ? 1 : 0) - (TILE_SPEC[b].cutout ? 1 : 0) || a - b), I = [], groups = [];
  for (const t of tiles) { groups.push([I.length, A.I[t].length, t]); for (const v of A.I[t]) I.push(v); }
  const g = makeGeo(A.P, A.U, I, A.N, { light: [A.L, 4], color: [A.C, 3] });
  for (const [s, n, t] of groups) g.addGroup(s, n, t);
  return g;
}
function shadowGeometry(g) {
  const s = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'uv']) s.setAttribute(k, g.attributes[k]);
  s.setIndex(g.index); s.boundingSphere = g.boundingSphere;
  let solidEnd = 0;
  for (const gr of g.groups) if (!TILE_SPEC[gr.materialIndex].cutout) solidEnd = gr.start + gr.count;
  if (solidEnd) s.addGroup(0, solidEnd, SHADOW_SOLID);
  for (const gr of g.groups) if (TILE_SPEC[gr.materialIndex].cutout) s.addGroup(gr.start, gr.count, gr.materialIndex);
  return s;
}
function disposeChunk(ch) {
  for (const k of ['mesh', 'shadow', 'water']) if (ch[k]) { scene.remove(ch[k]); ch[k].geometry.dispose(); ch[k] = null; }
}

let renderDist = isTouch ? 4 : 6;
let lastChunkScan = 0, genQueue = [], meshQueue = [];
function scanChunks(px, pz) {
  const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS), R = renderDist;
  genQueue = []; meshQueue = [];
  for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) {
    const dd = dx * dx + dz * dz; if (dd > (R + 1.5) * (R + 1.5)) continue;
    const ch = chunks.get(ck(pcx + dx, pcz + dz));
    if (!ch) genQueue.push([dd, pcx + dx, pcz + dz]);
    else if (ch.dirty && dd <= (R + .5) * (R + .5)) meshQueue.push([dd, ch]);
  }
  genQueue.sort((a, b) => a[0] - b[0]); meshQueue.sort((a, b) => a[0] - b[0]);
  for (const [k, ch] of chunks) {
    const dx = ch.cx - pcx, dz = ch.cz - pcz, dd = dx * dx + dz * dz;
    if (dd > (R + 3) * (R + 3)) { disposeChunk(ch); chunks.delete(k); }
    else if (dd > (R + 1.5) * (R + 1.5) && ch.meshed) { disposeChunk(ch); ch.meshed = false; ch.dirty = true; }
  }
}
function updateChunks(now, px, pz) {
  if (now - lastChunkScan > 200 || (!genQueue.length && !meshQueue.length && now - lastChunkScan > 60)) { scanChunks(px, pz); lastChunkScan = now; }
  const t0 = performance.now(), budget = 9;
  while (genQueue.length && performance.now() - t0 < budget * .55) {
    const [, cx, cz] = genQueue.shift(), k = ck(cx, cz);
    if (chunks.has(k)) continue;
    const ch = generateChunk(cx, cz); chunks.set(k, ch); initChunkLight(ch); initChunkSky(ch); flushTouched(false);
  }
  while (meshQueue.length && performance.now() - t0 < budget) {
    const [, ch] = meshQueue.shift();
    if (chunks.get(ck(ch.cx, ch.cz)) === ch && ch.dirty && hasAllNeighbours(ch)) buildMesh(ch);
  }
}
