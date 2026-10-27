'use strict';
// ============================================================
//  Rendering: renderer, voxel shader, sky, particles, held item
// ============================================================
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.25 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.autoClear = false;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9cc8ff, 40, 100);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 1200);
camera.rotation.order = 'YXZ';
const tex = new THREE.CanvasTexture(atlas);
tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
// block light level -> brightness (each step dims by ~18%)
const LIGHT_CURVE = Array.from({ length: 16 }, (_, l) => l ? Math.pow(0.82, 15 - l) : 0);

// ---------- cloud layer data (also used for cloud shadows on the ground) ----------
const CLOUD_Y = 128, CLOUD_CELL = 12, CLOUD_THICK = 4, CLOUD_N = 64, CLOUD_TILE = CLOUD_N * CLOUD_CELL;
// shadow mask: the 64x64 cloud cells upscaled 4x and blurred so cloud shadows get soft edges
const CLOUD_SHADOW_RES = 256;
const cloudCanvas = document.createElement('canvas'); cloudCanvas.width = cloudCanvas.height = CLOUD_SHADOW_RES;
const cloudShadowTex = new THREE.CanvasTexture(cloudCanvas);
cloudShadowTex.wrapS = cloudShadowTex.wrapT = THREE.RepeatWrapping; cloudShadowTex.flipY = false;
cloudShadowTex.magFilter = cloudShadowTex.minFilter = THREE.LinearFilter; cloudShadowTex.generateMipmaps = false;

// ---------- sun shadow state shared by every voxel material ----------
const SHADOW = { on: true, size: isTouch ? 1024 : 2048, range: isTouch ? 40 : 64 };
const sunDir = new THREE.Vector3(0, 1, 0), shadowCenter = new THREE.Vector3(), shadowMatrix = new THREE.Matrix4(), cloudOffset = new THREE.Vector2();
const shadowTarget = new THREE.WebGLRenderTarget(SHADOW.size, SHADOW.size, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });

