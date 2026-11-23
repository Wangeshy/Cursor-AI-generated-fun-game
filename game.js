import * as THREE from "three";

const ARENA = 18;
const PLAYER_R = 0.42;
const ENEMY_R = 0.58;
const PLAYER_SPEED = 8.4;
const TURN_SPEED = 3.15;
const EYE = 1.62;
const PLAYER_COOLDOWN = 0.36;
const PLAYER_DAMAGE = 20;
const ENEMY_DAMAGE = 12;

const obstacles = [
  { minX: -4.8, maxX: 4.8, minZ: -0.42, maxZ: 0.42, h: 2.25 },
  { minX: -1.3, maxX: 1.3, minZ: -1.3, maxZ: 1.3, h: 3.55 },
  { minX: -11.6, maxX: -8.5, minZ: -4.8, maxZ: -1.8, h: 2.55 },
  { minX: 8.6, maxX: 11.6, minZ: -5.4, maxZ: -2.2, h: 2.9 },
  { minX: -11.4, maxX: -8.2, minZ: 2.2, maxZ: 5.5, h: 2.4 },
  { minX: 7.6, maxX: 10.8, minZ: 3.0, maxZ: 6.5, h: 3.15 },
  { minX: -2.4, maxX: 2.4, minZ: -12.7, maxZ: -11.35, h: 1.12 },
  { minX: -2.4, maxX: 2.4, minZ: 11.35, maxZ: 12.7, h: 1.12 },
];

const patrol = [
  [-12.5, 12.2],
  [12.5, 12.2],
  [12.5, -12.2],
  [-12.5, -12.2],
];

const keys = {};
const bullets = [];
const effects = [];

const player = {
  x: -14.2,
  z: 14.2,
  yaw: -Math.PI / 4,
  pitch: 0,
  vx: 0,
  vz: 0,
  health: 100,
  cooldown: 0,
};

const enemy = {
  x: -12.5,
  z: 12.2,
  health: 100,
  cooldown: 0,
  windup: 0,
  flash: 0,
  fall: 0,
  facing: 0,
  recoil: 0,
  moved: 0,
  fx: 0,
  fz: 0,
  lostSight: 0,
  stuck: 0,
  goal: null,
  goalLock: 0,
  hasLos: false,
  patrolIndex: 0,
};

let mode = "menu";
let time = 0;
let matchTime = 0;
let grace = 0;
let shake = 0;
let hurtFlash = 0;
let endBlend = 0;
let toastAt = 0;

const $ = (id) => document.getElementById(id);
const view = $("view");
const hurtEl = $("hurt");
const fadeEl = $("fade");
const hudEl = $("hud");
const menuEl = $("menu");
const pauseEl = $("pause");
const endEl = $("end");
const enemyNum = $("enemy-num");
const playerNum = $("player-num");
const enemyFill = $("enemy-fill");
const playerFill = $("player-fill");
const youCard = document.querySelector(".health.you");
const clockEl = $("clock");
const cooldownFill = $("cooldown-fill");
const lockEl = $("lock");
const trackerEl = $("tracker");
const hitEl = $("hitmarker");
const toastEl = $("toast");
const radar = $("radar");
const radarCtx = radar.getContext("2d");

const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x07080c);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080c);
scene.fog = new THREE.Fog(0x07080c, 26, 62);

const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.08, 140);
camera.rotation.order = "YXZ";

const bulletGeo = new THREE.SphereGeometry(1, 12, 12);
const sparkGeo = new THREE.SphereGeometry(0.12, 8, 8);
const playerShotMat = new THREE.MeshBasicMaterial({ color: 0xb8fff4 });
const enemyShotMat = new THREE.MeshBasicMaterial({ color: 0xffa033 });

const playerFlash = new THREE.PointLight(0xc8fff6, 0, 7, 2);
const enemyFlash = new THREE.PointLight(0xff7a32, 0, 8, 2);
scene.add(playerFlash, enemyFlash);

const sfx = {
  ctx: null,
  ready() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!this.ctx) this.ctx = new AC();
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },
  blip(freq, dur, type, vol, slideTo) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  },
  noise(dur, vol, hp) {
    const ctx = this.ready();
    if (!ctx) return;
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = hp;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  },
  playerShot() {
    this.noise(0.07, 0.16, 900);
    this.blip(360, 0.08, "square", 0.045, 90);
  },
  enemyShot() {
    this.noise(0.12, 0.12, 380);
    this.blip(160, 0.16, "sawtooth", 0.04, 55);
  },
  confirm() {
    this.blip(540, 0.07, "square", 0.05, 240);
  },
  hurt() {
    this.noise(0.14, 0.2, 180);
    this.blip(110, 0.18, "triangle", 0.07, 48);
  },
  windup() {
    this.blip(620, 0.1, "square", 0.03, 860);
  },
  win() {
    this.blip(440, 0.1, "square", 0.05, 440);
    setTimeout(() => this.blip(660, 0.16, "square", 0.05, 660), 110);
  },
  lose() {
    this.blip(196, 0.28, "sawtooth", 0.05, 48);
  },
};

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function dampAngle(current, target, dt, speed) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-speed * dt));
}

