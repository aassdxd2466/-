'use strict';
// ============================================================
//  Rendering: renderer, physically based light, sky, day/night,
//  sun shadows, water, wind, clouds, fog, particles, held item,
//  post-processing and quality presets
// ============================================================
// Tunable look. Colours are written as sRGB hex; intensities are physical light units.
const LIGHTING = {
  exposure: 1.0,                                   // tone-mapping exposure (menu slider 0.5..1.5)
  sunNoon: 3.0, sunNoonColor: '#fff4e5', sunLowColor: '#ff9a5a',
  moon: 0.3, moonColor: '#9fb4ff',
  hemiSky: '#bfd8ff', hemiGround: '#5a4a3a', hemi: 0.6,
  hemiDuskSky: '#ffcf9e', hemiNightSky: '#26345a', hemiNightGround: '#121018', hemiNight: 0.14,
  envIntensity: 0.4, envInterval: 5,               // sky environment map strength and refresh period (s)
  skyBrightness: 0.22,                             // sky radiance scale so a sunlit white wall is brighter than blue sky, as outdoors
  terrainSpecular: 0.35,                           // sheen on rough blocks (water keeps full reflections)
  fogEdge: 0.5,                                    // FogExp2 amount at the render-distance edge (the density is derived from it)
  fogFadeStart: 0.8,                               // from this fraction of the render distance the terrain melts fully into the sky
  water: {
    color: '#2a6f8f', opacity: 0.75, roughness: 0.04,
    frontAlpha: 0.6,                               // opacity looking straight down = opacity x frontAlpha; it rises to 1 at grazing angles
    reflect: 1.0,                                  // sky reflection strength (environment map)
    absorb: [0.5, 0.17, 0.1],                      // light lost per block of water above a surface (red goes first), down and back up
    waveA: [0.35, 0.021, 0.013], waveB: [0.9, -0.017, 0.029], waveBAngle: 0.9, // per normal map: uv scale, scroll x, scroll y
  },
  underwater: { color: [0.012, 0.05, 0.14], density: 0.07, far: 48, wobble: 0.004 },
  wind: { amp: 0.04, speed: 1.7, wave: 0.35, dir: [0.8, 0.6] }, // grass and leaf sway: amplitude (blocks), phase speed, wave number
  clouds: {
    y: [120, 126], scale: [1 / 640, 1 / 980], speed: [[1.4, 0.3], [2.4, -0.6]], // two noise planes: height, texture scale, drift (blocks/s)
    cover: [0.5, 0.56], soft: [0.22, 0.3], alpha: [0.95, 0.65], fade: 900,   // coverage threshold, edge softness, opacity, fade-out distance
    sunset: '#ff9a62', dusk: '#e58aa6',            // evening tint of the lit side and of the shaded underside
  },
  shadowSize: 2048, shadowRange: 60,               // (the shadow map size follows the quality preset)
  shadowBias: -0.0005, shadowNormalBias: 0.02, shadowRadius: 3,
  sky: { turbidity: 8, rayleigh: 2.5, mieCoefficient: 0.005, mieDirectionalG: 0.8 },
  torch: [1.0, 0.62, 0.32], torchIntensity: 1.7,   // block light (torches, lava, glowstone) colour and strength
  caveAmbient: 0.02, cloudShadow: 0.55, stars: 3500,
  skyFalloff: 0.8,                                 // indirect sky light kept per sky-light level below 15 (roofs, caves)
};

const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.autoClear = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LIGHTING.exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
// r18x removed PCFSoftShadowMap; PCFShadowMap with shadow.radius is the soft-shadow path now
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.01); // density and colour are set every frame in updateEnvironment
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 2000);
camera.rotation.order = 'YXZ';
// block light level -> brightness (each step dims by ~18%)
const LIGHT_CURVE = Array.from({ length: 16 }, (_, l) => l ? Math.pow(0.82, 15 - l) : 0);
const col = h => new THREE.Color(h);

