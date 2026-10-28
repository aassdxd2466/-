'use strict';
// ============================================================
//  Rendering: renderer, physically based light, sky, day/night,
//  sun shadows, clouds, particles, held item
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
  hazeStart: 0.55, hazeEnd: 0.97,                  // distance haze, as fractions of the view distance
  shadowSize: isTouch ? 2048 : 4096, shadowRange: 60, shadowBias: -0.0005, shadowNormalBias: 0.02, shadowRadius: 3,
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
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 2000);
camera.rotation.order = 'YXZ';
// block light level -> brightness (each step dims by ~18%)
const LIGHT_CURVE = Array.from({ length: 16 }, (_, l) => l ? Math.pow(0.82, 15 - l) : 0);
const col = h => new THREE.Color(h);

// ---------- cloud layer data (also used for cloud shadows on the ground) ----------
const CLOUD_Y = 128, CLOUD_CELL = 12, CLOUD_THICK = 4, CLOUD_N = 64, CLOUD_TILE = CLOUD_N * CLOUD_CELL;
const CLOUD_SHADOW_RES = 256;
const cloudCanvas = document.createElement('canvas'); cloudCanvas.width = cloudCanvas.height = CLOUD_SHADOW_RES;
const cloudShadowTex = new THREE.CanvasTexture(cloudCanvas);
cloudShadowTex.wrapS = cloudShadowTex.wrapT = THREE.RepeatWrapping; cloudShadowTex.flipY = false;
cloudShadowTex.magFilter = cloudShadowTex.minFilter = THREE.LinearFilter; cloudShadowTex.generateMipmaps = false;