// Chunk shader. light attribute = (ambient occlusion * face shade, sky light, block light, 1 for one-sided faces)
// Sunlight is the sky term; it is dimmed on faces turned away from the sun, in the shadow map and under clouds.
const VOXEL_VS = `attribute vec4 light; varying vec2 vUv; varying vec4 vL; varying float vDepth; varying vec3 vWorld;
void main() { vUv = uv; vL = light; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vec4 mv = viewMatrix * wp; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`;
const VOXEL_FS = `#include <packing>
uniform sampler2D map, shadowMap, cloudMap;
uniform float daylight, minLight, nightVision, alphaTest, opacity, fogNear, fogFar;
uniform float sunStrength, useShadowMap, shadowTexel, shadowRange, cloudY, cloudScale, cloudShadow;
uniform vec3 fogColor, sunDir, shadowCenter; uniform vec2 cloudOffset; uniform mat4 shadowMatrix;
varying vec2 vUv; varying vec4 vL; varying float vDepth; varying vec3 vWorld;
float occluded(vec2 uv, float z) { return step(unpackRGBAToDepth(texture2D(shadowMap, uv)), z); }
float shadowAmount(vec3 n) {
  vec3 c = (shadowMatrix * vec4(vWorld + n * 0.07, 1.0)).xyz;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 0.0;
  float z = c.z - 0.0004, d = shadowTexel * 0.75;
  return (occluded(c.xy, z) + occluded(c.xy + vec2(d, d), z) + occluded(c.xy + vec2(-d, d), z) + occluded(c.xy + vec2(d, -d), z) + occluded(c.xy + vec2(-d, -d), z)) / 5.0;
}
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < alphaTest) discard;
  float sun = 1.0;
  if (sunStrength > 0.0 && vL.g > 0.0) {
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    float ndl = dot(n, sunDir);
    if (vL.a < 0.5 && ndl < 0.0) { n = -n; ndl = -ndl; }
    float vis = 1.0 - (1.0 - smoothstep(0.0, 0.3, ndl)) * 0.6;
    if (useShadowMap > 0.5 && ndl > 0.0) vis *= 1.0 - shadowAmount(n) * (1.0 - smoothstep(shadowRange * 0.7, shadowRange * 0.92, distance(vWorld.xz, shadowCenter.xz)));
    vec2 cp = vWorld.xz + sunDir.xz * ((cloudY - vWorld.y) / max(sunDir.y, 0.25));
    vis *= 1.0 - texture2D(cloudMap, (cp - cloudOffset) * cloudScale).a * cloudShadow;
    sun = 1.0 - sunStrength * (1.0 - vis);
  }
  float sky = vL.g * daylight * sun, bl = vL.b;
  float l = mix(max(max(sky, bl), minLight), 1.0, nightVision);
  float warm = clamp((bl - sky) * 1.6, 0.0, 1.0) * (1.0 - nightVision);
  vec3 c = t.rgb * vL.r * l * mix(vec3(1.0), vec3(1.1, 0.92, 0.72), warm);
  gl_FragColor = vec4(mix(c, fogColor, smoothstep(fogNear, fogFar, vDepth)), t.a * opacity);
}`;
function voxelMaterial(o) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex }, daylight: { value: 1 }, minLight: { value: .09 }, nightVision: { value: 0 }, alphaTest: { value: o.alphaTest }, opacity: { value: o.opacity },
      fogColor: { value: new THREE.Color() }, fogNear: { value: 50 }, fogFar: { value: 100 },
      shadowMap: { value: shadowTarget.texture }, shadowMatrix: { value: shadowMatrix }, sunDir: { value: sunDir }, shadowCenter: { value: shadowCenter },
      sunStrength: { value: 0 }, useShadowMap: { value: 0 }, shadowTexel: { value: 1 / SHADOW.size }, shadowRange: { value: SHADOW.range },
      cloudMap: { value: cloudShadowTex }, cloudY: { value: CLOUD_Y }, cloudScale: { value: 1 / CLOUD_TILE }, cloudShadow: { value: .7 }, cloudOffset: { value: cloudOffset },
    },
    vertexShader: VOXEL_VS, fragmentShader: VOXEL_FS, extensions: { derivatives: true },
    transparent: !!o.transparent, depthWrite: !o.transparent, side: o.side || THREE.FrontSide,
  });
}
const chunkMat = voxelMaterial({ alphaTest: .5, opacity: 1 });
const fluidMat = voxelMaterial({ alphaTest: .02, opacity: .78, transparent: true, side: THREE.DoubleSide });
const VOXEL_MATS = [chunkMat, fluidMat];

