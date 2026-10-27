'use strict';
// ============================================================
//  Blockcraft — core: constants, noise, block/item/recipe registries
// ============================================================
const CS = 16, H = 112, WATER = 32, DAY_LEN = 1200;      // one day = 20 minutes
const GOLDEN_HOUR = 0.465, TIME_FAST = 60;              // new worlds start in late-afternoon light; T runs time 60x
const SAVE_KEY = 'blockcraft-save-v2', SET_KEY = 'blockcraft-settings-v2';
const isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && !matchMedia('(pointer: fine)').matches);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = id => document.getElementById(id);

// ---------- random & noise ----------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (t, a, b) => a + t * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
function grad(h, x, y, z) { h &= 15; const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z); return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); }
class Perlin {
  constructor(seed) {
    const r = mulberry32(seed), p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.p = new Uint8Array(512); for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
  }
  noise(x, y, z) {
    const p = this.p; let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z; X &= 255; Y &= 255; Z &= 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B_ = p[X + 1] + Y, BA = p[B_] + Z, BB = p[B_ + 1] + Z;
    return lerp(w, lerp(v, lerp(u, grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z)), lerp(u, grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z))),
      lerp(v, lerp(u, grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1)), lerp(u, grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1))));
  }
}
function fbm(n, x, z, oct) { let s = 0, a = 1, f = 1, t = 0; for (let i = 0; i < oct; i++) { s += a * n.noise(x * f, z * f, 0.5 + i * 3.17); t += a; a *= 0.5; f *= 2; } return s / t; }
let SEED = 0;
function hash3(x, y, z) { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(SEED, 144665) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }

// ---------- texture tiles (atlas is 16 x 8 tiles of 16px) ----------
const ATLAS_COLS = 16, ATLAS_ROWS = 8;
const TILE_NAMES = ['GRASS_TOP', 'GRASS_SIDE', 'DIRT', 'STONE', 'SAND', 'WATER', 'LOG_SIDE', 'LOG_TOP', 'LEAVES', 'PLANKS', 'COBBLE', 'GLASS', 'BRICK', 'SNOW', 'SNOW_SIDE', 'BEDROCK',
  'GRAVEL', 'COAL', 'IRON', 'GOLD', 'DIAMOND', 'WOOL', 'BOOK', 'TNT_SIDE', 'TNT_TOP', 'TNT_BOT', 'CACTUS_SIDE', 'CACTUS_TOP', 'TALLGRASS', 'ROSE', 'DANDELION', 'LAVA',
  'OBSIDIAN', 'TORCH', 'GLOWSTONE', 'TABLE_TOP', 'TABLE_SIDE', 'TABLE_FRONT', 'FURNACE_FRONT', 'FURNACE_SIDE', 'FURNACE_TOP', 'CHEST_FRONT', 'CHEST_SIDE', 'CHEST_TOP', 'STONEBRICK', 'MOSSY', 'SANDSTONE_SIDE', 'SANDSTONE_TOP',
  'BIRCH_LOG', 'BIRCH_TOP', 'BIRCH_LEAVES', 'BIRCH_PLANKS', 'SPRUCE_LOG', 'SPRUCE_TOP', 'SPRUCE_LEAVES', 'SPRUCE_PLANKS', 'PUMPKIN_SIDE', 'PUMPKIN_TOP', 'PUMPKIN_FACE', 'JACK_FACE', 'MELON_SIDE', 'MELON_TOP', 'ICE', 'IRON_BLOCK',
  'GOLD_BLOCK', 'DIAMOND_BLOCK', 'LAPIS', 'EMERALD', 'REDSTONE', 'WOOL_WHITE', 'WOOL_YELLOW', 'WOOL_BLUE', 'WOOL_GREEN', 'WOOL_BLACK', 'LADDER', 'SUGARCANE', 'DEADBUSH', 'MUSH_RED', 'MUSH_BROWN', 'SAPLING',
  'BREWING', 'CLAY'];
const T = {}; TILE_NAMES.forEach((n, i) => T[n] = i);

