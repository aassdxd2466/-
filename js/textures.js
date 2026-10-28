'use strict';
// ============================================================
//  Procedural 2D art: item pixel art, HUD icons, crack stages
//  (block textures are generated in blocktex.js)
// ============================================================
function painter(d, seed) {
  const r = mulberry32(seed);
  const set = (x, y, c, a = 255) => { if (x < 0 || y < 0 || x > 15 || y > 15) return; const i = (y * 16 + x) * 4; d[i] = clamp(c[0], 0, 255); d[i + 1] = clamp(c[1], 0, 255); d[i + 2] = clamp(c[2], 0, 255); d[i + 3] = a; };
  const vary = (c, amt) => { const k = 1 + (r() - 0.5) * amt; return [c[0] * k, c[1] * k, c[2] * k]; };
  const fill = (c, amt) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) set(x, y, vary(c, amt)); };
  const clear = () => { for (let i = 0; i < 256; i++) d[i * 4 + 3] = 0; };
  const get = (x, y) => { const i = (y * 16 + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  return { set, vary, fill, clear, get, r, d };
}
// ---------- item pixel art (16x16) ----------
const ITEM16 = {};
function art(fn, seed = 5) { const c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d'), img = x.createImageData(16, 16); fn(painter(img.data, seed)); x.putImageData(img, 0, 0); return c; }
const darker = (c, k = .65) => [c[0] * k, c[1] * k, c[2] * k];
const lighter = (c, k = 1.25) => [c[0] * k, c[1] * k, c[2] * k];
function handle(p, x0, y0, len) { for (let t = 0; t < len; t++) { p.set(x0 + t, y0 - t, [124, 92, 50]); p.set(x0 + t, y0 - t + 1, [84, 60, 32]); } }
function drawTool(type, c) {
  return art(p => {
    const d = darker(c), l = lighter(c);
    if (type === 'sword') {
      for (let t = 0; t < 10; t++) { p.set(4 + t, 11 - t, c); p.set(5 + t, 11 - t, l); p.set(4 + t, 12 - t, d); }
      p.set(14, 1, l);
      for (let t = 0; t < 5; t++) p.set(2 + t, 8 + t, [70, 70, 70]);
      for (let t = 0; t < 3; t++) { p.set(1 + t, 14 - t, [124, 92, 50]); p.set(1 + t, 15 - t, [84, 60, 32]); }
      return;
    }
    handle(p, 2, 13, type === 'shovel' ? 8 : 9);
    if (type === 'pick') {
      for (let s = 0; s <= 1; s += 0.02) {
        const x = Math.round((1 - s) * (1 - s) * 3 + 2 * (1 - s) * s * 14 + s * s * 12), y = Math.round((1 - s) * (1 - s) * 3 + 2 * (1 - s) * s * 2 + s * s * 12);
        p.set(x, y, c); p.set(x - 1, y + 1, d); p.set(x, y - 1, l);
      }
    } else if (type === 'axe') {
      for (let y = 1; y < 8; y++) for (let x = 7; x < 13; x++) { if (y + x < 9 || (y > 5 && x < 9)) continue; p.set(x, y, x >= 11 ? l : (y === 7 || x === 7) ? d : c); }
    } else {
      for (let y = 1; y < 9; y++) for (let x = 8; x < 15; x++) { const dd = Math.abs(x - 11.5) + Math.abs(y - 4.5); if (dd < 3.6) p.set(x, y, dd > 2.6 ? d : (x + y < 15 ? l : c)); }
    }
  });
}
function blob(c, cx, cy, rx, ry, shade = true) { return p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.hypot((x - cx) / rx, (y - cy) / ry); if (d < 1) p.set(x, y, shade ? (d > .78 ? darker(c, .7) : (x - cx + y - cy < -2 ? lighter(c, 1.2) : p.vary(c, .1))) : c); } }; }
function dust(c) { return p => { for (let i = 0; i < 26; i++) { const a = p.r() * 6.28, r = Math.sqrt(p.r()) * 6; p.set(Math.round(8 + Math.cos(a) * r), Math.round(9 + Math.sin(a) * r * .7), p.vary(c, .3)); } }; }
function ingot(c) { return p => { for (let y = 5; y < 12; y++) for (let x = 2; x < 15; x++) { const xs = x - (11 - y) * .5; if (xs < 2 || xs > 12) continue; p.set(x, y, y < 7 ? lighter(c, 1.15) : y === 11 ? darker(c) : c); } }; }
function gem(c) { return p => { for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) { const d = Math.abs(x - 7.5) + Math.abs(y - 7.5); if (d < 6.5) p.set(x, y, d > 5.5 ? darker(c, .55) : (x < 8 && y < 8 ? lighter(c, 1.25) : c)); } p.set(6, 5, [255, 255, 255]); }; }
function bottle(liquid) { return p => { const g = [220, 236, 250]; for (let y = 1; y < 4; y++) { p.set(7, y, g); p.set(8, y, g); } p.set(6, 1, [140, 100, 60]); p.set(9, 1, [140, 100, 60]); p.set(7, 0, [140, 100, 60]); p.set(8, 0, [140, 100, 60]); for (let y = 4; y < 15; y++) for (let x = 3; x < 13; x++) { const d = Math.hypot(x - 7.5, (y - 9.5) * 1.05); if (d < 5.3) { const edge = d > 4.4; p.set(x, y, edge ? g : liquid && y > 6 ? (x < 6 && y < 10 ? lighter(liquid, 1.3) : liquid) : [200, 220, 240], edge || liquid ? 255 : 90); } } }; }
function bucket(content) { return p => { const m = [180, 180, 180], dk = [110, 110, 110]; for (let y = 3; y < 15; y++) { const w = 6 - (y - 3) * .25; for (let x = Math.round(8 - w); x <= Math.round(7 + w); x++) p.set(x, y, y < 5 ? (content || [50, 50, 50]) : (x === Math.round(8 - w) || x === Math.round(7 + w) ? dk : m)); } for (let x = 2; x < 14; x++) p.set(x, 2, dk); }; }
ITEM16[I.STICK] = art(p => { for (let t = 0; t < 11; t++) { p.set(3 + t, 13 - t, [140, 104, 56]); p.set(3 + t, 14 - t, [92, 66, 36]); } });
ITEM16[I.COAL_ITEM] = art(blob([48, 48, 50], 8, 8.5, 5.5, 5));
ITEM16[I.IRON_INGOT] = art(ingot([216, 216, 216]));
ITEM16[I.GOLD_INGOT] = art(ingot([250, 212, 60]));
ITEM16[I.DIAMOND_GEM] = art(gem([92, 230, 222]));
ITEM16[I.EMERALD_GEM] = art(gem([50, 210, 100]));
ITEM16[I.LAPIS_ITEM] = art(p => { blob([40, 70, 190], 8, 8.5, 5, 5)(p); for (let i = 0; i < 6; i++) p.set(5 + (p.r() * 6) | 0, 5 + (p.r() * 6) | 0, [120, 150, 240]); });
ITEM16[I.REDSTONE_DUST] = art(dust([220, 30, 24]));
ITEM16[I.GLOW_DUST] = art(dust([250, 210, 90]));
ITEM16[I.SUGAR] = art(dust([248, 248, 248]));
ITEM16[I.APPLE] = art(p => { blob([214, 34, 30], 8, 9.5, 5.5, 5)(p); p.set(8, 4, [100, 70, 30]); p.set(8, 3, [100, 70, 30]); p.set(9, 3, [70, 150, 40]); p.set(10, 3, [70, 150, 40]); p.set(10, 2, [70, 150, 40]); });
ITEM16[I.GOLDEN_APPLE] = art(p => { blob([250, 210, 60], 8, 9.5, 5.5, 5)(p); p.set(8, 4, [100, 70, 30]); p.set(8, 3, [100, 70, 30]); p.set(9, 3, [230, 190, 50]); p.set(10, 2, [230, 190, 50]); p.set(6, 7, [255, 255, 220]); });
ITEM16[I.PORK_RAW] = art(p => { blob([240, 150, 150], 8, 8, 6, 4.5)(p); for (let x = 4; x < 12; x++) p.set(x, 6 + (x % 3 === 0 ? 1 : 0), [255, 220, 220]); });
ITEM16[I.PORK_COOKED] = art(p => { blob([170, 104, 56], 8, 8, 6, 4.5)(p); for (let x = 4; x < 12; x++) p.set(x, 6 + (x % 3 === 0 ? 1 : 0), [226, 186, 130]); });
ITEM16[I.MUTTON_RAW] = art(p => { blob([214, 80, 80], 7, 9, 5, 4)(p); for (let t = 0; t < 4; t++) p.set(11 + t, 6 - t, [240, 236, 226]); });
ITEM16[I.MUTTON_COOKED] = art(p => { blob([150, 84, 50], 7, 9, 5, 4)(p); for (let t = 0; t < 4; t++) p.set(11 + t, 6 - t, [240, 236, 226]); });
ITEM16[I.ROTTEN] = art(p => { blob([150, 110, 70], 8, 8.5, 6, 4.5)(p); for (let i = 0; i < 9; i++) p.set(4 + (p.r() * 8) | 0, 6 + (p.r() * 5) | 0, [90, 130, 60]); });
function melonSlice(gold) { return p => { for (let y = 4; y < 15; y++) for (let x = 1; x < 15; x++) { const d = Math.hypot(x - 7.5, y - 4); if (y < 5 || d > 9.5) continue; p.set(x, y, d > 8.4 ? [70, 140, 40] : d > 7.6 ? [220, 230, 160] : [226, 50, 46]); } [[5, 7], [9, 7], [7, 10], [11, 9], [4, 10]].forEach(([x, y]) => p.set(x, y, [30, 20, 20])); if (gold) [[3, 6], [12, 6], [8, 12], [6, 5], [10, 11]].forEach(([x, y]) => p.set(x, y, [255, 230, 80])); }; }
ITEM16[I.MELON_SLICE] = art(melonSlice(false));
ITEM16[I.GLIST_MELON] = art(melonSlice(true));
const bowlArt = top => p => { for (let y = 7; y < 14; y++) for (let x = 1; x < 15; x++) { const d = Math.hypot((x - 7.5) / 6.5, (y - 7) / 6); if (d < 1) p.set(x, y, y === 7 ? (top || [80, 56, 30]) : d > .85 ? [90, 62, 32] : [140, 100, 56]); } if (top) for (let x = 3; x < 13; x++) p.set(x, 8, darker(top, .85)); };
ITEM16[I.BOWL] = art(bowlArt(null));
ITEM16[I.STEW] = art(bowlArt([190, 130, 80]));
ITEM16[I.BUCKET] = art(bucket(null));
ITEM16[I.WATER_BUCKET] = art(bucket([50, 100, 220]));
ITEM16[I.LAVA_BUCKET] = art(bucket([240, 120, 30]));
ITEM16[I.BOTTLE] = art(bottle(null));
ITEM16[I.WATER_BOTTLE] = art(bottle([60, 110, 230]));
const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
POTIONS.forEach(([eff], i) => ITEM16[320 + i] = art(bottle(hex(EFFECTS[eff].color))));
TOOL_TIERS.forEach((tier, ti) => TOOL_TYPES.forEach(tt => ITEM16[I[tier.key + '_' + tt.key]] = drawTool(tt.type, tier.color)));
const isFlatItem = id => !!ITEM16[id];

