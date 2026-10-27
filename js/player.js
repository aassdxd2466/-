'use strict';
// ============================================================
//  Player: survival stats, effects, inventory, mining, using items
// ============================================================
const player = {
  pos: new THREE.Vector3(.5, 80, .5), vel: new THREE.Vector3(), onGround: false, flying: false, yaw: 0, pitch: 0,
  inWater: false, inLava: false, eyeFluid: 0, climbing: false, sprinting: false,
  hp: 20, food: 20, sat: 5, exh: 0, air: 10, fire: 0, fallStart: null, hurtCd: 0, dead: false, spawn: [.5, .5], spawnPending: true,
  T: { regen: 0, starve: 0, air: 1.5, lava: 0, fire: 0, cactus: 0, void: 0 },
};
const PW = 0.3, PH = 1.8, EYE = 1.62;
let gameMode = 'survival', difficulty = 1;
let inv = new Array(36).fill(null), sel = 0, furnaceFuel = 0;
let invDirty = true, statsDirty = true;
let effects = {};
let hurtFlash = 0, hurtTilt = 0, deathCause = '';

// ---------- inventory ----------
const heldStack = () => inv[sel];
const heldId = () => inv[sel] ? inv[sel].id : 0;
function invChanged() { invDirty = true; setHand(heldId()); }
const matchId = (id, m) => Array.isArray(m) ? m.includes(id) : id === m;
function roomFor(id) { const ms = maxStack(id); return inv.some(s => !s || (s.id === id && s.n < ms)); }
// returns how many could not fit
function addItem(id, n, dur = 0) {
  const ms = maxStack(id);
  if (ms > 1) for (let i = 0; i < 36 && n > 0; i++) { const s = inv[i]; if (s && s.id === id && s.n < ms) { const k = Math.min(ms - s.n, n); s.n += k; n -= k; } }
  for (let i = 0; i < 36 && n > 0; i++) if (!inv[i]) { const k = Math.min(ms, n); inv[i] = { id, n: k, dur }; n -= k; }
  invChanged();
  return n;
}
function countMatch(m) { let c = 0; for (const s of inv) if (s && matchId(s.id, m)) c += s.n; return c; }
function removeMatch(m, n) {
  for (let i = 35; i >= 0 && n > 0; i--) { const s = inv[i]; if (!s || !matchId(s.id, m)) continue; const k = Math.min(s.n, n); s.n -= k; n -= k; if (!s.n) inv[i] = null; }
  invChanged();
}
function consumeHeld(n = 1) { const s = inv[sel]; if (!s) return; s.n -= n; if (s.n <= 0) inv[sel] = null; invChanged(); }
function damageHeldTool(n = 1) {
  const s = inv[sel]; if (!s || !n) return; const it = ITEMS[s.id]; if (!it.dur) return;
  s.dur = (s.dur || 0) + n;
  if (s.dur >= it.dur) { inv[sel] = null; noise(.3, 1500, 2, .4); tone(800, 300, .2, .06, 'triangle'); showToast(`${it.name}가 부서졌어요`); }
  invChanged();
}
// turn one item of the held stack into another (bucket -> water bucket, potion -> bottle)
function replaceHeldOne(newId) {
  const s = inv[sel]; if (!s) return;
  if (s.n > 1) { s.n--; if (addItem(newId, 1)) spawnDrop(newId, 1, player.pos.x, player.pos.y + 1, player.pos.z); }
  else inv[sel] = { id: newId, n: 1, dur: 0 };
  invChanged();
}
function dropHeld(all) {
  const s = inv[sel]; if (!s || player.dead) return;
  const n = all ? s.n : 1, d = lookDir();
  spawnDrop(s.id, n, player.pos.x + d.x * .4, player.pos.y + EYE - .3, player.pos.z + d.z * .4, { dur: s.dur, delay: 1.5, vel: new THREE.Vector3(d.x * 5, d.y * 5 + 1.5, d.z * 5) });
  s.n -= n; if (s.n <= 0) inv[sel] = null; invChanged();
}

