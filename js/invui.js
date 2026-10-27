'use strict';
// ============================================================
//  Inventory screen: slots, chests, creative palette, crafting
// ============================================================
let cursor = null, cursorPos = [0, 0], invStation = null, invChest = null, invTab = 'inv', craftFilter = 'all';
let stationsNear = { table: false, furnace: false, brew: false };
const mainSlotsEl = $('mainSlots'), hotSlotsEl = $('hotSlots'), chestSlotsEl = $('chestSlots');
function makeSlots(el, n, kind, offset) {
  for (let i = 0; i < n; i++) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'slot';
    b.addEventListener('pointerdown', e => slotClick(kind, offset + i, e));
    b.addEventListener('contextmenu', e => e.preventDefault());
    el.appendChild(b);
  }
}
makeSlots(mainSlotsEl, 27, 'main', 9); makeSlots(hotSlotsEl, 9, 'hot', 0); makeSlots(chestSlotsEl, 27, 'chest', 0);
const slotArr = kind => kind === 'chest' ? containers.get(invChest) : inv;
// merge a stack into arr[a..b), then fill empty slots; returns what is left
function insertStack(st, arr, a, b) {
  const ms = maxStack(st.id);
  if (ms > 1) for (let j = a; j < b && st.n; j++) { const t = arr[j]; if (t && t.id === st.id && t.n < ms) { const k = Math.min(ms - t.n, st.n); t.n += k; st.n -= k; } }
  for (let j = a; j < b && st.n; j++) if (!arr[j]) { arr[j] = { id: st.id, n: st.n, dur: st.dur || 0 }; st.n = 0; }
  return st.n;
}
function slotClick(kind, i, e) {
  e.preventDefault(); cursorPos = [e.clientX, e.clientY];
  const arr = slotArr(kind); if (!arr) return;
  const s = arr[i], right = e.button === 2;
  if (e.shiftKey && s && !cursor) {
    const left = invChest ? (kind === 'chest' ? insertStack(s, inv, 0, 36) : insertStack(s, containers.get(invChest), 0, 27)) : insertStack(s, inv, kind === 'hot' ? 9 : 0, kind === 'hot' ? 36 : 9);
    if (!left) arr[i] = null;
  } else if (!cursor) {
    if (!s) return;
    if (right && s.n > 1) { const k = Math.ceil(s.n / 2); cursor = { id: s.id, n: k, dur: s.dur }; s.n -= k; }
    else { cursor = s; arr[i] = null; }
  } else if (!s) {
    if (right) { arr[i] = { id: cursor.id, n: 1, dur: cursor.dur }; if (!--cursor.n) cursor = null; }
    else { arr[i] = cursor; cursor = null; }
  } else if (s.id === cursor.id && maxStack(s.id) > 1) {
    const k = Math.min(right ? 1 : cursor.n, maxStack(s.id) - s.n); s.n += k; cursor.n -= k; if (!cursor.n) cursor = null;
  } else { arr[i] = cursor; cursor = s; }
  if (kind === 'chest') saveDirty = true;
  blockSound(B.WOOL_WHITE, true);
  invChanged(); renderInventory();
}
// creative palette
const paletteEl = $('paletteGrid');
PALETTE.forEach(id => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'slot'; b.innerHTML = `<img alt="" src="${iconURL(id)}">`; b.title = itemName(id); b.setAttribute('aria-label', itemName(id));
  b.addEventListener('pointerdown', e => {
    e.preventDefault(); cursorPos = [e.clientX, e.clientY];
    if (cursor) cursor = null;
    else if (e.shiftKey || isTouch) { inv[sel] = { id, n: maxStack(id), dur: 0 }; invChanged(); }
    else cursor = { id, n: e.button === 2 ? 1 : maxStack(id), dur: 0 };
    renderInventory();
  });
  b.addEventListener('contextmenu', e => e.preventDefault());
  paletteEl.appendChild(b);
});
function setTab(t) {
  invTab = t;
  for (const b of $('invTabs').children) b.classList.toggle('on', b.dataset.tab === t);
  $('paletteBox').hidden = t !== 'palette' || !!invChest;
  $('craftBox').hidden = !!invChest || t === 'palette';
  $('invHint').textContent = t === 'palette' ? (isTouch ? '블록을 누르면 선택한 핫바 칸에 들어갑니다.' : '블록을 눌러 집으세요. Shift+클릭하면 선택한 핫바 칸에 바로 들어갑니다. 집은 채로 팔레트를 누르면 버려집니다.')
    : (isTouch ? '칸을 눌러 집고 다른 칸을 눌러 놓으세요.' : '칸을 눌러 집고 다른 칸에 놓으세요. 오른쪽 클릭은 반만 집기, Shift+클릭은 빠르게 옮기기.');
  renderInventory();
}
$('invTabs').addEventListener('click', e => { if (e.target.dataset.tab) setTab(e.target.dataset.tab); });
function scanStations() {
  const r = { table: false, furnace: false, brew: false }, px = Math.floor(player.pos.x), py = Math.floor(player.pos.y), pz = Math.floor(player.pos.z);
  for (let y = py - 2; y <= py + 3; y++) for (let z = pz - 4; z <= pz + 4; z++) for (let x = px - 4; x <= px + 4; x++) {
    const b = getBlock(x, y, z); if (b === B.TABLE) r.table = true; else if (b === B.FURNACE) r.furnace = true; else if (b === B.BREWING) r.brew = true;
  }
  return r;
}
function openInventory(station) {
  if (mode !== 'play' || player.dead) return;
  mode = 'inv'; invStation = station; invChest = null; using = null; releaseKeys();
  $('hud').hidden = true; $('touch').hidden = true; if (locked) document.exitPointerLock();
  $('inventory').hidden = false; $('chestBox').hidden = true; $('invTabs').hidden = gameMode !== 'creative';
  stationsNear = scanStations();
  craftFilter = station === 'furnace' ? 'furnace' : station === 'brew' ? 'brew' : 'all';
  setTab(gameMode === 'creative' && !station ? 'palette' : 'inv');
}
function openChest(x, y, z) {
  const k = posKey(x, y, z); if (!containers.has(k)) containers.set(k, new Array(27).fill(null));
  openInventory(null); invChest = k; $('chestBox').hidden = false; $('invTabs').hidden = true; setTab('inv');
  noise(.3, 300, 1, .3, 'lowpass');
}
function closeInventory() {
  if (cursor) { if (insertStack(cursor, inv, 0, 36)) dropStack(cursor, player.pos.x, player.pos.y + 1.2, player.pos.z, { delay: 1.5 }); cursor = null; invChanged(); }
  invChest = null; startPlay();
}
$('invClose').addEventListener('click', closeInventory);
$('inventory').addEventListener('pointerdown', e => {
  if (e.target !== $('inventory') || !cursor) return;
  const d = lookDir(); dropStack(cursor, player.pos.x + d.x * .4, player.pos.y + EYE - .3, player.pos.z + d.z * .4, { delay: 1.5, vel: new THREE.Vector3(d.x * 4, 2, d.z * 4) });
  cursor = null; renderInventory();
});
document.addEventListener('pointermove', e => { if (mode === 'inv') { cursorPos = [e.clientX, e.clientY]; renderCursor(); } });
function renderCursor() {
  const c = $('cursor');
  if (!cursor || mode !== 'inv') { c.hidden = true; return; }
  c.hidden = false; c.innerHTML = slotInner(cursor); c.style.left = cursorPos[0] + 'px'; c.style.top = cursorPos[1] + 'px';
}
function setSlot(b, s) { b.innerHTML = slotInner(s); b.setAttribute('aria-label', slotLabel(s, '')); }
function renderInventory() {
  if (mode !== 'inv') return;
  for (let i = 0; i < 27; i++) setSlot(mainSlotsEl.children[i], inv[9 + i]);
  for (let i = 0; i < 9; i++) { setSlot(hotSlotsEl.children[i], inv[i]); hotSlotsEl.children[i].classList.toggle('sel', i === sel); }
  if (invChest) { const c = containers.get(invChest); for (let i = 0; i < 27; i++) setSlot(chestSlotsEl.children[i], c[i]); }
  if (!$('craftBox').hidden) renderCrafting();
  renderCursor();
}