// ---------- voxel lighting patch for standard materials ----------
// Adds to three's PBR lighting: the sky light level on indirect light (dark under roofs and in caves),
// warm block light from torches, cloud shadows on direct light, and haze that fades into the sky
// colour of the environment map in that direction. Per-vertex data comes from the mesher's
// `light` attribute (ao, sky light, block light); entities pass the same as a uniform. Vertex AO
// itself is already in the vertex colour (albedo); here it only occludes reflections.
const VOX = {
  torchColor: { value: new THREE.Color().setRGB(...LIGHTING.torch).multiplyScalar(LIGHTING.torchIntensity) },
  caveAmbient: { value: LIGHTING.caveAmbient },
  cloudMap: { value: cloudShadowTex }, lightDirW: { value: new THREE.Vector3(0, 1, 0) }, cloudShadow: { value: LIGHTING.cloudShadow },
  cloudY: { value: CLOUD_Y }, cloudScale: { value: 1 / CLOUD_TILE }, cloudOffset: { value: new THREE.Vector2() },
  hazeNear: { value: 50 }, hazeFar: { value: 100 }, hazeOverride: { value: 0 }, hazeColor: { value: new THREE.Color() },
};
const VOX_PARS = `varying vec3 vWPos;
uniform vec3 torchColor, lightDirW, hazeColor; uniform float caveAmbient, cloudShadow, cloudY, cloudScale, hazeNear, hazeFar, hazeOverride;
uniform vec2 cloudOffset; uniform sampler2D cloudMap;
`;
const VOX_LIGHT = `{
  vec4 vox = VOX;
  vec2 cp = vWPos.xz + lightDirW.xz * ((cloudY - vWPos.y) / max(lightDirW.y, 0.2));
  float direct = 1.0 - texture2D(cloudMap, (cp - cloudOffset) * cloudScale).a * cloudShadow;
  reflectedLight.directDiffuse *= direct;
  reflectedLight.directSpecular *= direct * VOX_SPEC;
  reflectedLight.indirectDiffuse *= vox.g;
  reflectedLight.indirectSpecular *= vox.r * vox.g * VOX_SPEC;
  reflectedLight.indirectDiffuse += material.diffuseColor * (vec3(caveAmbient) + torchColor * vox.b);
}`;
const VOX_HAZE = `{
  vec3 toFrag = vWPos - cameraPosition;
  vec3 hc = hazeColor;
  #ifdef ENVMAP_TYPE_CUBE_UV
    if (hazeOverride < 0.5) { vec3 d = normalize(toFrag); d.y = max(d.y, 0.03); hc = textureCubeUV(envMap, envMapRotation * normalize(d), 0.0).rgb; }
  #endif
  float hf = smoothstep(hazeNear, hazeFar, length(toFrag));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, hc, hf * hf);
}`;
function patchVoxel(mat, perVertex, voxUniform, spec = LIGHTING.terrainSpecular) {
  mat.fog = false;
  const vu = voxUniform || { value: new THREE.Vector4(1, 1, 0, 1) };
  mat.userData.vox = vu;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, VOX);
    if (!perVertex) sh.uniforms.voxLight = vu;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;${perVertex ? '\nattribute vec4 light;\nvarying vec4 vVox;' : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;${perVertex ? '\nvVox = light;' : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n#define VOX_SPEC ${spec.toFixed(3)}\n${VOX_PARS}${perVertex ? 'varying vec4 vVox;\n#define VOX vVox' : 'uniform vec4 voxLight;\n#define VOX voxLight'}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${VOX_LIGHT}`)
      .replace('#include <tonemapping_fragment>', `${VOX_HAZE}\n#include <tonemapping_fragment>`);
  };
  mat.customProgramCacheKey = () => (perVertex ? 'vox-vertex' : 'vox-uniform') + spec;
  return mat;
}
// light at an entity's cell, as (ao, sky light, block light, 1)
function cellVox(x, y, z, v) { x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); return v.set(1, skyLight(getSky(x, y, z)), levelLight(getLight(x, y, z)), 1); }

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
  return patchVoxel(m, perVertex, vox, s.spec ?? LIGHTING.terrainSpecular);
}
const CHUNK_MATS = TILE_NAMES.map((n, t) => tileMaterial(t, true));
CHUNK_MATS[T.WATER].side = THREE.DoubleSide; // the surface is also seen from below while swimming
// the chunk shadow twins draw all opaque faces with this one material (index SHADOW_SOLID), cut-outs with their tile material
const SHADOW_SOLID = TILE_NAMES.length, SHADOW_MATS = [...CHUNK_MATS, new THREE.MeshBasicMaterial()];
// water and lava drift: their textures scroll in world space
function scrollFluids(t) {
  const w = TILE_TEX[T.WATER], l = TILE_TEX[T.LAVA];
  w.map.offset.set(t * .011, t * .007); w.normal.offset.set(-t * .023, t * .017); w.orm.offset.copy(w.map.offset);
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
let envTarget = null, envTimer = 0;
function bakeEnvironment() {
  const rt = pmrem.fromScene(envScene, 0, 0.1, 1000);
  scene.environment = handScene.environment = rt.texture;
  if (envTarget) envTarget.dispose();
  envTarget = rt;
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

// ---------- 3D clouds: one 64x64 cell tile of extruded boxes, repeated around the player ----------
const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, depthWrite: true });
cloudMat.userData.fade = { value: new THREE.Vector2(160, 480) };
cloudMat.onBeforeCompile = sh => {
  sh.uniforms.cloudFade = cloudMat.userData.fade;
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCloudPos;').replace('#include <project_vertex>', '#include <project_vertex>\nvCloudPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCloudPos; uniform vec2 cloudFade;')
    .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a *= 1.0 - smoothstep(cloudFade.x, cloudFade.y, length(vCloudPos.xz - cameraPosition.xz));');
};
const cloudGroup = new THREE.Group(); scene.add(cloudGroup);
const cloudTiles = [], cloudBits = new Uint8Array(CLOUD_N * CLOUD_N);
const cloudAt = (i, j) => cloudBits[((j + CLOUD_N) % CLOUD_N) * CLOUD_N + ((i + CLOUD_N) % CLOUD_N)];
function buildCloudGeometry() {
  const P = [], Nm = [], Ix = [];
  for (let j = 0; j < CLOUD_N; j++) for (let i = 0; i < CLOUD_N; i++) {
    if (!cloudAt(i, j)) continue;
    for (const f of FACES) {
      const [dx, dy, dz] = f.dir;
      if (!dy && cloudAt(i + dx, j + dz)) continue; // side hidden by the next cloud cell
      const b = P.length / 3;
      for (const c of f.c) { P.push((i + c[0]) * CLOUD_CELL, c[1] * CLOUD_THICK, (j + c[2]) * CLOUD_CELL); Nm.push(dx, dy, dz); }
      Ix.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nm, 3));
  g.setIndex(Ix); g.computeBoundingSphere(); return g;
}
function paintClouds(seed) {
  const n = new Perlin(seed + 99);
  for (let j = 0; j < CLOUD_N; j++) for (let i = 0; i < CLOUD_N; i++) {
    const a = i / CLOUD_N * Math.PI * 2, b = j / CLOUD_N * Math.PI * 2; // tileable via torus mapping
    const v = n.noise(Math.cos(a) * 2 + 9, Math.sin(a) * 2 + Math.cos(b) * 2, Math.sin(b) * 2) + .5 * n.noise(Math.cos(a) * 5, Math.sin(a) * 5 + Math.cos(b) * 5, Math.sin(b) * 5 + 3);
    cloudBits[j * CLOUD_N + i] = v > .18 ? 1 : 0;
  }
  // shadow mask: the cloud cells upscaled 4x and blurred so cloud shadows get soft edges
  const R = CLOUD_SHADOW_RES, k = R / CLOUD_N;
  let m = new Float32Array(R * R);
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) m[y * R + x] = cloudBits[((y / k) | 0) * CLOUD_N + ((x / k) | 0)];
  for (let pass = 0; pass < 2; pass++) {
    const o = new Float32Array(R * R);
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) { let s = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += m[((y + dy + R) % R) * R + ((x + dx + R) % R)]; o[y * R + x] = s / 25; }
    m = o;
  }
  const ctx = cloudCanvas.getContext('2d'), img = ctx.createImageData(R, R);
  for (let i = 0; i < R * R; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = Math.round(m[i] * 255); }
  ctx.putImageData(img, 0, 0); cloudShadowTex.needsUpdate = true;
  const geo = buildCloudGeometry();
  if (cloudTiles.length) cloudTiles[0].geometry.dispose();
  while (cloudTiles.length) cloudGroup.remove(cloudTiles.pop());
  for (let i = 0; i < 9; i++) { const mm = new THREE.Mesh(geo, cloudMat); mm.renderOrder = 3; cloudGroup.add(mm); cloudTiles.push(mm); }
}