function circleBlocked(x, z, radius, self) {
  if (Math.abs(x) > ARENA - radius || Math.abs(z) > ARENA - radius) return true;
  for (const box of obstacles) {
    const cx = clamp(x, box.minX, box.maxX);
    const cz = clamp(z, box.minZ, box.maxZ);
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  if (mode === "play" && self !== "player" && player.health > 0) {
    const dx = x - player.x;
    const dz = z - player.z;
    const reach = radius + PLAYER_R;
    if (dx * dx + dz * dz < reach * reach) return true;
  }
  if (mode === "play" && self !== "enemy" && enemy.health > 0) {
    const dx = x - enemy.x;
    const dz = z - enemy.z;
    const reach = radius + ENEMY_R;
    if (dx * dx + dz * dz < reach * reach) return true;
  }
  return false;
}

function tryMove(body, mx, mz, radius, self) {
  if (!circleBlocked(body.x + mx, body.z, radius, self)) body.x += mx;
  if (!circleBlocked(body.x, body.z + mz, radius, self)) body.z += mz;
}

function steer(x, z, dx, dz, radius) {
  const len = Math.hypot(dx, dz);
  if (len < 1e-5) return { x: 0, z: 0 };
  dx /= len;
  dz /= len;
  const reach = radius + 1.45;
  const angles = [0, 0.6, -0.6, 1.15, -1.15, 1.8, -1.8, 2.5, -2.5, Math.PI];
  for (const angle of angles) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const rx = dx * c - dz * s;
    const rz = dx * s + dz * c;
    if (!circleBlocked(x + rx * reach, z + rz * reach, radius, "enemy")) return { x: rx, z: rz };
  }
  return { x: 0, z: 0 };
}

function segmentT(x0, y0, z0, x1, y1, z1, minX, minY, minZ, maxX, maxY, maxZ) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  let tmin = 0;
  let tmax = 1;
  const dims = [
    [dx, x0, minX, maxX],
    [dy, y0, minY, maxY],
    [dz, z0, minZ, maxZ],
  ];
  for (const [d, p, mn, mx] of dims) {
    if (Math.abs(d) < 1e-8) {
      if (p < mn || p > mx) return null;
    } else {
      let t1 = (mn - p) / d;
      let t2 = (mx - p) / d;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

function sphereT(x0, y0, z0, x1, y1, z1, cx, cy, cz, radius) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const fz = z0 - cz;
  const c = fx * fx + fy * fy + fz * fz - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-8) return null;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > 1) return null;
  return t;
}

function lineClear(x0, y0, z0, x1, y1, z1) {
  for (const box of obstacles) {
    const hit = segmentT(x0, y0, z0, x1, y1, z1, box.minX, 0, box.minZ, box.maxX, box.h, box.maxZ);
    if (hit !== null) return false;
  }
  return true;
}