// ---------- cloud layers: two tileable noise textures, shared by the cloud planes and the cloud shadows ----------
function cloudNoise(seed, base) {
  const N = 256, n = tileNoise(seed), d = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = (i + .5) / N, v = (j + .5) / N, k = (j * N + i) * 4;
    d[k] = clamp(.5 + tfbm(n, u, v, base, 5) * 1.1 + (tridged(n, u + .37, v + .11, base * 2, 3) - .5) * .25, 0, 1) * 255; d[k + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
const CLOUD_U = {
  cloudMapA: { value: cloudNoise(41, 3) }, cloudMapB: { value: cloudNoise(57, 4) },
  cloudY: { value: new THREE.Vector2(...LIGHTING.clouds.y) }, cloudScale: { value: new THREE.Vector2(...LIGHTING.clouds.scale) },
  cloudOffA: { value: new THREE.Vector2() }, cloudOffB: { value: new THREE.Vector2() },
  cloudCover: { value: new THREE.Vector4(LIGHTING.clouds.cover[0], LIGHTING.clouds.soft[0], LIGHTING.clouds.cover[1], LIGHTING.clouds.soft[1]) },
  cloudAlpha: { value: new THREE.Vector2(...LIGHTING.clouds.alpha) },
};
const CLOUD_PARS = `uniform sampler2D cloudMapA, cloudMapB; uniform vec2 cloudY, cloudScale, cloudOffA, cloudOffB, cloudAlpha; uniform vec4 cloudCover;
float cloudA(vec2 xz, float bias) { return smoothstep(cloudCover.x, cloudCover.x + cloudCover.y, texture2D(cloudMapA, (xz + cloudOffA) * cloudScale.x, bias).r) * cloudAlpha.x; }
float cloudB(vec2 xz, float bias) { return smoothstep(cloudCover.z, cloudCover.z + cloudCover.w, texture2D(cloudMapB, (xz + cloudOffB) * cloudScale.y, bias).r) * cloudAlpha.y; }
`;

// ---------- voxel lighting patch for standard materials ----------
// Adds to three's PBR lighting: the sky light level on indirect light (dark under roofs and in caves),
// warm block light from torches, cloud shadows on direct light, and haze that fades into the sky
// colour of the environment map in that direction. Per-vertex data comes from the mesher's
// `light` attribute (ao, sky light, block light); entities pass the same as a uniform. Vertex AO
// itself is already in the vertex colour (albedo); here it only occludes reflections.
const VOX = Object.assign({
  torchColor: { value: new THREE.Color().setRGB(...LIGHTING.torch).multiplyScalar(LIGHTING.torchIntensity) },
  caveAmbient: { value: LIGHTING.caveAmbient }, lightDirW: { value: new THREE.Vector3(0, 1, 0) }, cloudShadow: { value: LIGHTING.cloudShadow },
  fogFadeNear: { value: 50 }, fogFadeFar: { value: 100 }, hazeOverride: { value: 0 }, hazeColor: { value: new THREE.Color() },
  windTime: { value: 0 }, windDir: { value: new THREE.Vector2(...LIGHTING.wind.dir).normalize() }, windAmp: { value: LIGHTING.wind.amp }, windWave: { value: LIGHTING.wind.wave },
  waterTime: { value: 0 }, waterWaveA: { value: new THREE.Vector3(...LIGHTING.water.waveA) }, waterWaveB: { value: new THREE.Vector3(...LIGHTING.water.waveB) },
  waterRotB: { value: new THREE.Vector2(Math.cos(LIGHTING.water.waveBAngle), Math.sin(LIGHTING.water.waveBAngle)) }, waterFront: { value: LIGHTING.water.frontAlpha },
  waterAbsorb: { value: new THREE.Vector3(...LIGHTING.water.absorb) },
}, CLOUD_U);
const VOX_PARS = `varying vec3 vWPos;
uniform vec3 torchColor, lightDirW, hazeColor, waterAbsorb; uniform float caveAmbient, cloudShadow, fogFadeNear, fogFadeFar, hazeOverride;
${CLOUD_PARS}`;
const VOX_LIGHT = `{
  vec4 vox = VOX;
  // cloud shadows: each layer's coverage where the sun ray through this point crosses it (blurred mip)
  float ly = max(lightDirW.y, 0.2);
  float ca = cloudA(vWPos.xz + lightDirW.xz * ((cloudY.x - vWPos.y) / ly), 2.5), cb = cloudB(vWPos.xz + lightDirW.xz * ((cloudY.y - vWPos.y) / ly), 2.5);
  float direct = 1.0 - clamp(ca + cb * (1.0 - ca), 0.0, 1.0) * cloudShadow;
  reflectedLight.directDiffuse *= direct;
  reflectedLight.directSpecular *= direct * VOX_SPEC;
  reflectedLight.indirectDiffuse *= vox.g;
  reflectedLight.indirectSpecular *= vox.r * vox.g * VOX_SPEC;
  reflectedLight.indirectDiffuse += material.diffuseColor * (vec3(caveAmbient) + torchColor * vox.b);
  vec3 waterT = exp(-waterAbsorb * vox.a); // under vox.a blocks of water
  reflectedLight.directDiffuse *= waterT; reflectedLight.directSpecular *= waterT; reflectedLight.indirectDiffuse *= waterT; reflectedLight.indirectSpecular *= waterT;
}`;
// FogExp2 (density from three's scene.fog), applied before tone mapping. Its colour is the sky itself: the environment
// map looked up toward the horizon in this view direction, so distant terrain melts into whatever sky is behind it.
// Near the render-distance edge the terrain fades out completely, so chunks never end in a hard line.
const VOX_FOG = `#ifdef USE_FOG
{
  vec3 toFrag = vWPos - cameraPosition; float dist = length(toFrag);
  vec3 fc = hazeColor;
  #ifdef ENVMAP_TYPE_CUBE_UV
    if (hazeOverride < 0.5) { vec3 d = toFrag / dist; d.y = max(d.y, 0.03); fc = textureCubeUV(envMap, envMapRotation * normalize(d), 0.0).rgb; }
  #endif
  float ff = 0.0;
  #ifdef FOG_EXP2
    float fd = fogDensity * dist; ff = 1.0 - exp(-fd * fd);
  #endif
  ff = max(ff, smoothstep(fogFadeNear, fogFadeFar, dist));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, ff);
}
#endif`;
// wind: a travelling wave across world space; 'tip' moves only the top of crossed plant quads (uv.y = 1), 'all' whole leaf blocks
const WIND_VERTEX = `{
  vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float ph = dot(wp.xz, windDir) * windWave - windTime;
  float sw = (sin(ph) * 0.75 + sin(ph * 2.31 + wp.y * 1.7) * 0.25) * windAmp * VOX_WIND_W;
  transformed.xz += windDir * sw;
  transformed.y += sin(ph * 1.37 + wp.x * 0.9) * windAmp * 0.35 * VOX_WIND_W;
}`;
// water: two normal maps drifting in different directions and scales, blended; Fresnel trades the water colour for
// sky reflection and makes the surface clear when looked at straight on, mirror-like at grazing angles
const WATER_NORMAL = `{
  vec2 ua = vWaterUv * waterWaveA.x + waterTime * waterWaveA.yz;
  mat2 rb = mat2(waterRotB.x, waterRotB.y, -waterRotB.y, waterRotB.x);
  vec2 ub = rb * vWaterUv * waterWaveB.x + waterTime * waterWaveB.yz;
  vec3 na = texture2D(normalMap, ua).xyz * 2.0 - 1.0, nb = texture2D(waterNormalB, ub).xyz * 2.0 - 1.0;
  nb.xy = transpose(rb) * nb.xy; // back into the first map's tangent frame
  vec3 mapN = normalize(vec3(na.xy + nb.xy, na.z * nb.z));
  mapN.xy *= normalScale;
  normal = normalize(tbn * mapN);
}`;
// alpha cut-outs keep their coverage in the distance: smaller mips average leaf and gap into alpha < 0.5, so a far canopy
// would fall apart into specks; alpha is raised with the mip level instead
const CUTOUT_MIP = `#ifdef USE_MAP
{
  vec2 ts = vec2(textureSize(map, 0)), mdx = dFdx(vMapUv * ts), mdy = dFdy(vMapUv * ts);
  diffuseColor.a *= 1.0 + max(0.0, 0.5 * log2(max(dot(mdx, mdx), dot(mdy, mdy)))) * 0.25;
}
#endif`;
function patchVoxel(mat, perVertex, voxUniform, spec = LIGHTING.terrainSpecular, opts = {}) {
  mat.fog = true;
  const vu = voxUniform || { value: new THREE.Vector4(1, 1, 0, 0) };
  mat.userData.vox = vu;
  const wind = opts.wind === 'tip' ? 'uv.y' : opts.wind === 'all' ? '1.0' : null, water = !!opts.water;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, VOX);
    if (!perVertex) sh.uniforms.voxLight = vu;
    if (water) sh.uniforms.waterNormalB = { value: WATER_NORMAL_B };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;${perVertex ? '\nattribute vec4 light;\nvarying vec4 vVox;' : ''}` +
        (wind ? `\nuniform float windTime, windAmp, windWave; uniform vec2 windDir;\n#define VOX_WIND_W ${wind}` : '') + (water ? '\nvarying vec2 vWaterUv;' : ''))
      .replace('#include <begin_vertex>', `#include <begin_vertex>${wind ? '\n' + WIND_VERTEX : ''}${water ? '\nvWaterUv = uv;' : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;${perVertex ? '\nvVox = light;' : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n#define VOX_SPEC ${spec.toFixed(3)}\n${VOX_PARS}${perVertex ? 'varying vec4 vVox;\n#define VOX vVox' : 'uniform vec4 voxLight;\n#define VOX voxLight'}` +
        (water ? '\nvarying vec2 vWaterUv; uniform sampler2D waterNormalB; uniform float waterTime, waterFront; uniform vec3 waterWaveA, waterWaveB; uniform vec2 waterRotB;' : ''))
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${VOX_LIGHT}` +
        (water ? '\nfloat waterF = 0.02 + 0.98 * pow(1.0 - saturate(dot(normal, geometryViewDir)), 5.0);\nreflectedLight.directDiffuse *= 1.0 - waterF; reflectedLight.indirectDiffuse *= 1.0 - waterF;' : ''))
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>' + (water ? '\ngl_FragColor.a = mix(diffuseColor.a * waterFront, 1.0, waterF);' : ''))
      .replace('#include <tonemapping_fragment>', `${VOX_FOG}\n#include <tonemapping_fragment>`)
      .replace('#include <fog_fragment>', '');
    if (water) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', WATER_NORMAL);
    if (mat.alphaTest > 0) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\n${CUTOUT_MIP}`);
  };
  mat.customProgramCacheKey = () => (perVertex ? 'vox-vertex' : 'vox-uniform') + spec + (wind || '') + (water ? 'water' : '') + (mat.alphaTest > 0 ? 'cut' : '');
  return mat;
}
// light at an entity's cell, as (ao, sky light, block light, blocks of water above)
function cellVox(x, y, z, v) {
  x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
  let w = 0; while (w < 16 && getBlock(x, y + w, z) === B.WATER) w++;
  return v.set(1, skyLight(getSky(x, y, z)), levelLight(getLight(x, y, z)), w);
}

// ---------- block materials: one PBR material per texture tile (no atlas, so mipmaps never bleed between tiles) ----------
// The maps come from blocktex.js: albedo (sRGB), tangent-space normal (Sobel of the height field) and ORM
// (R cavity occlusion, G roughness, B metal mask). Roughness and metalness per tile are in TILE_SPEC there.
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
function tileTexture(data, srgb) {
  const t = new THREE.DataTexture(data, TEX, TEX);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = MAX_ANISO;
  t.needsUpdate = true; return t;
}
const TILE_TEX = TILE_MAPS.map(m => ({ map: tileTexture(m.albedo, true), normal: tileTexture(m.normal, false), orm: tileTexture(m.orm, false), emissive: m.emissive && tileTexture(m.emissive, true) }));
function tileMaterial(tile, perVertex, vox) {
  const s = TILE_SPEC[tile], t = TILE_TEX[tile];
  const m = new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.orm, aoMap: t.orm, roughness: Math.min(1, s.rough * TILE_MAPS[tile].rk), metalness: 0, vertexColors: perVertex });
  if (!s.plant) m.normalMap = t.normal; // crossed plant quads use an upward normal, so a tangent-space map would only add noise
  if (s.metal) { m.metalnessMap = t.orm; m.metalness = s.metal; }
  if (t.emissive) { m.emissiveMap = t.emissive; m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = s.emissive; }
  if (s.cutout) { m.alphaTest = .5; m.alphaToCoverage = true; } // with MSAA the cut-out edges are smoothed instead of stair-stepped
  if (s.transparent) { m.transparent = true; m.depthWrite = false; }
  // leaves are seen from inside the canopy too; their shadows come from the far side, so lit faces don't shadow themselves
  if (s.sway === 'all') { m.side = THREE.DoubleSide; m.shadowSide = THREE.BackSide; }
  return patchVoxel(m, perVertex, vox, s.spec ?? LIGHTING.terrainSpecular, { wind: perVertex ? s.sway : null });
}
// a second, finer ripple normal map for the water (the first is the water tile's own)
const WATER_NORMAL_B = (() => {
  const n = tileNoise(331), L = newLayers();
  each(L, (u, v, p) => { p.h = .5 + .3 * tfbm(n, u, v, 3, 4, 5) + .12 * Math.sin((u * 4 + tfbm(n, u, v, 2, 2) * .8) * Math.PI * 2); });
  return tileTexture(bakeLayers(L, { bump: 1.6 }).normal, false);
})();
// the water surface: its own clear material (no albedo texture), lit like terrain, reflecting the baked sky
function waterMaterial() {
  const W = LIGHTING.water, m = new THREE.MeshStandardMaterial({
    color: W.color, transparent: true, opacity: W.opacity, roughness: W.roughness, metalness: 0, normalMap: TILE_TEX[T.WATER].normal,
    side: THREE.DoubleSide, depthWrite: false, vertexColors: true, envMapIntensity: W.reflect,
  });
  return patchVoxel(m, true, null, 1, { water: true });
}
const CHUNK_MATS = TILE_NAMES.map((n, t) => tileMaterial(t, true)), WATER_MAT = waterMaterial();
// the chunk shadow twins draw all opaque faces with this one material (index SHADOW_SOLID), cut-outs with their tile material
const SHADOW_SOLID = TILE_NAMES.length, SHADOW_MATS = [...CHUNK_MATS, new THREE.MeshBasicMaterial()];
// water ripples (in the shader) and lava drift (texture offsets) move in world space; the wind clock drives grass and leaves
function scrollFluids(t) {
  VOX.waterTime.value = t; VOX.windTime.value = t * LIGHTING.wind.speed;
  const l = TILE_TEX[T.LAVA];
  l.map.offset.set(t * .006, -t * .004); l.normal.offset.copy(l.map.offset); l.orm.offset.copy(l.map.offset); l.emissive.offset.copy(l.map.offset);
}

// ---------- sky (Preetham atmosphere from three/addons) ----------
const SKY_BRIGHTNESS = { value: LIGHTING.skyBrightness };
function makeSky(sunDisc) {
  const s = new Sky(); s.scale.setScalar(1000);
  const u = s.material.uniforms;
  for (const k in LIGHTING.sky) u[k].value = LIGHTING.sky[k];
  u.cloudCoverage.value = 0; u.showSunDisc.value = sunDisc ? 1 : 0;
  s.material.onBeforeCompile = sh => {
    sh.uniforms.skyBrightness = SKY_BRIGHTNESS;
    sh.fragmentShader = sh.fragmentShader.replace('uniform float time;', 'uniform float time;\nuniform float skyBrightness;')
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb *= skyBrightness;\n#include <tonemapping_fragment>');
  };
  return s;
}
const sky = makeSky(true); scene.add(sky);
// the environment map is baked from a copy of the sky without the sun disc (the sun is the directional light)
const envScene = new THREE.Scene(), envSky = makeSky(false); envScene.add(envSky);
const pmrem = new THREE.PMREMGenerator(renderer);
// the sky is rendered into one cube target and prefiltered into one PMREM target, both reused on every bake: no GPU
// allocations, and materials keep the same environment texture, so a bake never forces a material refresh (no hitch)
const envCubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType }), envCubeCam = new THREE.CubeCamera(0.1, 1000, envCubeRT);
let envTarget = null, envTimer = 0;
function bakeEnvironment() {
  const ac = renderer.autoClear; renderer.autoClear = true;
  envCubeCam.update(renderer, envScene);
  renderer.autoClear = ac;
  const first = !envTarget;
  envTarget = pmrem.fromCubemap(envCubeRT.texture, envTarget);
  if (first) {
    scene.environment = handScene.environment = envTarget.texture;
    WATER_MAT.envMap = envTarget.texture; // its own env map, so the reflection keeps full strength (envMapIntensity) instead of scene.environmentIntensity
  }
}

// ---------- stars and moon ----------
const starGeo = new THREE.BufferGeometry();
{
  const r = mulberry32(42), P = [], S = [], Ph = [], C = [];
  for (let i = 0; i < LIGHTING.stars; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    P.push(s * Math.cos(th) * 900, u * 900, s * Math.sin(th) * 900);
    const b = Math.pow(r(), 3);
    S.push(0.8 + b * 2.6); Ph.push(r());
    const t = r(); C.push(...(t < .15 ? [.75, .85, 1] : t < .25 ? [1, .9, .75] : [1, 1, 1]).map(v => v * (0.35 + b * 0.9)));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  starGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(S, 1));
  starGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(Ph, 1));
  starGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(C, 3));
}
const starMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uFade: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() } },
  vertexShader: `attribute float aSize, aPhase; attribute vec3 aColor; uniform float uTime, uFade, uPixelRatio; varying vec3 vColor; varying float vAlpha;
void main() { vColor = aColor; vAlpha = uFade * (0.6 + 0.4 * sin(uTime * (1.1 + fract(aPhase * 7.13) * 2.6) + aPhase * 6.2832));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uPixelRatio; }`,
  fragmentShader: `varying vec3 vColor; varying float vAlpha;
void main() { float a = smoothstep(0.5, 0.05, length(gl_PointCoord - 0.5)) * vAlpha; gl_FragColor = vec4(vColor * a, a); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const stars = new THREE.Points(starGeo, starMat); stars.renderOrder = 1; stars.frustumCulled = false; scene.add(stars);
const moonTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), img = x.createImageData(128, 128), n = new Perlin(7);
  for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) {
    const dx = (i - 63.5) / 44, dy = (j - 63.5) / 44, d = Math.hypot(dx, dy), k = (j * 128 + i) * 4;
    if (d < 1) {
      const mare = n.noise(dx * 2.2, dy * 2.2, 0.5) + .5 * n.noise(dx * 5, dy * 5, 3.1);
      let v = 0.86 - Math.max(0, mare) * 0.32 - (1 - Math.sqrt(1 - d * d)) * 0.18;
      for (const [cx, cy, cr] of [[-.35, -.3, .14], [.3, .35, .1], [.45, -.2, .07], [-.15, .5, .08], [.05, -.55, .06]]) { const cd = Math.hypot(dx - cx, dy - cy) / cr; if (cd < 1) v += cd > .75 ? .06 : -.07; }
      img.data[k] = 236 * v + 10; img.data[k + 1] = 236 * v + 10; img.data[k + 2] = 228 * v + 14; img.data[k + 3] = 255 * Math.min(1, (1 - d) * 40);
    } else { const g = Math.max(0, 1 - (d - 1) / 0.45); img.data[k] = 200; img.data[k + 1] = 214; img.data[k + 2] = 255; img.data[k + 3] = 70 * g * g; }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const moonMat = new THREE.MeshBasicMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false, color: new THREE.Color(1.5, 1.5, 1.5) });
