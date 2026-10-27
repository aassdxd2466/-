'use strict';
// ============================================================
//  Chunk meshing and the load / unload queue
// ============================================================
const AO_CURVE = [0.5, 0.7, 0.85, 1.0];
const levelLight = l => l > 0 ? Math.pow(0.82, 15 - l) : 0;
function buildMesh(ch) {
  const S = { P: [], U: [], L: [], N: [], I: [] }, W = { P: [], U: [], L: [], N: [], I: [] };
  const ox = ch.cx * CS, oz = ch.cz * CS, d = ch.data, md = ch.meta, lt = ch.light;
  const inside = (x, z) => x >= 0 && x < CS && z >= 0 && z < CS;
  const nb = (x, y, z) => { if (y < 0) return B.BEDROCK; if (y >= H) return B.AIR; return inside(x, z) ? d[(y * CS + z) * CS + x] : getBlock(ox + x, y, oz + z); };
  const nbMeta = (x, y, z) => (y < 0 || y >= H) ? 0 : inside(x, z) ? md[(y * CS + z) * CS + x] : getMeta(ox + x, y, oz + z);
  const sky = (x, y, z) => { if (y >= H) return 1; const t = inside(x, z) ? ch.top[z * CS + x] : getTop(ox + x, oz + z); return y > t ? 1 : 0; };
  const blk = (x, y, z) => (y < 0 || y >= H) ? 0 : inside(x, z) ? lt[(y * CS + z) * CS + x] : getLight(ox + x, y, oz + z);
  const occ = (x, y, z) => BLOCKS[nb(x, y, z)].occ ? 1 : 0;
  const quad = (A, base, flip) => flip ? A.I.push(base, base + 1, base + 3, base, base + 3, base + 2) : A.I.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  const both = (A, b) => A.I.push(b, b + 1, b + 2, b + 2, b + 1, b + 3, b, b + 2, b + 1, b + 2, b + 3, b + 1);
  const cellLight = (x, y, z) => [sky(x, y, z), levelLight(blk(x, y, z))];
  // fluid surface height of a cell, -1 when it holds a different block
  const fh = (x, y, z, id) => { if (nb(x, y, z) !== id) return -1; if (nb(x, y + 1, z) === id) return 1; const m = nbMeta(x, y, z); return (m === 0 || m >= 8) ? 0.875 : (8 - m) / 9; };
  const cornerH = (x, y, z, cx, cz, id) => { let s = 0, n = 0; for (let a = -1; a <= 0; a++) for (let b = -1; b <= 0; b++) { const h = fh(x + cx + a, y, z + cz + b, id); if (h === 1) return 1; if (h >= 0) { s += h; n++; } } return n ? s / n : 0.875; };

  for (let y = 0; y <= ch.maxY; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const i = (y * CS + z) * CS + x, id = d[i]; if (!id) continue;
    const bd = BLOCKS[id], X = ox + x, Z = oz + z;
    if (bd.shape === 'cross') {
      const [s, b] = cellLight(x, y, z);
      for (const q of PLANT_QUADS) { const base = S.P.length / 3; q.forEach((p, k) => { S.P.push(X + p[0], y + p[1], Z + p[2]); S.U.push(...tileUV(bd.tiles[0], k & 1, k >> 1)); S.L.push(1, s, b, 0); S.N.push(0, 1, 0); }); both(S, base); }
      continue;
    }
    if (bd.shape === 'torch') {
      const m = md[i], s = sky(x, y, z), t = bd.tiles[0], a = 7 / 16, w = 2 / 16, h = 10 / 16;
      let bx = 0, bz = 0, lx = 0, lz = 0, lift = 0;
      if (m) { const dir = FACES[m - 1].dir; bx = -dir[0] * .34; bz = -dir[2] * .34; lx = dir[0] * .3; lz = dir[2] * .3; lift = .2; }
      for (const f of FACES) {
        const base = S.P.length / 3;
        for (const c of f.c) {
          S.P.push(X + a + c[0] * w + bx + lx * c[1], y + c[1] * h + lift, Z + a + c[2] * w + bz + lz * c[1]);
          const v = f.dir[1] === 1 ? 8 / 16 + c[4] * 2 / 16 : f.dir[1] === -1 ? c[4] * 2 / 16 : c[4] * 10 / 16;
          S.U.push(...tileUV(t, 7 / 16 + c[3] * 2 / 16, v)); S.L.push(1, s, 1, 0); S.N.push(...f.dir);
        }
        quad(S, base, false);
      }
      continue;
    }
    if (bd.shape === 'ladder') {
      const dir = FACES[md[i]].dir, ax = dir[0] ? 0 : 2, p = (dir[0] || dir[2]) > 0 ? 1 / 16 : 15 / 16, [s, b] = cellLight(x, y, z), base = S.P.length / 3;
      for (let k = 0; k < 4; k++) { const u = k & 1, v = k >> 1; S.P.push(X + (ax === 0 ? p : u), y + v, Z + (ax === 0 ? u : p)); S.U.push(...tileUV(bd.tiles[0], u, v)); S.L.push(1, s, b, 0); S.N.push(...dir); }
      both(S, base);
      continue;
    }
    if (bd.liquid) {
      const A = id === B.LAVA ? S : W, glow = id === B.LAVA;
      const ch00 = cornerH(x, y, z, 0, 0, id), ch10 = cornerH(x, y, z, 1, 0, id), ch01 = cornerH(x, y, z, 0, 1, id), ch11 = cornerH(x, y, z, 1, 1, id);
      const topH = (cx, cz) => cx ? (cz ? ch11 : ch10) : (cz ? ch01 : ch00);
      for (const f of FACES) {
        const fx = x + f.dir[0], fy = y + f.dir[1], fz = z + f.dir[2], n = nb(fx, fy, fz);
        if (n === id) continue;
        if (f.dir[1] !== 1 && !BLOCKS[n].transparent) continue;
        const base = A.P.length / 3, s = sky(fx, fy, fz), b = glow ? 1 : levelLight(blk(fx, fy, fz));
        for (const c of f.c) {
          A.P.push(X + c[0], y + (c[1] ? topH(c[0], c[2]) : 0), Z + c[2]);
          A.U.push(...tileUV(bd.tiles[0], c[3], c[4])); A.L.push(1, s, b, 1); A.N.push(...f.dir);
        }
        quad(A, base, false);
      }
      continue;
    }
    const A = id === B.ICE ? W : S, m = md[i];
    for (let fi = 0; fi < 6; fi++) {
      const f = FACES[fi], fx = x + f.dir[0], fy = y + f.dir[1], fz = z + f.dir[2], n = nb(fx, fy, fz), nd = BLOCKS[n];
      if (!nd.transparent) continue;
      if (n === id && bd.transparent) continue;
      const tile = faceTile(bd, fi, m), base = A.P.length / 3, ao = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const c = f.c[k], [o1, o2, o3] = f.ao[k];
        A.P.push(X + c[0], y + c[1], Z + c[2]);
        const uv = tileUV(tile, c[3], c[4]); A.U.push(uv[0], uv[1]);
        const s1 = occ(x + o1[0], y + o1[1], z + o1[2]), s2 = occ(x + o2[0], y + o2[1], z + o2[2]), cr = occ(x + o3[0], y + o3[1], z + o3[2]);
        const a = (s1 && s2) ? 0 : 3 - (s1 + s2 + cr); ao[k] = a;
        let ss = sky(fx, fy, fz), bl = blk(fx, fy, fz), cnt = 1;
        if (!s1) { ss += sky(x + o1[0], y + o1[1], z + o1[2]); bl += blk(x + o1[0], y + o1[1], z + o1[2]); cnt++; }
        if (!s2) { ss += sky(x + o2[0], y + o2[1], z + o2[2]); bl += blk(x + o2[0], y + o2[1], z + o2[2]); cnt++; }
        if (!cr && !(s1 && s2)) { ss += sky(x + o3[0], y + o3[1], z + o3[2]); bl += blk(x + o3[0], y + o3[1], z + o3[2]); cnt++; }
        A.L.push(AO_CURVE[a], ss / cnt, levelLight(bl / cnt), 1); A.N.push(...f.dir);
      }
      quad(A, base, ao[0] + ao[3] > ao[1] + ao[2]);
    }
  }
  disposeChunk(ch);
  if (S.I.length) { ch.mesh = new THREE.Mesh(makeGeo(S.P, S.U, S.L, S.I, 'light', 4, S.N), chunkMat); ch.mesh.castShadow = ch.mesh.receiveShadow = true; scene.add(ch.mesh); }
  if (W.I.length) { ch.water = new THREE.Mesh(makeGeo(W.P, W.U, W.L, W.I, 'light', 4, W.N), fluidMat); ch.water.receiveShadow = true; ch.water.renderOrder = 1; scene.add(ch.water); }
  ch.dirty = false; ch.meshed = true;
}
function disposeChunk(ch) {
  if (ch.mesh) { scene.remove(ch.mesh); ch.mesh.geometry.dispose(); ch.mesh = null; }
  if (ch.water) { scene.remove(ch.water); ch.water.geometry.dispose(); ch.water = null; }
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
    const ch = generateChunk(cx, cz); chunks.set(k, ch); initChunkLight(ch); flushTouched(false);
  }
  while (meshQueue.length && performance.now() - t0 < budget) {
    const [, ch] = meshQueue.shift();
    if (chunks.get(ck(ch.cx, ch.cz)) === ch && ch.dirty && hasAllNeighbours(ch)) buildMesh(ch);
  }
}
