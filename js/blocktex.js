'use strict';
// ============================================================
//  Block textures: every tile gets its own original 128x128 set
//  (albedo, normal, ORM, optional emissive) built from tileable
//  noise, plus its material values (TILE_SPEC) and inventory icons.
// ============================================================
const TILE_SPEC = [], TILE_MAPS = [], tileAvg = [];
const nz = Array.from({ length: 10 }, (_, i) => tileNoise(101 + i));
const cells = Array.from({ length: 6 }, (_, i) => tileCells(201 + i, i === 3 ? 1 : 0.85));
const CO = {}, CO2 = {}, rgb = hexc;
const TAU = Math.PI * 2;
// opts: rough (material roughness), metal (metalness where the metal mask is 1), uv ('rot' | 'flip' | 'flipxy' | 'none'),
// cutout, transparent, emissive (intensity), bump (normal strength), wrap (tileable edges), spec (specular scale),
// plant (crossed quads: no normal map), tint (scale of the per-block colour variation, default 1)
function defTile(names, opts, gen) { for (const n of [].concat(names)) TILE_SPEC[T[n]] = Object.assign({ rough: .9, uv: 'rot', bump: 3, wrap: true, gen, name: n }, opts); }
const memo = f => { let v = null; return () => v || (v = f()); };

// ---------- rock and soil ----------
function stoneField(L, dark = rgb('#5c5b57'), light = rgb('#a19f99'), warm = rgb('#8d8274')) {
  each(L, (u, v, p) => {
    const w = tfbm(nz[0], u, v, 2, 3) * .1;
    const big = tfbm(nz[1], u + w, v - w, 3, 5), fine = tfbm(nz[2], u, v, 16, 3);
    cells[0](u + w * .6, v - w * .6, 4, CO);
    const crack = tfbm(nz[3], u, v, 2, 2) > .02 ? 1 - smoothstep(0, .045, CO.f2 - CO.f1) : 0;
    let c = mixc(dark, light, clamp(.5 + big * 1.1, 0, 1));
    c = mixc(c, warm, smoothstep(-.1, .35, tfbm(nz[4], u, v, 2, 2)) * .3);
    p.c = mulc(c, 1 + fine * .22 - crack * .4);
    p.h = .55 + big * .35 + fine * .1 - crack * .3; p.r = .93 + fine * .15;
  });
}
const stoneBase = memo(() => { const L = newLayers(true); stoneField(L); return L; });
function dirtField(L) {
  each(L, (u, v, p) => {
    const base = tfbm(nz[1], u, v, 4, 5), fine = tfbm(nz[2], u, v, 20, 3), clod = tridged(nz[3], u, v, 6, 3);
    cells[1](u, v, 10, CO); const peb = CO.id < .16 ? smoothstep(.38, .12, CO.f1) : 0;
    const c = mulc(mixc(rgb('#3b2a1d'), rgb('#6e5139'), clamp(.5 + base * 1.3, 0, 1)), 1 + fine * .3 + (clod - .5) * .25);
    p.c = mixc(c, mulc(mixc(rgb('#6d665d'), rgb('#8f8577'), clamp(CO.id * 6, 0, 1)), 1 + fine * .2), peb);
    p.h = .4 + base * .3 + fine * .12 + clod * .15 + peb * .4; p.r = 1;
  });
}
const dirtBase = memo(() => { const L = newLayers(); dirtField(L); return L; });
const grassColor = (t, dry) => mixc(mixc(rgb('#2c4417'), rgb('#6c9637'), clamp(t, 0, 1)), rgb('#8d8a43'), dry);
defTile('STONE', { rough: .9 }, L => stoneField(L));
defTile('DIRT', { rough: 1 }, L => dirtField(L));
defTile('GRASS_TOP', { rough: .85, bump: 3.5 }, L => each(L, (u, v, p) => {
  const w = tfbm(nz[4], u, v, 3, 2) * .04, blades = tridged(nz[5], u + w, v - w, 20, 3), clump = tfbm(nz[6], u, v, 5, 3);
  const dry = smoothstep(.1, .45, tfbm(nz[7], u, v, 2, 3)) * .35, soil = smoothstep(.32, .12, blades + clump * .2);
  p.c = mixc(grassColor(blades * .75 + clump * .6 + .1, dry), rgb('#3e3022'), soil * .5);
  p.h = blades * .6 + clump * .25; p.r = .9 + blades * .12;
}));
// a cover (grass, snow) over the top of a dirt side; strands > 0 lets blades hang down unevenly, 0 gives a soft drape
function capOver(L, col, edgeAt, rough, strands) {
  each(L, (u, v, p) => {
    const edge = edgeAt + tfbm(nz[4], u, .37, 6, 3) * .1, strand = strands ? tridged(nz[5], u, v, 20, 2, 3) : 0;
    const hang = edge - strand * strands * (.35 + .65 * (.5 + .5 * tfbm(nz[6], u, .5, 5, 2))) - (strands ? 0 : (.5 + .5 * tfbm(nz[5], u, .5, 8, 2)) * .07);
    if (v > hang) { const t = (v - hang) / Math.max(1e-3, 1 - hang); p.c = col(strand, t); p.h = .55 + strand * .35; p.r = rough; }
    else p.c = mulc(p.c, 1 - smoothstep(hang - .08, hang, v) * .35);
  });
}
defTile('GRASS_SIDE', { rough: .85, uv: 'flip' }, L => { Object.assign(L, copyLayers(dirtBase())); capOver(L, (s, t) => grassColor(s * .8 + t * .25 + tfbm(nz[7], (s + t) * .5, .5, 4, 2) * .2, 0), .8, .95, .2); });
defTile('SNOW_SIDE', { rough: .9, uv: 'flip' }, L => { Object.assign(L, copyLayers(dirtBase())); capOver(L, (s, t) => mixc(rgb('#c4d2e2'), rgb('#f2f6f9'), clamp(.55 + t * .5, 0, 1)), .78, 1, 0); });
defTile('SAND', { rough: .95, bump: 2.5 }, L => each(L, (u, v, p) => {
  const warp = tfbm(nz[1], u, v, 2, 3) * .25, rip = Math.sin((v * 6 + u + warp) * TAU) * smoothstep(-.1, .3, tfbm(nz[4], u, v, 2, 2)) * .3, grain = tfbm(nz[2], u, v, 32, 2), g2 = tfbm(nz[3], u, v, 8, 3);
  cells[2](u, v, 40, CO); const dk = CO.id < .25 ? smoothstep(.2, .05, CO.f1) : 0;
  p.c = mixc(mulc(mixc(rgb('#b89a6a'), rgb('#dcc79a'), clamp(.55 + g2 * .8 + rip * .12, 0, 1)), 1 + grain * .18), rgb('#7d6e5a'), dk * .7);
  p.h = .5 + rip * .12 + g2 * .2 + grain * .1; p.r = 1;
}));
defTile('GRAVEL', { rough: .95 }, L => each(L, (u, v, p) => {
  cells[3](u, v, 9, CO); const ed = CO.f2 - CO.f1, dome = smoothstep(0, .3, ed);
  const pal = ['#6f6b66', '#8a847c', '#5b5652', '#9a8f80', '#6e6258'][Math.floor(CO.id * 5)];
  p.c = ed < .05 ? rgb('#2d2a27') : mulc(rgb(pal), .8 + dome * .35 + tfbm(nz[2], u, v, 24, 2) * .15);
  p.h = dome * .7 + tfbm(nz[3], u, v, 16, 2) * .1; p.r = 1;
}));
function cobbleField(L, moss) {
  each(L, (u, v, p) => {
    cells[3](u + tfbm(nz[1], u, v, 4, 2) * .03, v, 4, CO);
    const ed = CO.f2 - CO.f1, stone = smoothstep(.04, .14, ed), detail = tfbm(nz[2], u, v, 12, 3);
    let c = mixc(rgb('#4c4842'), mulc(mixc(rgb('#6b6a66'), rgb('#9d9b95'), CO.id), 1 + detail * .25), stone);
    let h = stone * (.45 + smoothstep(.04, .4, ed) * .4) + detail * .1, r = stone ? .9 : 1;
    if (moss) {
      const m = smoothstep(0, .3, tfbm(nz[6], u, v, 3, 4) + (1 - stone) * .25);
      c = mixc(c, mixc(rgb('#2f4a1c'), rgb('#5f7d2e'), clamp(.5 + tfbm(nz[7], u, v, 12, 2), 0, 1)), m * .85); h += m * .08; r = r + m * .1;
    }
    p.c = c; p.h = h; p.r = r;
  });
}
defTile('COBBLE', { rough: .9, bump: 4 }, L => cobbleField(L, false));
defTile('MOSSY', { rough: .9, bump: 4 }, L => cobbleField(L, true));
defTile('BEDROCK', { rough: .95, bump: 4 }, L => each(L, (u, v, p) => {
  const a = tridged(nz[1], u, v, 4, 4), b = tfbm(nz[2], u, v, 8, 3); cells[0](u, v, 6, CO);
  p.c = mixc(mixc(rgb('#1e1e20'), rgb('#5c5a57'), clamp(a * .9 + b * .4, 0, 1)), rgb('#85827c'), smoothstep(.78, .92, a) * .6);
  p.h = a * .6 + b * .25 + smoothstep(0, .1, CO.f2 - CO.f1) * .2; p.r = 1;
}));
defTile('CLAY', { rough: 1, bump: 1.5 }, L => each(L, (u, v, p) => {
  const b = tfbm(nz[1], u, v, 3, 4); cells[5](u, v, 16, CO); const pore = CO.id < .2 ? smoothstep(.15, .05, CO.f1) : 0;
  p.c = mulc(mixc(rgb('#7f848d'), rgb('#a9adb4'), clamp(.5 + b * .9, 0, 1)), 1 + Math.sin((v * 9 + b * .4) * TAU) * .025 - pore * .25);
  p.h = .5 + b * .15 - pore * .2; p.r = 1;
}));
defTile('OBSIDIAN', { rough: .3, spec: 1, bump: 2 }, L => each(L, (u, v, p) => {
  cells[0](u, v, 3, CO); const ring = .5 + .5 * Math.sin(CO.f1 * 26), big = tfbm(nz[1], u, v, 3, 4);
  p.c = mixc(rgb('#08070b'), rgb('#2a2040'), clamp(.25 + big * .8 + ring * .12, 0, 1));
  p.h = .5 + ring * .06 + big * .15 + (smoothstep(0, .04, CO.f2 - CO.f1) - 1) * .2; p.r = .9 + big * .2;
}));
defTile('SANDSTONE_SIDE', { rough: .95, uv: 'flip' }, L => each(L, (u, v, p) => {
  const band = Math.sin((v * 7 + tfbm(nz[1], u, v, 2, 3) * .12) * TAU), fine = tfbm(nz[2], u, v, 16, 3, 4);
  cells[2](u, v, 10, CO); const pit = CO.id < .2 ? smoothstep(.15, .05, CO.f1) : 0;
  p.c = mulc(mixc(rgb('#b9945f'), rgb('#d9bd8a'), clamp(.55 + band * .1 + fine * .4, 0, 1)), 1 - pit * .3);
  p.h = .5 + band * .04 + fine * .12 - pit * .3; p.r = 1;
}));
defTile('SANDSTONE_TOP', { rough: .95, bump: 1.5 }, L => each(L, (u, v, p) => {
  const b = tfbm(nz[1], u, v, 3, 4), sw = Math.sin((u * 3 + v * 2 + b * .5) * TAU);
  p.c = mulc(mixc(rgb('#c4a26c'), rgb('#dec594'), clamp(.55 + b * .8, 0, 1)), 1 + sw * .03); p.h = .5 + b * .2 + sw * .03; p.r = 1;
}));
defTile('SNOW', { rough: .9, bump: 1.5 }, L => each(L, (u, v, p) => {
  const big = tfbm(nz[1], u, v, 3, 4), fine = tfbm(nz[2], u, v, 16, 3); cells[5](u, v, 24, CO);
  const glint = CO.id < .12 && CO.f1 < .12 ? 1 : 0;
  p.c = mulc(mixc(rgb('#c9d6e6'), rgb('#f4f7fa'), clamp(.7 + big * .8 + fine * .2, 0, 1)), 1 + glint * .08);
  p.h = .5 + big * .4 + fine * .1; p.r = glint ? .3 : 1;
}));
defTile('ICE', { rough: .05, transparent: true, spec: 1, bump: 1, tint: .3 }, L => each(L, (u, v, p) => {
  cells[0](u, v, 3, CO); const crack = 1 - smoothstep(0, .02, CO.f2 - CO.f1); cells[5](u, v, 18, CO2);
  const bub = CO2.id < .3 ? smoothstep(.1, .04, CO2.f1) : 0;
  p.c = mixc(mixc(rgb('#8fc0e3'), rgb('#cfe8f6'), clamp(.5 + tfbm(nz[1], u, v, 2, 3) * .8, 0, 1)), rgb('#f4fbff'), Math.max(crack * .7, bub));
  p.a = .6 + crack * .25 + bub * .2; p.h = .5 - crack * .1 + tfbm(nz[2], u, v, 4, 3) * .03; p.r = 1 + crack * 4;
}));

