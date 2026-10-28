'use strict';
// ============================================================
//  Save / load and the main loop
// ============================================================
let time = 0.05, lastSave = 0;
const validStack = s => s && ITEMS[s.id] ? { id: s.id, n: clamp(s.n | 0, 1, maxStack(s.id)), dur: s.dur | 0 } : null;
function save(manual) {
  try {
    const e = []; for (const v of edits.values()) { const a = []; for (const [i, id] of v.m) a.push(i, id); e.push([v.cx, v.cz, a]); }
    const p = player;
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 2, seed: SEED, edits: e, time, inv, sel, gameMode, difficulty, furnaceFuel, effects, containers: [...containers], saplings: [...saplings],
      p: { pos: p.pos.toArray(), yaw: p.yaw, pitch: p.pitch, flying: p.flying, hp: p.hp, food: p.food, sat: p.sat, air: p.air, fire: p.fire, spawn: p.spawn, dead: p.dead },
    }));
    saveDirty = false; if (manual) showToast('저장했어요');
  } catch (err) { if (manual) showToast('이 브라우저에서는 저장할 수 없어요'); }
}
function updateSeedInfo() { $('seedInfo').textContent = `시드 ${SEED} · 월드는 이 브라우저에 자동 저장돼요`; }
const CREATIVE_START = [B.GRASS, B.STONE, B.PLANKS, B.GLASS, B.TORCH, B.GLOWSTONE, B.TNT, I.WATER_BUCKET, I.POTION_SPEED];
function initWorld(seed, data) {
  for (const ch of chunks.values()) disposeChunk(ch);
  chunks.clear(); edits = new Map(); containers = new Map(); saplings = new Map(); fluidDue.clear(); touched.clear();
  for (const m of [...mobs]) removeMob(m); while (drops.length) removeDrop(0);
  for (const t of tnts) { scene.remove(t.m); disposeMats(t.mats); } tnts.length = 0; particles.length = 0;
  initNoise(seed); paintClouds(seed);
  effects = {}; mining = null; using = null; cursor = null; player.vel.set(0, 0, 0); player.flying = false; player.dead = false; player.fallStart = null;
  inv = new Array(36).fill(null); sel = 0; furnaceFuel = 0;
  if (data) {
    for (const [cx, cz, a] of data.edits || []) { const m = new Map(); for (let i = 0; i < a.length; i += 2) m.set(a[i], a[i + 1]); edits.set(ck(cx, cz), { cx, cz, m }); }
    for (const [k, slots] of data.containers || []) containers.set(k, Array.from({ length: 27 }, (_, i) => validStack(slots && slots[i])));
    saplings = new Map(data.saplings || []);
    inv = Array.from({ length: 36 }, (_, i) => validStack(data.inv && data.inv[i]));
    sel = clamp(data.sel | 0, 0, 8); gameMode = data.gameMode === 'creative' ? 'creative' : 'survival'; difficulty = clamp(data.difficulty ?? 1, 0, 2);
    furnaceFuel = +data.furnaceFuel || 0; time = typeof data.time === 'number' ? data.time : GOLDEN_HOUR;
    for (const [k, e] of Object.entries(data.effects || {})) if (EFFECTS[k] && e && e.t > 0) effects[k] = { t: +e.t, lv: e.lv | 0 || 1, max: +e.max || +e.t };
    const p = data.p || {};
    player.spawn = Array.isArray(p.spawn) ? p.spawn : findSpawn();
    if (Array.isArray(p.pos) && !p.dead) { player.pos.fromArray(p.pos); player.spawnPending = false; } else { player.pos.set(player.spawn[0], H, player.spawn[1]); player.spawnPending = true; }
    player.yaw = +p.yaw || 0; player.pitch = +p.pitch || 0; player.flying = !!p.flying && gameMode === 'creative';
    Object.assign(player, { hp: p.dead ? 20 : clamp(+p.hp || 20, 1, 20), food: p.dead ? 20 : clamp(p.food ?? 20, 0, 20), sat: +p.sat || 5, exh: 0, air: clamp(p.air ?? 10, 0, 10), fire: +p.fire || 0 });
  } else {
    const [sx, sz] = findSpawn();
    player.spawn = [sx, sz]; player.pos.set(sx, H, sz); player.yaw = Math.PI * .25; player.pitch = -.15; player.spawnPending = true; time = GOLDEN_HOUR;
    Object.assign(player, { hp: 20, food: 20, sat: 5, exh: 0, air: 10, fire: 0 });
    if (gameMode === 'creative') CREATIVE_START.forEach((id, i) => inv[i] = { id, n: maxStack(id), dur: 0 });
  }
  genQueue = []; meshQueue = []; lastChunkScan = 0; lastStats = ''; effKey = '';
  invChanged(); renderHotbar(); updateSegs(); updateSeedInfo(); save();
}
{
  let data = null; try { data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { }
  if (data && data.v === 2 && typeof data.seed === 'number') initWorld(data.seed, data); else initWorld((Math.random() * 1e9) | 0, null);
}

let last = performance.now(), fps = 0, fpsAcc = 0, fpsN = 0, fovNow = 72, uiTick = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  fpsAcc += dt; fpsN++; if (fpsAcc > .5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  updateChunks(now, player.pos.x, player.pos.z);
  const pch = chunks.get(ck(Math.floor(player.pos.x) >> 4, Math.floor(player.pos.z) >> 4)), ready = !!(pch && pch.meshed);
  if (ready && player.spawnPending) { placeAtSurface(); player.spawnPending = false; }
  scrollFluids(now / 1000);
  const paused = mode === 'menu', playing = mode === 'play' && ready && !player.dead;

  if (!paused) {
    if (ready && !player.dead) {
      const shift = keys.ShiftLeft || keys.ShiftRight, fly = player.flying;
      const ctl = playing ? {
        fw: (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - joy.y, st: (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x,
        jump: !!keys.Space, sneak: !!keys.KeyC || (fly && shift), sprint: (shift && !fly) || Math.hypot(joy.x, joy.y) > .95, fast: !!keys.ControlLeft,
      } : { fw: 0, st: 0 };
      updatePlayer(dt, ctl);
    }
    time = (time + dt / DAY_LEN * (keys.KeyT && mode === 'play' ? TIME_FAST : 1)) % 1;
    updateFluids(now); updateSaplings(dt);
  }

  const eye = eyePos(), dir = lookDir(), aim = playing ? raycast(eye, dir, 5) : null;
  updateTouchHold(now);
  const holdL = playing && ((mouse.l && !mouse.noMine) || look.held);
  updateMining(dt, aim, holdL);
  if (playing) {
    if (gameMode === 'creative' && holdL && now - mouse.lt > 260) { mouse.lt = now; primaryPress(); }
    updateUse(dt, mouse.r);
    if (mouse.r && !using && now - mouse.rt > 230) { mouse.rt = now; secondaryPress(false); }
  } else if (mode !== 'inv') using = null;

  const nv = hasEff('nightvision') ? 1 : 0;
  const daylight = updateEnvironment(paused ? 0 : dt, time, eye, player.eyeFluid, nv);
  const pl = Math.max(lightAt(eye.x, eye.y - .5, eye.z, daylight), nv * .9);
  camera.position.copy(eye);
  if (shake > 0) { camera.position.x += (Math.random() - .5) * shake * .4; camera.position.y += (Math.random() - .5) * shake * .4; shake = Math.max(0, shake - dt * 1.8); }
  hurtTilt = Math.max(0, hurtTilt - dt * 3);
  camera.rotation.set(player.pitch, player.yaw, reduceMotion ? 0 : Math.sin(hurtTilt * Math.PI) * .1);
  const hv = Math.hypot(player.vel.x, player.vel.z);
  let fovT = 72 * (1 + .08 * hasEff('speed')) + (player.sprinting && hv > 5 ? 8 : 0) + (player.flying && hv > 9 ? 6 : 0);
  if (player.eyeFluid === B.WATER) fovT *= .92;
  fovNow += (fovT - fovNow) * Math.min(1, dt * 8);
  if (Math.abs(camera.fov - fovNow) > .05) { camera.fov = fovNow; camera.updateProjectionMatrix(); }
  if (aim) { selBox.visible = true; selBox.position.set(aim.x + .5, aim.y + .5, aim.z + .5); } else selBox.visible = false;

  if (!paused) { updateMobs(dt, daylight); updateTNT(dt, pl); updateDrops(dt, pl); updateParticles(dt, pl); }
  updateHand(dt, hv, player.onGround, eye, !!using);

  if (invDirty) { invDirty = false; renderHotbar(); renderInventory(); }
  renderStats(); renderVignette(dt);
  if ((uiTick -= dt) <= 0) { uiTick = .25; renderEffects(); updateTouchButtons(); }

  updateSunShadow(player.pos.x, player.pos.y, player.pos.z, player.yaw, hv, !player.dead);
  renderer.clear();
  renderer.render(scene, camera);
  if (mode === 'play' && !player.dead) { renderer.clearDepth(); renderer.render(handScene, handCam); }

  if (showDebug) {
    const f = ((Math.round(-player.yaw / (Math.PI / 2)) % 4) + 4) % 4, px = Math.floor(player.pos.x), py = Math.floor(player.pos.y), pz = Math.floor(player.pos.z);
    $('debug').textContent = `Blockcraft  ${fps} fps\nXYZ  ${player.pos.x.toFixed(2)} / ${player.pos.y.toFixed(2)} / ${player.pos.z.toFixed(2)}\n청크 ${px >> 4}, ${pz >> 4}   로드됨 ${chunks.size}   생물군계 ${terrain(px, pz).biome}\n` +
      `방향 ${['북', '동', '남', '서'][f]}   시간 ${String(Math.floor((time * 24 + 6) % 24)).padStart(2, '0')}:00   하늘빛 ${getSky(px, py + 1, pz)}  블록빛 ${getLight(px, py + 1, pz)}\n` +
      `몹 ${mobs.length}  아이템 ${drops.length}  흐르는 물 ${fluidDue.size}   시드 ${SEED}${aim ? `\n보는 블록 ${BLOCKS[aim.b].name} (${aim.x}, ${aim.y}, ${aim.z})` : ''}`;
  }
  if (saveDirty && now - lastSave > 5000 && mode !== 'menu') { lastSave = now; save(); }
}
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = handCam.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); handCam.updateProjectionMatrix(); });
addEventListener('pagehide', () => save());
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
requestAnimationFrame(frame);
