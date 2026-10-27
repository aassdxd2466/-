'use strict';
// ============================================================
//  World: generation, storage, block light, fluids, physics
// ============================================================
const chunks = new Map();
let edits = new Map();        // chunk key -> { cx, cz, m: Map(index -> id | meta << 8) }
let containers = new Map();   // "x,y,z" -> 27 chest slots
let saplings = new Map();     // "x,y,z" -> seconds until it grows
const ck = (cx, cz) => ((cx & 0xffff) << 16) | (cz & 0xffff);
const posKey = (x, y, z) => x + ',' + y + ',' + z;
const NB6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const N = {};
let saveDirty = false;
function initNoise(seed) {
  SEED = seed;
  ['cont', 'hill', 'ridge', 'mount', 'temp', 'wet', 'forest', 'cave1', 'cave2', 'cave3', 'clay'].forEach((k, i) => N[k] = new Perlin(seed * 31 + i * 1013));
}

// ---------- terrain ----------
function terrain(x, z) {
  const cont = fbm(N.cont, x / 350, z / 350, 3), hills = fbm(N.hill, x / 90, z / 90, 4);
  const ridge = 1 - Math.abs(N.ridge.noise(x / 180, z / 180, .3));
  const mmask = smooth(0.0, 0.32, fbm(N.mount, x / 600, z / 600, 2));
  const h = clamp(Math.floor(38 + cont * 32 + hills * 11 + ridge * ridge * ridge * mmask * 48), 4, H - 14);
  const temp = fbm(N.temp, x / 480, z / 480, 2), wet = fbm(N.wet, x / 300, z / 300, 2);
  const biome = h > 74 ? 'mountain' : (temp > 0.2 && h > WATER && h < 60) ? 'desert' : temp < -0.2 ? 'snow' : wet > 0.12 ? 'birch' : 'plains';
  return { h, biome, wet };
}
function isCave(x, y, z) {
  const a = N.cave1.noise(x / 30, y / 18, z / 30), b = N.cave2.noise(x / 30, y / 18, z / 30);
  if (a * a + b * b < 0.0045) return true;
  return y < 28 && N.cave3.noise(x / 48, y / 28, z / 48) > 0.42;
}
function oreAt(gx, y, gz) {
  const r = hash3(gx >> 1, y >> 1, gz >> 1);
  if (r < 0.06 && hash3(gx, y, gz) < 0.55) {
    const k = r / 0.06;
    if (k < 0.45) return B.COAL;
    if (k < 0.7 && y < 64) return B.IRON;
    if (k < 0.78 && y < 32) return B.GOLD;
    if (k < 0.85 && y < 30) return B.LAPIS;
    if (k < 0.92 && y < 16) return B.REDSTONE;
    if (k < 0.97 && y < 16) return B.DIAMOND;
    if (k >= 0.97 && y < 32) return B.EMERALD;
  }
  return B.STONE;
}
const TREE = { oak: [B.LOG, B.LEAVES], birch: [B.BIRCH_LOG, B.BIRCH_LEAVES], spruce: [B.SPRUCE_LOG, B.SPRUCE_LEAVES] };
function treeAt(gx, gz, t) {
  if (t.h <= WATER + 1 || t.biome === 'desert' || t.biome === 'mountain') return null;
  const forest = Math.max(0, N.forest.noise(gx / 90, gz / 90, 1.1));
  const dens = t.biome === 'snow' ? 0.01 + forest * 0.05 : 0.003 + forest * 0.07;
  if (hash3(gx, 13, gz) >= dens) return null;
  const r = hash3(gx, 17, gz);
  const type = t.biome === 'snow' ? 'spruce' : t.biome === 'birch' ? (r < .7 ? 'birch' : 'oak') : (r < .12 ? 'birch' : 'oak');
  return { type, th: (type === 'spruce' ? 6 : 4) + Math.floor(r * 3) };
}
// put(x, y, z, id, isLeaf) writes one tree block
function growTree(type, th, gx, base, gz, put) {
  const [log, leaf] = TREE[type], crown = base + th;
  if (type === 'spruce') {
    for (let k = 0; k <= th - 2; k++) {
      const ly = crown - k, rad = k === 0 ? 0 : k < 3 ? 1 : (k % 2 ? 1 : 2);
      for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) { if (rad && Math.abs(dx) === rad && Math.abs(dz) === rad) continue; put(gx + dx, ly, gz + dz, leaf, true); }
    }
    put(gx, crown + 1, gz, leaf, true);
  } else {
    for (let ly = crown - 3; ly <= crown; ly++) {
      const rad = ly >= crown - 1 ? 1 : 2;
      for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
        if (Math.abs(dx) === rad && Math.abs(dz) === rad && (ly === crown || hash3(gx + dx, ly, gz + dz) < .5)) continue;
        put(gx + dx, ly, gz + dz, leaf, true);
      }
    }
  }
  for (let y = base; y < crown; y++) put(gx, y, gz, log, false);
}
function nearWater(gx, gz) { for (const fi of HORIZ) { const d = FACES[fi].dir; if (terrain(gx + d[0], gz + d[2]).h < WATER) return true; } return false; }

