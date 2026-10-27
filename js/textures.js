'use strict';
// ============================================================
//  Procedural textures: block atlas, item pixel art, HUD icons
// ============================================================
const atlas = document.createElement('canvas'); atlas.width = ATLAS_COLS * 16; atlas.height = ATLAS_ROWS * 16;
const actx = atlas.getContext('2d');
const tileAvg = [];
function painter(d, seed) {
  const r = mulberry32(seed);
  const set = (x, y, c, a = 255) => { if (x < 0 || y < 0 || x > 15 || y > 15) return; const i = (y * 16 + x) * 4; d[i] = clamp(c[0], 0, 255); d[i + 1] = clamp(c[1], 0, 255); d[i + 2] = clamp(c[2], 0, 255); d[i + 3] = a; };
  const vary = (c, amt) => { const k = 1 + (r() - 0.5) * amt; return [c[0] * k, c[1] * k, c[2] * k]; };
  const fill = (c, amt) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) set(x, y, vary(c, amt)); };
  const clear = () => { for (let i = 0; i < 256; i++) d[i * 4 + 3] = 0; };
  const get = (x, y) => { const i = (y * 16 + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  return { set, vary, fill, clear, get, r, d };
}
function paint(tile, fn) {
  const img = actx.createImageData(16, 16), p = painter(img.data, tile * 7919 + 17);
  fn(p);
  actx.putImageData(img, (tile % ATLAS_COLS) * 16, ((tile / ATLAS_COLS) | 0) * 16);
  const d = img.data; let s = [0, 0, 0], n = 0;
  for (let i = 0; i < 256; i++) if (d[i * 4 + 3] > 128) { s[0] += d[i * 4]; s[1] += d[i * 4 + 1]; s[2] += d[i * 4 + 2]; n++; }
  tileAvg[tile] = n ? [s[0] / n / 255, s[1] / n / 255, s[2] / n / 255] : [1, 1, 1];
}
function voronoi(p, n, colorFor, edge, edgeCol = [70, 70, 70]) {
  const pts = []; for (let i = 0; i < n; i++) pts.push([p.r() * 16, p.r() * 16, colorFor(i)]);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let b1 = 1e9, b2 = 1e9, bi = 0;
    for (let i = 0; i < n; i++) for (let ox = -16; ox <= 16; ox += 16) for (let oy = -16; oy <= 16; oy += 16) {
      const dx = x + .5 - pts[i][0] - ox, dy = y + .5 - pts[i][1] - oy, dd = Math.sqrt(dx * dx + dy * dy);
      if (dd < b1) { b2 = b1; b1 = dd; bi = i; } else if (dd < b2) b2 = dd;
    }
    p.set(x, y, b2 - b1 < edge ? p.vary(edgeCol, .3) : p.vary(pts[bi][2], .12));
  }
}
const PLANK_C = [164, 131, 79];
function dirt(p) { p.fill([134, 96, 67], .28); for (let i = 0; i < 18; i++) p.set((p.r() * 16) | 0, (p.r() * 16) | 0, p.r() < .5 ? [104, 74, 50] : [156, 114, 80]); }
function stone(p) { p.fill([126, 126, 126], .16); for (let i = 0; i < 10; i++) { const x = (p.r() * 16) | 0, y = (p.r() * 16) | 0, l = 1 + (p.r() * 3) | 0; for (let k = 0; k < l; k++) p.set(x + k, y, [100, 100, 100]); } }
function ore(c1, c2) { return p => { stone(p); for (let k = 0; k < 4; k++) { const cx = 2 + (p.r() * 12) | 0, cy = 2 + (p.r() * 12) | 0; for (let j = 0; j < 5; j++) { const x = cx + ((p.r() * 3) | 0) - 1, y = cy + ((p.r() * 3) | 0) - 1; p.set(x, y, p.r() < .6 ? c1 : c2); } } }; }
function planks(base, line) { return p => { for (let y = 0; y < 16; y++) { const row = y >> 2, jx = (row * 7 + 3) % 16; const b = p.vary(base, .12); for (let x = 0; x < 16; x++) p.set(x, y, (y % 4 === 3 || x === jx) ? line : p.vary(b, .07)); } }; }
function logSide(base, line) { return p => { for (let x = 0; x < 16; x++) { const b = p.vary(base, .2); for (let y = 0; y < 16; y++) p.set(x, y, (x % 4 === 1 && p.r() < .8) ? line : p.vary(b, .1)); } }; }
function logTop(bark, a, b) { return p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); p.set(x, y, d > 6.6 ? p.vary(bark, .2) : (Math.floor(d) % 2 ? p.vary(a, .08) : p.vary(b, .08))); } }; }
function leaves(c) { return p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { if (p.r() < .2) p.set(x, y, [0, 0, 0], 0); else p.set(x, y, p.vary(c, .45)); } }; }
function wool(c) { return p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, p.vary(((x + y) % 4 === 0) ? [c[0] * .85, c[1] * .85, c[2] * .85] : c, .1)); }; }
function metalBlock(c, dark) { return p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const edge = x === 0 || y === 0 || x === 15 || y === 15; p.set(x, y, edge ? dark : p.vary((x + y) % 7 === 0 ? [c[0] * 1.08, c[1] * 1.08, c[2] * 1.08] : c, .05)); } [[2, 2], [13, 2], [2, 13], [13, 13]].forEach(([x, y]) => p.set(x, y, dark)); }; }
function stem(p, x, top, c = [60, 130, 40]) { for (let y = 15; y >= top; y--) p.set(x, y, c); }
function waterPixel(x, y, f) { const w = Math.sin((x + y * .6 + f * 2) * .9) + Math.sin((x * .4 - y + f * 1.3) * .7); return w > 1.1 ? [92, 148, 238] : [46 + ((x * 7 + y * 3) % 5), 94, 206]; }
function lavaPixel(x, y, f) {
  const a = Math.sin(x * .8 + f * .9) + Math.sin(y * .7 - f * .6) + Math.sin((x + y) * .45 + f * .4);
  return a > 1.4 ? [255, 214, 90] : a > .4 ? [244, 140, 32] : a > -.8 ? [214, 96, 18] : [168, 58, 12];
}
paint(T.GRASS_TOP, p => { p.fill([96, 158, 54], .25); for (let i = 0; i < 30; i++) p.set((p.r() * 16) | 0, (p.r() * 16) | 0, p.r() < .5 ? [76, 134, 42] : [118, 180, 70]); });
paint(T.GRASS_SIDE, p => { dirt(p); for (let x = 0; x < 16; x++) { const dd = 3 + (p.r() < .5 ? 1 : 0) + (p.r() < .25 ? 1 : 0); for (let y = 0; y < dd; y++) p.set(x, y, p.vary([96, 158, 54], .25)); } });
paint(T.DIRT, dirt);
paint(T.STONE, stone);
paint(T.SAND, p => { p.fill([220, 211, 160], .1); for (let i = 0; i < 16; i++) p.set((p.r() * 16) | 0, (p.r() * 16) | 0, [196, 186, 136]); });
paint(T.WATER, p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, waterPixel(x, y, 0)); });
paint(T.LAVA, p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, lavaPixel(x, y, 0)); });
paint(T.LOG_SIDE, logSide([104, 81, 49], [74, 57, 33]));
paint(T.LOG_TOP, logTop([104, 81, 49], [176, 142, 88], [152, 120, 72]));
paint(T.LEAVES, leaves([56, 118, 38]));
paint(T.PLANKS, planks(PLANK_C, [112, 86, 52]));
paint(T.COBBLE, p => voronoi(p, 8, () => p.vary([128, 128, 128], .35), 1.1));
paint(T.MOSSY, p => voronoi(p, 8, () => p.r() < .4 ? p.vary([88, 120, 64], .3) : p.vary([128, 128, 128], .35), 1.1));
paint(T.GLASS, p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const edge = x === 0 || y === 0 || x === 15 || y === 15; p.set(x, y, [220, 240, 248], edge ? 255 : 0); } [[3, 5], [4, 4], [5, 3], [10, 12], [11, 11], [12, 10]].forEach(([x, y]) => p.set(x, y, [250, 255, 255])); });
paint(T.BRICK, p => { for (let y = 0; y < 16; y++) { const off = ((y >> 2) % 2) * 4; for (let x = 0; x < 16; x++) p.set(x, y, (y % 4 === 3 || (x + off) % 8 === 7) ? p.vary([186, 174, 160], .08) : p.vary([152, 70, 54], .14)); } });
paint(T.STONEBRICK, p => { for (let y = 0; y < 16; y++) { const off = ((y >> 3) % 2) * 8; for (let x = 0; x < 16; x++) { const mort = y % 8 === 7 || (x + off) % 16 === 15; const hi = y % 8 === 0 || (x + off) % 16 === 0; p.set(x, y, mort ? [78, 78, 78] : hi ? p.vary([150, 150, 150], .05) : p.vary([122, 122, 122], .1)); } } });
paint(T.SNOW, p => p.fill([240, 246, 250], .05));
paint(T.SNOW_SIDE, p => { dirt(p); for (let x = 0; x < 16; x++) { const dd = 3 + (p.r() < .5 ? 2 : 0); for (let y = 0; y < dd; y++) p.set(x, y, p.vary([240, 246, 250], .04)); } });
paint(T.BEDROCK, p => { const c = [[38, 38, 38], [86, 86, 86], [60, 60, 60], [120, 120, 120]]; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, c[(p.r() * 4) | 0]); });
paint(T.GRAVEL, p => voronoi(p, 14, () => p.r() < .3 ? [140, 118, 104] : p.vary([136, 128, 126], .4), .7));
paint(T.CLAY, p => { p.fill([160, 166, 180], .07); for (let i = 0; i < 10; i++) p.set((p.r() * 16) | 0, (p.r() * 16) | 0, [146, 152, 166]); });
paint(T.COAL, ore([30, 30, 30], [60, 60, 60]));
paint(T.IRON, ore([216, 175, 147], [176, 128, 98]));
paint(T.GOLD, ore([252, 238, 75], [200, 160, 30]));
paint(T.DIAMOND, ore([93, 236, 245], [30, 170, 190]));
paint(T.LAPIS, ore([38, 70, 190], [20, 40, 130]));
paint(T.EMERALD, ore([60, 220, 110], [20, 140, 60]));
paint(T.REDSTONE, ore([230, 30, 30], [150, 10, 10]));
paint(T.WOOL, wool([178, 48, 40]));
paint(T.WOOL_WHITE, wool([232, 235, 235]));
paint(T.WOOL_YELLOW, wool([246, 196, 40]));
paint(T.WOOL_BLUE, wool([54, 60, 160]));
paint(T.WOOL_GREEN, wool([86, 112, 30]));
paint(T.WOOL_BLACK, wool([28, 28, 34]));
paint(T.BOOK, p => {
  const pl = (y) => { for (let x = 0; x < 16; x++) p.set(x, y, p.vary(PLANK_C, .1)); };
  [0, 1, 7, 8, 14, 15].forEach(pl);
  const cols = [[140, 40, 40], [40, 70, 140], [60, 120, 50], [150, 120, 50], [100, 50, 120], [180, 170, 150]];
  for (const [y0, y1] of [[2, 6], [9, 13]]) { let x = 0; while (x < 16) { const w = p.r() < .3 ? 2 : 1, c = cols[(p.r() * cols.length) | 0], top = y0 + ((p.r() * 2) | 0); for (let k = 0; k < w && x < 16; k++, x++) for (let y = y0; y <= y1; y++) p.set(x, y, y < top ? [50, 34, 20] : p.vary(c, .1)); if (p.r() < .2 && x < 16) { for (let y = y0; y <= y1; y++) p.set(x, y, [50, 34, 20]); x++; } } }
});
paint(T.TNT_SIDE, p => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, (x % 4 === 3) ? [170, 44, 18] : p.vary([220, 70, 30], .1));
  for (let y = 5; y <= 10; y++) for (let x = 0; x < 16; x++) p.set(x, y, [232, 230, 222]);
  const L = { T: ['###', '.#.', '.#.', '.#.'], N: ['#.#', '###', '###', '#.#'] };
  [['T', 2], ['N', 6], ['T', 10]].forEach(([ch, ox]) => L[ch].forEach((row, ry) => [...row].forEach((c, rx) => { if (c === '#') p.set(ox + rx, 6 + ry, [30, 30, 30]); })));
});
paint(T.TNT_TOP, p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.hypot(x - 7.5, y - 7.5); p.set(x, y, d < 4.5 ? p.vary([200, 196, 188], .08) : p.vary([220, 70, 30], .1)); } p.set(7, 7, [30, 30, 30]); p.set(8, 8, [30, 30, 30]); p.set(7, 8, [60, 50, 40]); p.set(8, 7, [60, 50, 40]); });
paint(T.TNT_BOT, p => p.fill([214, 66, 28], .14));
paint(T.CACTUS_SIDE, p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, (x === 0 || x === 15) ? [20, 80, 24] : (x % 5 === 2 ? [26, 100, 30] : p.vary([42, 132, 44], .1))); for (let i = 0; i < 8; i++) p.set(1 + (p.r() * 14) | 0, (p.r() * 16) | 0, [210, 225, 160]); });
paint(T.CACTUS_TOP, p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const e = x === 0 || y === 0 || x === 15 || y === 15; p.set(x, y, e ? [26, 100, 30] : p.vary(((x + y) % 3 === 0) ? [60, 146, 56] : [76, 160, 64], .08)); } });
paint(T.TALLGRASS, p => { p.clear(); for (let k = 0; k < 9; k++) { let x = 1 + (p.r() * 14) | 0; const h = 6 + (p.r() * 9) | 0, lean = p.r() < .5 ? -1 : 1; const c = p.vary([86, 150, 48], .35); for (let j = 0; j < h; j++) { if (j > h * .6 && p.r() < .5) x += lean; p.set(x, 15 - j, c); } } });
paint(T.ROSE, p => { p.clear(); stem(p, 7, 7); p.set(6, 11, [60, 130, 40]); p.set(5, 10, [60, 130, 40]); p.set(8, 12, [60, 130, 40]); p.set(9, 11, [60, 130, 40]); for (let y = 2; y <= 7; y++) for (let x = 5; x <= 10; x++) { const d = Math.hypot(x - 7.5, y - 4.5); if (d < 2.8) p.set(x, y, d < 1 ? [120, 10, 20] : p.vary([210, 30, 34], .2)); } });
paint(T.DANDELION, p => { p.clear(); stem(p, 7, 8); p.set(6, 12, [60, 130, 40]); p.set(8, 11, [60, 130, 40]); for (let y = 4; y <= 8; y++) for (let x = 5; x <= 9; x++) { const d = Math.hypot(x - 7, y - 6); if (d < 2.3) p.set(x, y, d < 1 ? [230, 160, 20] : p.vary([248, 222, 46], .12)); } });
paint(T.OBSIDIAN, p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, p.r() < .12 ? p.vary([70, 48, 104], .2) : p.vary([22, 16, 34], .3)); });
paint(T.TORCH, p => { p.clear(); for (let y = 8; y < 16; y++) { p.set(7, y, [126, 92, 50]); p.set(8, y, [96, 70, 38]); } p.set(7, 6, [255, 244, 170]); p.set(8, 6, [255, 214, 80]); p.set(7, 7, [255, 190, 60]); p.set(8, 7, [236, 120, 30]); });
paint(T.GLOWSTONE, p => voronoi(p, 9, () => p.r() < .5 ? [252, 214, 120] : [222, 160, 70], .9, [150, 104, 44]));
paint(T.TABLE_TOP, p => { planks(PLANK_C, [112, 86, 52])(p); for (let i = 0; i < 16; i++) { p.set(i, 0, [84, 60, 34]); p.set(i, 15, [84, 60, 34]); p.set(0, i, [84, 60, 34]); p.set(15, i, [84, 60, 34]); p.set(i, 7, [96, 70, 40]); p.set(7, i, [96, 70, 40]); } });
paint(T.TABLE_SIDE, p => { planks(PLANK_C, [112, 86, 52])(p); for (let x = 0; x < 16; x++) for (let y = 0; y < 3; y++) p.set(x, y, p.vary([120, 90, 52], .1)); for (let y = 4; y < 10; y++) { p.set(3, y, [90, 90, 90]); p.set(4, y, [70, 70, 70]); } for (let x = 9; x < 14; x++) p.set(x, 5, [120, 120, 120]); for (let y = 5; y < 10; y++) p.set(11, y, [96, 70, 40]); });
paint(T.TABLE_FRONT, p => { planks(PLANK_C, [112, 86, 52])(p); for (let x = 0; x < 16; x++) for (let y = 0; y < 3; y++) p.set(x, y, p.vary([120, 90, 52], .1)); for (let x = 3; x < 13; x++) { p.set(x, 6, [170, 170, 170]); p.set(x, 7, [130, 130, 130]); } for (let y = 6; y < 12; y++) p.set(12, y, [96, 70, 40]); });
paint(T.FURNACE_SIDE, p => { stone(p); for (let i = 0; i < 16; i++) { p.set(i, 0, [90, 90, 90]); p.set(i, 15, [90, 90, 90]); } });
paint(T.FURNACE_TOP, p => { p.fill([140, 140, 140], .08); for (let i = 0; i < 16; i++) { p.set(i, 0, [96, 96, 96]); p.set(0, i, [96, 96, 96]); p.set(i, 15, [96, 96, 96]); p.set(15, i, [96, 96, 96]); } });
paint(T.FURNACE_FRONT, p => { stone(p); for (let i = 0; i < 16; i++) { p.set(i, 0, [90, 90, 90]); p.set(i, 15, [90, 90, 90]); } for (let y = 8; y < 14; y++) for (let x = 4; x < 12; x++) p.set(x, y, y === 8 || x === 4 || x === 11 ? [60, 60, 60] : [24, 22, 22]); for (let x = 5; x < 11; x++) p.set(x, 13, [180, 80, 30]); for (let x = 4; x < 12; x++) p.set(x, 5, [70, 70, 70]); });
paint(T.CHEST_SIDE, p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const edge = x === 0 || x === 15 || y === 0 || y === 15 || y === 5; p.set(x, y, edge ? [74, 48, 20] : p.vary([166, 116, 52], .1)); } });
paint(T.CHEST_TOP, p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const edge = x === 0 || x === 15 || y === 0 || y === 15; p.set(x, y, edge ? [74, 48, 20] : p.vary([176, 124, 58], .1)); } });
paint(T.CHEST_FRONT, p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const edge = x === 0 || x === 15 || y === 0 || y === 15 || y === 5; p.set(x, y, edge ? [74, 48, 20] : p.vary([166, 116, 52], .1)); } for (let y = 4; y < 8; y++) for (let x = 7; x < 9; x++) p.set(x, y, y === 4 ? [230, 230, 230] : [190, 190, 190]); });
paint(T.SANDSTONE_SIDE, p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, y < 3 ? p.vary([226, 216, 166], .05) : y === 3 || y === 11 ? [196, 182, 128] : p.vary([216, 204, 150], .08)); });
paint(T.SANDSTONE_TOP, p => p.fill([224, 214, 164], .06));
paint(T.BIRCH_LOG, p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, p.vary([216, 214, 206], .06)); for (let i = 0; i < 9; i++) { const x = (p.r() * 14) | 0, y = (p.r() * 16) | 0; p.set(x, y, [40, 40, 40]); p.set(x + 1, y, [60, 60, 56]); } });
paint(T.BIRCH_TOP, logTop([216, 214, 206], [214, 196, 140], [190, 170, 118]));
paint(T.BIRCH_LEAVES, leaves([98, 150, 66]));
paint(T.BIRCH_PLANKS, planks([200, 180, 122], [150, 132, 86]));
paint(T.SPRUCE_LOG, logSide([62, 44, 24], [42, 28, 14]));
paint(T.SPRUCE_TOP, logTop([62, 44, 24], [122, 90, 52], [100, 72, 40]));
paint(T.SPRUCE_LEAVES, leaves([44, 84, 56]));
paint(T.SPRUCE_PLANKS, planks([116, 86, 52], [78, 56, 32]));
const pumpkinSide = p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, (x % 5 === 0) ? [190, 106, 18] : p.vary([228, 144, 30], .08)); };
paint(T.PUMPKIN_SIDE, pumpkinSide);
paint(T.PUMPKIN_TOP, p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); p.set(x, y, d < 1.6 ? [100, 80, 30] : p.vary((Math.floor(d) % 3 === 0) ? [204, 120, 20] : [228, 144, 30], .06)); } });
function carved(lit) { return p => { pumpkinSide(p); const c = lit ? [255, 222, 90] : [56, 30, 8]; const hole = (x, y) => p.set(x, y, lit ? p.vary(c, .1) : c); for (let y = 0; y < 3; y++) for (let x = 0; x <= y; x++) { hole(3 + x, 4 + y); hole(12 - x, 4 + y); } for (let x = 3; x < 13; x++) { hole(x, 10); hole(x, 11); } hole(4, 9); hole(11, 9); hole(7, 12); hole(8, 12); }; }
paint(T.PUMPKIN_FACE, carved(false));
paint(T.JACK_FACE, carved(true));
paint(T.MELON_SIDE, p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, (x % 4 === 1) ? p.vary([62, 112, 28], .1) : p.vary([112, 164, 40], .1)); });
paint(T.MELON_TOP, p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.hypot(x - 7.5, y - 7.5); p.set(x, y, d < 2 ? [90, 120, 30] : p.vary((Math.floor(d) % 3 === 0) ? [70, 120, 30] : [112, 164, 40], .08)); } });
paint(T.ICE, p => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, p.vary([150, 190, 246], .06)); for (let i = 0; i < 4; i++) { let x = (p.r() * 16) | 0, y = (p.r() * 16) | 0; for (let k = 0; k < 5; k++) { p.set(x, y, [214, 232, 255]); x++; y += p.r() < .5 ? 1 : 0; } } });
paint(T.IRON_BLOCK, metalBlock([218, 218, 218], [150, 150, 150]));
paint(T.GOLD_BLOCK, metalBlock([248, 214, 60], [190, 140, 20]));
paint(T.DIAMOND_BLOCK, metalBlock([110, 230, 226], [40, 160, 156]));
paint(T.LADDER, p => { p.clear(); for (let y = 0; y < 16; y++) { p.set(2, y, [110, 80, 42]); p.set(3, y, [140, 104, 56]); p.set(12, y, [110, 80, 42]); p.set(13, y, [140, 104, 56]); } for (const y of [2, 6, 10, 14]) for (let x = 4; x < 12; x++) p.set(x, y, [150, 112, 60]); });
paint(T.SUGARCANE, p => { p.clear(); for (const x0 of [3, 8, 12]) for (let y = 0; y < 16; y++) { p.set(x0, y, y % 5 === 0 ? [150, 200, 110] : [110, 170, 80]); p.set(x0 + 1, y, y % 5 === 0 ? [120, 170, 90] : [86, 142, 60]); } p.set(5, 6, [110, 170, 80]); p.set(6, 5, [110, 170, 80]); p.set(10, 10, [110, 170, 80]); });
paint(T.DEADBUSH, p => { p.clear(); const c = [124, 86, 44]; let pts = [[8, 15]]; for (let g = 0; g < 7; g++) { const nx = []; for (const [x, y] of pts) { p.set(x, y, c); if (y > 3) { nx.push([x + (p.r() < .5 ? -1 : 0), y - 1]); if (p.r() < .3) nx.push([x + 1, y - 1]); } } pts = nx.slice(0, 6); } });
function mushroom(cap, dots) { return p => { p.clear(); for (let y = 9; y < 15; y++) { p.set(7, y, [226, 214, 196]); p.set(8, y, [206, 194, 176]); } for (let y = 5; y < 10; y++) for (let x = 3; x < 13; x++) { const d = Math.hypot((x - 7.5) / 5, (y - 9) / 4); if (d < 1) p.set(x, y, p.vary(cap, .08)); } if (dots) [[5, 7], [9, 6], [10, 8], [7, 8]].forEach(([x, y]) => p.set(x, y, [240, 236, 230])); }; }
paint(T.MUSH_RED, mushroom([214, 32, 30], true));
paint(T.MUSH_BROWN, mushroom([150, 108, 76], false));
paint(T.SAPLING, p => { p.clear(); stem(p, 7, 8, [110, 80, 42]); for (let y = 2; y < 10; y++) for (let x = 3; x < 13; x++) { const d = Math.hypot(x - 7.5, (y - 6) * 1.2); if (d < 4.2 && p.r() < .85) p.set(x, y, p.vary([60, 126, 40], .4)); } });
paint(T.BREWING, p => { p.clear(); for (let y = 1; y < 14; y++) { p.set(7, y, [96, 96, 96]); p.set(8, y, [70, 70, 70]); } for (let x = 3; x < 13; x++) { p.set(x, 14, [110, 110, 110]); p.set(x, 15, [80, 80, 80]); } for (const x0 of [2, 11]) { for (let y = 8; y < 13; y++) for (let x = x0; x < x0 + 3; x++) p.set(x, y, y < 10 ? [210, 230, 240] : [60, 90, 220]); } p.set(7, 0, [250, 220, 90]); });