// ---------- ores: mineral clusters in stone, metallic only where the mineral sits ----------
function oreField(L, mineral, dark, glow) {
  Object.assign(L, copyLayers(stoneBase()));
  each(L, (u, v, p) => {
    cells[4](u, v, 4, CO);
    const blob = CO.id < .55 ? smoothstep(.36 + CO.id * .3, .18, CO.f1 + tfbm(nz[8], u, v, 8, 3) * .35) : 0;
    if (blob <= 0) return;
    cells[5](u, v, 22, CO2); const edge = smoothstep(0, .08, CO2.f2 - CO2.f1), facet = .65 + CO2.id * .45;
    p.c = mixc(p.c, mulc(mixc(dark, mineral, CO2.id), facet * (.8 + edge * .25)), blob);
    p.h += blob * (.22 + edge * .1); p.m = smoothstep(.3, .7, blob); p.r = p.r + (.5 - p.r) * blob;
    if (glow) p.e = mulc(glow, blob);
  });
}
const ORES = { COAL: ['#262629', '#0d0d0f'], IRON: ['#c99a72', '#7a5038'], GOLD: ['#efc955', '#9a6e1c'], DIAMOND: ['#8ff0f2', '#2a9ea6'],
  LAPIS: ['#3a62d0', '#14286e'], EMERALD: ['#37d58a', '#0e6b3c'], REDSTONE: ['#e0281e', '#6e0c08'] };
for (const [k, [m, d]] of Object.entries(ORES)) defTile(k, { rough: .9, metal: .6, bump: 4, emissive: k === 'REDSTONE' ? .6 : 0 }, L => oreField(L, rgb(m), rgb(d), k === 'REDSTONE' ? [1, .12, .05] : null));
defTile('GLOWSTONE', { rough: .6, emissive: 1.4, bump: 4 }, L => each(L, (u, v, p) => {
  cells[0](u, v, 6, CO); const core = 1 - smoothstep(0, .55, CO.f1), edge = 1 - smoothstep(0, .06, CO.f2 - CO.f1);
  p.c = mulc(mixc(rgb('#9a5a1c'), rgb('#ffe08c'), core), 1 - edge * .5); p.e = mulc(mixc(rgb('#ff9a3a'), rgb('#ffe7a0'), core), core * .9 + .1);
  p.h = core * .6 - edge * .2; p.r = 1;
}));