const moon = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), moonMat); moon.renderOrder = 2; scene.add(moon);

// ---------- sun / moon light and sky light ----------
const sunLight = new THREE.DirectionalLight(LIGHTING.sunNoonColor, LIGHTING.sunNoon);
sunLight.castShadow = true;
{
  const s = sunLight.shadow, R = LIGHTING.shadowRange;
  s.mapSize.set(LIGHTING.shadowSize, LIGHTING.shadowSize);
  Object.assign(s.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 520 });
  s.camera.updateProjectionMatrix();
  s.bias = LIGHTING.shadowBias; s.normalBias = LIGHTING.shadowNormalBias; s.radius = LIGHTING.shadowRadius;
}
scene.add(sunLight, sunLight.target);
// a mesh that only draws into the sun's shadow map (chunk shadow twins, the player's body). Both passes filter by the
// main camera's layers, so layers can't separate them; frustum culling can: only the shadow frustum accepts it.
const SHADOW_FRUSTUM = sunLight.shadow.getFrustum();
function shadowOnly(mesh) {
  mesh.castShadow = true;
  mesh.intersectsFrustum = function (f) { return f === SHADOW_FRUSTUM && THREE.Mesh.prototype.intersectsFrustum.call(this, f); };
  return mesh;
}
const hemiLight = new THREE.HemisphereLight(LIGHTING.hemiSky, LIGHTING.hemiGround, LIGHTING.hemi); scene.add(hemiLight);
const SHADOW = { on: true };
function setShadowQuality(on) { SHADOW.on = on; sunLight.castShadow = on; VOX.cloudShadow.value = on ? LIGHTING.cloudShadow : 0; }