// ---------- blocks ----------
const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, WATER: 5, LOG: 6, LEAVES: 7, PLANKS: 8, COBBLE: 9, GLASS: 10, BRICK: 11, SNOW: 12, BEDROCK: 13, GRAVEL: 14,
  COAL: 15, IRON: 16, GOLD: 17, DIAMOND: 18, WOOL: 19, BOOKSHELF: 20, TNT: 21, CACTUS: 22, TALLGRASS: 23, ROSE: 24, DANDELION: 25, LAVA: 26, OBSIDIAN: 27,
  TORCH: 28, GLOWSTONE: 29, TABLE: 30, FURNACE: 31, CHEST: 32, STONEBRICK: 33, MOSSY: 34, SANDSTONE: 35, BIRCH_LOG: 36, BIRCH_LEAVES: 37, BIRCH_PLANKS: 38,
  SPRUCE_LOG: 39, SPRUCE_LEAVES: 40, SPRUCE_PLANKS: 41, PUMPKIN: 42, JACK: 43, MELON: 44, ICE: 45, SNOWBLOCK: 46, IRON_BLOCK: 47, GOLD_BLOCK: 48, DIAMOND_BLOCK: 49,
  LAPIS: 50, EMERALD: 51, REDSTONE: 52, WOOL_WHITE: 53, WOOL_YELLOW: 54, WOOL_BLUE: 55, WOOL_GREEN: 56, WOOL_BLACK: 57, LADDER: 58, SUGARCANE: 59, DEADBUSH: 60,
  MUSH_RED: 61, MUSH_BROWN: 62, SAPLING: 63, BREWING: 64, CLAY: 65, UNLOADED: 255
};
const BLOCKS = [];
// tiles: [top, side, bottom, front]; hard: seconds-ish hardness (-1 = unbreakable); tool: preferred tool; need: pickaxe tier required for drops
function def(id, name, tiles, o = {}) {
  const t = Array.isArray(tiles) ? tiles : [tiles, tiles, tiles];
  BLOCKS[id] = Object.assign({ id, name, tiles: [t[0], t[1], t[2], t[3] ?? t[1]], solid: true, transparent: false, shape: 'cube', liquid: false, sky: true, occ: true, snd: 'stone',
    light: 0, hard: 1, tool: null, need: 0, replace: false, face: t.length > 3 }, o);
}
const PLANT = { solid: false, transparent: true, shape: 'cross', sky: false, occ: false, snd: 'grass', hard: 0, replace: true, support: true };
def(B.AIR, '공기', 0, { solid: false, transparent: true, sky: false, occ: false, replace: true, hard: 0 });
def(B.GRASS, '잔디 블록', [T.GRASS_TOP, T.GRASS_SIDE, T.DIRT], { snd: 'grass', hard: .6, tool: 'shovel' });
def(B.DIRT, '흙', T.DIRT, { snd: 'grass', hard: .5, tool: 'shovel' });
def(B.STONE, '돌', T.STONE, { hard: 1.5, tool: 'pick', need: 1 });
def(B.SAND, '모래', T.SAND, { snd: 'sand', hard: .5, tool: 'shovel' });
def(B.WATER, '물', T.WATER, { solid: false, transparent: true, liquid: true, shape: 'fluid', sky: false, occ: false, snd: 'water', replace: true, hard: -1 });
def(B.LOG, '참나무 원목', [T.LOG_TOP, T.LOG_SIDE, T.LOG_TOP], { snd: 'wood', hard: 2, tool: 'axe' });
def(B.LEAVES, '참나무 잎', T.LEAVES, { transparent: true, sky: false, snd: 'grass', hard: .2 });
def(B.PLANKS, '참나무 판자', T.PLANKS, { snd: 'wood', hard: 2, tool: 'axe' });
def(B.COBBLE, '조약돌', T.COBBLE, { hard: 2, tool: 'pick', need: 1 });
def(B.GLASS, '유리', T.GLASS, { transparent: true, sky: false, occ: false, snd: 'glass', hard: .3 });
def(B.BRICK, '벽돌', T.BRICK, { hard: 2, tool: 'pick', need: 1 });
def(B.SNOW, '눈 덮인 흙', [T.SNOW, T.SNOW_SIDE, T.DIRT], { snd: 'sand', hard: .6, tool: 'shovel' });
def(B.BEDROCK, '기반암', T.BEDROCK, { hard: -1 });
def(B.GRAVEL, '자갈', T.GRAVEL, { snd: 'sand', hard: .6, tool: 'shovel' });
def(B.COAL, '석탄 광석', T.COAL, { hard: 3, tool: 'pick', need: 1 });
def(B.IRON, '철 광석', T.IRON, { hard: 3, tool: 'pick', need: 2 });
def(B.GOLD, '금 광석', T.GOLD, { hard: 3, tool: 'pick', need: 3 });
def(B.DIAMOND, '다이아몬드 광석', T.DIAMOND, { hard: 3, tool: 'pick', need: 3 });
def(B.WOOL, '빨간 양털', T.WOOL, { snd: 'cloth', hard: .8 });
def(B.BOOKSHELF, '책장', [T.PLANKS, T.BOOK, T.PLANKS], { snd: 'wood', hard: 1.5, tool: 'axe' });
def(B.TNT, 'TNT', [T.TNT_TOP, T.TNT_SIDE, T.TNT_BOT], { snd: 'grass', hard: 0 });
def(B.CACTUS, '선인장', [T.CACTUS_TOP, T.CACTUS_SIDE, T.CACTUS_TOP], { snd: 'cloth', hard: .4, support: true, prick: true });
def(B.TALLGRASS, '풀', T.TALLGRASS, PLANT);
def(B.ROSE, '장미', T.ROSE, PLANT);
def(B.DANDELION, '민들레', T.DANDELION, PLANT);
def(B.LAVA, '용암', T.LAVA, { solid: false, transparent: true, liquid: true, shape: 'fluid', sky: false, occ: false, snd: 'water', replace: true, hard: -1, light: 15 });
def(B.OBSIDIAN, '흑요석', T.OBSIDIAN, { hard: 25, tool: 'pick', need: 4 });
def(B.TORCH, '횃불', T.TORCH, { solid: false, transparent: true, shape: 'torch', sky: false, occ: false, snd: 'wood', hard: 0, light: 14, replace: false });
def(B.GLOWSTONE, '발광석', T.GLOWSTONE, { snd: 'glass', hard: .3, light: 15 });
def(B.TABLE, '작업대', [T.TABLE_TOP, T.TABLE_SIDE, T.PLANKS, T.TABLE_FRONT], { snd: 'wood', hard: 2.5, tool: 'axe' });
def(B.FURNACE, '화로', [T.FURNACE_TOP, T.FURNACE_SIDE, T.FURNACE_TOP, T.FURNACE_FRONT], { hard: 3.5, tool: 'pick', need: 1 });
def(B.CHEST, '상자', [T.CHEST_TOP, T.CHEST_SIDE, T.CHEST_TOP, T.CHEST_FRONT], { snd: 'wood', hard: 2.5, tool: 'axe' });
def(B.STONEBRICK, '석재 벽돌', T.STONEBRICK, { hard: 1.5, tool: 'pick', need: 1 });
def(B.MOSSY, '이끼 낀 조약돌', T.MOSSY, { hard: 2, tool: 'pick', need: 1 });
def(B.SANDSTONE, '사암', [T.SANDSTONE_TOP, T.SANDSTONE_SIDE, T.SANDSTONE_TOP], { hard: .8, tool: 'pick', need: 1 });
def(B.BIRCH_LOG, '자작나무 원목', [T.BIRCH_TOP, T.BIRCH_LOG, T.BIRCH_TOP], { snd: 'wood', hard: 2, tool: 'axe' });
def(B.BIRCH_LEAVES, '자작나무 잎', T.BIRCH_LEAVES, { transparent: true, sky: false, snd: 'grass', hard: .2 });
def(B.BIRCH_PLANKS, '자작나무 판자', T.BIRCH_PLANKS, { snd: 'wood', hard: 2, tool: 'axe' });
def(B.SPRUCE_LOG, '가문비나무 원목', [T.SPRUCE_TOP, T.SPRUCE_LOG, T.SPRUCE_TOP], { snd: 'wood', hard: 2, tool: 'axe' });
def(B.SPRUCE_LEAVES, '가문비나무 잎', T.SPRUCE_LEAVES, { transparent: true, sky: false, snd: 'grass', hard: .2 });
def(B.SPRUCE_PLANKS, '가문비나무 판자', T.SPRUCE_PLANKS, { snd: 'wood', hard: 2, tool: 'axe' });
def(B.PUMPKIN, '호박', [T.PUMPKIN_TOP, T.PUMPKIN_SIDE, T.PUMPKIN_TOP, T.PUMPKIN_FACE], { snd: 'wood', hard: 1, tool: 'axe' });
def(B.JACK, '잭오랜턴', [T.PUMPKIN_TOP, T.PUMPKIN_SIDE, T.PUMPKIN_TOP, T.JACK_FACE], { snd: 'wood', hard: 1, tool: 'axe', light: 15 });
def(B.MELON, '수박', [T.MELON_TOP, T.MELON_SIDE, T.MELON_TOP], { snd: 'wood', hard: 1, tool: 'axe' });
def(B.ICE, '얼음', T.ICE, { transparent: true, sky: false, occ: false, snd: 'glass', hard: .5, tool: 'pick', slip: true });
def(B.SNOWBLOCK, '눈 블록', T.SNOW, { snd: 'cloth', hard: .2, tool: 'shovel' });
def(B.IRON_BLOCK, '철 블록', T.IRON_BLOCK, { hard: 5, tool: 'pick', need: 2 });
def(B.GOLD_BLOCK, '금 블록', T.GOLD_BLOCK, { hard: 3, tool: 'pick', need: 3 });
def(B.DIAMOND_BLOCK, '다이아몬드 블록', T.DIAMOND_BLOCK, { hard: 5, tool: 'pick', need: 3 });
def(B.LAPIS, '청금석 광석', T.LAPIS, { hard: 3, tool: 'pick', need: 2 });
def(B.EMERALD, '에메랄드 광석', T.EMERALD, { hard: 3, tool: 'pick', need: 3 });
def(B.REDSTONE, '레드스톤 광석', T.REDSTONE, { hard: 3, tool: 'pick', need: 3, light: 7 });
def(B.WOOL_WHITE, '흰색 양털', T.WOOL_WHITE, { snd: 'cloth', hard: .8 });
def(B.WOOL_YELLOW, '노란색 양털', T.WOOL_YELLOW, { snd: 'cloth', hard: .8 });
def(B.WOOL_BLUE, '파란색 양털', T.WOOL_BLUE, { snd: 'cloth', hard: .8 });
def(B.WOOL_GREEN, '초록색 양털', T.WOOL_GREEN, { snd: 'cloth', hard: .8 });
def(B.WOOL_BLACK, '검은색 양털', T.WOOL_BLACK, { snd: 'cloth', hard: .8 });
def(B.LADDER, '사다리', T.LADDER, { solid: false, transparent: true, shape: 'ladder', sky: false, occ: false, snd: 'wood', hard: .4, tool: 'axe', climb: true });
def(B.SUGARCANE, '사탕수수', T.SUGARCANE, Object.assign({}, PLANT, { replace: false }));
def(B.DEADBUSH, '마른 덤불', T.DEADBUSH, PLANT);
def(B.MUSH_RED, '빨간 버섯', T.MUSH_RED, Object.assign({}, PLANT, { replace: false }));
def(B.MUSH_BROWN, '갈색 버섯', T.MUSH_BROWN, Object.assign({}, PLANT, { replace: false }));
def(B.SAPLING, '묘목', T.SAPLING, Object.assign({}, PLANT, { replace: false }));
def(B.BREWING, '양조기', T.BREWING, Object.assign({}, PLANT, { replace: false, snd: 'stone', hard: .5, tool: 'pick', need: 1 }));
def(B.CLAY, '점토', T.CLAY, { snd: 'grass', hard: .6, tool: 'shovel' });
def(B.UNLOADED, '?', 0, { occ: true, hard: -1 });
for (let i = 0; i < 256; i++) if (!BLOCKS[i]) BLOCKS[i] = BLOCKS[0];
for (const bd of BLOCKS) bd.opaque = bd.solid && !bd.transparent; // blocks light
const isFluid = id => id === B.WATER || id === B.LAVA;