// ---------- wood ----------
function barkField(L, dark, light, kind) {
  each(L, (u, v, p) => {
    const fine = tfbm(nz[2], u, v, 16, 2, 4);
    if (kind === 'birch') {
      const dash = smoothstep(.82, .95, tridged(nz[3], u, v, 3, 2, 22)), patch = smoothstep(.4, .5, tfbm(nz[4], u, v, 3, 3)) * .8;
      p.c = mixc(mulc(mixc(dark, light, clamp(.6 + fine * .8, 0, 1)), 1), rgb('#2e2b28'), Math.max(dash * .85, patch * .9));
      p.h = .5 + fine * .12 - dash * .2 - patch * .1; p.r = .95; return;
    }
    const ridges = tridged(nz[1], u, v, kind === 'spruce' ? 12 : 9, 3, 2);
    cells[1](u, v, kind === 'spruce' ? 6 : 5, CO, kind === 'spruce' ? 4 : 2);
    const crack = 1 - smoothstep(0, .06, CO.f2 - CO.f1);
    p.c = mulc(mixc(dark, light, clamp(ridges * .8 + fine * .3, 0, 1)), 1 - crack * .45);
    p.h = ridges * .55 + fine * .1 - crack * .35; p.r = 1;
  });
}
function ringField(L, heart, sap, bark) {
  each(L, (u, v, p) => {
    const dx = u - .5, dy = v - .5, r = Math.hypot(dx, dy) + tfbm(nz[2], u, v, 3, 3) * .03, a = Math.atan2(dy, dx);
    const rings = .5 + .5 * Math.sin(r * TAU * 11 + tfbm(nz[3], u, v, 4, 2) * 1.5);
    const crack = smoothstep(.992, 1, Math.cos(a * 3 + tfbm(nz[5], u, v, 2, 2) * 2)) * smoothstep(.06, .3, r);
    const barkT = smoothstep(.43, .47, r);
    let c = mulc(mixc(heart, sap, smoothstep(.12, .4, r)), .84 + rings * .2);
    c = mixc(c, mulc(bark, .8 + tfbm(nz[6], u, v, 16, 2) * .4), barkT);
    p.c = mulc(c, 1 - crack * .5 - smoothstep(.03, .01, r) * .4);
    p.h = .5 + rings * .06 + barkT * (.15 + tfbm(nz[6], u, v, 16, 2) * .2) - crack * .3; p.r = .95 + barkT * .1;
  });
}
function plankField(L, dark, light, seed) {
  each(L, (u, v, p) => {
    const b = Math.floor(v * 4), lv = v * 4 - b, ju = (u - ihash(b, 7, seed) + 1) % 1;
    const groove = Math.min(smoothstep(0, .07, lv), smoothstep(1, .93, lv), smoothstep(0, .012, ju), smoothstep(1, .988, ju));
    const grain = tfbm(nz[1], u + b * .31, v, 2, 4, 48), rings = .5 + .5 * Math.sin((v * 40 + tfbm(nz[2], u, v, 3, 3) * 3) * TAU);
    const kd = Math.hypot(u - ihash(b, 11, seed), (v - (b + .5) / 4) * 1.6), knot = ihash(b, 13, seed) < .5 ? smoothstep(.07, .015, kd) : 0;
    let c = mulc(mixc(dark, light, clamp(.5 + grain * .9 + rings * .12, 0, 1)), .82 + ihash(b, 3, seed) * .3);
    c = mixc(c, rgb('#3a2717'), knot * .8);
    p.c = mulc(c, .55 + .45 * groove); p.h = groove * (.6 + grain * .15) + rings * .04 - knot * .05; p.r = .95 + grain * .1;
  });
}
const WOOD = {
  oak: { bark: ['#3d2f22', '#7a6650'], heart: '#9a6c40', sap: '#c9a46e', plank: ['#7e5934', '#b88a58'] },
  birch: { bark: ['#cfcabd', '#f1eee6'], heart: '#cfb27e', sap: '#e6d4ab', plank: ['#bba273', '#e2cfa3'] },
  spruce: { bark: ['#2e1f17', '#6a4a35'], heart: '#8f6438', sap: '#b98a5a', plank: ['#5c3d24', '#8e643c'] },
};
for (const [k, w] of Object.entries(WOOD)) {
  const P = k === 'oak' ? '' : k.toUpperCase() + '_';
  defTile(k === 'oak' ? 'LOG_SIDE' : P + 'LOG', { rough: .8, uv: 'flip', bump: k === 'birch' ? 2 : 4.5 }, L => barkField(L, rgb(w.bark[0]), rgb(w.bark[1]), k));
  defTile(k === 'oak' ? 'LOG_TOP' : P + 'TOP', { rough: .8, wrap: false }, L => ringField(L, rgb(w.heart), rgb(w.sap), rgb(w.bark[0])));
  defTile(P + 'PLANKS', { rough: .8, uv: 'flipxy', bump: 3 }, L => plankField(L, rgb(w.plank[0]), rgb(w.plank[1]), k.length));
}
const oakPlanks = memo(() => { const L = newLayers(true); plankField(L, rgb(WOOD.oak.plank[0]), rgb(WOOD.oak.plank[1]), 3); return L; });

// ---------- foliage (alpha cut-outs) ----------
function leafField(L, dark, light, needles) {
  const layers = needles ? cells.map((c, i) => [c, 7 + i]) : [[cells[0], 6], [cells[1], 7], [cells[4], 5], [cells[2], 8]];
  each(L, (u, v, p) => {
    p.a = 0; p.h = 0; p.r = .9;
    for (let li = 0; li < layers.length; li++) {
      const [cf, f] = layers[li]; cf(u + li * .37, v + li * .21, f, CO);
      const ang = CO.id * TAU, ca = Math.cos(ang), sa = Math.sin(ang), lx = CO.dx * ca + CO.dy * sa, ly = -CO.dx * sa + CO.dy * ca;
      const e = needles ? (lx * lx) / .3 + (ly * ly) / .012 : (lx * lx) / .21 + (ly * ly) / .058;
      if (e < 1) {
        const vein = needles ? 0 : smoothstep(.035, 0, Math.abs(ly)) * .15;
        p.c = mulc(mixc(dark, light, ihash(li, Math.floor(CO.id * 997), 5)), .72 + CO.id * .4 + (1 - e) * .18 - vein);
        p.a = 1; p.h = .3 + (1 - e) * .45 + li * .15;
      }
    }
  });
}
defTile('LEAVES', { rough: .7, cutout: true, bump: 2.5 }, L => leafField(L, rgb('#3a6a22'), rgb('#7aae44'), false));
defTile('BIRCH_LEAVES', { rough: .7, cutout: true, bump: 2.5 }, L => leafField(L, rgb('#4f7d2a'), rgb('#9cc255'), false));
defTile('SPRUCE_LEAVES', { rough: .7, cutout: true, bump: 2 }, L => leafField(L, rgb('#24452b'), rgb('#4d7d52'), true));

// ---------- fluids and glass ----------
defTile('WATER', { rough: .04, transparent: true, spec: 1, bump: 1.2 }, L => each(L, (u, v, p) => {
  p.h = .5 + tfbm(nz[1], u, v, 4, 4) * .5 + tfbm(nz[2], u, v, 9, 3) * .25;
  p.c = mixc(rgb('#0f3a4f'), rgb('#2f6f80'), clamp(.5 + tfbm(nz[3], u, v, 2, 3), 0, 1)); p.a = .78; p.r = 1;
}));
defTile('LAVA', { rough: .5, emissive: 1.4, bump: 3 }, L => each(L, (u, v, p) => {
  const w = tfbm(nz[1], u, v, 2, 3) * .15; cells[0](u + w, v - w, 4, CO);
  const cr = smoothstep(-.05, .25, tfbm(nz[2], u, v, 3, 4)) * smoothstep(.02, .12, CO.f2 - CO.f1);
  const hot = mixc(rgb('#ff5a10'), rgb('#ffd66a'), clamp(.5 + tfbm(nz[3], u, v, 6, 3) * 1.2, 0, 1));
  p.c = mixc(hot, rgb('#2b1a14'), cr); p.e = mulc(hot, 1 - cr); p.h = cr * .7 + tfbm(nz[4], u, v, 8, 2) * .1; p.r = .6 + cr * .4;
}));
defTile('GLASS', { rough: .05, transparent: true, spec: 1, uv: 'none', bump: 2, tint: .3 }, L => each(L, (u, v, p) => {
  const fx = Math.min(u, 1 - u, v, 1 - v), frame = fx < .045;
  p.c = frame ? rgb('#c7d3cf') : mixc(rgb('#e3f1f2'), rgb('#cfe6ea'), clamp(.5 + tfbm(nz[1], u, v, 2, 3), 0, 1));
  p.a = frame ? .95 : .14 + smoothstep(.2, .6, tfbm(nz[2], u, v, 2, 3, 8)) * .06;
  p.h = frame ? .8 - fx * 4 : .5 + tfbm(nz[3], u, v, 3, 3) * .04; p.r = 1;
}));