function buildArena() {
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x141820, roughness: 0.94, metalness: 0.05 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x191d29, roughness: 0.78, metalness: 0.22 });
  const coverMat = new THREE.MeshStandardMaterial({ color: 0x2b3344, roughness: 0.62, metalness: 0.32 });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xff4b2b,
    emissive: 0xff2a18,
    emissiveIntensity: 0.65,
    roughness: 0.4,
  });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2, 0.5, ARENA * 2), floorMat);
  floor.position.y = -0.25;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(ARENA * 2, 18, 0x5a3028, 0x2a303c);
  grid.position.y = 0.012;
  scene.add(grid);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(5.4, 5.55, 80),
    new THREE.MeshBasicMaterial({ color: 0xff4b2b, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);

  const thickness = 1;
  const height = 5.6;
  const span = ARENA * 2 + thickness;
  const wallGeoX = new THREE.BoxGeometry(span, height, thickness);
  const wallGeoZ = new THREE.BoxGeometry(thickness, height, span);
  const places = [
    [0, height / 2, ARENA + thickness / 2, wallGeoX],
    [0, height / 2, -(ARENA + thickness / 2), wallGeoX],
    [ARENA + thickness / 2, height / 2, 0, wallGeoZ],
    [-(ARENA + thickness / 2), height / 2, 0, wallGeoZ],
  ];
  for (const [x, y, z, geo] of places) {
    const wall = new THREE.Mesh(geo, wallMat);
    wall.position.set(x, y, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
  }

  const stripeGeo = new THREE.BoxGeometry(ARENA * 2, 0.08, 0.08);
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(stripeGeo, trimMat);
    stripe.position.set(0, 1.15, side * (ARENA - 0.08));
    scene.add(stripe);
    const stripeZ = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, ARENA * 2), trimMat);
    stripeZ.position.set(side * (ARENA - 0.08), 1.15, 0);
    scene.add(stripeZ);
  }

  for (const box of obstacles) {
    const w = box.maxX - box.minX;
    const d = box.maxZ - box.minZ;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, box.h, d), coverMat);
    mesh.position.set((box.minX + box.maxX) / 2, box.h / 2, (box.minZ + box.maxZ) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.94, 0.05, d * 0.94), trimMat);
    cap.position.set(mesh.position.x, box.h + 0.025, mesh.position.z);
    scene.add(cap);
  }

  const hemi = new THREE.HemisphereLight(0x8ea4c4, 0x2a1c16, 0.55);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0x9aa4b8, 0.22);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff0e4, 2.15);
  sun.position.set(14, 24, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 64;
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  const lamps = [
    [-16.2, -16.2, 0xff4b2b, 28],
    [16.2, -16.2, 0x8ef6e4, 22],
    [-16.2, 16.2, 0x8ef6e4, 22],
    [16.2, 16.2, 0xff4b2b, 28],
  ];
  const bulbGeo = new THREE.SphereGeometry(0.1, 12, 12);
  for (const [x, z, color, intensity] of lamps) {
    const light = new THREE.PointLight(color, intensity, 26, 2);
    light.position.set(x, 3.4, z);
    scene.add(light);
    const bulb = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color }));
    bulb.position.copy(light.position);
    scene.add(bulb);
  }
}

function buildEnemy() {
  const group = new THREE.Group();
  const armor = new THREE.MeshStandardMaterial({
    color: 0x2a2e38,
    emissive: 0x000000,
    metalness: 0.74,
    roughness: 0.32,
  });
  const joint = new THREE.MeshStandardMaterial({ color: 0x14161c, metalness: 0.45, roughness: 0.55 });
  const hot = new THREE.MeshStandardMaterial({
    color: 0xff4b2b,
    emissive: 0xff3a1c,
    emissiveIntensity: 0.8,
    roughness: 0.38,
  });
  const gunMat = new THREE.MeshStandardMaterial({
    color: 0x17191f,
    emissive: 0xff5a2a,
    emissiveIntensity: 0.2,
    metalness: 0.8,
    roughness: 0.28,
  });

  const legGeo = new THREE.BoxGeometry(0.22, 0.62, 0.24);
  legGeo.translate(0, -0.31, 0);
  const legL = new THREE.Mesh(legGeo, joint);
  const legR = new THREE.Mesh(legGeo, joint);
  legL.position.set(-0.2, 0.78, 0);
  legR.position.set(0.2, 0.78, 0);
  legL.castShadow = true;
  legR.castShadow = true;
  const bootGeo = new THREE.BoxGeometry(0.24, 0.12, 0.34);
  const bootL = new THREE.Mesh(bootGeo, armor);
  const bootR = new THREE.Mesh(bootGeo, armor);
  bootL.position.set(0, -0.66, 0.05);
  bootR.position.set(0, -0.66, 0.05);
  bootL.castShadow = true;
  bootR.castShadow = true;
  legL.add(bootL);
  legR.add(bootR);
  group.add(legL, legR);

  function part(w, h, d, mat, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }

  part(0.72, 0.26, 0.4, armor, 0, 0.92, 0);
  part(1.02, 0.58, 0.5, armor, 0, 1.36, 0);
  part(0.34, 0.12, 0.08, hot, 0, 1.4, 0.28);
  part(0.3, 0.16, 0.3, armor, -0.62, 1.5, 0);
  part(0.3, 0.16, 0.3, armor, 0.62, 1.5, 0);
  part(0.4, 0.34, 0.4, joint, 0, 1.9, 0);
  part(0.24, 0.07, 0.05, hot, 0, 1.92, 0.22);

  const gun = new THREE.Group();
  gun.position.set(0.42, 1.3, 0.16);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.72), gunMat);
  barrel.position.set(0, 0, 0.34);
  barrel.castShadow = true;
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.28), gunMat);
  housing.position.set(0, -0.02, 0.02);
  housing.castShadow = true;
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, 0.72);
  gun.add(barrel, housing, muzzle);
  group.add(gun);

  const bar = new THREE.Group();
  bar.position.y = 2.38;
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 0.09),
    new THREE.MeshBasicMaterial({ color: 0x140e0c, side: THREE.DoubleSide })
  );
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 0.09),
    new THREE.MeshBasicMaterial({ color: 0xff4b2b, side: THREE.DoubleSide })
  );
  fill.position.z = 0.01;
  bar.add(bg, fill);
  group.add(bar);

  scene.add(group);
  return { group, legL, legR, gun, muzzle, armor, hot, gunMat, fill, bar };
}