// ---------- clouds: two noise planes drifting at different speeds, lit by the sun and sky ----------
const CLOUD_COL = { lit: { value: new THREE.Color() }, shade: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() }, fade: { value: LIGHTING.clouds.fade } };
function cloudLayer(i) {
  const m = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, CLOUD_U, { uLit: CLOUD_COL.lit, uShade: CLOUD_COL.shade, uSunDir: CLOUD_COL.sunDir, uFade: CLOUD_COL.fade }),
    vertexShader: `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${CLOUD_PARS}
uniform vec3 uLit, uShade, uSunDir; uniform float uFade; varying vec3 vW;
void main() {
  float a = ${i ? 'cloudB' : 'cloudA'}(vW.xz, 0.0);
  if (a < 0.004) discard;
  float thick = smoothstep(0.25, 1.0, a / ${i ? 'cloudAlpha.y' : 'cloudAlpha.x'});
  vec3 v = normalize(vW - cameraPosition);
  float glow = pow(max(dot(v, uSunDir), 0.0), 6.0) * (1.0 - thick);                 // thin edges light up toward the sun
  vec3 c = mix(uLit, uShade, thick * 0.7) + uLit * glow * 0.8;
  float fade = 1.0 - smoothstep(uFade * 0.45, uFade, length(vW.xz - cameraPosition.xz));
  gl_FragColor = vec4(c, a * fade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), m);
  mesh.scale.setScalar(LIGHTING.clouds.fade); mesh.frustumCulled = false; mesh.renderOrder = 3 + i;
  scene.add(mesh); return mesh;
}
const cloudLayers = [cloudLayer(0), cloudLayer(1)];
// each world starts with its own cloud pattern
function paintClouds(seed) { const r = mulberry32(seed + 99); CLOUD_U.cloudOffA.value.set(r() * 4096, r() * 4096); CLOUD_U.cloudOffB.value.set(r() * 4096, r() * 4096); }

// ---------- day / night ----------
const WATER_FOG = new THREE.Color(...LIGHTING.underwater.color), LAVA_FOG = new THREE.Color(0.9, 0.18, 0.01);
const C = {
  sunNoon: col(LIGHTING.sunNoonColor), sunLow: col(LIGHTING.sunLowColor), moon: col(LIGHTING.moonColor),
  hemiSky: col(LIGHTING.hemiSky), hemiGround: col(LIGHTING.hemiGround), hemiDusk: col(LIGHTING.hemiDuskSky),
  hemiNightSky: col(LIGHTING.hemiNightSky), hemiNightGround: col(LIGHTING.hemiNightGround),
  cloudSunset: col(LIGHTING.clouds.sunset), cloudDusk: col(LIGHTING.clouds.dusk),
};
const sunDir = new THREE.Vector3(0, 1, 0), lightDir = new THREE.Vector3(0, 1, 0), _tc = new THREE.Color();
let sunStrength = 0, starClock = 0;
// returns daylight 0.16..1 (gameplay brightness used by mob spawning) and updates sky, lights and clouds
function updateEnvironment(dt, t, eye, inFluid, nightVision) {
  const ang = t * Math.PI * 2, sunH = Math.sin(ang);
  const daylight = 0.16 + 0.84 * smooth(-0.2, 0.3, sunH);
  sunDir.set(Math.cos(ang), Math.sin(ang), 0.15).normalize();
  const sy = sunDir.y, moonY = -sy;
  const warm = 1 - smooth(0.04, 0.5, sy), dayF = smooth(-0.12, 0.2, sy);
  sky.material.uniforms.sunPosition.value.copy(sunDir); envSky.material.uniforms.sunPosition.value.copy(sunDir);
  sky.position.copy(eye);
  // one directional light: the sun by day, the moon by night; they cross near zero at the horizon
  const sunI = LIGHTING.sunNoon * smooth(-0.03, 0.08, sy) * (0.45 + 0.55 * smooth(0.05, 0.6, sy));
  const moonI = LIGHTING.moon * smooth(-0.02, 0.15, moonY);
  const useSun = sunI >= moonI, q = Math.PI / 3600; // light direction steps of 0.05 degrees keep shadow texels steady
  const la = Math.round((useSun ? ang : ang + Math.PI) / q) * q;
  lightDir.set(Math.cos(la), Math.sin(la), useSun ? 0.15 : -0.15).normalize();
  sunLight.intensity = useSun ? sunI : moonI;
  if (useSun) sunLight.color.copy(C.sunNoon).lerp(C.sunLow, warm); else sunLight.color.copy(C.moon);
  sunStrength = sunLight.intensity;
  VOX.lightDirW.value.copy(lightDir);
  // sky light: blue by day, warm at golden hour, deep blue at night
  hemiLight.color.copy(C.hemiNightSky).lerp(_tc.copy(C.hemiSky).lerp(C.hemiDusk, warm * 0.75), dayF);
  hemiLight.groundColor.copy(C.hemiNightGround).lerp(C.hemiGround, dayF);
  const ambientK = 0.4 + 0.6 * smooth(0.02, 0.45, sy); // diffuse sky light is weaker when the sun is low
  hemiLight.intensity = lerp(dayF, LIGHTING.hemiNight, LIGHTING.hemi * ambientK) + nightVision * 0.8;
  scene.environmentIntensity = handScene.environmentIntensity = LIGHTING.envIntensity * ambientK; // (three uses this, not material.envMapIntensity, for scene.environment)
  // fog: FogExp2 whose density follows the render distance, coloured by the sky; underwater and in lava a short coloured fog
  const hz = VOX, D = renderDist * CS, far = inFluid === B.WATER ? LIGHTING.underwater.far * (1 + nightVision) : inFluid ? 6 : 2000;
  if (inFluid) {
    const water = inFluid === B.WATER;
    hz.hazeOverride.value = 1; hz.hazeColor.value.copy(water ? WATER_FOG : LAVA_FOG); scene.fog.color.copy(hz.hazeColor.value);
    scene.fog.density = water ? LIGHTING.underwater.density / (1 + nightVision * 1.5) : 0.9;
    hz.fogFadeNear.value = far * 0.6; hz.fogFadeFar.value = far;
  } else {
    hz.hazeOverride.value = 0; scene.fog.color.copy(hemiLight.color).multiplyScalar(hemiLight.intensity); // (the shader takes the actual sky colour per pixel)
    scene.fog.density = Math.sqrt(-Math.log(1 - LIGHTING.fogEdge)) / D;
    hz.fogFadeNear.value = D * LIGHTING.fogFadeStart; hz.fogFadeFar.value = D;
  }
  if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); } // underwater the view distance shrinks
  sky.visible = !inFluid;
  if (inFluid) renderer.setClearColor(hz.hazeColor.value); else renderer.setClearColor(0x000000);
  // bake the sky into the environment map every few seconds (more often while time runs fast)
  envTimer -= dt * (keys.KeyT ? 12 : 1);
  if (envTimer <= 0 || !envTarget) { envTimer = LIGHTING.envInterval; bakeEnvironment(); }
  // stars and moon
  starClock += dt; starMat.uniforms.uTime.value = starClock; starMat.uniforms.uFade.value = (1 - smooth(-0.22, 0.02, sy)) * (inFluid ? 0 : 1);
  stars.position.copy(eye); stars.rotation.z = ang;
  moon.position.copy(eye).addScaledVector(sunDir, -900); moon.lookAt(eye);
  moonMat.opacity = smooth(-0.05, 0.08, moonY) * (1 - 0.75 * dayF); moon.visible = !inFluid && moonMat.opacity > 0.01;
  // clouds: each layer drifts at its own speed (the cloud shadows follow the same offsets); the lit side takes the
  // sun's colour and strength, the underside the sky light, tinted orange and pink around sunset
  const CL = LIGHTING.clouds;
  CLOUD_U.cloudOffA.value.x -= CL.speed[0][0] * dt; CLOUD_U.cloudOffA.value.y -= CL.speed[0][1] * dt;
  CLOUD_U.cloudOffB.value.x -= CL.speed[1][0] * dt; CLOUD_U.cloudOffB.value.y -= CL.speed[1][1] * dt;
  cloudLayers.forEach((m, i) => { m.visible = !inFluid; m.position.set(eye.x, CL.y[i], eye.z); });
  const evening = warm * dayF;
  CLOUD_COL.lit.value.copy(sunLight.color).multiplyScalar(sunLight.intensity * (useSun ? 0.32 : 0.6)).lerp(_tc.copy(C.cloudSunset).multiplyScalar(sunLight.intensity * 0.32), evening * 0.5)
    .add(_tc.copy(hemiLight.color).multiplyScalar(hemiLight.intensity * 0.45));
  CLOUD_COL.shade.value.copy(hemiLight.color).multiplyScalar(hemiLight.intensity * 0.55).add(_tc.copy(sunLight.color).multiplyScalar(sunLight.intensity * 0.06));
  CLOUD_COL.shade.value.lerp(_tc.copy(C.cloudDusk).multiplyScalar(0.12 + 0.25 * sunLight.intensity), evening * 0.6);
  CLOUD_COL.sunDir.value.copy(useSun ? sunDir : lightDir);
  return daylight;
}

// ---------- sun shadow camera follows the player, snapped to whole shadow texels ----------
const _lc = new THREE.OrthographicCamera(), _sv = new THREE.Vector3(), _li = new THREE.Matrix4();
// the player has no visible body in first person, but it still casts a shadow (shadow-only meshes)
const shadowBody = new THREE.Group(); scene.add(shadowBody);
const bodyLimbs = [];
{
  const box = (w, h, d, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial()); m.position.set(x, y, z); shadowOnly(m); parent.add(m); return m; };
  box(.5, .5, .5, 0, 1.56, 0, shadowBody); box(.5, .74, .26, 0, .96, 0, shadowBody);
  for (const [x, y, w] of [[-.37, 1.32, .22], [.37, 1.32, .22], [-.13, .62, .24], [.13, .62, .24]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0); shadowBody.add(pivot);
    box(w, y > 1 ? .7 : .62, w, 0, -(y > 1 ? .33 : .31), 0, pivot); bodyLimbs.push(pivot);
  }
}
function updateSunShadow(px, py, pz, yaw, hv, showBody) {
  const D = 250, texel = 2 * LIGHTING.shadowRange / sunLight.shadow.mapSize.x;
  _lc.position.copy(lightDir).multiplyScalar(D); _lc.lookAt(0, 0, 0); _lc.updateMatrixWorld(true);
  _li.copy(_lc.matrixWorld).invert();
  _sv.set(px, py, pz).applyMatrix4(_li);
  _sv.x = Math.round(_sv.x / texel) * texel; _sv.y = Math.round(_sv.y / texel) * texel;
  _sv.applyMatrix4(_lc.matrixWorld);
  sunLight.target.position.copy(_sv); sunLight.position.copy(_sv).addScaledVector(lightDir, D);
  shadowBody.visible = showBody; shadowBody.position.set(px, py, pz); shadowBody.rotation.y = yaw;
  const swingA = reduceMotion ? 0 : Math.sin(bob * 2) * Math.min(1, hv / 4) * .7;
  bodyLimbs[0].rotation.x = bodyLimbs[3].rotation.x = swingA; bodyLimbs[1].rotation.x = bodyLimbs[2].rotation.x = -swingA;
}

// ---------- selection & breaking overlay ----------
const selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, fog: false }));
selBox.visible = false; scene.add(selBox);
const crackTex = new THREE.CanvasTexture(crackCanvas); crackTex.magFilter = crackTex.minFilter = THREE.NearestFilter; crackTex.generateMipmaps = false; crackTex.repeat.set(.1, 1);
const crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
crackMesh.visible = false; scene.add(crackMesh);
function showCrack(x, y, z, stage) {
  if (stage < 0) { crackMesh.visible = false; return; }
  crackMesh.visible = true; crackMesh.position.set(x + .5, y + .5, z + .5); crackTex.offset.x = Math.min(9, stage) / 10;
}

// ---------- geometry helpers ----------
// accepts plain arrays or typed arrays (chunk meshes arrive from the worker as typed arrays and are used without copying)
function makeGeo(P, U, I, Nm, extra = {}) {
  const g = new THREE.BufferGeometry(), attr = (a, n) => ArrayBuffer.isView(a) ? new THREE.BufferAttribute(a, n) : new THREE.Float32BufferAttribute(a, n);
  g.setAttribute('position', attr(P, 3));
  g.setAttribute('uv', attr(U, 2));
  g.setAttribute('normal', attr(Nm, 3));
  for (const k in extra) g.setAttribute(k, attr(extra[k][0], extra[k][1]));
  g.setIndex(ArrayBuffer.isView(I) ? new THREE.BufferAttribute(I, 1) : I); g.computeBoundingSphere(); return g;
}
// a single centered cube (hand, drops, TNT): one group per face, drawn with that face's tile material
function blockGeometry(id) {
  const P = [], U = [], Nm = [], Ix = [];
  FACES.forEach(f => { const b = P.length / 3; for (const c of f.c) { P.push(c[0] - .5, c[1] - .5, c[2] - .5); U.push(c[3], c[4]); Nm.push(...f.dir); } Ix.push(b, b + 1, b + 2, b + 2, b + 1, b + 3); });
  const g = makeGeo(P, U, Ix, Nm);
  FACES.forEach((f, fi) => g.addGroup(fi * 6, 6, fi));
  return g;
}
// the six face materials of a block, lit by one shared light uniform (hand or drops); `fresh` skips the cache (TNT flashes on its own)
const blockMatCache = {};
function blockFaceMaterials(id, vox, fresh) {
  const key = id + (vox === handVox ? 'h' : 'd');
  if (!fresh && blockMatCache[key]) return blockMatCache[key];
  const byTile = {}, list = FACES.map((f, fi) => { const t = faceTile(BLOCKS[id], fi, 5); return byTile[t] || (byTile[t] = tileMaterial(t, false, vox)); });
  return fresh ? list : blockMatCache[key] = list;
}
const disposeMats = list => new Set(list).forEach(m => m.dispose());
const shadedBox = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const itemTexCache = {}, flatMatCache = {};
function itemTexture(id) { if (!itemTexCache[id]) { const t = new THREE.CanvasTexture(ITEM16[id]); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; itemTexCache[id] = t; } return itemTexCache[id]; }
const dropVox = { value: new THREE.Vector4(1, 1, 0, 0) }, handVox = { value: new THREE.Vector4(1, 1, 0, 0) };
// flat sprites: pixel-art items, or a plant / torch / ladder block shown with its own PBR tile
function flatMat(id, vox) {
  const m = isPlaceable(id) ? tileMaterial(BLOCKS[id].tiles[0], false, vox) : patchVoxel(new THREE.MeshStandardMaterial({ map: itemTexture(id), alphaTest: .5, roughness: .8 }), false, vox);
  m.side = THREE.DoubleSide; return m;
}
function flatItemMaterial(id) { return flatMatCache[id] || (flatMatCache[id] = flatMat(id, dropVox)); }
const planeGeo = new THREE.PlaneGeometry(1, 1);
const blockGeoCache = {};
const cachedBlockGeo = id => blockGeoCache[id] || (blockGeoCache[id] = blockGeometry(id));

// ---------- particles ----------
const MAXP = 500;
const pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), MAXP);
pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); pMesh.frustumCulled = false;
{ const c = new THREE.Color(1, 1, 1); for (let i = 0; i < MAXP; i++) pMesh.setColorAt(i, c); }
pMesh.count = 0; scene.add(pMesh);
const particles = []; const _m = new THREE.Matrix4(), _c = new THREE.Color();
function spawnParticles(x, y, z, colr, n, spread = 1, speed = 3, opts = {}) {
  for (let i = 0; i < n && particles.length < MAXP; i++) {
    const k = 0.75 + Math.random() * 0.35;
    particles.push({ p: new THREE.Vector3(x + (Math.random() - .5) * spread, y + (Math.random() - .5) * spread, z + (Math.random() - .5) * spread),
      v: new THREE.Vector3((Math.random() - .5) * speed, opts.up ?? Math.random() * speed * 1.2, (Math.random() - .5) * speed),
      life: (opts.life || 0.6) + Math.random() * 0.6, g: opts.g ?? 18, glow: !!opts.glow, size: opts.size || 1, c: [colr[0] * k, colr[1] * k, colr[2] * k] });
  }
}
function spawnBreakParticles(x, y, z, id) { const bd = BLOCKS[id]; spawnParticles(x + .5, y + .5, z + .5, tileAvg[bd.shape === 'cube' || bd.shape === 'fluid' ? bd.tiles[1] : bd.tiles[0]], 14, .8); }
function updateParticles(dt, light) {
  let n = 0;
  for (let i = particles.length - 1; i >= 0; i--) {
    const q = particles[i]; q.life -= dt; if (q.life <= 0) { particles.splice(i, 1); continue; }
    q.v.y -= q.g * dt; const ny = q.p.y + q.v.y * dt;
    if (q.g > 0 && BLOCKS[getBlock(Math.floor(q.p.x), Math.floor(ny), Math.floor(q.p.z))].solid) { q.v.y = 0; q.v.x *= .8; q.v.z *= .8; } else q.p.y = ny;
    q.p.x += q.v.x * dt; q.p.z += q.v.z * dt;
  }
  for (const q of particles) {
    const s = Math.min(1, q.life * 2.5) * q.size, l = q.glow ? 2 : light;
    _m.makeScale(s, s, s).setPosition(q.p); pMesh.setMatrixAt(n, _m); _c.setRGB(q.c[0], q.c[1], q.c[2], THREE.SRGBColorSpace).multiplyScalar(l); pMesh.setColorAt(n, _c); n++;
  }
  pMesh.count = n; pMesh.instanceMatrix.needsUpdate = true; if (pMesh.instanceColor) pMesh.instanceColor.needsUpdate = true;
}

// ---------- held item (drawn in its own scene over the world, lit like the player's cell) ----------
const handScene = new THREE.Scene(), handCam = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 10);
const handSun = new THREE.DirectionalLight(), handHemi = new THREE.HemisphereLight(); handScene.add(handSun, handSun.target, handHemi);
const armMat = patchVoxel(new THREE.MeshStandardMaterial({ color: 0xc69476, roughness: .7 }), false, handVox);
const handFlatCache = {};
const handFlat = id => handFlatCache[id] || (handFlatCache[id] = flatMat(id, handVox));
const handHolder = new THREE.Group(); handScene.add(handHolder);
let handMesh = null, handKind = '', handId = -1, swing = 0, bob = 0, equip = 0, useAnim = 0;
function setHand(id) {
  id = id || 0;
  if (id === handId) return;
  handId = id; equip = 1;
  if (handMesh) handHolder.remove(handMesh);
  if (!id) { handMesh = new THREE.Mesh(shadedBox(.28, .28, 1.0), armMat); handKind = 'arm'; }
  else if (isFlatItem(id)) { handMesh = new THREE.Mesh(planeGeo, handFlat(id)); handKind = 'flat'; }
  else { handMesh = new THREE.Mesh(cachedBlockGeo(id), blockFaceMaterials(id, handVox)); handKind = 'block'; }
  handHolder.add(handMesh);
}
function updateHand(dt, hv, onGround, eye, using) {
  if (onGround && !reduceMotion) bob += hv * dt * 1.6;
  swing = Math.max(0, swing - dt * 5); equip = Math.max(0, equip - dt * 5);
  useAnim = using ? useAnim + dt : 0;
  const sw = Math.sin(swing * Math.PI), bobA = Math.min(1, hv / 4) * (reduceMotion ? 0 : 1);
  const eat = using ? Math.abs(Math.sin(useAnim * 14)) * .05 : 0;
  const hx = Math.min(0.56, 0.7 * handCam.aspect * 0.78) - .1 * (1 - Math.min(1, handCam.aspect));
  handHolder.position.set(hx + Math.cos(bob) * .03 * bobA - sw * .14 - (using ? .28 : 0), -0.5 - Math.abs(Math.sin(bob)) * .035 * bobA - sw * .1 - equip * .35 + (using ? .12 + eat : 0), -1.0 - sw * .1);
  if (handKind === 'arm') { handMesh.position.set(.2, -.12, .1); handMesh.rotation.set(-0.5 - sw * .9, .3, .15); handMesh.scale.set(.75, .75, .8); }
  else if (handKind === 'flat') { handMesh.position.set(.06, .04, 0); handMesh.rotation.set(-sw * 0.9, -0.55 - (using ? .5 : 0), .25 + sw * .3); handMesh.scale.setScalar(.4); }
  else { handMesh.position.set(0, 0, 0); handMesh.rotation.set(-sw * 0.9, Math.PI / 4 + .2, sw * .3); handMesh.scale.setScalar(.3); }
  // the hand scene mirrors the world lights, rotated into camera space
  cellVox(eye.x, eye.y - .3, eye.z, handVox.value); dropVox.value.copy(handVox.value);
  handSun.color.copy(sunLight.color); handSun.intensity = sunLight.intensity * handVox.value.y;
  _hq.copy(camera.quaternion).invert();
  handSun.position.copy(lightDir).applyQuaternion(_hq); handHemi.position.set(0, 1, 0).applyQuaternion(_hq);
  handHemi.color.copy(hemiLight.color); handHemi.groundColor.copy(hemiLight.groundColor); handHemi.intensity = hemiLight.intensity;
}
const _hq = new THREE.Quaternion();

// ---------- post-processing: world -> GTAO -> held item -> (underwater wobble) -> bloom -> colour grading -> SMAA -> output ----------
const POST = {
  gtao: { blend: 0.5, radius: 0.7, thickness: 1.0, distanceExponent: 1.4, scale: 1.0, distanceFallOff: 1.0, samples: 12 }, // kept light: vertex AO already darkens corners
  bloom: { strength: 0.3, radius: 0.4, threshold: 0.85, cap: 2.0, sky: 4.0 }, // only the sun and bright highlights glow; cap limits how far an HDR source
  // spreads; sky pixels need this linear brightness (the sun and its glow), so a bright noon horizon doesn't haze the view
  grade: { contrast: 1.05, saturation: 1.1, warmth: [1.03, 1.0, 0.95], vignette: 0.2 },
};
// one depth texture per composer buffer; GTAO reads the world's depth from it instead of rendering the scene a second time
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) }));
const worldPass = new RenderPass(scene, camera), handPass = new RenderPass(handScene, handCam), WORLD_DEPTH = { value: null };
{ const render = worldPass.render.bind(worldPass); worldPass.render = (r, wb, rb, dt, mask) => { WORLD_DEPTH.value = rb.depthTexture; render(r, wb, rb, dt, mask); }; } // the world's depth, for GTAO and bloom
handPass.clear = false; handPass.clearDepth = true;
const gtaoPass = new GTAOPass(scene, camera, 1, 1, undefined, POST.gtao);
gtaoPass.setGBuffer(composer.renderTarget1.depthTexture); // normals are rebuilt from depth (flat block faces suit that)
gtaoPass.blendIntensity = POST.gtao.blend;
const POST_STATE = { gtaoScale: 0.5 }, _cc = new THREE.Color();
{
  const setSize = gtaoPass.setSize.bind(gtaoPass), render = gtaoPass.render.bind(gtaoPass);
  // half resolution on the medium preset; the unused internal normal buffer is kept tiny
  gtaoPass.setSize = (w, h) => { setSize(Math.max(1, Math.round(w * POST_STATE.gtaoScale)), Math.max(1, Math.round(h * POST_STATE.gtaoScale))); gtaoPass.normalRenderTarget.setSize(1, 1); };
  gtaoPass.render = (r, wb, rb, dt, mask) => {
    gtaoPass.gtaoMaterial.uniforms.tDepth.value = gtaoPass.pdMaterial.uniforms.tDepth.value = WORLD_DEPTH.value;
    // sky pixels are skipped by the AO shaders, so start both AO buffers white (no occlusion)
    r.getClearColor(_cc); const ca = r.getClearAlpha(); r.setClearColor(0xffffff, 1);
    for (const t of [gtaoPass.gtaoRenderTarget, gtaoPass.pdRenderTarget]) { r.setRenderTarget(t); r.clear(true, false, false); }
    r.setClearColor(_cc, ca);
    render(r, wb, rb, dt, mask);
  };
}
const fullscreenVS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const wobblePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAmount: { value: LIGHTING.underwater.wobble } },
  vertexShader: fullscreenVS,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uAmount; varying vec2 vUv;
void main() {
  vec2 o = vec2(sin(vUv.y * 23.0 + uTime * 2.1) + sin(vUv.y * 9.0 - uTime * 1.3) * 0.5, cos(vUv.x * 19.0 + uTime * 1.7)) * uAmount;
  gl_FragColor = texture2D(tDiffuse, clamp(vUv + o, 0.001, 0.999));
}`,
});
const bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), POST.bloom.strength, POST.bloom.radius, POST.bloom.threshold);
// The scene is still linear HDR here. The threshold is compared with the brightness as it will look on screen (exposure and
// an ACES-like curve, like the output pass), so a bright noon sky stays below it and only the sun and highlights bloom;
// the cap keeps an HDR source like the sun from flooding half the screen.
bloomPass.highPassUniforms.uExposure = { value: 1 }; bloomPass.highPassUniforms.tDepth = WORLD_DEPTH;
bloomPass.materialHighPassFilter.fragmentShader = bloomPass.materialHighPassFilter.fragmentShader
  .replace('uniform float smoothWidth;', 'uniform float smoothWidth; uniform float uExposure; uniform sampler2D tDepth;')
  .replace('vec4 texel = texture2D( tDiffuse, vUv );', `vec4 texel = texture2D( tDiffuse, vUv ); texel.rgb *= ${POST.bloom.cap.toFixed(2)} / max(${POST.bloom.cap.toFixed(2)}, luminance(texel.rgb));`)
  .replace('vec4 texel = texture2D( tDiffuse, vUv );', `vec4 texel = texture2D( tDiffuse, vUv ); float skyL = luminance( texel.rgb ) * uExposure; bool isSky = texture2D( tDepth, vUv ).x >= 0.99999;`)
  .replace('float v = luminance( texel.xyz );', 'float l = luminance( texel.xyz ) * uExposure; float v = (l * (2.51 * l + 0.03)) / (l * (2.43 * l + 0.59) + 0.14);')
  .replace('gl_FragColor = mix( outputColor, texel, alpha );', `if (isSky) alpha *= smoothstep(${POST.bloom.sky.toFixed(2)}, ${(POST.bloom.sky * 1.5).toFixed(2)}, skyL);\n\t\t\tgl_FragColor = mix( outputColor, texel, alpha );`);