// ---------- masonry, bricks and metal ----------
// running-bond layout: rows of n(r) blocks shifted by off(r); writes row, block id and the pixel distance to the nearest joint
const MS = {};
function masonry(u, v, rows, n, off) {
  const r = Math.floor(v * rows), lv = v * rows - r, cnt = n(r), bx = u * cnt + off(r), bi = Math.floor(bx), fu = bx - bi;
  MS.row = r; MS.id = ((bi % cnt) + cnt) % cnt; MS.d = Math.min(Math.min(fu, 1 - fu) / cnt, Math.min(lv, 1 - lv) / rows) * TEX;
  return MS;
}
const mortar = (p, u, v, base) => { p.c = mulc(rgb(base), .8 + tfbm(nz[2], u, v, 24, 2) * .3 + tfbm(nz[3], u, v, 48, 1) * .15); p.h = .08 + tfbm(nz[2], u, v, 24, 2) * .04; p.r = 1; };
defTile('BRICK', { rough: .9, uv: 'flipxy', bump: 4 }, L => each(L, (u, v, p) => {
  const m = masonry(u, v, 4, () => 2, r => r % 2 * .5), d = m.d + tfbm(nz[8], u, v, 12, 2) * 2.2;
  if (d < 2.2) return mortar(p, u, v, '#948b80');
  const fine = tfbm(nz[2], u, v, 24, 3), hb = ihash(m.id, m.row, 41);
  cells[5](u, v, 20, CO); const pit = CO.id < .3 ? smoothstep(.16, .05, CO.f1) : 0, bev = smoothstep(2.2, 5, d);
  const base = hb < .2 ? mixc(rgb('#4f2219'), rgb('#6e2f22'), hb * 5) : mixc(rgb('#8a3a27'), rgb('#b35f43'), ihash(m.id, m.row, 43));
  p.c = mulc(base, (.82 + fine * .28 + tfbm(nz[4], u, v, 6, 2) * .15) * (1 - pit * .3) * (.85 + bev * .15));
  p.h = .35 + bev * .4 + fine * .1 - pit * .15; p.r = .95 + fine * .1;
}));
defTile('STONEBRICK', { rough: .9, uv: 'flipxy', bump: 4 }, L => {
  Object.assign(L, copyLayers(stoneBase()));
  each(L, (u, v, p) => {
    const m = masonry(u, v, 2, r => r ? 2 : 1, r => r ? .25 : .5), d = m.d + tfbm(nz[8], u, v, 10, 2) * 1.6;
    if (d < 2) return mortar(p, u, v, '#47453f');
    const bev = smoothstep(2, 7, d);
    p.c = mulc(p.c, (.9 + ihash(m.id, m.row, 51) * .18) * (.78 + bev * .22)); p.h = p.h * .4 + .3 + bev * .35;
    if (m.row === 1 && m.id === 0 && Math.abs(v - .73 - tfbm(nz[9], u, v, 3, 3) * .12) < .006) { p.c = mulc(p.c, .45); p.h -= .25; } // hairline crack
  });
});
function furnaceMasonry(u, v, p) {
  const m = masonry(u, v, 3, r => r % 2 ? 3 : 2, r => r % 2 ? .17 : .5), d = m.d + tfbm(nz[8], u, v, 10, 2) * 1.4;
  if (d < 2) return mortar(p, u, v, '#3a3833');
  const bev = smoothstep(2, 6, d);
  p.c = mulc(p.c, (.86 + ihash(m.id, m.row, 81) * .2) * (.8 + bev * .2)); p.h = p.h * .4 + .3 + bev * .3;
}
const soot = (p, u, v, k) => { p.c = mulc(p.c, 1 - k * (.6 + tfbm(nz[6], u, v, 4, 3) * .8)); };
defTile('FURNACE_SIDE', { rough: .9, uv: 'flip', bump: 4 }, L => { Object.assign(L, copyLayers(stoneBase())); each(L, (u, v, p) => { furnaceMasonry(u, v, p); soot(p, u, v, smoothstep(.55, 1, v) * .35); }); });
defTile('FURNACE_TOP', { rough: .9, metal: .8, bump: 4 }, L => {
  Object.assign(L, copyLayers(stoneBase()));
  each(L, (u, v, p) => {
    const bev = smoothstep(2, 10, Math.min(u, 1 - u, v, 1 - v) * TEX), r = Math.hypot(u - .5, v - .5);
    p.c = mulc(p.c, .8 + bev * .2); p.h = p.h * .4 + .3 + bev * .3; soot(p, u, v, smoothstep(.38, .2, r) * .45);
    if (r >= .2) return;
    if (r > .17 || Math.abs(((u * 10) % 1) - .5) < .17) { p.c = mulc(rgb('#3c3a38'), .8 + tfbm(nz[2], u, v, 24, 2) * .4); p.h = .75; p.m = 1; p.r = .65; } // round iron grate over the flue
    else { p.c = rgb('#0c0a09'); p.h = 0; }
  });
});
defTile('FURNACE_FRONT', { rough: .9, uv: 'none', metal: .8, emissive: 1.2, bump: 4, wrap: false }, L => {
  Object.assign(L, copyLayers(stoneBase()));
  each(L, (u, v, p) => {
    furnaceMasonry(u, v, p); soot(p, u, v, smoothstep(.5, .75, v) * smoothstep(.4, .2, Math.abs(u - .5)) * .4);
    // arched fire mouth: signed distance, positive inside
    const ax = Math.abs(u - .5), sd = v <= .5 ? Math.min(.26 - ax, v - .1) : Math.min(.26 - Math.hypot(ax, v - .5), v - .1);
    if (sd < -.035) return;
    if (sd < 0) { p.c = mulc(rgb('#45423f'), .75 + tfbm(nz[2], u, v, 24, 2) * .4); p.h = .9 + sd * 4; p.m = 1; p.r = .7; return; } // iron frame
    cells[3](u, v, 14, CO);
    const coal = v < .24 ? smoothstep(.45, .15, CO.f1) * smoothstep(.26, .14, v) : 0, heat = coal * (.5 + .5 * CO.id) * (1 - smoothstep(0, .06, CO.f2 - CO.f1) * .5);
    p.c = mixc(mulc(rgb('#140d09'), 1 + smoothstep(.4, .1, v) * .8), mixc(rgb('#3a1608'), rgb('#ff9a3a'), heat), coal);
    p.e = mulc(mixc(rgb('#ff4a10'), rgb('#ffc060'), heat), heat * .9 + smoothstep(.35, .1, v) * .06);
    p.h = coal * .3; p.r = 1;
  });
});
defTile('IRON_BLOCK', { rough: .4, metal: 1, uv: 'flipxy', spec: 1, bump: 3, tint: .4 }, L => each(L, (u, v, p) => {
  const m = masonry(u, v, 2, () => 2, () => 0), bev = smoothstep(1, 6, m.d), brush = tfbm(nz[2], u, v, 2, 3, 96), blot = tfbm(nz[1], u, v, 3, 3);
  p.c = mulc(mixc(rgb('#8e9296'), rgb('#cfd2d6'), clamp(.6 + brush * .6 + blot * .3, 0, 1)), .7 + bev * .3);
  p.h = .3 + bev * .5 + brush * .02; p.r = .7 + brush * .25 + smoothstep(.1, .4, blot) * .5; p.m = 1;
  const rx = (u * 2) % 1, ry = (v * 2) % 1, rd = Math.hypot(Math.min(rx, 1 - rx) - .1, Math.min(ry, 1 - ry) - .1) * 64;
  if (rd < 3.2) { p.h = .8 + (1 - rd / 3.2) * .25; p.c = mulc(rgb('#b8bcc0'), .8 + (1 - rd / 3.2) * .3); p.r = .5; } // rivets
}));
defTile('GOLD_BLOCK', { rough: .3, metal: 1, spec: 1, bump: 3, tint: .4 }, L => each(L, (u, v, p) => {
  const bev = smoothstep(1, 8, Math.min(u, 1 - u, v, 1 - v) * TEX); cells[3](u, v, 9, CO);
  const dimple = smoothstep(0, .6, CO.f1), mott = tfbm(nz[1], u, v, 3, 3);
  p.c = mulc(mixc(rgb('#c08a26'), rgb('#f4d27a'), clamp(.6 + dimple * .2 + CO.id * .1 + mott * .2, 0, 1)), .78 + bev * .22);
  p.h = .3 + bev * .4 + dimple * .25; p.r = .7 + (1 - dimple) * .3 + smoothstep(0, .4, mott) * .4; p.m = 1; // hammered dimples
}));
defTile('DIAMOND_BLOCK', { rough: .12, spec: 1, bump: 5, tint: .4 }, L => each(L, (u, v, p) => {
  const bev = smoothstep(1, 8, Math.min(u, 1 - u, v, 1 - v) * TEX); cells[0](u, v, 5, CO);
  const ang = CO.id * TAU, facet = clamp(.5 + (Math.cos(ang) * CO.dx + Math.sin(ang) * CO.dy) * .9, 0, 1), edge = 1 - smoothstep(0, .05, CO.f2 - CO.f1);
  p.c = mulc(mixc(rgb('#2f9ea6'), rgb('#bff6f4'), clamp(facet * .7 + .2, 0, 1)), (.75 + bev * .25) * (1 + edge * .35));
  p.h = .4 + bev * .3 + facet * .25; p.r = 1 + edge * 2; // facets tilt like cut gems; the edges between them are frosted
}));

// ---------- cloth ----------
function woolField(L, base) {
  const b = rgb(base);
  each(L, (u, v, p) => {
    const cu = (u * 16) % 1, rib = Math.sin(cu * Math.PI), chev = .5 + .5 * Math.sin((v * 20 + Math.abs(cu - .5) * 1.3) * TAU);
    const fiber = tridged(nz[2], u, v, 48, 2, 12), fuzz = tfbm(nz[3], u, v, 32, 2), mott = tfbm(nz[1], u, v, 3, 3), s = rib * (.55 + chev * .45);
    p.c = mulc(b, .72 + s * .3 + fiber * .08 + fuzz * .08 + mott * .1); p.h = s * .55 + fiber * .2 + fuzz * .08; p.r = 1;
  });
}
for (const [k, c] of [['WOOL', '#a2302a'], ['WOOL_WHITE', '#e4e0d6'], ['WOOL_YELLOW', '#dcb23a'], ['WOOL_BLUE', '#2e4c9e'], ['WOOL_GREEN', '#4c7428'], ['WOOL_BLACK', '#2a292d']])
  defTile(k, { rough: 1, uv: 'flipxy', bump: 2.5 }, L => woolField(L, c));