function generateChunk(cx, cz) {
  const n = CS * CS * H, d = new Uint8Array(n), meta = new Uint8Array(n), ox = cx * CS, oz = cz * CS, L = CS * CS;
  const idx = (x, y, z) => (y * CS + z) * CS + x;
  const cols = new Array(L);
  let maxY = 0;
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const gx = ox + x, gz = oz + z, t = terrain(gx, gz), h = t.h; cols[z * CS + x] = t;
    const under = h < WATER, desert = t.biome === 'desert', sandy = desert || (h <= WATER + 1 && h >= WATER - 3);
    const clayPatch = under && h >= WATER - 6 && N.clay.noise(gx / 14, gz / 14, .7) > .35;
    const top = Math.max(h, WATER);
    for (let y = 0; y <= top; y++) {
      let b;
      if (y === 0 || (y < 4 && hash3(gx, y, gz) < 0.6 - y * 0.18)) b = B.BEDROCK;
      else if (y < h - 3) b = oreAt(gx, y, gz);
      else if (y < h) b = desert ? (y < h - 2 ? B.SANDSTONE : B.SAND) : sandy ? B.SAND : t.biome === 'mountain' ? B.STONE : B.DIRT;
      else if (y === h) b = under ? (clayPatch ? B.CLAY : h < WATER - 4 ? (hash3(gx, 3, gz) < .5 ? B.GRAVEL : B.DIRT) : B.SAND)
        : sandy ? B.SAND : t.biome === 'mountain' ? (h > 84 ? B.SNOWBLOCK : B.STONE) : t.biome === 'snow' ? B.SNOW : B.GRASS;
      else b = (y === WATER && t.biome === 'snow') ? B.ICE : B.WATER;
      if (y > 3 && y < h - 2 && b !== B.BEDROCK && isCave(gx, y, gz)) b = y <= 10 ? B.LAVA : B.AIR;
      d[idx(x, y, z)] = b;
    }
    // glowstone on deep cave ceilings, mushrooms on cave floors
    for (let y = 5, ym = Math.min(h - 3, 40); y < ym; y++) {
      const i = idx(x, y, z); if (d[i] !== B.AIR) continue;
      if (y < 30 && d[i + L] === B.STONE && hash3(gx, y, gz) < 0.006) d[i + L] = B.GLOWSTONE;
      else if (d[i - L] === B.STONE && hash3(gx, y + 7, gz) < 0.004) d[i] = hash3(gx, y, gz + 3) < .5 ? B.MUSH_RED : B.MUSH_BROWN;
    }
    maxY = Math.max(maxY, top);
    if (!under && h + 4 < H) {
      const surf = d[idx(x, h, z)], r = hash3(gx, 7, gz), up = idx(x, h + 1, z);
      if (surf === B.GRASS) {
        if (r < 0.1) d[up] = B.TALLGRASS; else if (r < 0.106) d[up] = B.ROSE; else if (r < 0.112) d[up] = B.DANDELION;
        else if (r < 0.1135) { d[up] = B.PUMPKIN; meta[up] = HORIZ[(hash3(gx, 9, gz) * 4) | 0]; }
        else if (r < 0.116 && t.wet > 0.15) d[up] = B.MELON;
      } else if (surf === B.SNOW && r < 0.04) d[up] = B.TALLGRASS;
      else if (surf === B.SAND && desert) {
        if (r < 0.005) { const ch = 1 + Math.floor(hash3(gx, 8, gz) * 3); for (let k = 1; k <= ch; k++) d[idx(x, h + k, z)] = B.CACTUS; maxY = Math.max(maxY, h + ch); }
        else if (r < 0.012) d[up] = B.DEADBUSH;
      }
      if ((surf === B.GRASS || surf === B.SAND) && h === WATER && r > 0.9 && r < 0.97 && nearWater(gx, gz)) {
        const ch = 1 + Math.floor(hash3(gx, 11, gz) * 3); for (let k = 1; k <= ch; k++) d[idx(x, h + k, z)] = B.SUGARCANE; maxY = Math.max(maxY, h + ch);
      }
    }
  }
  // trees, including ones rooted in neighbouring chunks that overhang this one
  for (let tz = -2; tz < CS + 2; tz++) for (let tx = -2; tx < CS + 2; tx++) {
    const gx = ox + tx, gz = oz + tz, inside = tx >= 0 && tz >= 0 && tx < CS && tz < CS;
    const t = inside ? cols[tz * CS + tx] : terrain(gx, gz), tr = treeAt(gx, gz, t);
    if (!tr) continue;
    const base = t.h + 1;
    growTree(tr.type, tr.th, gx, base, gz, (x, y, z, id, leaf) => {
      const lx = x - ox, lz = z - oz; if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || y < 0 || y >= H) return;
      const i = idx(lx, y, lz), cur = d[i];
      if (!leaf || cur === B.AIR || (BLOCKS[cur].shape === 'cross')) d[i] = id;
    });
    if (inside) d[idx(tx, base - 1, tz)] = B.DIRT;
    maxY = Math.max(maxY, base + tr.th + 2);
  }
  const ch = { cx, cz, data: d, meta, light: new Uint8Array(n), top: new Int16Array(L), maxY: Math.min(maxY + 1, H - 1), mesh: null, water: null, dirty: true, meshed: false };
  const e = edits.get(ck(cx, cz));
  if (e) for (const [i, v] of e.m) { d[i] = v & 255; meta[i] = v >> 8; const y = (i / L) | 0; if ((v & 255) && y >= ch.maxY) ch.maxY = Math.min(y + 1, H - 1); }
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) computeTop(ch, x, z);
  return ch;
}
function computeTop(ch, x, z) {
  let y = ch.maxY; for (; y >= 0; y--) if (BLOCKS[ch.data[(y * CS + z) * CS + x]].sky) break;
  ch.top[z * CS + x] = y;
}

