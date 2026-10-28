'use strict';
// ============================================================
//  Entities: sound, dropped items, mobs, TNT
// ============================================================
let ac = null;
function audio() { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } } if (ac && ac.state === 'suspended') ac.resume(); return ac; }
function noise(dur, freq, q, gain, type = 'bandpass') {
  if (!ac) return; const len = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, len, ac.sampleRate), ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = buf; f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = gain;
  s.connect(f); f.connect(g); g.connect(ac.destination); s.start();
}
function tone(f0, f1, dur, gain, type = 'square', delay = 0) {
  if (!ac) return; const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + delay; o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur + .02);
}
const SND = { stone: [1800, 1.2, .5], grass: [700, .8, .55], sand: [1100, .6, .45], wood: [500, 2, .6], glass: [3200, 3, .35], water: [400, .5, .3], cloth: [900, .5, .3] };
function blockSound(id, place, soft) {
  const s = SND[BLOCKS[id].snd] || SND.stone; noise(place ? .08 : soft ? .05 : .14, s[0] * (place ? .8 : 1), s[1], s[2] * (soft ? .35 : 1));
  if (BLOCKS[id].snd === 'glass' && !place && !soft) tone(2400, 1800, .25, .05, 'sine');
}
const pickupSound = () => tone(900 + Math.random() * 500, 1500, .07, .05, 'sine');
const hurtSound = () => { tone(260, 150, .16, .14, 'triangle'); noise(.08, 500, .6, .2); };
function fizz(x, y, z) { noise(.5, 2600, .5, .22, 'highpass'); spawnParticles(x + .5, y + 1, z + .5, [.85, .85, .85], 10, .8, 1.2, { g: -3, up: 1, life: .6 }); }