// ---------- furniture ----------
const IRON = rgb('#55585c'), BRASS = rgb('#a98a3e');
const metalAt = (p, u, v, c, h = .85) => { p.c = mulc(c, .75 + tfbm(nz[2], u, v, 24, 2) * .35); p.h = h; p.m = 1; p.r = .6; };
const rivet = (p, u, v, pts, c) => { for (const [x, y] of pts) { const d = Math.hypot(u - x, v - y) * TEX; if (d < 3) { metalAt(p, u, v, mulc(c, 1.1 + (1 - d / 3) * .3), .9 + (1 - d / 3) * .1); return; } } };
defTile('BOOK', { rough: .8, uv: 'flip', metal: .5, bump: 3 }, L => {
  Object.assign(L, copyLayers(oakPlanks()));
  const COLS = ['#6e1f1c', '#28452b', '#22355e', '#5b3a1f', '#8a6a2a', '#3b2a4a', '#7a4a22'].map(rgb), SH = [[.12, .44], [.56, .88]], books = [];
  for (let s = 0; s < 2; s++) for (let x = 2, n = 0; x < 126; n++) {
    const w = 7 + Math.floor(ihash(s, n, 61) * 8);
    books.push({ s, x0: x, x1: Math.min(126, x + w), top: .72 + ihash(s, n, 62) * .26, col: COLS[Math.floor(ihash(s, n, 63) * COLS.length)] });
    x += w + (ihash(s, n, 64) < .15 ? 6 : 1);
  }
  each(L, (u, v, p) => {
    const sh = SH.findIndex(([a, b]) => v >= a && v < b);
    if (sh < 0) { if (SH.some(([a]) => v < a && v > a - .03)) p.c = mulc(p.c, .7); return; } // frame boards
    const [v0, v1] = SH[sh], lv = (v - v0) / (v1 - v0), px = u * TEX, bk = books.find(b => b.s === sh && px >= b.x0 && px < b.x1), shade = 1 - smoothstep(.75, 1, lv) * .35;
    if (!bk || lv > bk.top) { p.c = mulc(rgb('#1c130c'), (.8 + lv * .4) * shade); p.h = 0; p.r = 1; return; } // back of the shelf
    const t = (px - bk.x0) / (bk.x1 - bk.x0), round = Math.sin(t * Math.PI), band = Math.abs(lv - .15) < .03 || Math.abs(lv - bk.top + .12) < .03;
    p.c = mulc(band ? mixc(bk.col, rgb('#c9a24a'), .6) : bk.col, (.6 + round * .45) * (.9 + tfbm(nz[2], u, v, 32, 2) * .2) * shade);
    p.h = .3 + round * .3 + (band ? .05 : 0); p.r = band ? .6 : 1; p.m = band ? 1 : 0; // gilt bands on the spines
  });
});
// chest: oak boards with an iron edge frame, rivets and a brass lock
const CHEST_RIVETS = [[.035, .035], [.5, .035], [.965, .035], [.035, .5], [.965, .5], [.035, .965], [.5, .965], [.965, .965]];
function chestFace(L, top, lock) {
  Object.assign(L, copyLayers(oakPlanks()));
  each(L, (u, v, p) => {
    if (!top && Math.abs(v - .66) < .012) { p.c = mulc(p.c, .35); p.h = 0; } // lid seam
    if (u < .07 || u > .93 || v < .07 || v > .93 || (top && Math.abs(u - .5) < .035)) metalAt(p, u, v, IRON);
    rivet(p, u, v, CHEST_RIVETS, IRON);
    if (!lock) return;
    if (Math.abs(u - .5) < .08 && v > .5 && v < .72) {
      const kd = Math.hypot(u - .5, v - .64);
      if (kd < .022 || (Math.abs(u - .5) < .008 && v > .57 && v < .64)) { p.c = rgb('#0d0a08'); p.h = .4; p.m = 0; } else metalAt(p, u, v, BRASS, .95);
    }
  });
}
defTile('CHEST_SIDE', { rough: .8, uv: 'flip', metal: .8, bump: 3, wrap: false }, L => chestFace(L, false, false));
defTile('CHEST_TOP', { rough: .8, uv: 'flip', metal: .8, bump: 3, wrap: false }, L => chestFace(L, true, false));
defTile('CHEST_FRONT', { rough: .8, uv: 'none', metal: .8, bump: 3, wrap: false }, L => chestFace(L, false, true));
// workbench: butcher-block top with iron corner plates; framed sides, a drawer on the front
defTile('TABLE_TOP', { rough: .8, metal: .8, bump: 3, wrap: false }, L => each(L, (u, v, p) => {
  const gx = u * 4, gy = v * 4, cx = Math.floor(gx), cy = Math.floor(gy), fx = gx - cx, fy = gy - cy, id = ihash(cx, cy, 91);
  const rr = Math.hypot(fx - (ihash(cx, cy, 92) * 2 - .5), fy - (ihash(cx, cy, 93) * 2 - .5)) + tfbm(nz[2], u, v, 8, 2) * .05;
  const rings = .5 + .5 * Math.sin(rr * TAU * 7), joint = Math.min(fx, 1 - fx, fy, 1 - fy) * 32;
  const scratch = smoothstep(.9, .98, tridged(nz[5], u, v, 3, 2, 40)) * smoothstep(.1, .3, tfbm(nz[6], u, v, 2, 2));
  p.c = mulc(mixc(rgb('#8a5d33'), rgb('#c79a62'), clamp(id * .7 + rings * .3, 0, 1)), (.82 + rings * .12) * (joint < 1 ? .55 : 1) * (1 - scratch * .2));
  p.h = .5 + rings * .04 - (joint < 1 ? .3 : 0) - scratch * .12; p.r = 1;
  const cu = Math.min(u, 1 - u), cv = Math.min(v, 1 - v);
  if (cu < .16 && cv < .16 && (cu < .055 || cv < .055)) metalAt(p, u, v, IRON);
  rivet(p, u, v, [[.03, .1], [.1, .03], [.97, .1], [.9, .03], [.03, .9], [.1, .97], [.97, .9], [.9, .97]], IRON);
}));
function tableFace(L, front) {
  Object.assign(L, copyLayers(oakPlanks()));
  each(L, (u, v, p) => {
    const leg = u < .12 || u > .88, apron = v > .8, low = v > .06 && v < .18;
    if (leg || apron || low) {
      const g = leg ? tfbm(nz[1], u, v, 24, 3, 2) : tfbm(nz[1], u, v, 2, 3, 24), e = (leg ? Math.min(Math.abs(u - .12), Math.abs(u - .88)) : Math.min(Math.abs(v - .8), Math.abs(v - .18), Math.abs(v - .06))) * TEX;
      p.c = mulc(mixc(rgb('#5a3b20'), rgb('#8a6038'), clamp(.5 + g * 1.2, 0, 1)), .8 + smoothstep(0, 3, e) * .2); p.h = .7 + smoothstep(0, 3, e) * .2; p.r = 1;
      return;
    }
    // recessed panel, shadowed under the apron and beside the legs
    p.c = mulc(p.c, .72 * (1 - smoothstep(.72, .8, v) * .35) * (1 - smoothstep(.2, .12, Math.min(u, 1 - u)) * .3)); p.h = .2 + p.h * .3;
    const pu = (u - .12) / .76, pv = (v - .18) / .62;
    if (!front) { if (Math.abs(pu - pv) < .07 || Math.abs(pu - (1 - pv)) < .07) { p.c = mulc(p.c, 1.25); p.h = .55; } return; } // cross brace
    if (u > .18 && u < .82 && v > .47 && v < .75) { // drawer
      const e = Math.min(u - .18, .82 - u, v - .47, .75 - v) * TEX;
      p.c = mulc(p.c, 1.3 * (.85 + smoothstep(0, 3, e) * .15)); p.h = .45 + smoothstep(0, 3, e) * .1;
      if (Math.abs(u - .5) < .09 && Math.abs(v - .61) < .018) metalAt(p, u, v, IRON, .8);
      return;
    }
    if (v < .43 && v > .2) { // open shelf with a hammer
      p.c = mulc(rgb('#24180e'), .8 + (v - .2) * 1.5); p.h = .05;
      if (u > .3 && u < .6 && Math.abs(v - .28) < .018) { p.c = rgb('#7a5a36'); p.h = .3; }
      if (u > .6 && u < .67 && v > .23 && v < .34) metalAt(p, u, v, IRON, .35);
    }
  });
}
defTile('TABLE_SIDE', { rough: .8, uv: 'flip', bump: 3, wrap: false }, L => tableFace(L, false));
defTile('TABLE_FRONT', { rough: .8, uv: 'none', metal: .8, bump: 3, wrap: false }, L => tableFace(L, true));