// ---------- access ----------
function getBlock(x, y, z) {
  if (y < 0) return B.BEDROCK; if (y >= H) return B.AIR;
  const ch = chunks.get(ck(x >> 4, z >> 4)); if (!ch) return B.UNLOADED;
  return ch.data[(y * CS + (z & 15)) * CS + (x & 15)];
}
function getMeta(x, y, z) { if (y < 0 || y >= H) return 0; const ch = chunks.get(ck(x >> 4, z >> 4)); return ch ? ch.meta[(y * CS + (z & 15)) * CS + (x & 15)] : 0; }
function getLight(x, y, z) { if (y < 0 || y >= H) return 0; const ch = chunks.get(ck(x >> 4, z >> 4)); return ch ? ch.light[(y * CS + (z & 15)) * CS + (x & 15)] : 0; }
function getTop(x, z) { const ch = chunks.get(ck(x >> 4, z >> 4)); return ch ? ch.top[(z & 15) * CS + (x & 15)] : -1; }
const skyAt = (x, y, z) => y > getTop(x, z) ? 1 : 0;
// brightness of an entity standing in this cell, for given daylight
function lightAt(x, y, z, daylight) { x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); return Math.max(skyAt(x, y, z) * daylight, LIGHT_CURVE[getLight(x, y, z)], .12); }
function hasAllNeighbours(ch) { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!chunks.has(ck(ch.cx + dx, ch.cz + dz))) return false; return true; }