// ---------- items ----------
const I = {
  STICK: 256, COAL_ITEM: 257, IRON_INGOT: 258, GOLD_INGOT: 259, DIAMOND_GEM: 260, EMERALD_GEM: 261, LAPIS_ITEM: 262, REDSTONE_DUST: 263, GLOW_DUST: 264, SUGAR: 265,
  APPLE: 266, GOLDEN_APPLE: 267, PORK_RAW: 268, PORK_COOKED: 269, MUTTON_RAW: 270, MUTTON_COOKED: 271, ROTTEN: 272, MELON_SLICE: 273, GLIST_MELON: 274, BOWL: 275, STEW: 276,
  BUCKET: 277, WATER_BUCKET: 278, LAVA_BUCKET: 279, BOTTLE: 280, WATER_BOTTLE: 281,
};
const TOOL_TIERS = [
  { key: 'WOOD', name: '나무', speed: 2, dur: 59, color: [150, 116, 66] },
  { key: 'STONE', name: '돌', speed: 4, dur: 131, color: [128, 128, 128] },
  { key: 'IRON', name: '철', speed: 6, dur: 250, color: [222, 222, 222] },
  { key: 'DIAMOND', name: '다이아몬드', speed: 8, dur: 1561, color: [92, 230, 222] },
];
const TOOL_TYPES = [{ key: 'PICK', type: 'pick', name: '곡괭이', dmg: 2 }, { key: 'AXE', type: 'axe', name: '도끼', dmg: 3 }, { key: 'SHOVEL', type: 'shovel', name: '삽', dmg: 1.5 }, { key: 'SWORD', type: 'sword', name: '검', dmg: 4 }];
TOOL_TIERS.forEach((tier, ti) => TOOL_TYPES.forEach((tt, ki) => I[tier.key + '_' + tt.key] = 290 + ti * 4 + ki));
const EFFECTS = {
  speed: { name: '신속', color: '#7cc4e8' }, jump: { name: '도약', color: '#3fe07a' }, strength: { name: '힘', color: '#c8342c' },
  regen: { name: '재생', color: '#e87ac4' }, heal: { name: '즉시 치유', color: '#f83a3a' }, nightvision: { name: '야간 투시', color: '#2a4bdc' },
  waterbreath: { name: '수중 호흡', color: '#3a7ad8' }, fireres: { name: '화염 저항', color: '#e6942e' }, invis: { name: '투명화', color: '#9aa3b8' },
  resist: { name: '저항', color: '#9a6b4a' }, slowfall: { name: '느린 낙하', color: '#f5edd2' }, hunger: { name: '허기', color: '#587b3a' },
};
// potion: [effect, seconds, level, ingredient]
const POTIONS = [
  ['speed', 180, 1, I.SUGAR], ['heal', 0, 1, I.GLIST_MELON], ['regen', 45, 1, I.GOLDEN_APPLE], ['nightvision', 180, 1, I.GLOW_DUST],
  ['strength', 180, 1, I.IRON_INGOT], ['waterbreath', 180, 1, I.LAPIS_ITEM], ['jump', 180, 1, I.EMERALD_GEM], ['fireres', 180, 1, B.OBSIDIAN],
  ['invis', 180, 1, B.GLASS], ['resist', 90, 1, I.DIAMOND_GEM], ['slowfall', 90, 1, B.WOOL_WHITE],
];
POTIONS.forEach((p, i) => I['POTION_' + p[0].toUpperCase()] = 320 + i);