const bot = buildEnemy();
buildArena();

function clearShots() {
  for (const bullet of bullets) scene.remove(bullet.mesh);
  bullets.length = 0;
  for (const effect of effects) {
    scene.remove(effect.mesh);
    effect.mat.dispose();
  }
  effects.length = 0;
}

function spark(x, y, z, color) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
  const mesh = new THREE.Mesh(sparkGeo, mat);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  effects.push({ mesh, mat, life: 0.2, max: 0.2 });
}

function spawnBullet(x, y, z, dir, speed, owner, damage, radius) {
  const mat = owner === "player" ? playerShotMat : enemyShotMat;
  const mesh = new THREE.Mesh(bulletGeo, mat);
  mesh.scale.setScalar(radius);
  mesh.position.set(x, y, z);
  if (owner === "enemy") {
    const glow = new THREE.PointLight(0xff8a3a, 6, 5.5, 2);
    mesh.add(glow);
  }
  scene.add(mesh);
  bullets.push({
    mesh,
    x,
    y,
    z,
    vx: dir.x * speed,
    vy: dir.y * speed,
    vz: dir.z * speed,
    owner,
    damage,
    radius,
    life: 2.4,
  });
}

function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove("show");
  void toastEl.offsetWidth;
  toastEl.classList.add("show");
  toastAt = time;
}

function setOverlays() {
  menuEl.classList.toggle("hidden", mode !== "menu");
  hudEl.classList.toggle("hidden", mode !== "play" && mode !== "pause");
  pauseEl.classList.toggle("hidden", mode !== "pause");
  endEl.classList.toggle("hidden", mode !== "end");
}

function flashFade() {
  fadeEl.classList.add("show");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => fadeEl.classList.remove("show"));
  });
}

function beginMatch() {
  player.x = -14.2;
  player.z = 14.2;
  player.yaw = -Math.PI / 4;
  player.pitch = 0;
  player.vx = 0;
  player.vz = 0;
  player.health = 100;
  player.cooldown = 0;
  enemy.x = 14.2;
  enemy.z = -14.2;
  enemy.health = 100;
  enemy.cooldown = 1.15;
  enemy.windup = 0;
  enemy.flash = 0;
  enemy.fall = 0;
  enemy.recoil = 0;
  enemy.lostSight = 0;
  enemy.stuck = 0;
  enemy.goal = null;
  enemy.goalLock = 0;
  enemy.hasLos = false;
  enemy.facing = Math.atan2(player.x - enemy.x, player.z - enemy.z);
  clearShots();
  matchTime = 0;
  grace = 1.05;
  shake = 0;
  hurtFlash = 0;
  endBlend = 0;
  mode = "play";
  setOverlays();
  flashFade();
  showToast("Engage");
  sfx.ready();
}

function finish(result) {
  if (mode !== "play") return;
  mode = "end";
  endBlend = 0;
  const title = $("end-title");
  const sub = $("end-sub");
  if (result === "win") {
    title.textContent = "Arena clear";
    sub.textContent = `Warden dropped in ${matchTime.toFixed(1)}s.`;
    sfx.win();
  } else {
    title.textContent = "Downed";
    sub.textContent = `You lasted ${matchTime.toFixed(1)}s.`;
    sfx.lose();
  }
  setOverlays();
}

function returnToMenu() {
  mode = "menu";
  enemy.health = 100;
  enemy.fall = 0;
  enemy.windup = 0;
  enemy.flash = 0;
  enemy.x = patrol[0][0];
  enemy.z = patrol[0][1];
  enemy.patrolIndex = 0;
  clearShots();
  hurtFlash = 0;
  setOverlays();
}

function togglePause() {
  if (mode === "play") mode = "pause";
  else if (mode === "pause") mode = "play";
  for (const key of Object.keys(keys)) keys[key] = false;
  setOverlays();
}

function hurtPlayer(amount) {
  if (mode !== "play" || player.health <= 0) return;
  player.health = Math.max(0, player.health - amount);
  hurtFlash = 1;
  shake = 1;
  sfx.hurt();
  if (player.health <= 0) finish("lose");
}

function hurtEnemy(amount) {
  if (mode !== "play" || enemy.health <= 0) return;
  enemy.health = Math.max(0, enemy.health - amount);
  enemy.flash = 0.12;
  sfx.confirm();
  hitEl.classList.remove("on");
  void hitEl.offsetWidth;
  hitEl.classList.add("on");
  if (enemy.health <= 0) finish("win");
}