// chunks whose mesh must be rebuilt (a changed cell on a border also touches the neighbour)
const touched = new Set();
function touch(x, z) {
  const cx = x >> 4, cz = z >> 4, lx = x & 15, lz = z & 15;
  touched.add(ck(cx, cz));
  const dx = lx === 0 ? -1 : lx === 15 ? 1 : 0, dz = lz === 0 ? -1 : lz === 15 ? 1 : 0;
  if (dx) touched.add(ck(cx + dx, cz)); if (dz) touched.add(ck(cx, cz + dz)); if (dx && dz) touched.add(ck(cx + dx, cz + dz));
}
function flushTouched(rebuildNow) {
  for (const k of touched) { const c = chunks.get(k); if (!c) continue; c.dirty = true; if (rebuildNow && c.meshed && hasAllNeighbours(c)) buildMesh(c); }
  touched.clear();
}

// ---------- block light (flood fill, 15 levels) ----------
const lightQ = [];
function propagateLight() {
  for (let qi = 0; qi < lightQ.length;) {
    const x = lightQ[qi++], y = lightQ[qi++], z = lightQ[qi++], l = getLight(x, y, z);
    if (l <= 1) continue;
    for (const [dx, dy, dz] of NB6) {
      const nx = x + dx, ny = y + dy, nz = z + dz; if (ny < 0 || ny >= H) continue;
      const ch = chunks.get(ck(nx >> 4, nz >> 4)); if (!ch) continue;
      const i = (ny * CS + (nz & 15)) * CS + (nx & 15);
      if (BLOCKS[ch.data[i]].opaque || ch.light[i] + 2 > l) continue;
      ch.light[i] = l - 1; touch(nx, nz); lightQ.push(nx, ny, nz);
    }
  }
  lightQ.length = 0;
}
function removeLight(x, y, z) {
  const ch0 = chunks.get(ck(x >> 4, z >> 4)); if (!ch0) return;
  const i0 = (y * CS + (z & 15)) * CS + (x & 15), rq = [x, y, z, ch0.light[i0]], relight = [];
  ch0.light[i0] = 0; touch(x, z);
  for (let qi = 0; qi < rq.length;) {
    const x0 = rq[qi++], y0 = rq[qi++], z0 = rq[qi++], l = rq[qi++];
    for (const [dx, dy, dz] of NB6) {
      const nx = x0 + dx, ny = y0 + dy, nz = z0 + dz; if (ny < 0 || ny >= H) continue;
      const ch = chunks.get(ck(nx >> 4, nz >> 4)); if (!ch) continue;
      const i = (ny * CS + (nz & 15)) * CS + (nx & 15), nl = ch.light[i];
      if (nl !== 0 && nl < l) { ch.light[i] = 0; touch(nx, nz); rq.push(nx, ny, nz, nl); if (BLOCKS[ch.data[i]].light) relight.push(nx, ny, nz, ch, i); }
      else if (nl >= l) lightQ.push(nx, ny, nz);
    }
  }
  for (let k = 0; k < relight.length; k += 5) { const ch = relight[k + 3], i = relight[k + 4]; ch.light[i] = BLOCKS[ch.data[i]].light; lightQ.push(relight[k], relight[k + 1], relight[k + 2]); }
}
function lightAfterChange(x, y, z, oldId, newId) {
  const nb = BLOCKS[newId];
  if (BLOCKS[oldId].light || nb.opaque) removeLight(x, y, z);
  if (nb.light) { const ch = chunks.get(ck(x >> 4, z >> 4)); ch.light[(y * CS + (z & 15)) * CS + (x & 15)] = Math.max(nb.light, getLight(x, y, z)); lightQ.push(x, y, z); }
  if (!nb.opaque) for (const [dx, dy, dz] of NB6) if (getLight(x + dx, y + dy, z + dz) > 1) lightQ.push(x + dx, y + dy, z + dz);
  propagateLight();
}
function initChunkLight(ch) {
  const ox = ch.cx * CS, oz = ch.cz * CS, d = ch.data, L = CS * CS;
  for (let i = 0, n = d.length; i < n; i++) { const e = BLOCKS[d[i]].light; if (e) { ch.light[i] = e; lightQ.push(ox + i % CS, (i / L) | 0, oz + ((i / CS) | 0) % CS); } }
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nb = chunks.get(ck(ch.cx + dx, ch.cz + dz)); if (!nb) continue;
    for (let y = 0; y < H; y++) for (let k = 0; k < CS; k++) {
      const lx = dx ? (dx > 0 ? 0 : 15) : k, lz = dz ? (dz > 0 ? 0 : 15) : k;
      if (nb.light[(y * CS + lz) * CS + lx] > 1) lightQ.push(nb.cx * CS + lx, y, nb.cz * CS + lz);
    }
  }
  propagateLight();
}