const ITEMS = [];
function item(id, name, o = {}) { ITEMS[id] = Object.assign({ id, name, stack: 64, block: id < 256 ? id : 0 }, o); }
for (let id = 1; id < 255; id++) if (BLOCKS[id] !== BLOCKS[0]) item(id, BLOCKS[id].name);
item(I.STICK, '막대기'); item(I.COAL_ITEM, '석탄'); item(I.IRON_INGOT, '철괴'); item(I.GOLD_INGOT, '금괴'); item(I.DIAMOND_GEM, '다이아몬드');
item(I.EMERALD_GEM, '에메랄드'); item(I.LAPIS_ITEM, '청금석'); item(I.REDSTONE_DUST, '레드스톤 가루'); item(I.GLOW_DUST, '발광석 가루'); item(I.SUGAR, '설탕');
item(I.APPLE, '사과', { food: [4, 2.4] }); item(I.GOLDEN_APPLE, '황금 사과', { food: [4, 9.6], always: true, eff: [['regen', 6, 2, 1]] });
item(I.PORK_RAW, '날 돼지고기', { food: [3, 1.8] }); item(I.PORK_COOKED, '익힌 돼지고기', { food: [8, 12.8] });
item(I.MUTTON_RAW, '날 양고기', { food: [2, 1.2] }); item(I.MUTTON_COOKED, '익힌 양고기', { food: [6, 9.6] });
item(I.ROTTEN, '썩은 살점', { food: [4, .8], eff: [['hunger', 30, 1, .8]] }); item(I.MELON_SLICE, '수박 조각', { food: [2, 1.2] });
item(I.GLIST_MELON, '반짝이는 수박 조각'); item(I.BOWL, '그릇'); item(I.STEW, '버섯 스튜', { food: [6, 7.2], stack: 1, returns: I.BOWL });
item(I.BUCKET, '양동이', { stack: 16 }); item(I.WATER_BUCKET, '물 양동이', { stack: 1, fluid: B.WATER }); item(I.LAVA_BUCKET, '용암 양동이', { stack: 1, fluid: B.LAVA });
item(I.BOTTLE, '유리병'); item(I.WATER_BOTTLE, '물병', { stack: 1 });
TOOL_TIERS.forEach((tier, ti) => TOOL_TYPES.forEach((tt, ki) => item(I[tier.key + '_' + tt.key], `${tier.name} ${tt.name}`, { stack: 1, tool: tt.type, tier: ti + 1, speed: tier.speed, dur: tier.dur, dmg: tt.dmg + ti })));
POTIONS.forEach(([eff, sec, lv], i) => item(320 + i, EFFECTS[eff].name + '의 물약', { stack: 1, potion: [eff, sec, lv] }));
const itemName = id => ITEMS[id] ? ITEMS[id].name : '?';
const maxStack = id => ITEMS[id] ? ITEMS[id].stack : 64;
const isPlaceable = id => id > 0 && id < 256;

