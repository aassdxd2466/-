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

// Chunk shader: light attribute = (ambient occlusion * face shade, sky light, block light)
const VOXEL_VS = `attribute vec3 light; varying vec2 vUv; varying vec3 vL; varying float vDepth;
void main() { vUv = uv; vL = light; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`;
const VOXEL_FS = `uniform sampler2D map; uniform float daylight, minLight, nightVision, alphaTest, opacity; uniform vec3 fogColor; uniform float fogNear, fogFar;
varying vec2 vUv; varying vec3 vL; varying float vDepth;
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < alphaTest) discard;
  float sky = vL.g * daylight, bl = vL.b;
  float l = mix(max(max(sky, bl), minLight), 1.0, nightVision);
  float warm = clamp((bl - sky) * 1.6, 0.0, 1.0) * (1.0 - nightVision);
  vec3 c = t.rgb * vL.r * l * mix(vec3(1.0), vec3(1.1, 0.92, 0.72), warm);
  gl_FragColor = vec4(mix(c, fogColor, smoothstep(fogNear, fogFar, vDepth)), t.a * opacity);
}`;
function voxelMaterial(o) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, daylight: { value: 1 }, minLight: { value: .09 }, nightVision: { value: 0 }, alphaTest: { value: o.alphaTest }, opacity: { value: o.opacity },
      fogColor: { value: new THREE.Color() }, fogNear: { value: 50 }, fogFar: { value: 100 } },
    vertexShader: VOXEL_VS, fragmentShader: VOXEL_FS, transparent: !!o.transparent, depthWrite: !o.transparent, side: o.side || THREE.FrontSide,
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
const cloudCanvas = document.createElement('canvas'); cloudCanvas.width = cloudCanvas.height = 64;
const cloudTex = new THREE.CanvasTexture(cloudCanvas); cloudTex.magFilter = cloudTex.minFilter = THREE.NearestFilter; cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping; cloudTex.generateMipmaps = false;
const CLOUD_SIZE = 64 * 14;
const cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false });
const clouds = new THREE.Mesh(new THREE.PlaneGeometry(CLOUD_SIZE, CLOUD_SIZE), cloudMat); clouds.rotation.x = -Math.PI / 2; scene.add(clouds);
function paintClouds(seed) {
  const x = cloudCanvas.getContext('2d'), n = new Perlin(seed + 99), img = x.createImageData(64, 64);
  for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
    const a = i / 64 * Math.PI * 2, b = j / 64 * Math.PI * 2; // tileable via torus mapping
    const v = n.noise(Math.cos(a) * 2 + 9, Math.sin(a) * 2 + Math.cos(b) * 2, Math.sin(b) * 2) + .5 * n.noise(Math.cos(a) * 5, Math.sin(a) * 5 + Math.cos(b) * 5, Math.sin(b) * 5 + 3);
    const k = (j * 64 + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = v > .18 ? 255 : 0;
  }
  x.putImageData(img, 0, 0); cloudTex.needsUpdate = true;
}
const DAY_SKY = new THREE.Color(0.53, 0.75, 1.0), NIGHT_SKY = new THREE.Color(0.012, 0.018, 0.05), DUSK = new THREE.Color(0.98, 0.52, 0.28), WATER_FOG = new THREE.Color(0.06, 0.16, 0.4), LAVA_FOG = new THREE.Color(0.8, 0.25, 0.02);
const skyCol = new THREE.Color();
let wind = 0;
// returns daylight 0.16..1 and updates fog, sky objects and voxel uniforms
function updateEnvironment(dt, t, eye, inFluid, nightVision) {
  const ang = t * Math.PI * 2, sunH = Math.sin(ang);
  const daylight = 0.16 + 0.84 * smooth(-0.2, 0.3, sunH);
  skyCol.copy(NIGHT_SKY).lerp(DAY_SKY, smooth(-0.25, 0.3, sunH)).lerp(DUSK, Math.exp(-Math.pow(sunH / 0.16, 2)) * 0.45);
  if (nightVision) skyCol.lerp(DAY_SKY, .5 * nightVision);
  const fog = scene.fog;
  if (inFluid === B.WATER) { fog.color.copy(WATER_FOG).multiplyScalar(Math.max(daylight, nightVision) + .2); fog.near = 1; fog.far = 18 + nightVision * 30; }
  else if (inFluid === B.LAVA) { fog.color.copy(LAVA_FOG); fog.near = .1; fog.far = 2.5; }
  else { fog.color.copy(skyCol); fog.near = renderDist * CS * 0.45; fog.far = renderDist * CS * 0.95; }
  renderer.setClearColor(fog.color);
  for (const m of VOXEL_MATS) { const u = m.uniforms; u.daylight.value = daylight; u.nightVision.value = nightVision * .85; u.fogColor.value.copy(fog.color); u.fogNear.value = fog.near; u.fogFar.value = fog.far; }
  cloudMat.color.setScalar(Math.max(daylight, .25));
  starMat.opacity = 1 - smooth(-0.3, 0.05, sunH);
  sun.position.set(eye.x + Math.cos(ang) * 400, eye.y + sunH * 400, eye.z + 60); sun.lookAt(eye);
  moon.position.set(eye.x - Math.cos(ang) * 400, eye.y - sunH * 400, eye.z - 60); moon.lookAt(eye);
  stars.position.copy(eye); stars.rotation.z = ang;
  wind += dt * 1.6; clouds.position.set(eye.x, 124, eye.z); cloudTex.offset.set((eye.x + wind) / CLOUD_SIZE, -eye.z / CLOUD_SIZE);
  return daylight;
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
function makeGeo(P, U, C, I, attr = 'color') {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute(attr, new THREE.Float32BufferAttribute(C, 3));
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