function updatePlayer(dt) {
  if (player.health <= 0) return;
  let turn = 0;
  if (keys.ArrowLeft) turn += 1;
  if (keys.ArrowRight) turn -= 1;
  player.yaw += turn * TURN_SPEED * dt;
  let throttle = 0;
  if (keys.ArrowUp) throttle += 1;
  if (keys.ArrowDown) throttle -= 1;
  const step = PLAYER_SPEED * throttle * dt;
  const beforeX = player.x;
  const beforeZ = player.z;
  tryMove(player, -Math.sin(player.yaw) * step, -Math.cos(player.yaw) * step, PLAYER_R, "player");
  player.vx = dt > 0 ? (player.x - beforeX) / dt : 0;
  player.vz = dt > 0 ? (player.z - beforeZ) / dt : 0;
  player.cooldown = Math.max(0, player.cooldown - dt);
  player.pitch += (0 - player.pitch) * Math.min(1, dt * 9);
}

function moveEnemy(dx, dz, speed, dt) {
  const heading = steer(enemy.x, enemy.z, dx, dz, ENEMY_R);
  const beforeX = enemy.x;
  const beforeZ = enemy.z;
  tryMove(enemy, heading.x * speed * dt, heading.z * speed * dt, ENEMY_R, "enemy");
  enemy.fx = enemy.x - beforeX;
  enemy.fz = enemy.z - beforeZ;
  enemy.moved = Math.hypot(enemy.fx, enemy.fz);
  if (enemy.moved < 0.004) enemy.stuck += dt;
  else enemy.stuck = 0;
}

function pickFlank() {
  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + time * 0.2;
    const x = player.x + Math.cos(angle) * 8.2;
    const z = player.z + Math.sin(angle) * 8.2;
    if (Math.abs(x) > ARENA - 1.4 || Math.abs(z) > ARENA - 1.4) continue;
    if (circleBlocked(x, z, ENEMY_R, "enemy")) continue;
    if (!lineClear(x, 1.45, z, player.x, 1.45, player.z)) continue;
    const score = Math.hypot(x - enemy.x, z - enemy.z) + Math.random() * 1.5;
    if (score < bestScore) {
      bestScore = score;
      best = { x, z };
    }
  }
  return best;
}

function fireEnemy() {
  const origin = new THREE.Vector3();
  bot.muzzle.getWorldPosition(origin);
  const dist = Math.hypot(player.x - origin.x, player.z - origin.z);
  const speed = 16.5;
  const lead = dist / speed;
  const spread = 0.28 + dist * 0.028;
  const target = new THREE.Vector3(
    player.x + player.vx * lead * 0.45 + (Math.random() - 0.5) * spread * 2,
    EYE - 0.2 + (Math.random() - 0.5) * 0.35,
    player.z + player.vz * lead * 0.45 + (Math.random() - 0.5) * spread * 2
  );
  const dir = target.sub(origin).normalize();
  spawnBullet(origin.x, origin.y, origin.z, dir, speed, "enemy", ENEMY_DAMAGE, 0.26);
  enemy.recoil = 0.26;
  enemyFlash.position.copy(origin);
  enemyFlash.intensity = 8;
  sfx.enemyShot();
}

function updateEnemy(dt) {
  if (enemy.health <= 0) {
    enemy.fall = Math.min(1, enemy.fall + dt * 1.8);
    return;
  }

  if (mode === "menu") {
    const point = patrol[enemy.patrolIndex];
    const dx = point[0] - enemy.x;
    const dz = point[1] - enemy.z;
    if (Math.hypot(dx, dz) < 0.9) enemy.patrolIndex = (enemy.patrolIndex + 1) % patrol.length;
    else moveEnemy(dx, dz, 4.2, dt);
    return;
  }

  if (mode !== "play") return;

  const dx = player.x - enemy.x;
  const dz = player.z - enemy.z;
  const dist = Math.hypot(dx, dz) || 0.0001;
  enemy.hasLos = lineClear(enemy.x, 1.45, enemy.z, player.x, EYE - 0.15, player.z);
  if (enemy.hasLos) enemy.lostSight = 0;
  else enemy.lostSight += dt;

  enemy.goalLock -= dt;
  if (enemy.stuck > 0.65) {
    const point = patrol[Math.floor(Math.random() * patrol.length)];
    enemy.goal = { x: point[0], z: point[1] };
    enemy.goalLock = 1.15;
    enemy.stuck = 0;
  }

  let tx;
  let tz;
  if (enemy.goalLock > 0 && enemy.goal) {
    tx = enemy.goal.x;
    tz = enemy.goal.z;
  } else if (!enemy.hasLos && enemy.lostSight > 0.4) {
    if (!enemy.goal || Math.hypot(enemy.goal.x - enemy.x, enemy.goal.z - enemy.z) < 1.15) {
      enemy.goal = pickFlank();
    }
    if (enemy.goal) {
      tx = enemy.goal.x;
      tz = enemy.goal.z;
    } else {
      tx = player.x;
      tz = player.z;
    }
  } else {
    enemy.goal = null;
    const preferred = 8.4;
    const forward = dist > preferred + 1.6 ? 1 : dist < preferred - 1.7 ? -1 : 0;
    const side = Math.sin(time * 0.8) >= 0 ? 1 : -1;
    tx = enemy.x + (dx / dist) * forward + (-dz / dist) * side;
    tz = enemy.z + (dz / dist) * forward + (dx / dist) * side;
  }

  const speed = enemy.windup > 0 ? 2.1 : 5.5;
  moveEnemy(tx - enemy.x, tz - enemy.z, speed, dt);

  enemy.cooldown -= dt;
  if (enemy.windup > 0) {
    if (!enemy.hasLos) enemy.windup = 0;
    else {
      enemy.windup -= dt;
      if (enemy.windup <= 0) {
        fireEnemy();
        enemy.cooldown = 0.78;
      }
    }
  } else if (enemy.hasLos && dist < 23 && dist > 3 && enemy.cooldown <= 0 && grace <= 0 && player.health > 0) {
    enemy.windup = 0.32;
    sfx.windup();
  }
}