// ---------- crafting ----------
const FILTERS = [['all', '전체'], ['block', '블록'], ['tool', '도구'], ['item', '재료'], ['food', '음식'], ['furnace', '화로'], ['brew', '물약']];
$('craftFilters').innerHTML = FILTERS.map(([k, n]) => `<button type="button" data-f="${k}">${n}</button>`).join('');
$('craftFilters').addEventListener('click', e => { if (e.target.dataset.f) { craftFilter = e.target.dataset.f; renderCrafting(); } });
const fuelUnits = () => furnaceFuel + inv.reduce((a, s) => a + (s && FUEL[s.id] ? FUEL[s.id] * s.n : 0), 0);
const haveAll = r => r.ins.every(([m, n]) => countMatch(m) >= n);
const canCraft = r => (!r.st || stationsNear[r.st]) && haveAll(r) && (r.st !== 'furnace' || fuelUnits() >= 1);
function craft(r) {
  if (!canCraft(r)) return false;
  for (const [m, n] of r.ins) removeMatch(m, n);
  if (r.st === 'furnace') {
    while (furnaceFuel < 1) {
      let i = -1; inv.forEach((s, j) => { if (s && FUEL[s.id] && (i < 0 || FUEL[s.id] > FUEL[inv[i].id])) i = j; });
      if (i < 0) break; furnaceFuel += FUEL[inv[i].id]; if (!--inv[i].n) inv[i] = null;
    }
    furnaceFuel = Math.max(0, furnaceFuel - 1);
  }
  const left = addItem(r.out, r.n); if (left) spawnDrop(r.out, left, player.pos.x, player.pos.y + 1, player.pos.z);
  return true;
}
function recipeShown(r) {
  if (craftFilter === 'all') return true;
  if (craftFilter === 'furnace' || craftFilter === 'brew') return r.st === craftFilter;
  return r.cat === craftFilter;
}
function renderCrafting() {
  for (const b of $('craftFilters').children) b.classList.toggle('on', b.dataset.f === craftFilter);
  $('stations').innerHTML = Object.entries(STATION_NAME).map(([k, n]) => `<span class="chip ${stationsNear[k] ? 'on' : ''}">${n} ${stationsNear[k] ? '있음' : '없음'}</span>`).join('')
    + `<span class="chip ${fuelUnits() >= 1 ? 'on' : ''}">화로 연료 ${Math.floor(fuelUnits())}회</span>`;
  const list = RECIPES.map((r, i) => [r, i, canCraft(r)]).filter(([r]) => recipeShown(r)).sort((a, b) => (b[2] - a[2]) || (a[1] - b[1]));
  const fu = fuelUnits();
  $('recipes').innerHTML = list.map(([r, i, ok]) => {
    const ins = r.ins.map(([m, n]) => {
      const id = Array.isArray(m) ? (m.find(x => countMatch(x) > 0) ?? m[0]) : m, have = countMatch(m);
      return `<span class="${have >= n ? '' : 'miss'}"><img alt="${itemName(id)}" title="${itemName(id)}" src="${iconURL(id)}">${n}</span>`;
    }).join('') + (r.st === 'furnace' ? `<span class="${fu >= 1 ? '' : 'miss'}">+ 연료 1</span>` : '');
    const st = r.st ? `<span class="st">${STATION_NAME[r.st]} 필요${stationsNear[r.st] ? '' : ' · 근처에 없어요'}</span>` : '';
    return `<button type="button" class="recipe ${ok ? '' : 'no'}" data-r="${i}" aria-disabled="${!ok}"><span class="out"><img alt="" src="${iconURL(r.out)}">${r.n > 1 ? `<span class="cnt">${r.n}</span>` : ''}</span><span class="nm">${itemName(r.out)}</span><span class="ins">${ins}</span>${st}</button>`;
  }).join('') || '<p class="hint">이 분류에는 제작법이 없어요.</p>';
}
$('recipes').addEventListener('click', e => {
  const b = e.target.closest('.recipe'); if (!b) return;
  const r = RECIPES[+b.dataset.r]; let n = 0;
  do { if (!craft(r)) break; n++; } while (e.shiftKey && n < 64 / r.n);
  if (n) { tone(700, 1000, .08, .05, 'triangle'); showToast(`${itemName(r.out)} 만들었어요`); }
  renderInventory();
});