bloomPass.highPassUniforms.smoothWidth.value = 0.05;
// colour grading in linear light: a touch warmer, saturation and contrast around middle grey, then a soft vignette
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uContrast: { value: POST.grade.contrast }, uSaturation: { value: POST.grade.saturation }, uWarm: { value: new THREE.Vector3(...POST.grade.warmth) }, uVignette: { value: POST.grade.vignette }, uAspect: { value: 1 } },
  vertexShader: fullscreenVS,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uContrast, uSaturation, uVignette, uAspect; uniform vec3 uWarm; varying vec2 vUv;
void main() {
  vec4 t = texture2D(tDiffuse, vUv);
  vec3 c = t.rgb * uWarm;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, uSaturation), 0.0);
  c = 0.18 * pow(c / 0.18, vec3(uContrast));
  vec2 d = (vUv - 0.5) * 2.0 * vec2(sqrt(uAspect), 1.0 / sqrt(uAspect));
  c *= 1.0 - uVignette * smoothstep(0.5, 1.6, length(d));
  gl_FragColor = vec4(c, t.a);
}`,
});
const smaaPass = new SMAAPass();
smaaPass.clear = true; // its edge buffers must start empty each frame (the renderer doesn't auto-clear)
for (const p of [worldPass, gtaoPass, handPass, wobblePass, bloomPass, gradePass, smaaPass, new OutputPass()]) composer.addPass(p);

// ---------- quality presets ----------
const QUALITY = {
  low: { label: '저', shadow: 1024, dist: 4, gtao: 0, bloom: false, smaa: false, pixelRatio: () => 1 },
  medium: { label: '중', shadow: 2048, dist: 6, gtao: 0.5, bloom: true, smaa: true, pixelRatio: () => 1 },
  high: { label: '고', shadow: 4096, dist: 8, gtao: 1, bloom: true, smaa: true, pixelRatio: () => Math.min(devicePixelRatio, 2) },
};
let quality = 'medium';
function applyQuality(name) {
  const q = QUALITY[name] || QUALITY.medium; quality = QUALITY[name] ? name : 'medium';
  sunLight.shadow.mapSize.set(q.shadow, q.shadow);
  if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; } // rebuilt at the new size on the next frame
  renderDist = q.dist; lastChunkScan = 0;
  gtaoPass.enabled = q.gtao > 0; POST_STATE.gtaoScale = q.gtao || 0.5; bloomPass.enabled = q.bloom; smaaPass.enabled = q.smaa;
  renderer.setPixelRatio(q.pixelRatio()); starMat.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  resizeOutput();
}
function resizeOutput() {
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight);
  gradePass.uniforms.uAspect.value = innerWidth / innerHeight;
}
resizeOutput();
// frame statistics for the corner readout (every render this frame: shadow map, world, post passes)
renderer.info.autoReset = false;
const PERF = { calls: 0, tris: 0 };
function renderFrame(dt, showHand, underwater) {
  handPass.enabled = showHand; wobblePass.enabled = underwater; wobblePass.uniforms.uTime.value += dt;
  bloomPass.highPassUniforms.uExposure.value = renderer.toneMappingExposure;
  renderer.info.reset();
  composer.render(dt);
  PERF.calls = renderer.info.render.calls; PERF.tris = renderer.info.render.triangles;
}