function syncEnemy(dt) {
  bot.group.position.set(enemy.x, enemy.fall * -0.28, enemy.z);
  if (enemy.health > 0) {
    const faceTarget =
      mode === "menu" && enemy.moved > 0.001
        ? Math.atan2(enemy.fx, enemy.fz)
        : Math.atan2(player.x - enemy.x, player.z - enemy.z);
    enemy.facing = mode === "play" ? faceTarget : dampAngle(enemy.facing, faceTarget, dt, 7);
    bot.group.rotation.y = enemy.facing;
    bot.group.rotation.z = 0;
    const stride = Math.sin(time * (mode === "play" ? 9 : 7)) * Math.min(1, enemy.moved / (dt || 0.016)) * 0.04;
    bot.legL.rotation.x = stride * 14;
    bot.legR.rotation.x = -stride * 14;
  } else {
    bot.group.rotation.z = enemy.fall * 1.35;
    bot.legL.rotation.x = 0;
    bot.legR.rotation.x = 0;
  }

  enemy.recoil = Math.max(0, enemy.recoil - dt * 1.5);
  bot.gun.position.z = 0.16 - enemy.recoil;
  const heat = enemy.windup > 0 ? 1.6 : 0.25;
  bot.gunMat.emissiveIntensity = heat;
  bot.hot.emissiveIntensity = enemy.windup > 0 ? 1.8 : 0.75;
  if (enemy.flash > 0) {
    bot.armor.emissive.setHex(0xffc8bc);
    bot.armor.emissiveIntensity = 0.85;
    enemy.flash -= dt;
  } else {
    bot.armor.emissive.setHex(0x000000);
    bot.armor.emissiveIntensity = 0;
  }

  const ratio = clamp(enemy.health / 100, 0, 1);
  bot.fill.scale.x = Math.max(ratio, 0.001);
  bot.fill.position.x = (ratio - 1) * 0.575;
  bot.bar.visible = enemy.health > 0 && (mode === "play" || mode === "pause");
  bot.bar.lookAt(camera.position);
}

