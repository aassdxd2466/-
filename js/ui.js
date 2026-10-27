'use strict';
// ============================================================
//  HUD, menus and input
// ============================================================
let mode = 'menu', locked = false, showDebug = false, lastSpace = 0;
const keys = {}, mouse = { l: false, r: false, lt: 0, rt: 0, noMine: false };
const joy = { id: null, x: 0, y: 0, ox: 0, oy: 0 }, look = { id: null, x: 0, y: 0, t: 0, moved: 0, held: false };
let touchMode = 'break';
function releaseKeys() { for (const k in keys) keys[k] = false; mouse.l = mouse.r = false; look.held = false; }

// ---------- HUD ----------
const hotbarEl = $('hotbar');
for (let i = 0; i < 9; i++) { const b = document.createElement('button'); b.type = 'button'; b.className = 'slot'; b.addEventListener('click', e => { e.stopPropagation(); selectSlot(i); }); hotbarEl.appendChild(b); }
function slotInner(s) {
  if (!s) return '';
  const it = ITEMS[s.id]; let h = `<img alt="" src="${iconURL(s.id)}">`;
  if (s.n > 1) h += `<span class="cnt">${s.n}</span>`;
  if (it.dur && s.dur) { const f = 1 - s.dur / it.dur; h += `<span class="dur"><i style="width:${(f * 100).toFixed(0)}%;background:hsl(${(f * 120).toFixed(0)},80%,45%)"></i></span>`; }
  return h;
}
const slotLabel = (s, prefix) => `${prefix}${s ? itemName(s.id) + (s.n > 1 ? ` ${s.n}개` : '') : '비어 있음'}`;
function renderHotbar() {
  for (let i = 0; i < 9; i++) {
    const b = hotbarEl.children[i]; b.className = 'slot' + (i === sel ? ' sel' : '');
    b.innerHTML = `<span class="num">${i + 1}</span>` + slotInner(inv[i]); b.setAttribute('aria-label', slotLabel(inv[i], `${i + 1}번 칸: `));
  }
}
for (const id of ['hearts', 'food', 'air']) for (let i = 0; i < 10; i++) $(id).appendChild(Object.assign(document.createElement('img'), { alt: '' }));
let lastStats = '';
function renderStats() {
  const surv = gameMode === 'survival';
  $('stats').style.visibility = surv ? 'visible' : 'hidden';
  if (!surv) return;
  const hungry = hasEff('hunger') > 0, showAir = player.eyeFluid === B.WATER || player.air < 10;
  const key = [player.hp, player.food, player.air, showAir, hungry].join();
  if (key === lastStats) return; lastStats = key;
  [...$('hearts').children].forEach((img, i) => { const v = player.hp - i * 2; img.src = v >= 2 ? HUDICON.heart : v >= 1 ? HUDICON.heartHalf : HUDICON.heartEmpty; });
  $('hearts').classList.toggle('low', player.hp <= 4 && player.hp > 0);
  $('hearts').setAttribute('aria-label', `체력 ${Math.ceil(player.hp)}/20`);
  [...$('food').children].forEach((img, i) => { const v = player.food - i * 2; img.src = v >= 2 ? (hungry ? HUDICON.foodHunger : HUDICON.food) : v >= 1 ? HUDICON.foodHalf : HUDICON.foodEmpty; });
  $('food').setAttribute('aria-label', `배고픔 ${player.food}/20`);
  [...$('air').children].forEach((img, i) => { img.src = HUDICON.bubble; img.style.visibility = showAir && i < player.air ? 'visible' : 'hidden'; });
}
const ROMAN = ['', '', ' II', ' III', ' IV'];
const fmtTime = t => { t = Math.ceil(t); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
let effKey = '';
function renderEffects() {
  const list = Object.entries(effects), key = list.map(([k, e]) => k + e.lv + Math.ceil(e.t)).join();
  if (key === effKey) return; effKey = key;
  $('effects').innerHTML = list.map(([k, e]) => `<div class="eff"><i style="background:${EFFECTS[k].color}"></i><b>${EFFECTS[k].name}${ROMAN[e.lv] || ''}</b><span>${fmtTime(e.t)}</span></div>`).join('');
}
function renderVignette(dt) {
  hurtFlash = Math.max(0, hurtFlash - dt * 2.5);
  const v = $('vignette'); let bg = 'none', op = 0;
  if (player.eyeFluid === B.WATER) { bg = 'rgba(20,60,160,.32)'; op = 1; }
  if ((player.fire > 0 && !hasEff('fireres')) || player.eyeFluid === B.LAVA) { bg = 'radial-gradient(ellipse at 50% 40%, transparent 35%, rgba(255,110,10,.6) 100%)'; op = .85 + Math.sin(performance.now() / 90) * .15; }
  if (hurtFlash > 0) { bg = 'radial-gradient(ellipse at center, transparent 40%, rgba(190,0,0,.65) 100%)'; op = hurtFlash; }
  v.style.background = bg; v.style.opacity = op;
}
let nameTimer = 0, toastTimer = 0;
function selectSlot(i) {
  sel = (i + 9) % 9; mining = null; renderHotbar(); setHand(heldId());
  const n = $('blockname'), s = inv[sel]; n.textContent = s ? itemName(s.id) : ''; n.classList.toggle('show', !!s);
  clearTimeout(nameTimer); nameTimer = setTimeout(() => n.classList.remove('show'), 1400);
}
function showToast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1700); }
function updateTouchButtons() {
  $('tFly').hidden = gameMode !== 'creative';
  $('tFly').classList.toggle('on', player.flying);
  $('tDown').textContent = player.flying ? '하강' : '웅크리기';
}