// ---------- explosives ----------
const TNT_RED = [rgb('#9a2c1b'), rgb('#cf5a32')];
defTile('TNT_SIDE', { rough: .9, uv: 'flip', bump: 3, wrap: false }, L => each(L, (u, v, p) => {
  const s = (u * 4) % 1, cyl = Math.sin(s * Math.PI), wr = tfbm(nz[3], u, v, 6, 3, 10), band = Math.abs(v - .5) < .13;
  if (band) { // hazard tape around the bundle
    const stripe = ((u * 8 + v * 8) % 1) < .5, n = tfbm(nz[2], u, v, 32, 2);
    p.c = mulc(rgb(stripe ? '#e2b52c' : '#1e1c1a'), (.85 + n * .25) * (Math.abs(Math.abs(v - .5) - .13) < .012 ? .7 : 1)); p.h = .8 + n * .05; p.r = stripe ? .7 : .8; return;
  }
  p.c = mulc(mixc(TNT_RED[0], TNT_RED[1], clamp(.5 + wr + ihash(Math.floor(u * 4), 0, 71) * .3 - .15, 0, 1)), .55 + cyl * .5);
  p.h = cyl * .55 + wr * .1; p.r = 1;
  if (Math.abs(v - .12) < .02 || Math.abs(v - .88) < .02) { p.c = mulc(rgb('#a58c62'), .7 + cyl * .4 + tridged(nz[5], u, v, 32, 2, 4) * .2); p.h += .1; } // twine
}));
function tntEnds(L, fuse) {
  each(L, (u, v, p) => {
    const gx = u * 4, gy = v * 4, cx = Math.floor(gx), cy = Math.floor(gy), dx = gx - cx - .5, dy = gy - cy - .5, r = Math.hypot(dx, dy) + tfbm(nz[2], u, v, 16, 2) * .03;
    if (r > .47) { p.c = rgb('#1e1410'); p.h = 0; p.r = 1; return; }
    const g = tfbm(nz[3], u, v, 40, 2);
    p.c = r > .37 ? mulc(TNT_RED[0], .8 + (.47 - r) * 3) : mulc(mixc(rgb('#a99069'), rgb('#d5c095'), clamp(.5 + g * 1.2, 0, 1)), fuse ? 1 : .8);
    p.h = r > .37 ? .7 : .55 + g * .1; p.r = 1;
    if (fuse && r < .09 && (cx + cy) % 2 === 0) { p.c = mulc(rgb('#2b2622'), .8 + Math.sin(Math.atan2(dy, dx) * 3 + r * 80) * .2); p.h = .95; }
  });
}
defTile('TNT_TOP', { rough: .9, bump: 3 }, L => tntEnds(L, true));
defTile('TNT_BOT', { rough: .9, bump: 3 }, L => tntEnds(L, false));

// ---------- produce ----------
const CACT = [rgb('#1f4a22'), rgb('#4f8a3a')], SPINE = rgb('#e8e2c8'), FELT = rgb('#c9b98a');
function areole(p, dx, dy) { // dx, dy in pixels from the areole centre
  const d = Math.hypot(dx, dy);
  if (d < 2.4) { p.c = mulc(FELT, .8 + (1 - d / 2.4) * .3); p.h += .2; return; }
  for (const a of [-2.2, -.9, .9, 2.2, Math.PI / 2]) { const ca = Math.cos(a), sa = Math.sin(a), al = dx * ca + dy * sa, pe = Math.abs(-dx * sa + dy * ca); if (al > 2 && al < 7 && pe < .5) { p.c = SPINE; p.h += .3; p.r = .6; return; } }
}
defTile('CACTUS_SIDE', { rough: .7, uv: 'flip', bump: 4 }, L => each(L, (u, v, p) => {
  const s = (u * 6) % 1, rib = Math.pow(Math.sin(s * Math.PI), .7), streak = tfbm(nz[3], u, v, 6, 3, 24);
  p.c = mixc(CACT[0], CACT[1], clamp(rib * .8 + streak * .4, 0, 1)); p.h = rib * .6 + streak * .05; p.r = 1 - rib * .25;
  areole(p, (s - .5) * TEX / 6, (((v * 8 + Math.floor(u * 6) % 2 * .5) % 1) - .5) * 16);
}));
defTile('CACTUS_TOP', { rough: .7, bump: 4, wrap: false }, L => each(L, (u, v, p) => {
  const dx = u - .5, dy = v - .5, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx), rib = Math.pow(.5 + .5 * Math.cos(a * 6), .8) * smoothstep(.02, .2, r);
  p.c = mixc(CACT[0], CACT[1], clamp(rib * .8 + .15 + r * .3 + tfbm(nz[3], u, v, 8, 3) * .3, 0, 1)); p.h = rib * .5 + r * .2; p.r = 1 - rib * .25;
  const ra = Math.round(a / (TAU / 6)) * (TAU / 6), rd = Math.round(r * 8) / 8; // areoles on the rib crests
  if (rd > .05) areole(p, (dx - Math.cos(ra) * rd) * TEX, (dy - Math.sin(ra) * rd) * TEX);
}));
const PK = [rgb('#a5480f'), rgb('#e88a2a')];
function pumpkinSide(u, v, p) {
  const s = (u * 4) % 1, lobe = Math.pow(Math.sin(s * Math.PI), .6), str = tfbm(nz[3], u, v, 8, 3, 32);
  cells[5](u, v, 24, CO); const fleck = CO.id < .15 ? smoothstep(.15, .05, CO.f1) : 0;
  p.c = mulc(mixc(PK[0], PK[1], clamp(lobe * .9 + str * .4, 0, 1)), (.85 + tfbm(nz[1], u, v, 3, 3) * .2) * (1 + fleck * .15));
  p.h = lobe * .6 + str * .06; p.r = 1 - lobe * .3;
}
defTile('PUMPKIN_SIDE', { rough: .6, uv: 'flip', bump: 4 }, L => each(L, pumpkinSide));
defTile('PUMPKIN_TOP', { rough: .6, bump: 4, wrap: false }, L => each(L, (u, v, p) => {
  const dx = u - .5, dy = v - .5, r = Math.hypot(dx, dy), lobe = Math.pow(.5 + .5 * Math.cos(Math.atan2(dy, dx) * 8 + tfbm(nz[2], u, v, 3, 2) * .6), .6);
  p.c = mulc(mixc(PK[0], PK[1], clamp(lobe * .8 + .2 + tfbm(nz[3], u, v, 8, 3) * .3, 0, 1)), .8 + smoothstep(.05, .5, r) * .25);
  p.h = lobe * .4 * smoothstep(.06, .3, r) + (1 - smoothstep(0, .5, r)) * .3; p.r = 1 - lobe * .3;
  if (r < .07 + tfbm(nz[4], u, v, 6, 2) * .02) { p.c = mulc(rgb('#5c5a2c'), .7 + tridged(nz[5], u, v, 24, 2) * .5); p.h = .95; p.r = 1.3; } // stem
}));
// carved face: crescent eyes, a small diamond nose and a zig-zag grin
const carveMask = memo(() => drawMask(x => {
  x.fillStyle = '#fff';
  for (const ex of [38, 90]) { x.globalCompositeOperation = 'source-over'; x.beginPath(); x.arc(ex, 52, 16, 0, TAU); x.fill(); x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.arc(ex, 61, 16, 0, TAU); x.fill(); }
  x.globalCompositeOperation = 'source-over';
  x.beginPath(); x.moveTo(64, 62); x.lineTo(70, 71); x.lineTo(64, 80); x.lineTo(58, 71); x.closePath(); x.fill();
  x.beginPath(); x.moveTo(20, 84); x.quadraticCurveTo(64, 126, 108, 84);
  for (let i = 0; i <= 8; i++) x.lineTo(108 - i * 11, i % 2 ? 98 : 88);
  x.closePath(); x.fill();
}));
function carvedFace(L, lit) {
  const m = carveMask(), rim = blurField(m, 3, false);
  each(L, (u, v, p, k) => {
    pumpkinSide(u, v, p);
    const inner = m[k] > .5;
    if (!inner && rim[k] > .08) { p.c = mulc(p.c, 1 - rim[k] * .5); p.h -= rim[k] * .3; } // carved edges are pressed in
    if (!inner) return;
    const depth = clamp((rim[k] - .5) * 2, 0, 1), flesh = mixc(rgb('#e9b05a'), rgb('#c9862e'), depth);
    if (lit) { p.c = mixc(flesh, rgb('#ffd27a'), depth); p.e = mulc(mixc(rgb('#ff9a30'), rgb('#ffe1a0'), depth), .35 + depth * .65); }
    else p.c = mixc(flesh, rgb('#1a0c04'), smoothstep(.1, .5, depth));
    p.h = .1 - depth * .1; p.r = 1;
  });
}
defTile('PUMPKIN_FACE', { rough: .6, uv: 'none', bump: 4, wrap: false }, L => carvedFace(L, false));
defTile('JACK_FACE', { rough: .6, uv: 'none', emissive: 1.6, bump: 4, wrap: false }, L => carvedFace(L, true));
const ML = [rgb('#24481a'), rgb('#86a94c')];
defTile('MELON_SIDE', { rough: .5, uv: 'flip', bump: 2 }, L => each(L, (u, v, p) => {
  const st = .5 + .5 * Math.sin((u * 5 + tfbm(nz[2], u, v, 2, 3, 3) * .5) * TAU), stripe = smoothstep(.25, .75, st + tfbm(nz[3], u, v, 16, 2, 6) * .5), n = tfbm(nz[4], u, v, 32, 2);
  p.c = mulc(mixc(ML[0], ML[1], stripe * .8), .85 + n * .2); p.h = .5 + stripe * .08 + n * .05; p.r = 1 + n * .3;
}));
defTile('MELON_TOP', { rough: .5, bump: 2, wrap: false }, L => each(L, (u, v, p) => {
  const dx = u - .5, dy = v - .5, r = Math.hypot(dx, dy), st = .5 + .5 * Math.sin(Math.atan2(dy, dx) * 5 + tfbm(nz[2], u, v, 3, 3) * 3), n = tfbm(nz[4], u, v, 32, 2);
  p.c = mulc(mixc(ML[0], ML[1], smoothstep(.25, .75, st) * .8 * smoothstep(.04, .15, r)), .85 + n * .2); p.h = .5 + n * .05; p.r = 1 + n * .3;
  if (r < .05) { p.c = mulc(rgb('#6b6a3a'), .8 + n * .4); p.h = .6; } // stem scar
}));