function firePlayer() {
  if (mode !== "play" || player.health <= 0 || player.cooldown > 0) return;
  player.cooldown = PLAYER_COOLDOWN;
  player.pitch -= 0.035;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  if (enemy.health > 0) {
    const to = new THREE.Vector3(enemy.x - camera.position.x, 1.2 - camera.position.y, enemy.z - camera.position.z);
    const distance = to.length();
    if (distance < 28 && distance > 0.001) {
      to.multiplyScalar(1 / distance);
      if (dir.dot(to) > 0.965) dir.lerp(to, 0.55).normalize();
    }
  }
  spawnBullet(
    camera.position.x + dir.x * 0.45,
    camera.position.y + dir.y * 0.45,
    camera.position.z + dir.z * 0.45,
    dir,
    46,
    "player",
    PLAYER_DAMAGE,
    0.12
  );
  playerFlash.position.copy(camera.position);
  playerFlash.intensity = 7;
  sfx.playerShot();
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];
    bullet.life -= dt;
    const x0 = bullet.x;
    const y0 = bullet.y;
    const z0 = bullet.z;
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.z += bullet.vz * dt;
    bullet.mesh.position.set(bullet.x, bullet.y, bullet.z);

    let remove = bullet.life <= 0;
    let impact = null;
    const color = bullet.owner === "player" ? 0xb8fff4 : 0xffa033;

    if (!remove) {
      let best = Infinity;
      let kind = null;
      const pad = bullet.radius;
      for (const box of obstacles) {
        const t = segmentT(
          x0, y0, z0, bullet.x, bullet.y, bullet.z,
          box.minX - pad, -pad, box.minZ - pad,
          box.maxX + pad, box.h + pad, box.maxZ + pad
        );
        if (t !== null && t < best) {
          best = t;
          kind = "world";
        }
      }
      if (bullet.owner === "player" && enemy.health > 0 && mode === "play") {
        const t = sphereT(x0, y0, z0, bullet.x, bullet.y, bullet.z, enemy.x, 1.2, enemy.z, 0.78 + bullet.radius);
        if (t !== null && t < best) {
          best = t;
          kind = "enemy";
        }
      }
      if (bullet.owner === "enemy" && player.health > 0 && mode === "play") {
        const t = sphereT(x0, y0, z0, bullet.x, bullet.y, bullet.z, player.x, 1.05, player.z, 0.5 + bullet.radius);
        if (t !== null && t < best) {
          best = t;
          kind = "player";
        }
      }
      if (kind) {
        impact = {
          x: x0 + (bullet.x - x0) * best,
          y: y0 + (bullet.y - y0) * best,
          z: z0 + (bullet.z - z0) * best,
          kind,
        };
        remove = true;
      } else if (Math.abs(bullet.x) > ARENA || Math.abs(bullet.z) > ARENA || bullet.y < 0.02 || bullet.y > 5.2) {
        impact = {
          x: clamp(bullet.x, -ARENA, ARENA),
          y: clamp(bullet.y, 0.08, 5),
          z: clamp(bullet.z, -ARENA, ARENA),
          kind: "world",
        };
        remove = true;
      }
    }

    if (remove) {
      if (impact) {
        spark(impact.x, impact.y, impact.z, color);
        if (impact.kind === "enemy") hurtEnemy(bullet.damage);
        if (impact.kind === "player") hurtPlayer(bullet.damage);
      }
      scene.remove(bullet.mesh);
      bullets.splice(i, 1);
    }
  }
}

function updateEffects(dt) {
  playerFlash.intensity = Math.max(0, playerFlash.intensity - dt * 40);
  enemyFlash.intensity = Math.max(0, enemyFlash.intensity - dt * 28);
  for (let i = effects.length - 1; i >= 0; i--) {
    const effect = effects[i];
    effect.life -= dt;
    const k = Math.max(0, effect.life / effect.max);
    effect.mesh.scale.setScalar(1.6 - k);
    effect.mat.opacity = k;
    if (effect.life <= 0) {
      scene.remove(effect.mesh);
      effect.mat.dispose();
      effects.splice(i, 1);
    }
  }
}

function updateCamera(dt) {
  if (mode === "menu") {
    const angle = time * 0.16;
    camera.position.set(Math.cos(angle) * 24, 11.5, Math.sin(angle) * 24);
    camera.lookAt(0, 1.3, 0);
    return;
  }
  if (mode === "end") {
    endBlend = Math.min(1, endBlend + dt * 0.55);
    const angle = time * 0.18;
    const dest = new THREE.Vector3(Math.sin(angle) * 18, 8.5, Math.cos(angle) * 18);
    const eye = new THREE.Vector3(player.x, EYE, player.z);
    camera.position.lerpVectors(eye, dest, endBlend);
    camera.lookAt((player.x + enemy.x) * 0.5, 1.1, (player.z + enemy.z) * 0.5);
    return;
  }
  const moving = Math.hypot(player.vx, player.vz) > 0.4 && mode === "play";
  const bob = moving ? Math.sin(time * 11) * 0.03 : 0;
  camera.position.set(player.x, EYE + bob, player.z);
  if (shake > 0 && mode === "play") {
    camera.position.x += (Math.random() - 0.5) * shake * 0.08;
    camera.position.y += (Math.random() - 0.5) * shake * 0.06;
    shake = Math.max(0, shake - dt * 1.6);
  }
  const pitch = player.pitch + (player.health <= 0 ? 0.45 : 0);
  camera.rotation.order = "YXZ";
  camera.rotation.y = player.yaw;
  camera.rotation.x = pitch;
  camera.rotation.z = 0;
}