// ---------- menus ----------
function lockPointer() {
  if (isTouch || !canvas.requestPointerLock) return;
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => { }); } catch (e) { }
}
function hideOverlays() { for (const id of ['menu', 'inventory', 'death']) $(id).hidden = true; $('cursor').hidden = true; }
function startPlay() {
  if (player.dead) { showDeath(); return; }
  audio(); mode = 'play'; hideOverlays(); $('hud').hidden = false; $('play').textContent = '계속하기';
  $('touch').hidden = !isTouch; updateTouchButtons(); lockPointer(); canvas.focus();
}
function openMenu() {
  mode = 'menu'; releaseKeys(); hideOverlays(); $('hud').hidden = true; $('touch').hidden = true; $('menu').hidden = false;
  if (locked) document.exitPointerLock();
  updateSegs(); save(); updateSeedInfo();
}
function showDeath() {
  mode = 'dead'; releaseKeys(); hideOverlays(); $('touch').hidden = true; $('hud').hidden = true;
  $('deathCause').textContent = deathCause; $('death').hidden = false;
  if (locked) document.exitPointerLock();
}
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; if (!locked && mode === 'play') openMenu(); });
$('play').addEventListener('click', startPlay);
$('respawnBtn').addEventListener('click', () => { respawn(); startPlay(); });
$('deathMenu').addEventListener('click', () => { respawn(); openMenu(); });
$('saveBtn').addEventListener('click', () => save(true));
function updateSegs() {
  for (const b of $('modeSeg').children) b.classList.toggle('on', b.dataset.v === gameMode);
  for (const b of $('diffSeg').children) b.classList.toggle('on', +b.dataset.v === difficulty);
  for (const b of $('shadowSeg').children) b.classList.toggle('on', (b.dataset.v === '1') === SHADOW.on);
}
function setGameMode(v) {
  if (v === gameMode) return;
  gameMode = v; player.flying = false; mining = null; showCrack(0, 0, 0, -1); statsDirty = true; lastStats = ''; saveDirty = true;
  if (v === 'creative') { player.hp = 20; player.food = 20; player.air = 10; player.fire = 0; }
  updateSegs(); updateTouchButtons(); showToast(v === 'creative' ? '크리에이티브 모드' : '서바이벌 모드');
}
$('modeSeg').addEventListener('click', e => { if (e.target.dataset.v) setGameMode(e.target.dataset.v); });
$('shadowSeg').addEventListener('click', e => { if (e.target.dataset.v === undefined) return; setShadowQuality(e.target.dataset.v === '1'); updateSegs(); saveSettings(); });
$('diffSeg').addEventListener('click', e => { if (e.target.dataset.v === undefined) return; difficulty = +e.target.dataset.v; updateSegs(); saveDirty = true; });
let confirmNew = 0;
$('newWorld').addEventListener('click', () => {
  const b = $('newWorld');
  if (Date.now() - confirmNew > 3000) { confirmNew = Date.now(); b.textContent = '한 번 더 누르면 지금 월드가 지워져요'; setTimeout(() => { b.textContent = '새 월드'; }, 3000); return; }
  confirmNew = 0; b.textContent = '새 월드';
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
  initWorld((Math.random() * 1e9) | 0, null); showToast('새 월드를 만들었어요');
});
const rd = $('rd'), sens = $('sens'); let sensitivity = 1;
function applySettings() { rd.value = renderDist; $('rdOut').textContent = renderDist; sens.value = sensitivity; $('sensOut').textContent = sensitivity.toFixed(1); }
rd.addEventListener('input', () => { renderDist = +rd.value; $('rdOut').textContent = renderDist; lastChunkScan = 0; saveSettings(); });
sens.addEventListener('input', () => { sensitivity = +sens.value; $('sensOut').textContent = sensitivity.toFixed(1); saveSettings(); });
function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify({ renderDist, sensitivity, shadows: SHADOW.on })); } catch (e) { } }
try { const s = JSON.parse(localStorage.getItem(SET_KEY) || 'null'); if (s) { renderDist = clamp(s.renderDist | 0 || renderDist, 2, 12); sensitivity = +s.sensitivity || 1; if (s.shadows === false) setShadowQuality(false); } } catch (e) { }
applySettings();
if (isTouch) { document.body.classList.add('touch'); $('helpDesk').hidden = true; $('helpTouch').hidden = false; $('invHint').textContent = '칸을 눌러 집고 다른 칸을 눌러 놓으세요.'; }
const SPLASHES = ['끝없이 펼쳐지는 월드!', '좀비는 햇빛을 싫어해요!', 'TNT 조심!', '다이아몬드는 깊은 곳에', '횃불로 동굴을 밝히세요', '물약을 양조해 보세요!', '양털은 염색할 수 있어요'];
$('splash').textContent = SPLASHES[(Math.random() * SPLASHES.length) | 0];