// ---------- dropped items ----------
const drops = [];
function spawnDrop(id, n, x, y, z, o = {}) {
  if (!id || n <= 0) return;
  const flat = isFlatItem(id), mesh = new THREE.Mesh(flat ? planeGeo : cachedBlockGeo(id), flat ? flatItemMaterial(id) : blockFaceMaterials(id, dropVox));
  mesh.scale.setScalar(flat ? .42 : .26); mesh.castShadow = true; scene.add(mesh);
  drops.push({ id, n, dur: o.dur || 0, pos: new THREE.Vector3(x, y, z), vel: o.vel || new THREE.Vector3((Math.random() - .5) * 2.4, 3 + Math.random() * 1.5, (Math.random() - .5) * 2.4),
    onGround: false, age: 0, delay: o.delay ?? .35, mesh, phase: Math.random() * 6 });
}
const dropStack = (s, x, y, z, o = {}) => { if (s) spawnDrop(s.id, s.n, x, y, z, Object.assign({ dur: s.dur }, o)); };
function removeDrop(i) { scene.remove(drops[i].mesh); drops.splice(i, 1); }
function updateDrops(dt, light) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i]; d.age += dt;
    if (d.age > 300 || d.pos.y < -20) { removeDrop(i); continue; }
    const cell = getBlock(Math.floor(d.pos.x), Math.floor(d.pos.y + .1), Math.floor(d.pos.z));
    if (cell === B.LAVA) { fizz(Math.floor(d.pos.x), Math.floor(d.pos.y), Math.floor(d.pos.z)); removeDrop(i); continue; }
    if (cell === B.UNLOADED) continue;
    d.vel.y = cell === B.WATER ? Math.min(d.vel.y + 12 * dt, 1.2) : Math.max(d.vel.y - 20 * dt, -30);
    const k = Math.exp(-dt * (d.onGround ? 10 : 1)); d.vel.x *= k; d.vel.z *= k;
    if (!player.dead && d.age > d.delay) {
      const dx = player.pos.x - d.pos.x, dy = player.pos.y + .8 - d.pos.y, dz = player.pos.z - d.pos.z, dist = Math.hypot(dx, dy, dz);
      if (dist < 1.4) { const left = addItem(d.id, d.n, d.dur); if (left < d.n) pickupSound(); if (!left) { removeDrop(i); continue; } d.n = left; }
      else if (dist < 2.6 && roomFor(d.id)) { d.vel.x += dx / dist * 30 * dt; d.vel.y += dy / dist * 30 * dt; d.vel.z += dz / dist * 30 * dt; }
    }
    moveEntity(d, dt, .12, .25);
    d.mesh.position.set(d.pos.x, d.pos.y + .25 + Math.sin(d.age * 2.4 + d.phase) * .06, d.pos.z);
    d.mesh.rotation.y = d.age * 1.6 + d.phase;
  }
}
// what a broken block leaves behind, given the tool that broke it
function blockDrops(id, held) {
  const bd = BLOCKS[id], tool = held && ITEMS[held.id].tool ? ITEMS[held.id] : null;
  if (bd.need && !(tool && tool.tool === 'pick' && tool.tier >= bd.need)) return [];
  switch (id) {
    case B.GRASS: case B.SNOW: return [[B.DIRT, 1]];
    case B.STONE: return [[B.COBBLE, 1]];
    case B.COAL: return [[I.COAL_ITEM, 1]];
    case B.DIAMOND: return [[I.DIAMOND_GEM, 1]];
    case B.EMERALD: return [[I.EMERALD_GEM, 1]];
    case B.LAPIS: return [[I.LAPIS_ITEM, rnd(4, 8)]];
    case B.REDSTONE: return [[I.REDSTONE_DUST, rnd(4, 5)]];
    case B.GLOWSTONE: return [[I.GLOW_DUST, rnd(2, 4)]];
    case B.MELON: return [[I.MELON_SLICE, rnd(3, 7)]];
    case B.LEAVES: case B.BIRCH_LEAVES: case B.SPRUCE_LEAVES: {
      const r = Math.random();
      return r < .06 ? [[B.SAPLING, 1]] : r < .16 ? [[id, 1]] : (id === B.LEAVES && r < .21) ? [[I.APPLE, 1]] : [];
    }
    case B.DEADBUSH: return [[I.STICK, rnd(0, 2)]];
    case B.TALLGRASS: case B.GLASS: case B.ICE: case B.BEDROCK: case B.WATER: case B.LAVA: return [];
    default: return [[id, 1]];
  }
}
function dropBlockItems(x, y, z, id, popped) {
  if (id === B.CHEST) { const k = posKey(x, y, z), c = containers.get(k); if (c) { c.forEach(s => dropStack(s, x + .5, y + .5, z + .5)); containers.delete(k); } }
  if (gameMode !== 'survival') return;
  for (const [did, n] of blockDrops(id, popped ? null : heldStack())) if (n > 0) spawnDrop(did, n, x + .5, y + .4, z + .5);
}