// ---------- editing ----------
// block that keeps another block in place: plants sit on top, torches and ladders hang on a face
function supportOf(x, y, z, id, meta) {
  const bd = BLOCKS[id];
  if (bd.shape === 'torch') { if (!meta) return [x, y - 1, z]; const d = FACES[meta - 1].dir; return [x - d[0], y - d[1], z - d[2]]; }
  if (bd.shape === 'ladder') { const d = FACES[meta].dir; return [x - d[0], y - d[1], z - d[2]]; }
  if (bd.support) return [x, y - 1, z];
  return null;
}
function supported(x, y, z, id, meta) {
  const s = supportOf(x, y, z, id, meta); if (!s) return true;
  const b = getBlock(s[0], s[1], s[2]);
  if (b === B.UNLOADED) return true;
  if ((id === B.CACTUS || id === B.SUGARCANE) && b === id) return true;
  return BLOCKS[b].solid;
}
function setBlock(x, y, z, id, meta = 0, batch = false) {
  if (y < 0 || y >= H) return false;
  const cx = x >> 4, cz = z >> 4, ch = chunks.get(ck(cx, cz)); if (!ch) return false;
  const lx = x & 15, lz = z & 15, i = (y * CS + lz) * CS + lx, old = ch.data[i];
  if (old === id && ch.meta[i] === meta) return false;
  ch.data[i] = id; ch.meta[i] = meta;
  const key = ck(cx, cz); let e = edits.get(key); if (!e) { e = { cx, cz, m: new Map() }; edits.set(key, e); }
  e.m.set(i, id | (meta << 8));
  if (id && y >= ch.maxY) ch.maxY = Math.min(y + 1, H - 1);
  computeTop(ch, lx, lz);
  touch(x, z); saveDirty = true;
  if (old !== id) {
    const ob = BLOCKS[old], nb = BLOCKS[id];
    if (ob.light || nb.light || ob.opaque !== nb.opaque) lightAfterChange(x, y, z, old, id);
    if (old === B.SAPLING) saplings.delete(posKey(x, y, z));
    // things resting on or hanging from this cell fall off
    if (!(nb.solid && !nb.transparent)) for (const [dx, dy, dz] of NB6) {
      const ax = x + dx, ay = y + dy, az = z + dz, a = getBlock(ax, ay, az);
      if (a === B.AIR || a === B.UNLOADED || (!BLOCKS[a].support && BLOCKS[a].shape !== 'torch' && BLOCKS[a].shape !== 'ladder')) continue;
      if (!supported(ax, ay, az, a, getMeta(ax, ay, az))) { dropBlockItems(ax, ay, az, a, true); spawnBreakParticles(ax, ay, az, a); setBlock(ax, ay, az, B.AIR, 0, true); }
    }
  }
  scheduleFluid(x, y, z); for (const [dx, dy, dz] of NB6) scheduleFluid(x + dx, y + dy, z + dz);
  if (!batch) flushTouched(true);
  return true;
}