// ---------- sky ----------
function glowTex(draw) { const c = document.createElement('canvas'); c.width = c.height = 32; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t; }
const sunTex = glowTex(x => { x.fillStyle = 'rgba(255,240,180,.25)'; x.fillRect(2, 2, 28, 28); x.fillStyle = '#fff6c8'; x.fillRect(8, 8, 16, 16); x.fillStyle = '#ffffff'; x.fillRect(10, 10, 12, 12); });
const moonTex = glowTex(x => { x.fillStyle = '#d8dce6'; x.fillRect(9, 9, 14, 14); x.fillStyle = '#aab0bf'; x.fillRect(12, 12, 3, 3); x.fillRect(17, 16, 4, 3); x.fillRect(13, 18, 2, 2); });
const skyMat = t => new THREE.MeshBasicMaterial({ map: t, transparent: true, fog: false, depthWrite: false });
const sun = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), skyMat(sunTex)); scene.add(sun);
const moon = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), skyMat(moonTex)); scene.add(moon);
sun.renderOrder = moon.renderOrder = -2;
const starGeo = new THREE.BufferGeometry(); { const a = []; const r = mulberry32(42); for (let i = 0; i < 900; i++) { const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u); a.push(s * Math.cos(th) * 500, u * 500, s * Math.sin(th) * 500); } starGeo.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); }
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false });
const stars = new THREE.Points(starGeo, starMat); stars.renderOrder = -3; scene.add(stars);
// ---------- 3D clouds: one 64x64 cell tile of extruded boxes, repeated around the player ----------
const CLOUD_VS = `attribute float shade; varying float vShade; varying float vDist;
void main() { vShade = shade; vec4 wp = modelMatrix * vec4(position, 1.0); vDist = length(wp.xz - cameraPosition.xz); gl_Position = projectionMatrix * viewMatrix * wp; }`;
const CLOUD_FS = `uniform vec3 cloudColor, fogColor; uniform float fadeNear, fadeFar; varying float vShade; varying float vDist;
void main() { float f = smoothstep(fadeNear, fadeFar, vDist); gl_FragColor = vec4(mix(cloudColor * vShade, fogColor, f * 0.6), 1.0 - f); }`;
const cloudMat = new THREE.ShaderMaterial({
  uniforms: { cloudColor: { value: new THREE.Color(1, 1, 1) }, fogColor: { value: new THREE.Color() }, fadeNear: { value: 160 }, fadeFar: { value: 480 } },
  vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: true,
});
const cloudGroup = new THREE.Group(); scene.add(cloudGroup);
const cloudTiles = [], cloudBits = new Uint8Array(CLOUD_N * CLOUD_N);
const cloudAt = (i, j) => cloudBits[((j + CLOUD_N) % CLOUD_N) * CLOUD_N + ((i + CLOUD_N) % CLOUD_N)];
function buildCloudGeometry() {
  const P = [], S = [], Ix = [];
  for (let j = 0; j < CLOUD_N; j++) for (let i = 0; i < CLOUD_N; i++) {
    if (!cloudAt(i, j)) continue;
    for (const f of FACES) {
      const [dx, dy, dz] = f.dir;
      if (!dy && cloudAt(i + dx, j + dz)) continue; // side hidden by the next cloud cell
      const shade = dy > 0 ? 1 : dy < 0 ? .74 : dx ? .86 : .93, b = P.length / 3;
      for (const c of f.c) { P.push((i + c[0]) * CLOUD_CELL, c[1] * CLOUD_THICK, (j + c[2]) * CLOUD_CELL); S.push(shade); }
      Ix.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('shade', new THREE.Float32BufferAttribute(S, 1));
  g.setIndex(Ix); g.computeBoundingSphere(); return g;
}
function paintClouds(seed) {
  const n = new Perlin(seed + 99);
  for (let j = 0; j < CLOUD_N; j++) for (let i = 0; i < CLOUD_N; i++) {
    const a = i / CLOUD_N * Math.PI * 2, b = j / CLOUD_N * Math.PI * 2; // tileable via torus mapping
    const v = n.noise(Math.cos(a) * 2 + 9, Math.sin(a) * 2 + Math.cos(b) * 2, Math.sin(b) * 2) + .5 * n.noise(Math.cos(a) * 5, Math.sin(a) * 5 + Math.cos(b) * 5, Math.sin(b) * 5 + 3);
    cloudBits[j * CLOUD_N + i] = v > .18 ? 1 : 0;
  }
  const R = CLOUD_SHADOW_RES, k = R / CLOUD_N;
  let m = new Float32Array(R * R);
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) m[y * R + x] = cloudBits[((y / k) | 0) * CLOUD_N + ((x / k) | 0)];
  for (let pass = 0; pass < 2; pass++) { // wrap-around box blur
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
  for (let k = 0; k < 9; k++) { const m = new THREE.Mesh(geo, cloudMat); m.renderOrder = 2; cloudGroup.add(m); cloudTiles.push(m); }
}
const DAY_SKY = new THREE.Color(0.53, 0.75, 1.0), NIGHT_SKY = new THREE.Color(0.012, 0.018, 0.05), DUSK = new THREE.Color(0.98, 0.52, 0.28), WATER_FOG = new THREE.Color(0.06, 0.16, 0.4), LAVA_FOG = new THREE.Color(0.8, 0.25, 0.02);
const CLOUD_DUSK = new THREE.Color(1, 0.72, 0.55), CLOUD_NIGHT = new THREE.Color(0.11, 0.13, 0.19);
const skyCol = new THREE.Color(), _dayCloud = new THREE.Color();
let wind = 0, sunStrength = 0;
// returns daylight 0.16..1 and updates fog, sky objects, clouds and voxel uniforms
function updateEnvironment(dt, t, eye, inFluid, nightVision) {
  const ang = t * Math.PI * 2, sunH = Math.sin(ang);
  const daylight = 0.16 + 0.84 * smooth(-0.2, 0.3, sunH), dusk = Math.exp(-Math.pow(sunH / 0.16, 2));
  skyCol.copy(NIGHT_SKY).lerp(DAY_SKY, smooth(-0.25, 0.3, sunH)).lerp(DUSK, dusk * 0.45);
  if (nightVision) skyCol.lerp(DAY_SKY, .5 * nightVision);
  const fog = scene.fog;
  if (inFluid === B.WATER) { fog.color.copy(WATER_FOG).multiplyScalar(Math.max(daylight, nightVision) + .2); fog.near = 1; fog.far = 18 + nightVision * 30; }
  else if (inFluid === B.LAVA) { fog.color.copy(LAVA_FOG); fog.near = .1; fog.far = 2.5; }
  else { fog.color.copy(skyCol); fog.near = renderDist * CS * 0.45; fog.far = renderDist * CS * 0.95; }
  renderer.setClearColor(fog.color);
  // sun direction moves in quarter-degree steps so shadow edges don't shimmer every frame
  const q = Math.PI / 720, sa = Math.round(ang / q) * q;
  sunDir.set(Math.cos(sa), Math.sin(sa), 0.15).normalize();
  sunStrength = SHADOW.on ? 0.45 * smooth(0.0, 0.2, sunH) : 0;
  wind += dt * 1.6; cloudOffset.set(wind, 0);
  for (const m of VOXEL_MATS) {
    const u = m.uniforms; u.daylight.value = daylight; u.nightVision.value = nightVision * .85; u.fogColor.value.copy(fog.color); u.fogNear.value = fog.near; u.fogFar.value = fog.far;
    u.sunStrength.value = sunStrength; u.useShadowMap.value = sunStrength > 0 ? 1 : 0;
  }
  // clouds: tile the cloud mesh around the player, drifting with the wind
  cloudGroup.visible = !inFluid;
  const tx = Math.floor((eye.x - wind) / CLOUD_TILE), tz = Math.floor(eye.z / CLOUD_TILE);
  let k = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) cloudTiles[k++].position.set((tx + a) * CLOUD_TILE + wind, CLOUD_Y, (tz + b) * CLOUD_TILE);
  const cu = cloudMat.uniforms;
  cu.cloudColor.value.copy(CLOUD_NIGHT).lerp(_dayCloud.setRGB(1, 1, 1), smooth(-0.2, 0.25, sunH)).lerp(CLOUD_DUSK, dusk * .55);
  cu.fogColor.value.copy(skyCol); cu.fadeNear.value = 120 + renderDist * 8; cu.fadeFar.value = 360 + renderDist * 20;
  starMat.opacity = 1 - smooth(-0.3, 0.05, sunH);
  sun.position.set(eye.x + Math.cos(ang) * 400, eye.y + sunH * 400, eye.z + 60); sun.lookAt(eye);
  moon.position.set(eye.x - Math.cos(ang) * 400, eye.y - sunH * 400, eye.z - 60); moon.lookAt(eye);
  stars.position.copy(eye); stars.rotation.z = ang;
  return daylight;
}

// ---------- sun shadow map, rendered from the sun around the player ----------
const shadowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 420);
const depthCutout = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: .5 });
const depthSolid = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
const SHADOW_BIAS = new THREE.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
const _clear = new THREE.Color(), _sv = new THREE.Vector3();
// the player has no visible body in first person, but it still casts a shadow (layer 2 only)
const shadowBody = new THREE.Group(); scene.add(shadowBody);
const bodyLimbs = [];
{
  const box = (w, h, d, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d)); m.position.set(x, y, z); m.layers.set(2); parent.add(m); return m; };
  box(.5, .5, .5, 0, 1.56, 0, shadowBody); box(.5, .74, .26, 0, .96, 0, shadowBody);
  for (const [x, y, w] of [[-.37, 1.32, .22], [.37, 1.32, .22], [-.13, .62, .24], [.13, .62, .24]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0); shadowBody.add(pivot);
    box(w, y > 1 ? .7 : .62, w, 0, -(y > 1 ? .33 : .31), 0, pivot); bodyLimbs.push(pivot);
  }
}
function setShadowQuality(on) {
  SHADOW.on = on;
  for (const m of VOXEL_MATS) { m.uniforms.shadowTexel.value = 1 / SHADOW.size; m.uniforms.shadowRange.value = SHADOW.range; }
}
function renderShadows(px, py, pz, yaw, hv, showBody) {
  if (!SHADOW.on || sunStrength <= 0) return;
  const R = SHADOW.range;
  shadowCam.left = shadowCam.bottom = -R; shadowCam.right = shadowCam.top = R; shadowCam.updateProjectionMatrix();
  shadowCam.position.copy(sunDir).multiplyScalar(200); shadowCam.lookAt(0, 0, 0); shadowCam.updateMatrixWorld();
  // snap the centre to whole shadow-map texels so shadow edges don't crawl as the player walks
  const texel = 2 * R / SHADOW.size;
  _sv.set(px, py, pz).applyMatrix4(shadowCam.matrixWorldInverse);
  _sv.x = Math.round(_sv.x / texel) * texel; _sv.y = Math.round(_sv.y / texel) * texel;
  _sv.applyMatrix4(shadowCam.matrixWorld);
  shadowCam.position.copy(_sv).addScaledVector(sunDir, 200); shadowCam.updateMatrixWorld();
  shadowCenter.set(px, py, pz);
  shadowBody.visible = showBody; shadowBody.position.set(px, py, pz); shadowBody.rotation.y = yaw;
  const swingA = reduceMotion ? 0 : Math.sin(bob * 2) * Math.min(1, hv / 4) * .7;
  bodyLimbs[0].rotation.x = bodyLimbs[3].rotation.x = swingA; bodyLimbs[1].rotation.x = bodyLimbs[2].rotation.x = -swingA;
  renderer.getClearColor(_clear); const alpha = renderer.getClearAlpha();
  renderer.setRenderTarget(shadowTarget); renderer.setClearColor(0xffffff, 1); renderer.clear();
  scene.overrideMaterial = depthCutout; shadowCam.layers.set(1); renderer.render(scene, shadowCam);
  scene.overrideMaterial = depthSolid; shadowCam.layers.set(2); renderer.render(scene, shadowCam);
  scene.overrideMaterial = null; renderer.setRenderTarget(null); renderer.setClearColor(_clear, alpha);
  shadowMatrix.copy(SHADOW_BIAS).multiply(shadowCam.projectionMatrix).multiply(shadowCam.matrixWorldInverse);
}