// ---------- keyboard & mouse ----------
function toggleFly() { if (gameMode !== 'creative') return; player.flying = !player.flying; player.vel.y = 0; showToast(player.flying ? '비행 모드 켜짐' : '비행 모드 꺼짐'); updateTouchButtons(); }
addEventListener('keydown', e => {
  if (mode === 'inv') { if (e.code === 'KeyE' || e.code === 'Escape') { e.preventDefault(); closeInventory(); } return; }
  if (mode !== 'play') { if (mode === 'menu' && e.code === 'Enter' && document.activeElement === document.body) startPlay(); return; }
  if (['Space', 'Tab', 'F3', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape' && !locked) { openMenu(); return; }
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'Space') { const now = performance.now(); if (now - lastSpace < 280) { toggleFly(); lastSpace = 0; } else lastSpace = now; }
  if (e.code === 'KeyF') toggleFly();
  if (e.code === 'KeyE') openInventory(null);
  if (e.code === 'KeyQ') dropHeld(e.shiftKey);
  if (e.code === 'KeyT' && gameMode === 'creative') { time = (time + .25) % 1; showToast('시간이 흘렀습니다'); }
  if (e.code === 'F3' || e.code === 'Backquote') { showDebug = !showDebug; $('debug').hidden = !showDebug; }
  if (e.code.startsWith('Digit')) { const n = +e.code.slice(5); if (n >= 1 && n <= 9) selectSlot(n - 1); }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', releaseKeys);
canvas.addEventListener('mousedown', e => {
  if (mode !== 'play' || isTouch) return;
  if (!locked) lockPointer();
  audio();
  if (e.button === 0) { mouse.l = true; mouse.lt = performance.now(); mouse.noMine = primaryPress(); }
  if (e.button === 2) { mouse.r = true; mouse.rt = performance.now(); secondaryPress(false); }
  if (e.button === 1) { e.preventDefault(); pickBlock(); }
});
addEventListener('mouseup', e => { if (e.button === 0) { mouse.l = false; mouse.noMine = false; } if (e.button === 2) mouse.r = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (mode !== 'play' || isTouch) return;
  const mx = clamp(e.movementX || 0, -250, 250), my = clamp(e.movementY || 0, -250, 250);
  player.yaw -= mx * 0.0024 * sensitivity; player.pitch = clamp(player.pitch - my * 0.0024 * sensitivity, -1.55, 1.55);
});
addEventListener('wheel', e => { if (mode === 'play') selectSlot(sel + (e.deltaY > 0 ? 1 : -1)); }, { passive: true });

// ---------- touch ----------
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch' || mode !== 'play') return;
  audio();
  if (e.clientX < innerWidth * 0.42 && joy.id === null) {
    joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.y = 0;
    const s = $('stick'); s.hidden = false; s.style.left = e.clientX + 'px'; s.style.top = e.clientY + 'px'; $('knob').style.transform = '';
  } else if (look.id === null) Object.assign(look, { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, held: false });
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerId === joy.id) {
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy; const l = Math.hypot(dx, dy); if (l > 50) { dx *= 50 / l; dy *= 50 / l; }
    joy.x = dx / 50; joy.y = dy / 50; $('knob').style.transform = `translate(${dx}px,${dy}px)`;
  } else if (e.pointerId === look.id) {
    const dx = e.clientX - look.x, dy = e.clientY - look.y; look.x = e.clientX; look.y = e.clientY; look.moved += Math.abs(dx) + Math.abs(dy);
    player.yaw -= dx * 0.006 * sensitivity; player.pitch = clamp(player.pitch - dy * 0.006 * sensitivity, -1.55, 1.55);
  }
});
function endTouch(e) {
  if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; $('stick').hidden = true; }
  if (e.pointerId === look.id) {
    if (!look.held && look.moved < 14 && performance.now() - look.t < 300 && mode === 'play') { if (touchMode === 'break') primaryPress(); else secondaryPress(true); }
    look.id = null; look.held = false;
  }
}
canvas.addEventListener('pointerup', endTouch); canvas.addEventListener('pointercancel', endTouch);
// a still finger held on the right side mines (or keeps breaking in creative)
function updateTouchHold(now) {
  if (look.id === null || look.held || touchMode !== 'break') return;
  if (now - look.t > 300 && look.moved < 14) { look.held = true; mouse.lt = now; if (gameMode === 'creative') primaryPress(); }
}
function holdBtn(id, code) {
  const b = $(id);
  b.addEventListener('pointerdown', e => { e.preventDefault(); keys[code] = true; b.classList.add('on'); });
  const up = () => { keys[code] = false; b.classList.remove('on'); };
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
}
holdBtn('tJump', 'Space'); holdBtn('tDown', 'KeyC');
$('tFly').addEventListener('click', toggleFly);
$('tMode').addEventListener('click', () => { touchMode = touchMode === 'break' ? 'place' : 'break'; $('tMode').textContent = touchMode === 'break' ? '부수기' : '놓기'; $('tMode').classList.toggle('on', touchMode === 'place'); });
$('tInv').addEventListener('click', () => openInventory(null));
$('tPause').addEventListener('click', openMenu);
$('tDrop').addEventListener('click', () => dropHeld(false));