// ---------- climbable and plants (alpha cut-outs) ----------
defTile('LADDER', { rough: .8, uv: 'none', cutout: true, metal: .6, bump: 3 }, L => each(L, (u, v, p) => {
  const rail = (u > .08 && u < .22) || (u > .78 && u < .92), ry = (v * 4) % 1, rung = Math.abs(ry - .5) < .065 && u > .1 && u < .9;
  if (!rail && !rung) { p.a = 0; p.h = 0; return; }
  const g = rail ? tfbm(nz[1], u, v, 24, 3, 2) : tfbm(nz[1], u, v, 2, 3, 24), round = rail ? Math.sin(((u < .5 ? u - .08 : u - .78) / .14) * Math.PI) : Math.sin(((ry - .435) / .13) * Math.PI);
  p.c = mulc(mixc(rgb('#5f4128'), rgb('#9a7148'), clamp(.5 + g * 1.2, 0, 1)), .65 + round * .4); p.h = round * .6; p.r = 1;
  if (rail && Math.abs(ry - .5) < .03 && Math.abs((u < .5 ? u - .15 : u - .85)) < .02) metalAt(p, u, v, IRON, .9); // nail heads
}));
defTile('TORCH', { rough: .8, uv: 'none', cutout: true, emissive: 2, bump: 2, wrap: false }, L => each(L, (u, v, p) => {
  p.a = 0;
  const fu = (u - 7 / 16) / (2 / 16);
  if (fu >= 0 && fu < 1 && v < 10 / 16) {
    p.a = 1;
    if (v < 8 / 16) { // the 3D torch uses this 2x10 strip: a wooden handle charred near the top
      p.c = mulc(mixc(rgb('#4a3020'), rgb('#8a6038'), clamp(.5 + tfbm(nz[1], u, v, 4, 3, 24) * 1.2, 0, 1)), (.7 + Math.sin(fu * Math.PI) * .35) * (1 - smoothstep(6 / 16, 8 / 16, v) * .6));
      p.h = Math.sin(fu * Math.PI) * .5;
    } else { // glowing head
      const t = tfbm(nz[3], u, v, 16, 2); p.c = mixc(rgb('#ff8a2a'), rgb('#fff0b0'), clamp(.5 + t, 0, 1)); p.e = p.c; p.h = .6;
    }
    return;
  }
  const fy = (v - 10 / 16) / (4 / 16), w = .085 * Math.sin(Math.PI * Math.min(1, fy * .8 + .25)) * (1 - fy * .6); // flame tip, seen on the flat item
  if (fy >= 0 && fy < 1 && Math.abs(u - .5 - tfbm(nz[3], .5, v, 4, 2) * .02) < w) { p.a = 1; p.c = mixc(rgb('#ffe6a0'), rgb('#ff7a1a'), fy); p.e = p.c; }
}));
// plants are painted with the 2D canvas API (y runs down from the top), then mottled with noise
function paintLayers(L, seed, draw) {
  const c = canvasOf(), x = c.getContext('2d');
  draw(x, mulberry32(seed));
  const d = x.getImageData(0, 0, TEX, TEX).data;
  for (let j = 0; j < TEX; j++) for (let i = 0; i < TEX; i++) {
    const k = j * TEX + i, q = ((TEX - 1 - j) * TEX + i) * 4;
    L.c[k * 3] = d[q] / 255; L.c[k * 3 + 1] = d[q + 1] / 255; L.c[k * 3 + 2] = d[q + 2] / 255; L.a[k] = d[q + 3] / 255; L.h[k] = L.a[k] * .5;
  }
  each(L, (u, v, p) => { p.c = mulc(p.c, .86 + tfbm(nz[2], u, v, 16, 3) * .3); });
}
const css = c => `rgb(${c.map(v => Math.round(clamp(v, 0, 1) * 255)).join(',')})`;
function blade(x, bx, by, len, lean, w, c0, c1) {
  const tx = bx + lean * len, ty = by - len, cx = bx + lean * len * .25, cy = by - len * .65, g = x.createLinearGradient(bx, by, tx, ty);
  g.addColorStop(0, css(c0)); g.addColorStop(1, css(c1)); x.fillStyle = g;
  x.beginPath(); x.moveTo(bx - w, by); x.quadraticCurveTo(cx - w * .5, cy, tx, ty); x.quadraticCurveTo(cx + w * .5, cy, bx + w, by); x.closePath(); x.fill();
}
const stem = (x, pts, w, c) => { x.strokeStyle = c; x.lineWidth = w; x.lineCap = 'round'; x.beginPath(); x.moveTo(...pts[0]); x.quadraticCurveTo(...pts[1], ...pts[2]); x.stroke(); };
function leafShape(x, cx, cy, len, ang, w, c0, c1) {
  x.save(); x.translate(cx, cy); x.rotate(ang);
  const g = x.createLinearGradient(0, -w, 0, w); g.addColorStop(0, css(c1)); g.addColorStop(1, css(c0)); x.fillStyle = g;
  x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(len * .45, -w, len, 0); x.quadraticCurveTo(len * .45, w, 0, 0); x.fill();
  x.strokeStyle = 'rgba(20,40,10,.5)'; x.lineWidth = 1; x.beginPath(); x.moveTo(0, 0); x.lineTo(len * .9, 0); x.stroke(); x.restore();
}
const plant = { rough: .7, uv: 'flip', cutout: true, plant: true };
defTile('TALLGRASS', plant, L => paintLayers(L, 11, (x, r) => {
  for (let i = 0; i < 16; i++) {
    const t = r(), dry = r() < .2;
    blade(x, 16 + r() * 96, 130, 50 + r() * 70, (r() - .5) * .9, 3 + r() * 2.5, mixc(rgb('#24401a'), rgb('#3a5e22'), t), dry ? rgb('#a8a052') : mixc(rgb('#5e8c32'), rgb('#8cb850'), t));
  }
}));
defTile('ROSE', plant, L => paintLayers(L, 12, (x, r) => {
  stem(x, [[64, 128], [58, 90], [64, 50]], 4, '#2f5a22');
  leafShape(x, 61, 96, 30, -2.6, 8, rgb('#244a1a'), rgb('#4f8a34')); leafShape(x, 62, 80, 28, -.4, 7, rgb('#244a1a'), rgb('#4f8a34'));
  for (let i = 0; i < 4; i++) leafShape(x, 64, 50, 11, Math.PI / 2 + (i - 1.5) * .5, 3.5, rgb('#2a5020'), rgb('#4a7a30')); // sepals
  for (let ring = 0; ring < 3; ring++) for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + ring * .5, rad = 15 - ring * 4.5, px = 64 + Math.cos(a) * rad * .45, py = 38 + Math.sin(a) * rad * .32;
    const g = x.createRadialGradient(px, py, 1, px, py, rad * .8); g.addColorStop(0, css(mixc(rgb('#d42a3a'), rgb('#ff5a64'), ring / 2))); g.addColorStop(1, css(rgb('#6e0c18')));
    x.fillStyle = g; x.beginPath(); x.ellipse(px, py, rad * .62, rad * .5, a, 0, TAU); x.fill();
  }
  x.strokeStyle = '#5a0a14'; x.lineWidth = 1.5; x.beginPath(); for (let t = 0; t < 12; t += .2) x.lineTo(64 + Math.cos(t) * t * .45, 37 + Math.sin(t) * t * .35); x.stroke();
}));
defTile('DANDELION', plant, L => paintLayers(L, 13, (x, r) => {
  for (const [a, l] of [[-2.7, 34], [-.5, 30], [-2.2, 26], [-.9, 28]]) { // toothed rosette leaves
    x.save(); x.translate(64, 124); x.rotate(a); x.fillStyle = css(mixc(rgb('#2c5a1e'), rgb('#4f8a30'), r()));
    x.beginPath(); x.moveTo(0, 0); for (let s = 0; s <= 8; s++) x.lineTo(s / 8 * l, -(s % 2 ? 7 : 3) * (1 - s / 9)); for (let s = 8; s >= 0; s--) x.lineTo(s / 8 * l, (s % 2 ? 6 : 2) * (1 - s / 9)); x.fill(); x.restore();
  }
  stem(x, [[64, 124], [70, 80], [62, 46]], 3.5, '#4a7a2c');
  for (let i = 0; i < 70; i++) { const a = r() * TAU, len = 8 + r() * 9; x.strokeStyle = css(mixc(rgb('#e8a818'), rgb('#ffe066'), r())); x.lineWidth = 2; x.beginPath(); x.moveTo(62, 40); x.lineTo(62 + Math.cos(a) * len, 40 + Math.sin(a) * len * .8); x.stroke(); }
  x.fillStyle = '#c98a10'; x.beginPath(); x.arc(62, 40, 4, 0, TAU); x.fill();
}));
defTile('SUGARCANE', plant, L => paintLayers(L, 14, (x, r) => {
  for (const [cx, w, off] of [[30, 11, 6], [66, 13, 20], [100, 10, 0]]) {
    const g = x.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0); g.addColorStop(0, '#5f8a36'); g.addColorStop(.4, '#b9d77e'); g.addColorStop(1, '#4f7a2c');
    x.fillStyle = g; x.fillRect(cx - w / 2, 0, w, 128);
    for (let y = off; y < 128 + 32; y += 32) { x.fillStyle = 'rgba(70,90,30,.9)'; x.fillRect(cx - w / 2 - 1, (y % 128) - 2, w + 2, 3); }
    blade(x, cx + w / 2, 70 + off, 46, .55, 3, rgb('#5e8a36'), rgb('#a8c86a'));
  }
}));
function twig(x, px, py, a, len, w, depth, r) {
  const ex = px + Math.cos(a) * len, ey = py + Math.sin(a) * len;
  x.strokeStyle = css(mixc(rgb('#5a3c22'), rgb('#9a7a50'), r())); x.lineWidth = w; x.lineCap = 'round'; x.beginPath(); x.moveTo(px, py); x.lineTo(ex, ey); x.stroke();
  if (depth > 0) for (const s of [-1, 1]) twig(x, ex, ey, a + s * (.35 + r() * .45), len * (.6 + r() * .2), w * .7, depth - 1, r);
}
defTile('DEADBUSH', plant, L => paintLayers(L, 15, (x, r) => { for (const a of [-1.9, -1.55, -1.2]) twig(x, 64, 128, a, 30, 4, 4, r); }));
function mushroom(x, r, red) {
  const sg = x.createLinearGradient(56, 0, 72, 0); sg.addColorStop(0, '#b9ab90'); sg.addColorStop(.5, '#f0e6d2'); sg.addColorStop(1, '#a89a80');
  x.fillStyle = sg; x.fillRect(57, red ? 92 : 98, 14, 36);
  const cy = red ? 94 : 100, rx = red ? 30 : 36, ry = red ? 26 : 12, g = x.createRadialGradient(56, cy - ry * .6, 2, 64, cy, rx);
  g.addColorStop(0, red ? '#e0402e' : '#b08a5e'); g.addColorStop(1, red ? '#7a140c' : '#5e4228');
  x.fillStyle = g; x.beginPath(); x.ellipse(64, cy, rx, ry, 0, Math.PI, TAU); x.fill();
  x.fillStyle = red ? '#d8c0a8' : '#8a6a4a'; x.beginPath(); x.ellipse(64, cy, rx, 4, 0, 0, Math.PI); x.fill(); // gills underneath
  if (red) for (let i = 0; i < 7; i++) { const a = Math.PI + .3 + r() * (Math.PI - .6), d = .3 + r() * .55; x.fillStyle = '#f4efe4'; x.beginPath(); x.arc(64 + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, 2.5 + r() * 2.5, 0, TAU); x.fill(); }
}
defTile('MUSH_RED', Object.assign({}, plant, { rough: .5 }), L => paintLayers(L, 16, (x, r) => mushroom(x, r, true)));
defTile('MUSH_BROWN', Object.assign({}, plant, { rough: .8 }), L => paintLayers(L, 17, (x, r) => mushroom(x, r, false)));
defTile('SAPLING', plant, L => paintLayers(L, 18, (x, r) => {
  stem(x, [[64, 128], [60, 96], [63, 58]], 4, '#5a3c22');
  stem(x, [[62, 92], [52, 82], [44, 70]], 2.5, '#5a3c22'); stem(x, [[62, 80], [74, 70], [84, 62]], 2.5, '#5a3c22');
  for (const [cx, cy] of [[63, 56], [44, 68], [84, 60]]) for (let i = 0; i < 9; i++) leafShape(x, cx + (r() - .5) * 8, cy + (r() - .5) * 8, 12 + r() * 6, r() * TAU, 4, rgb('#2a5a1c'), rgb('#6aa240'));
}));
defTile('BREWING', Object.assign({}, plant, { rough: .5 }), L => paintLayers(L, 19, (x, r) => {
  const bg = x.createLinearGradient(0, 110, 0, 126); bg.addColorStop(0, '#8a8780'); bg.addColorStop(1, '#3e3c38');
  x.fillStyle = bg; x.beginPath(); x.ellipse(64, 118, 42, 8, 0, 0, TAU); x.fill();
  const rg = x.createLinearGradient(60, 0, 68, 0); rg.addColorStop(0, '#6e5420'); rg.addColorStop(.5, '#e8c46a'); rg.addColorStop(1, '#5e461a');
  x.fillStyle = rg; x.fillRect(61, 26, 6, 88); x.beginPath(); x.arc(64, 26, 5, 0, TAU); x.fill();
  x.strokeStyle = '#8a6a2a'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(64, 50); x.lineTo(34, 66); x.moveTo(64, 50); x.lineTo(94, 66); x.stroke();
  for (const bx of [34, 94]) { // glass flasks with a violet brew
    x.fillStyle = 'rgba(200,225,235,1)'; x.fillRect(bx - 3, 66, 6, 10); x.beginPath(); x.arc(bx, 88, 13, 0, TAU); x.fill();
    const lg = x.createRadialGradient(bx - 4, 92, 1, bx, 92, 12); lg.addColorStop(0, '#b47ae0'); lg.addColorStop(1, '#4a2280');
    x.fillStyle = lg; x.beginPath(); x.arc(bx, 88, 11, .1, Math.PI - .1); x.fill();
    x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.ellipse(bx - 5, 83, 2, 4, .4, 0, TAU); x.fill();
  }
}));