// ---------- effects ----------
const hasEff = k => effects[k] ? effects[k].lv : 0;
function giveEffect(key, sec, lv = 1) {
  if (key === 'heal') { healPlayer(4 * lv); spawnParticles(player.pos.x, player.pos.y + 1, player.pos.z, [1, .3, .3], 10, 1, 1, { g: -2, up: 1 }); return; }
  const e = effects[key];
  effects[key] = { t: Math.max(sec, e ? e.t : 0), lv: Math.max(lv, e ? e.lv : 0), max: Math.max(sec, e ? e.max : 0) };
  statsDirty = true;
}
function updateEffects(dt) {
  for (const k in effects) { effects[k].t -= dt; if (effects[k].t <= 0) { delete effects[k]; statsDirty = true; } }
  if (hasEff('regen')) { player.T.regenFx = (player.T.regenFx || 0) + dt; if (player.T.regenFx >= 2.5 / hasEff('regen')) { player.T.regenFx = 0; healPlayer(1); } }
  if (hasEff('hunger')) exhaust(.1 * hasEff('hunger') * dt);
}

// ---------- health & hunger ----------
function exhaust(v) { if (gameMode === 'survival' && difficulty > 0) player.exh += v; }
function healPlayer(n) { if (player.dead) return; const o = player.hp; player.hp = Math.min(20, player.hp + n); if (o !== player.hp) statsDirty = true; }
function damagePlayer(amount, cause, knock, force) {
  if (player.dead || amount <= 0) return;
  if (gameMode === 'creative' && cause !== 'void') return;
  if ((cause === 'lava' || cause === 'fire') && hasEff('fireres')) return;
  if (player.hurtCd > 0 && !force) return;
  amount *= 1 - .2 * hasEff('resist');
  player.hp = Math.max(0, player.hp - amount); player.hurtCd = .5;
  hurtFlash = 1; hurtTilt = 1; exhaust(.1); hurtSound(); statsDirty = true;
  if (knock) player.vel.add(knock);
  if (player.hp <= 0) killPlayer(cause);
}
const DEATH_TEXT = { fall: '높은 곳에서 떨어졌습니다', lava: '용암에서 수영하려 했습니다', fire: '불에 타 죽었습니다', drown: '익사했습니다', mob: '좀비에게 당했습니다',
  starve: '굶어 죽었습니다', explosion: '폭발에 휘말렸습니다', cactus: '선인장에 찔려 죽었습니다', void: '세상 밖으로 떨어졌습니다' };
function killPlayer(cause) {
  player.dead = true; deathCause = DEATH_TEXT[cause] || '죽었습니다';
  for (let i = 0; i < 36; i++) if (inv[i]) { dropStack(inv[i], player.pos.x, player.pos.y + 1, player.pos.z, { delay: 1 }); inv[i] = null; }
  effects = {}; player.fire = 0; invChanged();
  showDeath();
}
function respawn() {
  Object.assign(player, { dead: false, hp: 20, food: 20, sat: 5, exh: 0, air: 10, fire: 0, fallStart: null, flying: false });
  effects = {}; player.vel.set(0, 0, 0);
  player.pos.set(player.spawn[0], H, player.spawn[1]); player.spawnPending = true; statsDirty = true;
}
function findSpawn() {
  for (let r = 0; r < 60; r++) {
    const a = r * 2.4, x = Math.round(Math.cos(a) * r * 10), z = Math.round(Math.sin(a) * r * 10);
    const t = terrain(x, z); if (t.h > WATER + 1 && t.h < 70) return [x + .5, z + .5];
  }
  return [.5, .5];
}
function placeAtSurface() {
  const x = Math.floor(player.pos.x), z = Math.floor(player.pos.z);
  for (let y = H - 1; y > 0; y--) { const b = getBlock(x, y, z); if (BLOCKS[b].solid || isFluid(b)) { player.pos.y = y + 1; break; } }
  player.vel.set(0, 0, 0); player.fallStart = null;
}