// ---------- recipes ----------
const PLANKS_ANY = [B.PLANKS, B.BIRCH_PLANKS, B.SPRUCE_PLANKS], LOG_ANY = [B.LOG, B.BIRCH_LOG, B.SPRUCE_LOG];
const RECIPES = [];
// st: null (hand), 'table', 'furnace' (costs 1 fuel), 'brew'
function rec(out, n, ins, st = null, cat = 'block') { RECIPES.push({ out, n, ins, st, cat }); }
rec(B.PLANKS, 4, [[B.LOG, 1]]); rec(B.BIRCH_PLANKS, 4, [[B.BIRCH_LOG, 1]]); rec(B.SPRUCE_PLANKS, 4, [[B.SPRUCE_LOG, 1]]);
rec(I.STICK, 4, [[PLANKS_ANY, 2]], null, 'item'); rec(B.TABLE, 1, [[PLANKS_ANY, 4]]); rec(B.TORCH, 4, [[I.STICK, 1], [I.COAL_ITEM, 1]]);
TOOL_TIERS.forEach((tier, ti) => {
  const mat = [PLANKS_ANY, B.COBBLE, I.IRON_INGOT, I.DIAMOND_GEM][ti];
  rec(I[tier.key + '_PICK'], 1, [[mat, 3], [I.STICK, 2]], 'table', 'tool'); rec(I[tier.key + '_AXE'], 1, [[mat, 3], [I.STICK, 2]], 'table', 'tool');
  rec(I[tier.key + '_SHOVEL'], 1, [[mat, 1], [I.STICK, 2]], 'table', 'tool'); rec(I[tier.key + '_SWORD'], 1, [[mat, 2], [I.STICK, 1]], 'table', 'tool');
});
rec(B.CHEST, 1, [[PLANKS_ANY, 8]], 'table'); rec(B.FURNACE, 1, [[B.COBBLE, 8]], 'table'); rec(B.LADDER, 3, [[I.STICK, 7]], 'table');
rec(B.BREWING, 1, [[B.COBBLE, 3], [I.IRON_INGOT, 1]], 'table'); rec(I.BUCKET, 1, [[I.IRON_INGOT, 3]], 'table', 'item'); rec(I.BOTTLE, 3, [[B.GLASS, 3]], 'table', 'item');
rec(I.BOWL, 4, [[PLANKS_ANY, 3]], 'table', 'item'); rec(B.BOOKSHELF, 1, [[PLANKS_ANY, 6], [B.SUGARCANE, 3]], 'table');
rec(B.TNT, 1, [[B.SAND, 4], [I.COAL_ITEM, 4], [I.REDSTONE_DUST, 1]], 'table');
rec(B.STONEBRICK, 4, [[B.STONE, 4]], 'table'); rec(B.MOSSY, 1, [[B.COBBLE, 1], [B.LEAVES, 1]]); rec(B.SANDSTONE, 1, [[B.SAND, 4]]);
rec(B.GLOWSTONE, 1, [[I.GLOW_DUST, 4]]); rec(B.JACK, 1, [[B.PUMPKIN, 1], [B.TORCH, 1]]); rec(B.MELON, 1, [[I.MELON_SLICE, 9]]);
rec(B.IRON_BLOCK, 1, [[I.IRON_INGOT, 9]], 'table'); rec(I.IRON_INGOT, 9, [[B.IRON_BLOCK, 1]], null, 'item');
rec(B.GOLD_BLOCK, 1, [[I.GOLD_INGOT, 9]], 'table'); rec(I.GOLD_INGOT, 9, [[B.GOLD_BLOCK, 1]], null, 'item');
rec(B.DIAMOND_BLOCK, 1, [[I.DIAMOND_GEM, 9]], 'table'); rec(I.DIAMOND_GEM, 9, [[B.DIAMOND_BLOCK, 1]], null, 'item');
rec(B.WOOL, 1, [[B.WOOL_WHITE, 1], [B.ROSE, 1]]); rec(B.WOOL_YELLOW, 1, [[B.WOOL_WHITE, 1], [B.DANDELION, 1]]); rec(B.WOOL_BLUE, 1, [[B.WOOL_WHITE, 1], [I.LAPIS_ITEM, 1]]);
rec(B.WOOL_GREEN, 1, [[B.WOOL_WHITE, 1], [B.CACTUS, 1]]); rec(B.WOOL_BLACK, 1, [[B.WOOL_WHITE, 1], [I.COAL_ITEM, 1]]);
rec(I.SUGAR, 1, [[B.SUGARCANE, 1]], null, 'food'); rec(I.GLIST_MELON, 1, [[I.MELON_SLICE, 1], [I.GOLD_INGOT, 1]], null, 'food');
rec(I.GOLDEN_APPLE, 1, [[I.APPLE, 1], [I.GOLD_INGOT, 4]], 'table', 'food'); rec(I.STEW, 1, [[I.BOWL, 1], [B.MUSH_RED, 1], [B.MUSH_BROWN, 1]], null, 'food');
rec(B.GLASS, 1, [[B.SAND, 1]], 'furnace'); rec(B.STONE, 1, [[B.COBBLE, 1]], 'furnace'); rec(B.BRICK, 1, [[B.CLAY, 1]], 'furnace');
rec(I.IRON_INGOT, 1, [[B.IRON, 1]], 'furnace', 'item'); rec(I.GOLD_INGOT, 1, [[B.GOLD, 1]], 'furnace', 'item'); rec(I.COAL_ITEM, 1, [[LOG_ANY, 1]], 'furnace', 'item');
rec(I.PORK_COOKED, 1, [[I.PORK_RAW, 1]], 'furnace', 'food'); rec(I.MUTTON_COOKED, 1, [[I.MUTTON_RAW, 1]], 'furnace', 'food');
POTIONS.forEach(([, , , ing], i) => rec(320 + i, 1, [[I.WATER_BOTTLE, 1], [ing, 1]], 'brew', 'potion'));
// furnace fuel: how many smelts one item powers
const FUEL = { [I.COAL_ITEM]: 8, [B.PLANKS]: 1, [B.BIRCH_PLANKS]: 1, [B.SPRUCE_PLANKS]: 1, [B.LOG]: 1, [B.BIRCH_LOG]: 1, [B.SPRUCE_LOG]: 1, [I.STICK]: .5 };
const STATION_NAME = { table: '작업대', furnace: '화로', brew: '양조기' };
const STATION_BLOCK = { table: B.TABLE, furnace: B.FURNACE, brew: B.BREWING };