// ---------- selection & breaking overlay ----------
const selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }));
selBox.visible = false; scene.add(selBox);
const crackTex = new THREE.CanvasTexture(crackCanvas); crackTex.magFilter = crackTex.minFilter = THREE.NearestFilter; crackTex.generateMipmaps = false; crackTex.repeat.set(.1, 1);
const crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false }));
crackMesh.visible = false; scene.add(crackMesh);
function showCrack(x, y, z, stage) {
  if (stage < 0) { crackMesh.visible = false; return; }
  crackMesh.visible = true; crackMesh.position.set(x + .5, y + .5, z + .5); crackTex.offset.x = Math.min(9, stage) / 10;
}

// ---------- geometry helpers ----------
function makeGeo(P, U, C, I, attr = 'color', size = 3) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute(attr, new THREE.Float32BufferAttribute(C, size));
  g.setIndex(I); g.computeBoundingSphere(); return g;
}
// a single centered cube with face shading baked into vertex colours (hand, drops, TNT)
function blockGeometry(id) {
  const bd = BLOCKS[id], P = [], U = [], C = [], Ix = [];
  FACES.forEach((f, fi) => {
    const tile = faceTile(bd, fi, 5), b = P.length / 3;
    for (const c of f.c) { P.push(c[0] - .5, c[1] - .5, c[2] - .5); U.push(...tileUV(tile, c[3], c[4])); C.push(f.shade, f.shade, f.shade); }
    Ix.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
  });
  return makeGeo(P, U, C, Ix);
}
// box with per-face shade in vertex colours, for mobs
function shadedBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d), n = g.attributes.normal, c = [];
  for (let i = 0; i < n.count; i++) { const ny = n.getY(i), nx = n.getX(i); const s = ny > .5 ? 1 : ny < -.5 ? .5 : Math.abs(nx) > .5 ? .66 : .82; c.push(s, s, s); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); return g;
}
const itemTexCache = {}, flatMatCache = {};
function itemTexture(id) { if (!itemTexCache[id]) { const t = new THREE.CanvasTexture(ITEM16[id]); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; itemTexCache[id] = t; } return itemTexCache[id]; }
function flatItemMaterial(id) { return flatMatCache[id] || (flatMatCache[id] = new THREE.MeshBasicMaterial({ map: itemTexture(id), alphaTest: .5, side: THREE.DoubleSide })); }
const planeGeo = new THREE.PlaneGeometry(1, 1);
const dropBlockMat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true });
const blockGeoCache = {};
const cachedBlockGeo = id => blockGeoCache[id] || (blockGeoCache[id] = blockGeometry(id));