// ---------- movement ----------
function updatePlayer(dt, ctl) {
  const p = player, T = p.T, creative = gameMode === 'creative';
  if (!creative) p.flying = false;
  p.hurtCd -= dt;
  p.inWater = touchesBlock(p.pos.x, p.pos.y, p.pos.z, PW, PH * .6, b => b === B.WATER);
  p.inLava = touchesBlock(p.pos.x, p.pos.y, p.pos.z, PW, PH * .6, b => b === B.LAVA);
  p.climbing = !p.flying && touchesBlock(p.pos.x, p.pos.y, p.pos.z, PW, PH, b => !!BLOCKS[b].climb, .02);
  const icy = p.onGround && BLOCKS[getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y - .05), Math.floor(p.pos.z))].slip;
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  let wx = -sy * ctl.fw + cy * ctl.st, wz = -cy * ctl.fw - sy * ctl.st; const wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; }
  const sprint = ctl.sprint && (creative || p.food > 6) && !p.flying && ctl.fw > 0 && !ctl.sneak;
  p.sprinting = sprint;
  let speed = p.flying ? (ctl.fast ? 22 : 11) : sprint ? 5.6 : ctl.sneak ? 1.3 : 4.3;
  speed *= 1 + .2 * hasEff('speed');
  const swim = (p.inWater || p.inLava) && !p.flying;
  if (swim) speed *= p.inLava ? .35 : .55;
  const k = 1 - Math.exp(-dt * (p.flying ? 8 : p.onGround ? (icy ? 1.5 : 18) : swim ? 6 : 5));
  p.vel.x += (wx * speed - p.vel.x) * k; p.vel.z += (wz * speed - p.vel.z) * k;
  if (p.flying) { const vy = ((ctl.jump ? 1 : 0) - (ctl.sneak ? 1 : 0)) * 9; p.vel.y += (vy - p.vel.y) * (1 - Math.exp(-dt * 10)); }
  else if (swim) { p.vel.y -= (p.inLava ? 5 : 9) * dt; if (ctl.jump) p.vel.y += (p.inLava ? 14 : 22) * dt; p.vel.y = clamp(p.vel.y, -3.5, 3.8); }
  else if (p.climbing) { p.vel.y = (ctl.jump || ctl.fw > 0) ? 3.2 : ctl.sneak ? 0 : Math.max(p.vel.y - 28 * dt, -2.5); }
  else {
    p.vel.y = Math.max(p.vel.y - 28 * dt, -55);
    if (hasEff('slowfall')) p.vel.y = Math.max(p.vel.y, -2.2);
    if (ctl.jump && p.onGround) { p.vel.y = 8.6 + 1.5 * hasEff('jump'); exhaust(sprint ? .2 : .05); }
  }
  const wasGround = p.onGround, ox = p.pos.x, oz = p.pos.z;
  const hitH = moveEntity(p, dt, PW, PH);
  if (swim && hitH && ctl.jump) p.vel.y = 6.5;
  if (p.flying && p.onGround) p.flying = false;
  const moved = Math.hypot(p.pos.x - ox, p.pos.z - oz);
  exhaust((sprint ? .1 : 0) * moved + (p.inWater ? .01 * moved : 0));
  if (p.onGround || swim || p.flying || p.climbing || hasEff('slowfall')) {
    if (p.onGround && !wasGround && p.fallStart !== null && !swim) { const fall = p.fallStart - p.pos.y - 3 - hasEff('jump'); if (fall > .5) { damagePlayer(Math.ceil(fall), 'fall', null, true); blockSound(B.DIRT, false); } }
    p.fallStart = null;
  } else if (p.fallStart === null || p.pos.y > p.fallStart) p.fallStart = p.pos.y;
  // hazards
  if (p.pos.y < -10 && (T.void -= dt) <= 0) { T.void = .5; damagePlayer(4, 'void', null, true); }
  if (p.inLava) { if (!hasEff('fireres')) p.fire = 8; if ((T.lava -= dt) <= 0) { T.lava = .5; damagePlayer(4, 'lava', null, true); } }
  else if (p.fire > 0) { p.fire -= dt; if (p.inWater) p.fire = 0; if ((T.fire -= dt) <= 0) { T.fire = 1; damagePlayer(1, 'fire', null, true); } }
  if (touchesBlock(p.pos.x, p.pos.y, p.pos.z, PW, PH, b => b === B.CACTUS, .03) && (T.cactus -= dt) <= 0) { T.cactus = .5; damagePlayer(1, 'cactus'); }
  const eb = getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y + EYE), Math.floor(p.pos.z));
  p.eyeFluid = isFluid(eb) ? eb : 0;
  if (eb === B.WATER && !hasEff('waterbreath') && !creative) { if ((T.air -= dt) <= 0) { T.air = 1.5; if (p.air > 0) { p.air--; statsDirty = true; } else damagePlayer(2, 'drown', null, true); } }
  else if (p.air < 10) { if ((T.air -= dt) <= 0) { T.air = .12; p.air++; statsDirty = true; } }
  else T.air = 1.5;
  // hunger and natural healing
  if (!creative) {
    if (difficulty === 0) { p.food = 20; p.exh = 0; if (p.hp < 20 && (T.regen += dt) >= 1) { T.regen = 0; healPlayer(1); } }
    else {
      while (p.exh >= 4) { p.exh -= 4; if (p.sat > 0) p.sat = Math.max(0, p.sat - 1); else { p.food = Math.max(0, p.food - 1); statsDirty = true; } }
      if (p.hp < 20 && p.food >= 18) { T.regen += dt; if (T.regen >= (p.food >= 20 && p.sat > 0 ? .5 : 4)) { T.regen = 0; healPlayer(1); exhaust(6); } } else T.regen = 0;
      if (p.food <= 0) { if ((T.starve += dt) >= 4) { T.starve = 0; if (difficulty === 2 || p.hp > 1) damagePlayer(1, 'starve', null, true); } } else T.starve = 0;
    }
  }
  updateEffects(dt);
}