function updateHud() {
  const playerRatio = clamp(player.health / 100, 0, 1);
  const enemyRatio = clamp(enemy.health / 100, 0, 1);
  playerFill.style.transform = `scaleX(${playerRatio})`;
  enemyFill.style.transform = `scaleX(${enemyRatio})`;
  playerNum.textContent = String(Math.ceil(player.health));
  enemyNum.textContent = String(Math.ceil(enemy.health));
  youCard.classList.toggle("low", player.health > 0 && player.health <= 35);
  clockEl.textContent = matchTime.toFixed(1);
  const ready = player.cooldown <= 0 ? 1 : 1 - player.cooldown / PLAYER_COOLDOWN;
  cooldownFill.style.transform = `scaleX(${clamp(ready, 0, 1)})`;
  const lowPulse = player.health > 0 && player.health <= 35 ? 0.25 + Math.sin(time * 6) * 0.08 : 0;
  const dead = mode === "end" && player.health <= 0 ? 0.72 : 0;
  hurtEl.style.opacity = String(Math.max(hurtFlash, lowPulse, dead));
  hurtFlash = Math.max(0, hurtFlash - 0.02);
  lockEl.classList.toggle("show", mode === "play" && enemy.windup > 0 && enemy.hasLos);

  if (mode === "play" && enemy.health > 0) {
    camera.updateMatrixWorld();
    const local = new THREE.Vector3(enemy.x, 1.4, enemy.z);
    local.applyMatrix4(camera.matrixWorldInverse);
    const angle = Math.atan2(local.x, -local.z);
    const inView = local.z < -0.8 && Math.abs(angle) < 0.42;
    trackerEl.classList.toggle("hidden", inView);
    trackerEl.classList.toggle("danger", enemy.windup > 0);
    const pad = Math.min(window.innerWidth, window.innerHeight) * 0.34;
    trackerEl.style.transform = `translate(-50%, -50%) rotate(${angle}rad) translate(0, ${-pad}px)`;
  } else {
    trackerEl.classList.add("hidden");
  }

  drawRadar();
}

function drawRadar() {
  const size = 148;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (radar.width !== size * dpr) {
    radar.width = size * dpr;
    radar.height = size * dpr;
  }
  const ctx = radarCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const scale = (size - 16) / (ARENA * 2);
  const mapX = (x) => size / 2 + x * scale;
  const mapY = (z) => size / 2 - z * scale;

  ctx.strokeStyle = "rgba(243,239,230,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(mapX(-ARENA), mapY(ARENA), ARENA * 2 * scale, ARENA * 2 * scale);

  ctx.fillStyle = "rgba(243,239,230,0.16)";
  for (const box of obstacles) {
    const x = mapX(box.minX);
    const y = mapY(box.maxZ);
    ctx.fillRect(x, y, (box.maxX - box.minX) * scale, (box.maxZ - box.minZ) * scale);
  }

  for (const bullet of bullets) {
    ctx.fillStyle = bullet.owner === "player" ? "#8ef6e4" : "#ffb020";
    ctx.fillRect(mapX(bullet.x) - 1.5, mapY(bullet.z) - 1.5, 3, 3);
  }

  if (enemy.health > 0) {
    ctx.fillStyle = "#ff4b2b";
    ctx.beginPath();
    ctx.arc(mapX(enemy.x), mapY(enemy.z), 4, 0, Math.PI * 2);
    ctx.fill();
  }

  const px = mapX(player.x);
  const py = mapY(player.z);
  const fx = -Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(Math.atan2(fx, fz));
  ctx.fillStyle = "#8ef6e4";
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 6);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  if (mode !== "pause") {
    if (mode === "play") {
      grace = Math.max(0, grace - dt);
      matchTime += dt;
      updatePlayer(dt);
    }
    updateEnemy(dt);
    updateCamera(dt);
    if (mode === "play" && keys.Space) firePlayer();
    updateBullets(dt);
    updateEffects(dt);
    syncEnemy(dt);
  } else {
    updateCamera(dt);
    syncEnemy(dt);
  }
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

const clock = new THREE.Clock();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener("keydown", (event) => {
  const movement =
    event.code === "ArrowUp" ||
    event.code === "ArrowDown" ||
    event.code === "ArrowLeft" ||
    event.code === "ArrowRight" ||
    event.code === "Space";
  if (movement) event.preventDefault();
  if (event.repeat) return;
  keys[event.code] = true;
  if (event.code === "Enter") {
    event.preventDefault();
    if (mode === "menu") beginMatch();
    else if (mode === "end") beginMatch();
    else if (mode === "pause") togglePause();
  }
  if (event.code === "Escape") togglePause();
  if (event.code === "KeyR" && mode === "end") beginMatch();
});

window.addEventListener("keyup", (event) => {
  keys[event.code] = false;
});

window.addEventListener("blur", () => {
  for (const key of Object.keys(keys)) keys[key] = false;
});

$("play").addEventListener("click", () => {
  $("play").blur();
  beginMatch();
});
$("again").addEventListener("click", () => {
  $("again").blur();
  beginMatch();
});
$("resume").addEventListener("click", () => {
  $("resume").blur();
  if (mode === "pause") togglePause();
});
$("quit").addEventListener("click", () => {
  $("quit").blur();
  returnToMenu();
});
$("menu-btn").addEventListener("click", () => {
  $("menu-btn").blur();
  returnToMenu();
});

setOverlays();
frame();