// ---------- day / night ----------
const WATER_FOG = new THREE.Color(0.012, 0.05, 0.14), LAVA_FOG = new THREE.Color(0.9, 0.18, 0.01);
const C = {
  sunNoon: col(LIGHTING.sunNoonColor), sunLow: col(LIGHTING.sunLowColor), moon: col(LIGHTING.moonColor),
  hemiSky: col(LIGHTING.hemiSky), hemiGround: col(LIGHTING.hemiGround), hemiDusk: col(LIGHTING.hemiDuskSky),
  hemiNightSky: col(LIGHTING.hemiNightSky), hemiNightGround: col(LIGHTING.hemiNightGround),
};
const sunDir = new THREE.Vector3(0, 1, 0), lightDir = new THREE.Vector3(0, 1, 0), _tc = new THREE.Color();
let wind = 0, sunStrength = 0, starClock = 0;
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
  // haze over distant terrain; underwater and in lava it becomes a short coloured fog
  const hz = VOX;
  if (inFluid) { hz.hazeOverride.value = 1; hz.hazeColor.value.copy(inFluid === B.WATER ? WATER_FOG : LAVA_FOG); hz.hazeNear.value = inFluid === B.WATER ? 1 : .1; hz.hazeFar.value = inFluid === B.WATER ? 18 + nightVision * 30 : 2.5; }
  else { hz.hazeOverride.value = 0; hz.hazeNear.value = renderDist * CS * LIGHTING.hazeStart; hz.hazeFar.value = renderDist * CS * LIGHTING.hazeEnd; }
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
  // clouds drift with the wind, tiled around the player; a little self-glow keeps their undersides soft
  wind += dt * 1.6; VOX.cloudOffset.value.set(wind, 0);
  cloudGroup.visible = !inFluid;
  const tx = Math.floor((eye.x - wind) / CLOUD_TILE), tz = Math.floor(eye.z / CLOUD_TILE);
  let k = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) cloudTiles[k++].position.set((tx + a) * CLOUD_TILE + wind, CLOUD_Y, (tz + b) * CLOUD_TILE);
  cloudMat.emissive.copy(hemiLight.color).multiplyScalar(0.12 * dayF + 0.01);
  cloudMat.userData.fade.value.set(120 + renderDist * 8, 360 + renderDist * 20);
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
  const D = 250, texel = 2 * LIGHTING.shadowRange / LIGHTING.shadowSize;
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
const selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }));
selBox.visible = false; scene.add(selBox);
const crackTex = new THREE.CanvasTexture(crackCanvas); crackTex.magFilter = crackTex.minFilter = THREE.NearestFilter; crackTex.generateMipmaps = false; crackTex.repeat.set(.1, 1);
const crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
crackMesh.visible = false; scene.add(crackMesh);
function showCrack(x, y, z, stage) {
  if (stage < 0) { crackMesh.visible = false; return; }
  crackMesh.visible = true; crackMesh.position.set(x + .5, y + .5, z + .5); crackTex.offset.x = Math.min(9, stage) / 10;
}

// ---------- geometry helpers ----------
function makeGeo(P, U, I, Nm, extra = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Nm, 3));
  for (const k in extra) g.setAttribute(k, new THREE.Float32BufferAttribute(extra[k][0], extra[k][1]));
  g.setIndex(I); g.computeBoundingSphere(); return g;
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
const dropVox = { value: new THREE.Vector4(1, 1, 0, 1) }, handVox = { value: new THREE.Vector4(1, 1, 0, 1) };
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
const pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAXP);
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