// ---------- HUD icons (9x9) ----------
function icon9(rows, pal) {
  const c = document.createElement('canvas'); c.width = c.height = 9; const x = c.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((ch, i) => { if (pal[ch]) { x.fillStyle = pal[ch]; x.fillRect(i, y, 1, 1); } }));
  return c.toDataURL();
}
const HEART = ['.XX...XX.', 'XAAX.XAAX', 'XAWAXAAAX', 'XAAAAAAAX', 'XAAAAAAAX', '.XAAAAAX.', '..XAAAX..', '...XAX...', '....X....'];
const HEART_HALF = ['.XX...XX.', 'XAAX.XeeX', 'XAWAXeeeX', 'XAAAAeeeX', 'XAAAAeeeX', '.XAAAeeX.', '..XAAeX..', '...XAX...', '....X....'];
const SHANK = ['.....XX..', '....XWWX.', '...XWWX..', '..XAAX...', '.XAAAX...', 'XAAAAX...', 'XAAAX....', 'XAAX.....', '.XX......'];
const SHANK_HALF = ['.....XX..', '....XWWX.', '...XWWX..', '..XAeX...', '.XAeeX...', 'XAAeeX...', 'XAeeX....', 'XAeX.....', '.XX......'];
const BUBBLE = ['..XXXXX..', '.XAAAAAX.', 'XAWWAAAAX', 'XAWAAAAAX', 'XAAAAAAAX', 'XAAAAAAAX', 'XAAAAAAAX', '.XAAAAAX.', '..XXXXX..'];
const HUDICON = {
  heart: icon9(HEART, { X: '#1a0a0a', A: '#dc2a24', W: '#ffd0cc' }), heartHalf: icon9(HEART_HALF, { X: '#1a0a0a', A: '#dc2a24', W: '#ffd0cc', e: '#3a1c1c' }),
  heartEmpty: icon9(HEART, { X: '#1a0a0a', A: '#3a1c1c', W: '#3a1c1c' }), heartPoison: icon9(HEART, { X: '#1a0a0a', A: '#94a33a', W: '#e2eebb' }),
  food: icon9(SHANK, { X: '#2a1608', A: '#b86a32', W: '#f2ece0' }), foodHalf: icon9(SHANK_HALF, { X: '#2a1608', A: '#b86a32', W: '#f2ece0', e: '#3a2614' }),
  foodEmpty: icon9(SHANK, { X: '#2a1608', A: '#3a2614', W: '#4a3a2c' }), foodHunger: icon9(SHANK, { X: '#1a2208', A: '#6f8a32', W: '#d8e6c0' }),
  bubble: icon9(BUBBLE, { X: '#123c7a', A: '#4f8fe0', W: '#e6f2ff' }),
};

// ---------- block-breaking cracks: 10 stages in a 160x16 strip ----------
const crackCanvas = document.createElement('canvas'); crackCanvas.width = 160; crackCanvas.height = 16;
{
  const x = crackCanvas.getContext('2d'), r = mulberry32(99), steps = [];
  for (let k = 0; k < 6; k++) { let px = 8, py = 8; const a0 = r() * 6.28; for (let s = 0; s < 9; s++) { const a = a0 + (r() - .5) * 1.4; px += Math.cos(a) * 1.3; py += Math.sin(a) * 1.3; steps.push([Math.round(px), Math.round(py), s]); } }
  for (let st = 0; st < 10; st++) {
    x.fillStyle = 'rgba(0,0,0,0.72)';
    const lim = (st + 1) * 0.9;
    for (const [px, py, s] of steps) if (s < lim && px >= 0 && py >= 0 && px < 16 && py < 16) x.fillRect(st * 16 + px, py, 1, 1);
    if (st > 5) { x.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < st * 3; i++) x.fillRect(st * 16 + ((r() * 16) | 0), (r() * 16) | 0, 1, 1); }
  }
}