// ---------- particles ----------
const MAXP = 500;
const pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAXP);
pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); pMesh.frustumCulled = false;
{ const c = new THREE.Color(1, 1, 1); for (let i = 0; i < MAXP; i++) pMesh.setColorAt(i, c); }
pMesh.count = 0; scene.add(pMesh);
const particles = []; const _m = new THREE.Matrix4(), _c = new THREE.Color();
function spawnParticles(x, y, z, col, n, spread = 1, speed = 3, opts = {}) {
  for (let i = 0; i < n && particles.length < MAXP; i++) {
    const k = 0.75 + Math.random() * 0.35;
    particles.push({ p: new THREE.Vector3(x + (Math.random() - .5) * spread, y + (Math.random() - .5) * spread, z + (Math.random() - .5) * spread),
      v: new THREE.Vector3((Math.random() - .5) * speed, opts.up ?? Math.random() * speed * 1.2, (Math.random() - .5) * speed),
      life: (opts.life || 0.6) + Math.random() * 0.6, g: opts.g ?? 18, glow: !!opts.glow, size: opts.size || 1, c: [col[0] * k, col[1] * k, col[2] * k] });
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
    const s = Math.min(1, q.life * 2.5) * q.size, l = q.glow ? 1 : light;
    _m.makeScale(s, s, s).setPosition(q.p); pMesh.setMatrixAt(n, _m); _c.setRGB(q.c[0] * l, q.c[1] * l, q.c[2] * l); pMesh.setColorAt(n, _c); n++;
  }
  pMesh.count = n; pMesh.instanceMatrix.needsUpdate = true; if (pMesh.instanceColor) pMesh.instanceColor.needsUpdate = true;
}