// ---------- looking & picking ----------
function lookDir() { const cp = Math.cos(player.pitch); return new THREE.Vector3(-Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp); }
function eyePos() { return new THREE.Vector3(player.pos.x, player.pos.y + EYE, player.pos.z); }
function raycast(o, d, maxD, fluids) {
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
  const tdx = d.x ? Math.abs(1 / d.x) : Infinity, tdy = d.y ? Math.abs(1 / d.y) : Infinity, tdz = d.z ? Math.abs(1 / d.z) : Infinity;
  let tx = d.x ? (d.x > 0 ? x + 1 - o.x : o.x - x) * tdx : Infinity, ty = d.y ? (d.y > 0 ? y + 1 - o.y : o.y - y) * tdy : Infinity, tz = d.z ? (d.z > 0 ? z + 1 - o.z : o.z - z) * tdz : Infinity;
  let face = [0, 0, 0], t = 0;
  for (let i = 0; i < 64 && t <= maxD; i++) {
    const b = getBlock(x, y, z);
    if (b === B.UNLOADED) return null;
    if (b !== B.AIR && (fluids || !isFluid(b))) return { x, y, z, face, b, t };
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; face = [-sx, 0, 0]; }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; face = [0, -sy, 0]; }
    else { z += sz; t = tz; tz += tdz; face = [0, 0, -sz]; }
  }
  return null;
}
function boxHitsEntity(x, y, z) {
  const hit = (px, py, pz, hw, hh) => x < px + hw && x + 1 > px - hw && y < py + hh && y + 1 > py && z < pz + hw && z + 1 > pz - hw;
  if (!player.dead && hit(player.pos.x, player.pos.y, player.pos.z, PW, PH)) return true;
  return mobs.some(m => hit(m.pos.x, m.pos.y, m.pos.z, m.t.hw, m.t.hh));
}