// ============================================================
//  Build every tile (yields between tiles so the page stays responsive and can show progress)
// ============================================================
const FLAT_BLOCKS = [B.TORCH, B.LADDER, B.TALLGRASS, B.ROSE, B.DANDELION, B.SUGARCANE, B.DEADBUSH, B.MUSH_RED, B.MUSH_BROWN, B.SAPLING, B.BREWING];
const yieldToBrowser = () => new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = r; ch.port2.postMessage(0); });
async function buildBlockTextures(progress) {
  const n = TILE_NAMES.length; let t0 = performance.now();
  for (let t = 0; t < n; t++) {
    const s = TILE_SPEC[t]; if (!s) throw new Error(`텍스처 정의가 없는 타일: ${TILE_NAMES[t]}`);
    const L = newLayers(s.emissive > 0); s.gen(L); if (!(s.emissive > 0)) L.e = null;
    const m = TILE_MAPS[t] = bakeLayers(L, s); tileAvg[t] = m.avg;
    if (performance.now() - t0 > 50) { if (progress) progress((t + 1) / n); await yieldToBrowser(); t0 = performance.now(); }
  }
  FLAT_BLOCKS.forEach(id => ITEM16[id] = TILE_MAPS[BLOCKS[id].tiles[0]].canvas); // these show as flat sprites in the hand and as drops
}

// ---------- inventory icons: flat art, or an isometric cube from the albedo tiles ----------
const ICON_URL = {}, SHADED = {};
function shadedTile(tile, dark) {
  const key = tile + ':' + dark; if (SHADED[key]) return SHADED[key];
  const c = canvasOf(), x = c.getContext('2d'); x.drawImage(TILE_MAPS[tile].canvas, 0, 0);
  x.globalCompositeOperation = 'source-atop'; x.fillStyle = `rgba(0,0,0,${dark})`; x.fillRect(0, 0, TEX, TEX);
  return SHADED[key] = c;
}
function iconURL(id) {
  if (ICON_URL[id]) return ICON_URL[id];
  const c = document.createElement('canvas'); c.width = c.height = 48; const x = c.getContext('2d');
  if (ITEM16[id]) { x.imageSmoothingEnabled = ITEM16[id].width > 16; x.drawImage(ITEM16[id], 0, 0, ITEM16[id].width, ITEM16[id].height, 0, 0, 48, 48); }
  else {
    const bd = BLOCKS[id], k = 16 / TEX, side = bd.face ? bd.tiles[3] : bd.tiles[1];
    if (bd.liquid) x.globalAlpha = .9;
    x.setTransform(20 / 16 * k, 10 / 16 * k, 0, 24 / 16 * k, 4, 14); x.drawImage(shadedTile(side, .2), 0, 0);
    x.setTransform(20 / 16 * k, -10 / 16 * k, 0, 24 / 16 * k, 24, 24); x.drawImage(shadedTile(bd.tiles[1], .42), 0, 0);
    x.setTransform(20 / 16 * k, -10 / 16 * k, 20 / 16 * k, 10 / 16 * k, 4, 14); x.drawImage(shadedTile(bd.tiles[0], 0), 0, 0);
  }
  return ICON_URL[id] = c.toDataURL();
}