// ---------- flowing water and lava ----------
const fluidDue = new Map();
function scheduleFluid(x, y, z, delay) {
  const id = getBlock(x, y, z); if (!isFluid(id)) return;
  const k = posKey(x, y, z); if (!fluidDue.has(k)) fluidDue.set(k, performance.now() + (delay ?? (id === B.LAVA ? 1500 : 250)));
}
const canFlowInto = b => b === B.AIR || BLOCKS[b].shape === 'cross' || BLOCKS[b].shape === 'torch';
function flowInto(x, y, z, id, m) { const b = getBlock(x, y, z); if (b !== B.AIR) dropBlockItems(x, y, z, b, true); setBlock(x, y, z, id, m, true); }
function fluidTick(x, y, z) {
  const id = getBlock(x, y, z); if (!isFluid(id)) return;
  const lava = id === B.LAVA, step = lava ? 2 : 1;
  let m = getMeta(x, y, z);
  if (lava) for (const [dx, dy, dz] of NB6) if (getBlock(x + dx, y + dy, z + dz) === B.WATER) { setBlock(x, y, z, m === 0 ? B.OBSIDIAN : B.COBBLE, 0, true); fizz(x, y, z); return; }
  if (m !== 0) {
    let nm;
    if (getBlock(x, y + 1, z) === id) nm = 8;
    else {
      let best = 99, sources = 0;
      for (const fi of HORIZ) { const d = FACES[fi].dir; if (getBlock(x + d[0], y, z + d[2]) !== id) continue; const mm = getMeta(x + d[0], y, z + d[2]); if (mm === 0) sources++; best = Math.min(best, mm >= 8 ? 0 : mm); }
      const below = getBlock(x, y - 1, z);
      nm = (!lava && sources >= 2 && (BLOCKS[below].solid || (below === id && getMeta(x, y - 1, z) === 0))) ? 0 : best + step <= 7 ? best + step : -1;
    }
    if (nm !== m) { if (nm < 0) { setBlock(x, y, z, B.AIR, 0, true); return; } setBlock(x, y, z, id, nm, true); m = nm; }
  }
  const below = getBlock(x, y - 1, z);
  if (!lava && below === B.LAVA) scheduleFluid(x, y - 1, z, 50);
  if (y > 0 && canFlowInto(below)) { flowInto(x, y - 1, z, id, 8); return; }
  if (below === id) { const bm = getMeta(x, y - 1, z); if (bm !== 0 && bm !== 8) setBlock(x, y - 1, z, id, 8, true); return; }
  const nl = (m >= 8 ? 0 : m) + step;
  if (nl > 7) return;
  for (const fi of HORIZ) {
    const d = FACES[fi].dir, nx = x + d[0], nz = z + d[2], nb = getBlock(nx, y, nz);
    if (canFlowInto(nb)) flowInto(nx, y, nz, id, nl);
    else if (nb === id) { const mm = getMeta(nx, y, nz); if (mm !== 0 && mm !== 8 && mm > nl) setBlock(nx, y, nz, id, nl, true); }
    else if (!lava && nb === B.LAVA) scheduleFluid(nx, y, nz, 50);
  }
}
function updateFluids(now) {
  if (!fluidDue.size) return;
  let n = 0;
  for (const [k, t] of fluidDue) {
    if (t > now) continue;
    fluidDue.delete(k);
    const p = k.split(','); fluidTick(+p[0], +p[1], +p[2]);
    if (++n > 400) break;
  }
  flushTouched(true);
}