// ---------- mining ----------
let mining = null, mineSoundT = 0, breakCd = 0;
function breakTime(id, held) {
  const bd = BLOCKS[id]; if (bd.hard < 0) return Infinity; if (bd.hard === 0) return 0.05;
  const tool = held ? ITEMS[held.id] : null, right = tool && tool.tool && tool.tool === bd.tool;
  const canHarvest = !bd.need || (tool && tool.tool === 'pick' && tool.tier >= bd.need);
  let speed = right ? tool.speed : (tool && tool.tool === 'sword' && bd.snd === 'grass') ? 1.5 : 1;
  let t = bd.hard * (canHarvest ? 1.5 : 5) / speed;
  if (player.eyeFluid === B.WATER) t *= 3;
  if (!player.onGround && !player.flying && !player.climbing && !player.inWater) t *= 2;
  return t;
}
function breakBlockAt(x, y, z, id) {
  blockSound(id, false); spawnBreakParticles(x, y, z, id);
  if (id === B.TNT && gameMode === 'creative') { setBlock(x, y, z, B.AIR); primeTNT(x, y, z); return; }
  dropBlockItems(x, y, z, id, false);
  const below = getBlock(x, y - 1, z);
  setBlock(x, y, z, id === B.ICE && gameMode === 'survival' && (BLOCKS[below].solid || isFluid(below)) ? B.WATER : B.AIR);
  if (gameMode === 'survival') { damageHeldTool(BLOCKS[id].hard > 0 && ITEMS[heldId()] && ITEMS[heldId()].tool ? 1 : 0); exhaust(.005); }
}
function updateMining(dt, h, holding) {
  breakCd -= dt;
  if (!holding || !h || player.dead || gameMode !== 'survival') { mining = null; showCrack(0, 0, 0, -1); return; }
  if (!mining || mining.x !== h.x || mining.y !== h.y || mining.z !== h.z || mining.id !== h.b) mining = { x: h.x, y: h.y, z: h.z, id: h.b, p: 0 };
  if (breakCd > 0) return;
  const t = breakTime(h.b, heldStack());
  if (!isFinite(t)) { showCrack(0, 0, 0, -1); return; }
  mining.p += dt / t;
  if ((mineSoundT -= dt) <= 0) { mineSoundT = .22; blockSound(h.b, false, true); swing = 1; if (Math.random() < .5) spawnParticles(h.x + .5 + h.face[0] * .55, h.y + .5 + h.face[1] * .55, h.z + .5 + h.face[2] * .55, tileAvg[BLOCKS[h.b].tiles[1]], 2, .6, 1.5); }
  if (mining.p >= 1) { breakBlockAt(h.x, h.y, h.z, h.b); mining = null; breakCd = .15; showCrack(0, 0, 0, -1); }
  else showCrack(h.x, h.y, h.z, Math.floor(mining.p * 10));
}
// left click: hit a mob in reach, otherwise break (creative) / start mining (survival). Returns true when a mob was hit.
function primaryPress() {
  if (player.dead) return false;
  swing = 1;
  const o = eyePos(), d = lookDir(), h = raycast(o, d, 5), m = mobOnRay(o, d, Math.min(h ? h.t : 3.5, 3.5));
  if (m) {
    const s = heldStack(), it = s && ITEMS[s.id];
    let dmg = (it && it.tool ? it.dmg : 1) + 3 * hasEff('strength');
    if (!player.onGround && player.vel.y < -1) { dmg *= 1.5; spawnParticles(m.pos.x, m.pos.y + 1, m.pos.z, [.9, .9, .9], 8, .8, 2); }
    if (hurtMob(m, dmg, new THREE.Vector3(d.x, 0, d.z).normalize()) && gameMode === 'survival') { exhaust(.1); if (it && it.tool) damageHeldTool(it.tool === 'sword' ? 1 : 2); }
    return true;
  }
  if (gameMode === 'creative' && h && h.b !== B.BEDROCK) breakBlockAt(h.x, h.y, h.z, h.b);
  return false;
}