// creative palette order
const PALETTE = [B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.MOSSY, B.STONEBRICK, B.BRICK, B.SAND, B.SANDSTONE, B.GRAVEL, B.CLAY, B.SNOW, B.SNOWBLOCK, B.ICE,
  B.LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.PLANKS, B.BIRCH_PLANKS, B.SPRUCE_PLANKS, B.LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES, B.GLASS, B.BOOKSHELF,
  B.TABLE, B.FURNACE, B.CHEST, B.BREWING, B.LADDER, B.TORCH, B.GLOWSTONE, B.JACK, B.PUMPKIN, B.MELON, B.CACTUS, B.TNT, B.OBSIDIAN, B.BEDROCK,
  B.COAL, B.IRON, B.GOLD, B.DIAMOND, B.LAPIS, B.REDSTONE, B.EMERALD, B.IRON_BLOCK, B.GOLD_BLOCK, B.DIAMOND_BLOCK,
  B.WOOL_WHITE, B.WOOL, B.WOOL_YELLOW, B.WOOL_GREEN, B.WOOL_BLUE, B.WOOL_BLACK, B.TALLGRASS, B.ROSE, B.DANDELION, B.SAPLING, B.SUGARCANE, B.DEADBUSH, B.MUSH_RED, B.MUSH_BROWN,
  I.WATER_BUCKET, I.LAVA_BUCKET, I.BUCKET, I.BOTTLE, I.WATER_BOTTLE,
  ...TOOL_TIERS.flatMap(t => TOOL_TYPES.map(k => I[t.key + '_' + k.key])),
  I.STICK, I.COAL_ITEM, I.IRON_INGOT, I.GOLD_INGOT, I.DIAMOND_GEM, I.EMERALD_GEM, I.LAPIS_ITEM, I.REDSTONE_DUST, I.GLOW_DUST, I.SUGAR, I.BOWL,
  I.APPLE, I.GOLDEN_APPLE, I.PORK_RAW, I.PORK_COOKED, I.MUTTON_RAW, I.MUTTON_COOKED, I.ROTTEN, I.MELON_SLICE, I.GLIST_MELON, I.STEW,
  ...POTIONS.map((p, i) => 320 + i)];