// ---------- saplings ----------
let saplingClock = 0;
function updateSaplings(dt) {
  saplingClock += dt; if (saplingClock < 1) return;
  const step = saplingClock; saplingClock = 0;
  for (const [k, t] of saplings) {
    const [x, y, z] = k.split(',').map(Number), b = getBlock(x, y, z);
    if (b === B.UNLOADED) continue;
    if (b !== B.SAPLING) { saplings.delete(k); continue; }
    if (t - step > 0) { saplings.set(k, t - step); continue; }
    saplings.delete(k);
    const type = Math.random() < .3 ? 'birch' : 'oak', th = 4 + rnd(0, 2);
    let room = true; for (let yy = y + 1; yy <= y + th + 1; yy++) if (getBlock(x, yy, z) !== B.AIR && !BLOCKS[getBlock(x, yy, z)].replace) room = false;
    if (!room) { saplings.set(k, 30); continue; }
    setBlock(x, y, z, B.AIR, 0, true);
    growTree(type, th, x, y, z, (px, py, pz, id, leaf) => { const c = getBlock(px, py, pz); if (c === B.AIR || BLOCKS[c].shape === 'cross' || (!leaf && BLOCKS[c].transparent && !isFluid(c))) setBlock(px, py, pz, id, 0, true); });
    flushTouched(true);
  }
}

// ---------- physics shared by player, mobs and drops ----------
function collides(x, y, z, hw, hh) {
  const x0 = Math.floor(x - hw + 1e-4), x1 = Math.floor(x + hw - 1e-4), y0 = Math.floor(y), y1 = Math.floor(y + hh - 1e-4), z0 = Math.floor(z - hw + 1e-4), z1 = Math.floor(z + hw - 1e-4);
  for (let iy = y0; iy <= y1; iy++) for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) if (BLOCKS[getBlock(ix, iy, iz)].solid) return true;
  return false;
}
// any block of a kind overlapping the box (used for water, lava, ladders, cactus)
function touchesBlock(x, y, z, hw, hh, test, grow = 0) {
  const x0 = Math.floor(x - hw - grow), x1 = Math.floor(x + hw + grow), y0 = Math.floor(y), y1 = Math.floor(y + hh - 1e-4), z0 = Math.floor(z - hw - grow), z1 = Math.floor(z + hw + grow);
  for (let iy = y0; iy <= y1; iy++) for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) if (test(getBlock(ix, iy, iz))) return true;
  return false;
}
function moveEntity(e, dt, hw, hh) {
  e.onGround = false; let hitH = false;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(e.vel.x), Math.abs(e.vel.y), Math.abs(e.vel.z)) * dt / 0.3)), sdt = dt / steps;
  for (let s = 0; s < steps; s++) {
    let d = e.vel.y * sdt;
    if (d) {
      const oy = e.pos.y, ny = oy + d;
      if (collides(e.pos.x, ny, e.pos.z, hw, hh)) {
        e.pos.y = d < 0 ? Math.floor(ny) + 1 : Math.floor(ny + hh) - hh - 0.001;
        if (collides(e.pos.x, e.pos.y, e.pos.z, hw, hh)) e.pos.y = oy;
        if (d < 0) e.onGround = true; e.vel.y = 0;
      } else e.pos.y = ny;
    }
    for (const ax of ['x', 'z']) {
      d = e.vel[ax] * sdt; if (!d) continue;
      const o = e.pos[ax], n = o + d; e.pos[ax] = n;
      if (collides(e.pos.x, e.pos.y, e.pos.z, hw, hh)) {
        e.pos[ax] = d > 0 ? Math.floor(n + hw) - hw - 0.001 : Math.floor(n - hw) + 1 + hw + 0.001;
        if (collides(e.pos.x, e.pos.y, e.pos.z, hw, hh)) e.pos[ax] = o;
        e.vel[ax] = 0; hitH = true;
      }
    }
  }
  return hitH;
}