// ---------- placing & using ----------
function placeBlock(h, id) {
  const bd = BLOCKS[id];
  let px = h.x + h.face[0], py = h.y + h.face[1], pz = h.z + h.face[2], face = h.face;
  if (BLOCKS[h.b].replace && !isFluid(h.b)) { px = h.x; py = h.y; pz = h.z; face = [0, 1, 0]; }
  const cur = getBlock(px, py, pz);
  if (py < 0 || py >= H || cur === B.UNLOADED || !BLOCKS[cur].replace) return false;
  if (bd.solid && boxHitsEntity(px, py, pz)) return false;
  const fi = FACES.findIndex(f => f.dir[0] === face[0] && f.dir[1] === face[1] && f.dir[2] === face[2]);
  let meta = 0;
  if (bd.shape === 'torch') { if (face[1] === -1) return false; meta = face[1] === 1 ? 0 : fi + 1; }
  else if (bd.shape === 'ladder') { if (face[1] !== 0) return false; meta = fi; }
  else if (bd.face) { const dx = player.pos.x - (px + .5), dz = player.pos.z - (pz + .5); meta = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 0) : (dz > 0 ? 5 : 4); }
  if (!supported(px, py, pz, id, meta)) return false;
  if (cur !== B.AIR && !isFluid(cur)) dropBlockItems(px, py, pz, cur, true);
  setBlock(px, py, pz, id, meta);
  if (id === B.SAPLING) saplings.set(posKey(px, py, pz), rnd(45, 150));
  return true;
}
let using = null;
function secondaryPress(auto) {
  if (player.dead) return;
  const o = eyePos(), d = lookDir(), h = raycast(o, d, 5), s = heldStack(), it = s ? ITEMS[s.id] : null;
  if (h && !keys.KeyC) {
    if (h.b === B.CHEST) { openChest(h.x, h.y, h.z); return; }
    if (h.b === B.TABLE) { openInventory('table'); return; }
    if (h.b === B.FURNACE) { openInventory('furnace'); return; }
    if (h.b === B.BREWING) { openInventory('brew'); return; }
    if (h.b === B.TNT && s && s.id === B.TORCH) { swing = 1; setBlock(h.x, h.y, h.z, B.AIR); primeTNT(h.x, h.y, h.z); return; }
  }
  if (!s) return;
  if (it.food || it.potion || s.id === I.WATER_BOTTLE) {
    if (it.food && !it.always && (gameMode === 'creative' || player.food >= 20)) { showToast('배가 불러요'); return; }
    using = { slot: sel, id: s.id, t: 0, dur: 1.4, auto, sndT: 0 };
    return;
  }
  if (s.id === I.BUCKET || s.id === I.BOTTLE) {
    const f = raycast(o, d, 5, true);
    if (!f || !isFluid(f.b) || getMeta(f.x, f.y, f.z) !== 0) return;
    swing = 1; noise(.25, 500, .5, .3);
    if (s.id === I.BOTTLE) { if (f.b === B.WATER) replaceHeldOne(I.WATER_BOTTLE); return; }
    setBlock(f.x, f.y, f.z, B.AIR); replaceHeldOne(f.b === B.WATER ? I.WATER_BUCKET : I.LAVA_BUCKET); return;
  }
  if (it.fluid) {
    if (!h) return;
    let px = h.x + h.face[0], py = h.y + h.face[1], pz = h.z + h.face[2];
    if (BLOCKS[h.b].replace && !isFluid(h.b)) { px = h.x; py = h.y; pz = h.z; }
    const cur = getBlock(px, py, pz); if (cur === B.UNLOADED || !BLOCKS[cur].replace) return;
    if (cur !== B.AIR && !isFluid(cur)) dropBlockItems(px, py, pz, cur, true);
    setBlock(px, py, pz, it.fluid, 0); swing = 1; noise(.25, 400, .5, .3);
    if (gameMode === 'survival') replaceHeldOne(I.BUCKET);
    return;
  }
  if (isPlaceable(s.id) && h && placeBlock(h, s.id)) { swing = 1; blockSound(s.id, true); if (gameMode === 'survival') consumeHeld(1); }
}
function updateUse(dt, holdingRight) {
  if (!using) return false;
  const s = inv[sel];
  if (sel !== using.slot || !s || s.id !== using.id || (!using.auto && !holdingRight) || player.dead) { using = null; return false; }
  using.t += dt;
  if ((using.sndT -= dt) <= 0) {
    using.sndT = .24;
    if (ITEMS[s.id].food) { noise(.07, 800 + Math.random() * 400, .8, .3); const d = lookDir(), e = eyePos(); spawnParticles(e.x + d.x * .5, e.y - .25, e.z + d.z * .5, tileAvgOfItem(s.id), 3, .2, 1.5); }
    else noise(.12, 260, .6, .2, 'lowpass');
  }
  if (using.t >= using.dur) {
    const it = ITEMS[s.id]; using = null;
    if (it.food) { player.food = Math.min(20, player.food + it.food[0]); player.sat = Math.min(player.food, player.sat + it.food[1]); (it.eff || []).forEach(([e, sec, lv, ch]) => { if (Math.random() < ch) giveEffect(e, sec, lv); }); tone(420, 260, .16, .08, 'triangle'); statsDirty = true; }
    if (it.potion) { giveEffect(...it.potion); tone(500, 900, .25, .05, 'sine'); showToast(`${EFFECTS[it.potion[0]].name} 효과!`); }
    const ret = it.returns || (it.potion || s.id === I.WATER_BOTTLE ? I.BOTTLE : 0);
    if (gameMode === 'survival') { if (ret) replaceHeldOne(ret); else consumeHeld(1); }
  }
  return !!using;
}
function tileAvgOfItem(id) { const c = ITEM16[id]; if (!c) return [.8, .6, .4]; const d = c.getContext('2d').getImageData(0, 0, 16, 16).data; let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < 1024; i += 4) if (d[i + 3] > 128) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } return n ? [r / n / 255, g / n / 255, b / n / 255] : [1, 1, 1]; }
function pickBlock() {
  const h = raycast(eyePos(), lookDir(), 5); if (!h || !ITEMS[h.b]) return;
  const at = inv.findIndex(s => s && s.id === h.b);
  if (at >= 0 && at < 9) { selectSlot(at); return; }
  if (at >= 9) { const t = inv[sel]; inv[sel] = inv[at]; inv[at] = t; invChanged(); return; }
  if (gameMode === 'creative') { inv[sel] = { id: h.b, n: maxStack(h.b), dur: 0 }; invChanged(); }
}