// animated fluids: redraw the water and lava tiles in place
let fluidFrame = -1;
function animateFluids(t) {
  const f = Math.floor(t * 5);
  if (f === fluidFrame) return false;
  fluidFrame = f;
  for (const [tile, fn, speed] of [[T.WATER, waterPixel, 1], [T.LAVA, lavaPixel, .4]]) {
    const img = actx.createImageData(16, 16), d = img.data, ph = f * .25 * speed;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const c = fn(x, y, ph), i = (y * 16 + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; }
    actx.putImageData(img, (tile % ATLAS_COLS) * 16, ((tile / ATLAS_COLS) | 0) * 16);
  }
  return true;
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
// flat blocks show their tile as the item
const FLAT_BLOCKS = [B.TORCH, B.LADDER, B.TALLGRASS, B.ROSE, B.DANDELION, B.SUGARCANE, B.DEADBUSH, B.MUSH_RED, B.MUSH_BROWN, B.SAPLING, B.BREWING];
FLAT_BLOCKS.forEach(id => { const c = document.createElement('canvas'); c.width = c.height = 16; const t = BLOCKS[id].tiles[0]; c.getContext('2d').drawImage(atlas, (t % ATLAS_COLS) * 16, ((t / ATLAS_COLS) | 0) * 16, 16, 16, 0, 0, 16, 16); ITEM16[id] = c; });
const isFlatItem = id => !!ITEM16[id];

// ---------- inventory icons ----------
function shadedTile(tile, dark) {
  const c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d');
  x.drawImage(atlas, (tile % ATLAS_COLS) * 16, ((tile / ATLAS_COLS) | 0) * 16, 16, 16, 0, 0, 16, 16);
  if (dark) { x.globalCompositeOperation = 'source-atop'; x.fillStyle = `rgba(0,0,0,${dark})`; x.fillRect(0, 0, 16, 16); }
  return c;
}
const ICON_URL = {};
function iconURL(id) {
  if (ICON_URL[id]) return ICON_URL[id];
  const c = document.createElement('canvas'); c.width = c.height = 48; const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  if (ITEM16[id]) x.drawImage(ITEM16[id], 0, 0, 16, 16, 0, 0, 48, 48);
  else {
    const bd = BLOCKS[id];
    if (bd.liquid) x.globalAlpha = .9;
    const side = bd.face ? bd.tiles[3] : bd.tiles[1];
    x.setTransform(20 / 16, 10 / 16, 0, 24 / 16, 4, 14); x.drawImage(shadedTile(side, .2), 0, 0);
    x.setTransform(20 / 16, -10 / 16, 0, 24 / 16, 24, 24); x.drawImage(shadedTile(bd.tiles[1], .42), 0, 0);
    x.setTransform(20 / 16, -10 / 16, 20 / 16, 10 / 16, 4, 14); x.drawImage(shadedTile(bd.tiles[0], 0), 0, 0);
  }
  return ICON_URL[id] = c.toDataURL();
}

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