// ---------- held item (drawn in its own scene over the world) ----------
const handScene = new THREE.Scene(), handCam = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 10);
const handBlockMat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true });
const armMat = new THREE.MeshBasicMaterial({ color: 0xc69476, vertexColors: true });
const handHolder = new THREE.Group(); handScene.add(handHolder);
let handMesh = null, handKind = '', handId = -1, swing = 0, bob = 0, equip = 0, useAnim = 0;
function setHand(id) {
  id = id || 0;
  if (id === handId) return;
  handId = id; equip = 1;
  if (handMesh) handHolder.remove(handMesh);
  if (!id) { handMesh = new THREE.Mesh(shadedBox(.28, .28, 1.0), armMat); handKind = 'arm'; }
  else if (isFlatItem(id)) { handMesh = new THREE.Mesh(planeGeo, flatItemMaterial(id)); handKind = 'flat'; }
  else { handMesh = new THREE.Mesh(cachedBlockGeo(id), handBlockMat); handKind = 'block'; }
  handHolder.add(handMesh);
}
function updateHand(dt, hv, onGround, light, using) {
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
  const l = Math.max(light, .3);
  handBlockMat.color.setScalar(l); armMat.color.setRGB(.78 * l, .58 * l, .46 * l);
  for (const k in flatMatCache) flatMatCache[k].color.setScalar(l);
}