// ---------- mobs ----------
const mobs = [], HURT_TINT = new THREE.Color(1, .25, .2);
const MOB = {
  pig: { hp: 10, hw: .42, hh: .9, speed: 1.3, passive: true, name: '돼지', drops: () => [[I.PORK_RAW, rnd(1, 3)]] },
  sheep: { hp: 8, hw: .42, hh: 1.25, speed: 1.2, passive: true, name: '양', drops: () => [[B.WOOL_WHITE, rnd(1, 2)], [I.MUTTON_RAW, rnd(1, 2)]] },
  zombie: { hp: 20, hw: .3, hh: 1.9, speed: 2.1, passive: false, name: '좀비', drops: () => [[I.ROTTEN, rnd(0, 2)], ...(Math.random() < .03 ? [[I.IRON_INGOT, 1]] : [])] },
};
function part(m, w, h, d, color, x, y, z, parent) {
  const mat = patchVoxel(new THREE.MeshStandardMaterial({ color, roughness: .85 }), false, m.vox); mat.userData.base = new THREE.Color(color); m.mats.push(mat);
  const mesh = new THREE.Mesh(shadedBox(w, h, d), mat); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; (parent || m.g).add(mesh); return mesh;
}
function limb(m, w, h, d, color, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); part(m, w, h, d, color, 0, -h / 2, 0, g); m.g.add(g); return g; }
function buildModel(m) {
  if (m.type === 'pig') {
    part(m, .62, .52, .95, 0xf0a8a4, 0, .62, 0);
    const head = new THREE.Group(); head.position.set(0, .76, -.6); m.g.add(head);
    part(m, .52, .5, .45, 0xf0a8a4, 0, 0, 0, head); part(m, .26, .18, .07, 0xd9827f, 0, -.08, -.26, head);
    for (const s of [-1, 1]) { part(m, .08, .08, .02, 0x1d1d1d, s * .13, .08, -.231, head); part(m, .08, .08, .02, 0xf4f4f4, s * .21, .08, -.231, head); }
    m.legs = [[-.18, -.3], [.18, -.3], [-.18, .3], [.18, .3]].map(([x, z]) => limb(m, .2, .38, .2, 0xe89a96, x, .38, z));
  } else if (m.type === 'sheep') {
    part(m, .7, .62, 1.0, 0xe8e8e2, 0, .82, 0);
    const head = new THREE.Group(); head.position.set(0, 1.02, -.6); m.g.add(head);
    part(m, .4, .42, .45, 0xc8b49c, 0, 0, -.06, head); part(m, .46, .2, .3, 0xe8e8e2, 0, .2, .04, head);
    for (const s of [-1, 1]) part(m, .07, .07, .02, 0x1d1d1d, s * .11, .04, -.29, head);
    m.legs = [[-.18, -.32], [.18, -.32], [-.18, .32], [.18, .32]].map(([x, z]) => limb(m, .18, .52, .18, 0xc8b49c, x, .52, z));
  } else {
    part(m, .5, .5, .5, 0x5f9a4c, 0, 1.62, 0);
    for (const s of [-1, 1]) part(m, .1, .06, .02, 0x14240f, s * .12, 1.62, -.252);
    part(m, .5, .72, .28, 0x2c8f99, 0, 1.0, 0);
    m.arms = [-1, 1].map(s => { const a = limb(m, .22, .72, .22, 0x5f9a4c, s * .36, 1.32, 0); a.rotation.x = -Math.PI / 2; return a; });
    m.legs = [-1, 1].map(s => limb(m, .24, .66, .24, 0x3f3f9a, s * .13, .66, 0));
  }
}
function spawnMob(type, x, y, z) {
  const t = MOB[type], m = { type, t, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), onGround: false, yaw: Math.random() * 6.28, tYaw: 0, walk: false, vox: { value: new THREE.Vector4(1, 1, 0, 0) },
    timer: 0, hp: t.hp, hurt: 0, flee: 0, phase: 0, atk: 0, burn: 0, fireT: 0, g: new THREE.Group(), mats: [], legs: [], arms: null };
  m.tYaw = m.yaw; buildModel(m); scene.add(m.g); mobs.push(m); return m;
}
function removeMob(m) { scene.remove(m.g); m.g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); m.mats.forEach(x => x.dispose()); mobs.splice(mobs.indexOf(m), 1); }
function hurtMob(m, dmg, dir, cause) {
  if (m.hurt > 0 && cause !== 'fire') return false;
  m.hp -= dmg; m.hurt = .4;
  if (dir) { m.vel.x = dir.x * 7; m.vel.z = dir.z * 7; m.vel.y = 5.5; }
  if (m.t.passive) { m.flee = 5; m.tYaw = dir ? Math.atan2(-dir.x, -dir.z) : Math.random() * 6.28; m.yaw = m.tYaw; }
  if (m.type === 'pig') { tone(330, 190, .12, .08); tone(300, 170, .14, .07, 'square', .14); }
  else if (m.type === 'sheep') { tone(520, 420, .25, .06, 'sawtooth'); }
  else { tone(140, 90, .3, .1, 'sawtooth'); }
  if (m.hp <= 0) {
    const c = m.type === 'zombie' ? [.37, .6, .3] : m.type === 'sheep' ? [.9, .9, .88] : [.94, .66, .64];
    spawnParticles(m.pos.x, m.pos.y + .6, m.pos.z, c, 26, .9, 3.5); noise(.3, 600, .7, .35);
    if (gameMode === 'survival') for (const [id, n] of m.t.drops()) spawnDrop(id, n, m.pos.x, m.pos.y + .5, m.pos.z);
    removeMob(m);
  }
  return true;
}
let mobSpawnT = 2;
function findSpawnSpot(cx, cz, yHint, needSky) {
  for (let y = Math.min(H - 3, yHint + 12); y > Math.max(1, yHint - 24); y--) {
    const b = getBlock(cx, y, cz);
    if (!BLOCKS[b].solid || b === B.LEAVES || b === B.BIRCH_LEAVES || b === B.SPRUCE_LEAVES) continue;
    if (BLOCKS[getBlock(cx, y + 1, cz)].solid || BLOCKS[getBlock(cx, y + 2, cz)].solid || isFluid(getBlock(cx, y + 1, cz))) continue;
    if (needSky && !skyAt(cx, y + 1, cz)) continue;
    return [b, y + 1];
  }
  return null;
}
function updateMobs(dt, daylight) {
  mobSpawnT -= dt;
  if (mobSpawnT <= 0 && !player.dead) {
    mobSpawnT = 3;
    const passive = mobs.filter(m => m.t.passive).length, hostile = mobs.length - passive;
    const a = Math.random() * 6.28, r = 18 + Math.random() * 22, x = Math.floor(player.pos.x + Math.cos(a) * r), z = Math.floor(player.pos.z + Math.sin(a) * r);
    const ch = chunks.get(ck(x >> 4, z >> 4));
    if (ch && ch.meshed) {
      if (passive < 8 && Math.random() < .6) {
        const s = findSpawnSpot(x, z, Math.floor(player.pos.y), true);
        if (s && s[0] === B.GRASS) { const type = Math.random() < .5 ? 'pig' : 'sheep', n = rnd(1, 3); for (let i = 0; i < n; i++) spawnMob(type, x + .5 + i * .6, s[1], z + .5 + (i % 2) * .6); }
      } else if (difficulty > 0 && hostile < (difficulty === 2 ? 8 : 5)) {
        const s = findSpawnSpot(x, z, Math.floor(player.pos.y), false);
        if (s && getLight(x, s[1], z) < 6 && (!skyAt(x, s[1], z) || daylight < .4)) spawnMob('zombie', x + .5, s[1], z + .5);
      }
    }
  }
  const invisible = hasEff('invis') > 0;
  for (let i = mobs.length - 1; i >= 0; i--) {
    const m = mobs[i], t = m.t;
    const dist = m.pos.distanceTo(player.pos);
    if (dist > renderDist * CS + 24 || m.pos.y < -10 || (m.type === 'zombie' && difficulty === 0)) { removeMob(m); continue; }
    const ch = chunks.get(ck(Math.floor(m.pos.x) >> 4, Math.floor(m.pos.z) >> 4)); if (!ch || !ch.meshed) continue;
    m.timer -= dt; m.flee -= dt; m.hurt -= dt; m.atk -= dt; m.fireT -= dt;
    let sp = 0;
    const chase = m.type === 'zombie' && !player.dead && gameMode === 'survival' && !invisible && dist < 24;
    if (chase) {
      m.tYaw = Math.atan2(-(player.pos.x - m.pos.x), -(player.pos.z - m.pos.z)); sp = t.speed * (difficulty === 2 ? 1.2 : 1);
      const hd = Math.hypot(player.pos.x - m.pos.x, player.pos.z - m.pos.z);
      if (hd < 1.25 && Math.abs(player.pos.y - m.pos.y) < 1.6 && m.atk <= 0) {
        m.atk = 1; const k = new THREE.Vector3(player.pos.x - m.pos.x, 0, player.pos.z - m.pos.z).normalize();
        damagePlayer(difficulty === 2 ? 4.5 : 3, 'mob', new THREE.Vector3(k.x * 6, 4, k.z * 6));
      }
      if (hd < 1) sp = 0;
    } else {
      if (m.timer <= 0) { m.walk = Math.random() < .6; m.tYaw = m.yaw + (Math.random() - .5) * 3; m.timer = 2 + Math.random() * 4; }
      sp = m.flee > 0 ? 3.2 : m.walk ? t.speed * .6 : 0;
    }
    let dy = m.tYaw - m.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); m.yaw += dy * Math.min(1, dt * (chase ? 8 : 4));
    const fx = -Math.sin(m.yaw) * sp, fz = -Math.cos(m.yaw) * sp, k = 1 - Math.exp(-dt * (m.onGround ? 10 : 2));
    m.vel.x += (fx - m.vel.x) * k; m.vel.z += (fz - m.vel.z) * k;
    const wet = touchesBlock(m.pos.x, m.pos.y, m.pos.z, t.hw, .6, b => b === B.WATER), hot = touchesBlock(m.pos.x, m.pos.y, m.pos.z, t.hw, t.hh, b => b === B.LAVA);
    if (wet || hot) m.vel.y = Math.min(m.vel.y + (hot ? 10 : 22) * dt, 2.5); else m.vel.y = Math.max(m.vel.y - 28 * dt, -40);
    const hit = moveEntity(m, dt, t.hw, t.hh);
    if (hit && m.onGround && sp > 0) m.vel.y = 7.6;
    if (hit && !chase && !wet) m.tYaw += 1.2 * dt;
    // burning: lava always, zombies under open daylight sky
    if (hot) m.burn = 8;
    if (m.type === 'zombie' && daylight > .7 && skyAt(Math.floor(m.pos.x), Math.floor(m.pos.y + 1.6), Math.floor(m.pos.z))) m.burn = Math.max(m.burn, 1);
    if (wet) m.burn = 0;
    if (m.burn > 0) {
      m.burn -= dt;
      if (Math.random() < dt * 12) spawnParticles(m.pos.x, m.pos.y + t.hh * Math.random(), m.pos.z, [1, .55, .1], 1, t.hw * 2, .4, { g: -4, up: 1.5, life: .3, glow: true });
      if (m.fireT <= 0) { m.fireT = 1; hurtMob(m, hot ? 4 : 1, null, 'fire'); if (m.hp <= 0) continue; }
    }
    const hv = Math.hypot(m.vel.x, m.vel.z); m.phase += hv * dt * 7;
    const sw = Math.sin(m.phase) * Math.min(1, hv) * .7;
    if (m.legs.length === 4) { m.legs[0].rotation.x = m.legs[3].rotation.x = sw; m.legs[1].rotation.x = m.legs[2].rotation.x = -sw; }
    else { m.legs[0].rotation.x = sw; m.legs[1].rotation.x = -sw; m.arms[0].rotation.x = -Math.PI / 2 + sw * .2 - (m.atk > .8 ? .5 : 0); m.arms[1].rotation.x = -Math.PI / 2 - sw * .2 - (m.atk > .8 ? .5 : 0); }
    m.g.position.copy(m.pos); m.g.rotation.y = m.yaw;
    cellVox(m.pos.x, m.pos.y + .5, m.pos.z, m.vox.value);
    for (const mat of m.mats) { mat.color.copy(mat.userData.base); if (m.hurt > 0 || m.burn > 0) mat.color.lerp(HURT_TINT, m.hurt > 0 ? .55 : .25); }
  }
}
function rayBox(o, d, min, max) {
  let t0 = 0, t1 = 1e9;
  for (const a of ['x', 'y', 'z']) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < min[a] || o[a] > max[a]) return -1; continue; }
    let ta = (min[a] - o[a]) / d[a], tb = (max[a] - o[a]) / d[a]; if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return -1;
  }
  return t0;
}
function mobOnRay(o, d, maxT) {
  let best = null, bt = maxT;
  for (const m of mobs) { const w = m.t.hw + .05, t = rayBox(o, d, { x: m.pos.x - w, y: m.pos.y, z: m.pos.z - w }, { x: m.pos.x + w, y: m.pos.y + m.t.hh, z: m.pos.z + w }); if (t >= 0 && t < bt) { bt = t; best = m; } }
  return best;
}