// ---------- geometry tables ----------
// corner = [x, y, z, u, v]; faces: -x, +x, -y, +y, -z, +z
const FACES = [
  { dir: [-1, 0, 0], shade: 0.62, c: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], shade: 0.62, c: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], shade: 0.5, c: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], shade: 1.0, c: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], shade: 0.8, c: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], shade: 0.8, c: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];
for (const f of FACES) {
  const na = f.dir.findIndex(v => v !== 0), ta = [0, 1, 2].filter(a => a !== na);
  f.ao = f.c.map(c => {
    const s1 = [...f.dir], s2 = [...f.dir];
    s1[ta[0]] += c[ta[0]] ? 1 : -1; s2[ta[1]] += c[ta[1]] ? 1 : -1;
    const cr = [...f.dir]; cr[ta[0]] = s1[ta[0]]; cr[ta[1]] = s2[ta[1]];
    return [s1, s2, cr];
  });
}
const HORIZ = [0, 1, 4, 5]; // face indices of the four side faces
function faceTile(bd, fi, meta) {
  const f = FACES[fi];
  if (f.dir[1] === 1) return bd.tiles[0];
  if (f.dir[1] === -1) return bd.tiles[2];
  return bd.face && fi === (meta & 7) ? bd.tiles[3] : bd.tiles[1];
}
const UV_EPS = 0.002;
function tileUV(tile, u, v) { const tc = tile % ATLAS_COLS, tr = (tile / ATLAS_COLS) | 0; return [(tc + UV_EPS + u * (1 - 2 * UV_EPS)) / ATLAS_COLS, 1 - (tr + 1 - UV_EPS - v * (1 - 2 * UV_EPS)) / ATLAS_ROWS]; }
const PLANT_QUADS = [[[.15, 0, .15], [.85, 0, .85], [.15, 1, .15], [.85, 1, .85]], [[.85, 0, .15], [.15, 0, .85], [.85, 1, .15], [.15, 1, .85]]];