// ---------- TNT ----------
const tnts = []; let shake = 0;
function primeTNT(x, y, z, fuse = 2.5) {
  const mats = blockFaceMaterials(B.TNT, dropVox, true); // its own materials, so only this block flashes
  const m = new THREE.Mesh(cachedBlockGeo(B.TNT), mats); m.position.set(x + .5, y + .5, z + .5); m.castShadow = true; scene.add(m);
  tnts.push({ t: fuse, m, mats, vy: 2 }); tone(900, 200, .5, .05, 'sawtooth');
}
function updateTNT(dt, light) {
  for (let i = tnts.length - 1; i >= 0; i--) {
    const t = tnts[i]; t.t -= dt;
    t.vy -= 20 * dt; const ny = t.m.position.y + t.vy * dt;
    if (BLOCKS[getBlock(Math.floor(t.m.position.x), Math.floor(ny - .5), Math.floor(t.m.position.z))].solid) { t.vy = 0; t.m.position.y = Math.floor(ny - .5) + 1.5; } else t.m.position.y = ny;
    for (const mt of t.mats) mt.emissive.setScalar(Math.floor(t.t * 6) % 2 === 0 ? 1.4 : 0);
    t.m.scale.setScalar(1 + Math.max(0, .4 - t.t) * .5);
    if (t.t <= 0) { tnts.splice(i, 1); scene.remove(t.m); disposeMats(t.mats); explode(t.m.position.x, t.m.position.y, t.m.position.z, 3.6); }
  }
}
function explode(cx, cy, cz, R) {
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++) for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
    if (Math.hypot(x + .5 - cx, y + .5 - cy, z + .5 - cz) > R - Math.random() * .8) continue;
    const b = getBlock(x, y, z); if (b === B.AIR || b === B.BEDROCK || b === B.OBSIDIAN || b === B.UNLOADED || isFluid(b)) continue;
    if (b === B.TNT) { setBlock(x, y, z, B.AIR, 0, true); primeTNT(x, y, z, .3 + Math.random() * .5); continue; }
    if (Math.random() < .1) spawnBreakParticles(x, y, z, b);
    if (Math.random() < .3 || b === B.CHEST) dropBlockItems(x, y, z, b, true);
    setBlock(x, y, z, B.AIR, 0, true);
  }
  flushTouched(true);
  spawnParticles(cx, cy, cz, [.9, .9, .85], 40, 2.5, 8); spawnParticles(cx, cy, cz, [1, .6, .2], 20, 1.5, 6, { glow: true });
  noise(1.2, 140, .7, 1.2, 'lowpass'); noise(.4, 900, .5, .4);
  const c = new THREE.Vector3(cx, cy, cz), dp = new THREE.Vector3(player.pos.x, player.pos.y + .9, player.pos.z).sub(c), dist = dp.length();
  if (dist < 8) {
    const f = (8 - dist) * 1.5 / Math.max(dist, 1);
    damagePlayer(Math.round((1 - dist / 8) * 16), 'explosion', new THREE.Vector3(dp.x * f, Math.max(4, dp.y * f), dp.z * f), true);
  }
  for (const m of [...mobs]) { const d2 = m.pos.distanceTo(c); if (d2 < 6) { m.hurt = 0; hurtMob(m, (1 - d2 / 6) * 20, new THREE.Vector3(m.pos.x - cx, 0, m.pos.z - cz).normalize()); } }
  if (!reduceMotion) shake = Math.max(shake, clamp(1.2 - dist / 20, 0, 1));
}
