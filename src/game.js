import * as THREE from 'three';
import { LEVELS } from './levels.js';
import { buildWorld, disposeGroup } from './world.js';
import { TYPES, PLAYER_MODELS, PLAYER_COLORS, TRAFFIC_COLORS, createCarMesh, circlesFor, setCarEnv } from './models.js';
import { makeEnv } from './env.js';
import { FX } from './fx.js';
import { initAudio, resumeAudio, sfx, setMuted, isMuted } from './audio.js';
import { clamp, lerp, rand, pick, wpick, fmt } from './util.js';

const $ = (id) => document.getElementById(id);
const G = 24;
const MAX_CARS = 84;

/* ------------------------------------------------------------------ save */
const SAVE_KEY = 'crashjunction.v1';
let save = { money: 0, unlocked: 1, medals: [], up: { power: 0, blast: 0, after: 0, cars: 0 }, model: 'muscle', owned: ['muscle'], color: '#e8202a', mute: false, last: 0 };
try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s) save = { ...save, ...s, up: { ...save.up, ...(s.up || {}) } }; } catch (e) { /* ignore */ }
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } };
setMuted(!!save.mute);

/* -------------------------------------------------------------- renderer */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance' });
let dpr = Math.min(window.devicePixelRatio || 1, 1.75);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd2e0f2, 160, 420);
const FOV = 42;
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 900);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
const HQ = location.search.includes('hq');
const LOWEND = !HQ && ((navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 4) <= 2);
let shadowsOn = !LOWEND;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const ENV = makeEnv(renderer);
setCarEnv(ENV);
scene.environment = ENV;
scene.environmentIntensity = 0.4;
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x70727a, 0.55));
const SUN_DIR = new THREE.Vector3(-45, 70, 38).normalize();
const sun = new THREE.DirectionalLight(0xffe0b0, 3.1);
sun.castShadow = shadowsOn;
sun.shadow.mapSize.set(LOWEND ? 1024 : 1536, LOWEND ? 1024 : 1536);
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 20, far: 260 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);
const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 12), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { sd: { value: SUN_DIR } },
  vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `varying vec3 vP; uniform vec3 sd; void main(){ float h=clamp(vP.y,0.0,1.0);
    vec3 hor=vec3(0.82,0.88,0.95), top=vec3(0.16,0.4,0.8); vec3 c=mix(hor,top,pow(h,0.5));
    float s=max(dot(vP,sd),0.0); c+=vec3(1.0,0.82,0.55)*(pow(s,64.0)*1.2+pow(s,8.0)*0.28);
    float cl=smoothstep(0.55,0.8,sin(vP.x*9.0+sin(vP.z*7.0)*1.5)*sin(vP.z*6.0+vP.x*3.0)*0.5+0.5)*smoothstep(0.08,0.3,h)*smoothstep(0.7,0.3,h);
    c=mix(c,vec3(1.0),cl*0.35); gl_FragColor=vec4(c,1.0); }`,
}));
sky.renderOrder = -10; sky.frustumCulled = false;
scene.add(sky);
const fx = new FX(scene);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  fx.setScale((h * dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360)));
}
window.addEventListener('resize', resize);
resize();

/* ----------------------------------------------------------------- state */
const S = {
  mode: 'menu', phase: 'none', li: save.last || 0, L: null, world: null, cars: [], free: [], pickups: [],
  player: null, carsTotal: 3, carsUsed: 0, score: 0, disp: 0, crashScore: 0, chain: 0, chainT: 0, mult: 1,
  t: 0, lightT: 0, paused: false, slowT: 0, ts: 1, shake: 0, aim: 0, gaugeT: 0, power: 0, after: 1, afterMax: 3,
  breakReady: false, timeSince: 0, quiet: 0, phaseT: 0, nid: 1, focus: new THREE.Vector3(), zoomW: 90, lampState: {},
  stick: { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, mag: 0 }, orbit: 0, wrecks: 0, showcase: null, bigHit: false,
  fovKick: 0, roll: 0, punch: 0, chaseT: 0, cine: 0, cineX: 0, cineZ: 0, speedFx: 0, camSnap: true, viewShift: 0,
  cam: { fx: 0, fz: 0, dist: 80, el: 58, az: 0, fov: 42, lookY: 0 },
};
const lvl = () => LEVELS[S.li];

/* ------------------------------------------------------------------- UI */
const ui = {
  hud: $('hud'), score: $('score'), goal: $('goal'), mult: $('mult'), chainbar: $('chainbar').firstElementChild, after: $('after').firstElementChild,
  hint: $('hint'), toast: $('toast'), tally: $('tally'), gauge: $('gauge'), launch: $('launchBtn'), stop: $('stopBtn'), brk: $('breakBtn'),
  cars: $('cars'), name: $('lvlName'), pops: $('pops'), flash: $('flash'), speed: $('speed'), stick: $('stick'), knob: $('knob'),
};
const screens = { title: $('title'), levels: $('levels'), garage: $('garage'), pause: $('pause'), results: $('results') };
function showScreen(n) {
  for (const k in screens) screens[k].classList.toggle('hidden', k !== n);
  ui.hud.classList.toggle('hidden', n !== null && n !== 'pause');
}
// gauge zones
ui.gauge.innerHTML = '<div class="z" style="left:0;width:55%;background:#1d4e89"></div><div class="z" style="left:55%;width:31%;background:#22a74a"></div><div class="z" style="left:86%;width:11%;background:#ffd500"></div><div class="z" style="left:97%;width:3%;background:#e8202a"></div><div id="needle"></div>';
const needle = $('needle');

const popEls = [];
for (let i = 0; i < 14; i++) { const d = document.createElement('div'); d.className = 'pop'; d.style.opacity = 0; ui.pops.appendChild(d); popEls.push(d); }
let popI = 0;
const _v = new THREE.Vector3();
function pop(x, z, text, cls = '') {
  const el = popEls[popI]; popI = (popI + 1) % popEls.length;
  _v.set(x, 2.5, z).project(camera);
  const px = (_v.x * 0.5 + 0.5) * window.innerWidth, py = (-_v.y * 0.5 + 0.5) * window.innerHeight;
  el.className = 'pop ' + cls; el.textContent = text;
  el.style.left = clamp(px - 40, 4, window.innerWidth - 120) + 'px'; el.style.top = clamp(py, 90, window.innerHeight - 160) + 'px';
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
}
let toastT = 0;
function toast(t, ms = 1400) { ui.toast.textContent = t; ui.toast.style.opacity = 1; toastT = ms / 1000; }
function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ } }
function flash(a = 0.8, col = '#fff') { ui.flash.style.background = col; ui.flash.style.transition = 'none'; ui.flash.style.opacity = a; void ui.flash.offsetWidth; ui.flash.style.transition = 'opacity .5s'; ui.flash.style.opacity = 0; }

/* -------------------------------------------------------------- level mgmt */
function clearLevel() {
  if (S.world) { scene.remove(S.world.group); disposeGroup(S.world.group); }
  for (const c of S.cars) { scene.remove(c.root); c.mat.dispose(); }
  for (const p of S.pickups) scene.remove(p.mesh);
  if (S.arrow) { scene.remove(S.arrow); S.arrow = null; }
  S.cars = []; S.free = []; S.pickups = []; S.player = null; S.showcase = null; S.world = null; S.lampState = {};
  fx.clear();
}

function loadLevel(i) {
  clearLevel();
  S.li = i; S.L = LEVELS[i];
  S.world = buildWorld(S.L);
  scene.add(S.world.group);
  S.lightT = 0;
  for (const l of S.world.lanes) {
    l.target = Math.max(1, Math.round(l.len / (S.L.density + rand(-1, 3))));
    l.spawnCd = 0;
  }
  const tot = S.world.lanes.reduce((n, l) => n + l.target, 0), cap = LOWEND ? 50 : 70;
  if (tot > cap) for (const l of S.world.lanes) l.target = Math.max(1, Math.round((l.target * cap) / tot));
  populateTraffic();
  for (let k = 0; k < 150; k++) { S.lightT += 1 / 30; updateRails(1 / 30); }
  spawnPickups();
  buildArrow();
  S.focus.set(0, 0, 0);
  S.zoomW = S.L.view;
  updateLamps(true);
}

function populateTraffic() {
  for (const l of S.world.lanes) {
    let tries = 0;
    while (l.cars.length < l.target && tries++ < 80) {
      const type = wpick(S.L.mix), T = TYPES[type];
      const p = rand(T.L, l.len - T.L);
      if (l.zones.some((z) => p + T.L / 2 > z[0] && p - T.L / 2 < z[1])) continue;
      if (l.cars.some((o) => Math.abs(o.p - p) < (o.T.L + T.L) / 2 + 4)) continue;
      addRailCar(l, type, p);
    }
  }
}
function addRailCar(l, type, p) {
  const c = newCar(type, pick(TRAFFIC_COLORS));
  c.rail = l; c.p = p; c.v0 = rand(S.L.speed[0], S.L.speed[1]); c.speed = c.v0;
  l.cars.push(c); placeRail(c);
  return c;
}

/* ------------------------------------------------------------------ cars */
function newCar(type, hex) {
  const m = createCarMesh(type, hex);
  const T = m.T, cs = circlesFor(T), mass = T.m * 1000;
  const c = {
    ...m, type, x: 0, z: 0, a: 0, vx: 0, vz: 0, w: 0, y: 0, vy: 0, pitch: 0, roll: 0, wp: 0, wr: 0, dmg: 0,
    mass, I: (mass * (T.L * T.L + T.W * T.W)) / 12, rad: T.L / 2 + 0.4, cr: cs.r, offs: cs.offs,
    rail: null, p: 0, speed: 0, v0: 0, counted: false, player: false, fire: 0, fuse: -1, gone: false, id: S.nid++,
    lastCash: 0, onFire: false, fireT: 0, boomed: false, smokeT: 0, bob: 0, braking: false, acc: 0, skidD: 0, wheelsLost: 0, lastSk: 0,
  };
  scene.add(c.root);
  S.cars.push(c);
  return c;
}
function placeRail(c) {
  const l = c.rail, s = l.a + l.dir * c.p;
  if (l.axis === 'x') { c.x = s; c.z = l.fixed; c.a = l.dir > 0 ? 0 : Math.PI; c.vx = l.dir * c.speed; c.vz = 0; }
  else { c.z = s; c.x = l.fixed; c.a = l.dir > 0 ? Math.PI / 2 : -Math.PI / 2; c.vz = l.dir * c.speed; c.vx = 0; }
}
function unrail(c) {
  const l = c.rail;
  if (!l) return;
  const i = l.cars.indexOf(c); if (i >= 0) l.cars.splice(i, 1);
  c.rail = null;
  S.free.push(c);
}
function syncCar(c) {
  c.root.position.set(c.x, 0, c.z);
  c.root.rotation.y = -c.a;
  c.pivot.position.y = c.H / 2 + c.y + c.bob;
  c.pivot.rotation.set(c.roll, 0, c.pitch);
  c.mat.userData.dmg.value = c.dmg;
  c.shadow.visible = !shadowsOn;
  if (!shadowsOn) { const sh = 1 + c.y * 0.12; c.shadow.scale.set(c.T.L * 1.25 * sh, 1, c.T.W * 1.7 * sh); }
}

/* ---------------------------------------------------------------- lights */
function lightState(group) {
  const [g, y, r] = S.L.cycle, half = g + y + r, t = S.lightT % (2 * half);
  const inH = t < half, tt = inH ? t : t - half;
  if ((group === 'H') !== inH) return 'red';
  return tt < g ? 'green' : tt < g + y ? 'yellow' : 'red';
}
const _col = new THREE.Color();
function updateLamps(force) {
  if (!S.world) return;
  for (const g of ['H', 'V']) {
    const st = lightState(g);
    if (!force && S.lampState[g] === st) continue;
    S.lampState[g] = st;
    _col.set(st === 'green' ? 0x22ff55 : st === 'yellow' ? 0xffc400 : 0xff2020);
    const im = g === 'H' ? S.world.lampsH : S.world.lampsV;
    for (let i = 0; i < im.count; i++) im.setColorAt(i, _col);
    im.instanceColor.needsUpdate = true;
  }
}

/* ----------------------------------------------------------- rail traffic */
function updateRails(dt) {
  for (const l of S.world.lanes) {
    const cars = l.cars;
    cars.sort((a, b) => b.p - a.p);
    const st = l.group;
    const light = lightState(st);
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i], front = c.p + c.T.L / 2;
      let target = c.v0;
      if (light !== 'green') {
        let best = null;
        for (const s of l.stops) { const d = s.p - front; if (d > -0.4 && (best === null || d < best)) best = d; }
        if (best !== null) {
          const need = (c.speed * c.speed) / (2 * Math.max(best, 0.05));
          if (light === 'red' || need < 9) target = Math.min(target, Math.sqrt(2 * 8 * Math.max(best - 0.4, 0)));
        }
      }
      const lead = i > 0 ? cars[i - 1] : null;
      if (lead) {
        const gap = lead.p - lead.T.L / 2 - front - 2;
        target = Math.min(target, lead.speed + Math.sqrt(2 * 9 * Math.max(gap, 0)));
        if (gap < 0.2) target = Math.min(target, lead.speed * 0.85);
      }
      const old = c.speed;
      if (c.speed < target) c.speed = Math.min(target, c.speed + 6 * dt); else c.speed = Math.max(target, c.speed - 16 * dt);
      c.acc = (c.speed - old) / dt;
      c.braking = c.acc < -1.2 || (c.speed < 0.6 && target < 0.6);
      c.pitch += (clamp(c.acc * 0.0032, -0.05, 0.04) - c.pitch) * Math.min(1, dt * 7);
      c.bob = Math.sin(S.t * 9 + c.id) * 0.012 * Math.min(1, c.speed / 10);
      if (c.acc < -11 && c.speed > 3 && S.t - c.lastSk > 0.07) {
        c.lastSk = S.t;
        const hx = Math.cos(c.a), hz = Math.sin(c.a);
        for (const sg of [-1, 1]) fx.skid(c.x - hx * c.T.L * 0.25 - hz * sg * c.T.W * 0.36, c.z - hz * c.T.L * 0.25 + hx * sg * c.T.W * 0.36, c.a, 1.6, 0.24);
      }
      c.p += c.speed * dt;
      placeRail(c);
      if (c.p > l.len + c.T.L) { cars.splice(i, 1); c.root.visible = false; c.rail = l; l.waiting.push(c); }
    }
    // respawn
    l.spawnCd -= dt;
    if (l.spawnCd <= 0 && S.phase !== 'crash' && S.phase !== 'tally') {
      const last = cars.length ? cars[cars.length - 1] : null;
      const clear = (T) => !last || last.p - last.T.L / 2 > T.L + 10;
      if (l.waiting.length) {
        const c = l.waiting[0];
        if (clear(c.T)) { l.waiting.shift(); c.p = -c.T.L / 2; c.v0 = rand(S.L.speed[0], S.L.speed[1]); c.speed = c.v0; c.root.visible = true; cars.push(c); placeRail(c); l.spawnCd = 1.5; }
      } else if (cars.length < l.target && S.cars.length < MAX_CARS) {
        const type = wpick(S.L.mix);
        if (clear(TYPES[type])) { addRailCar(l, type, -TYPES[type].L / 2); l.spawnCd = 2.5; }
      }
    }
  }
}

/* ---------------------------------------------------------------- pickups */
const coinGeo = new THREE.CylinderGeometry(1, 1, 0.28, 18).rotateX(Math.PI / 2);
const coinMat = new THREE.MeshBasicMaterial({ color: 0xffc400 });
const multGeo = new THREE.OctahedronGeometry(1.25);
const multMat = new THREE.MeshBasicMaterial({ color: 0x2cff7a });
function spawnPickups() {
  const lanes = S.world.lanes;
  let n = 0, guard = 0;
  while (n < 10 && guard++ < 200) {
    const l = pick(lanes);
    const p = rand(0, l.len), s = l.a + l.dir * p;
    const x = l.axis === 'x' ? s : l.fixed, z = l.axis === 'x' ? l.fixed : s;
    if (Math.hypot(x, z) > 44) continue;
    if (S.pickups.some((q) => Math.hypot(q.x - x, q.z - z) < 8)) continue;
    const type = n % 4 === 3 ? 'mult' : 'coin';
    const mesh = new THREE.Mesh(type === 'coin' ? coinGeo : multGeo, type === 'coin' ? coinMat : multMat);
    mesh.position.set(x, 1.8, z);
    scene.add(mesh);
    S.pickups.push({ mesh, x, z, type, got: false });
    n++;
  }
}
function updatePickups(dt) {
  for (const p of S.pickups) {
    if (p.got) continue;
    p.mesh.rotation.y += dt * 3; p.mesh.position.y = 1.8 + Math.sin(S.t * 3 + p.x) * 0.25;
    for (const c of S.free) {
      if (c.gone || c.y > 2.5) continue;
      if (Math.hypot(c.x - p.x, c.z - p.z) < c.T.L / 2 + 1.2) {
        p.got = true; scene.remove(p.mesh);
        if (p.type === 'coin') { addCash(2500); pop(p.x, p.z, '+$2,500', 'coin'); } else { bumpChain(3); pop(p.x, p.z, 'MULTI +3!', 'coin'); }
        sfx.coin(); vibrate(15);
        break;
      }
    }
  }
}

/* ------------------------------------------------------------ scoring */
function addCash(v, k = 'x') { S.crashScore += v; S.score += v; (S.dbg || (S.dbg = {}))[k] = ((S.dbg || {})[k] || 0) + v; }
function bumpChain(n) {
  const before = Math.floor(S.chain / 5);
  S.chain += n; S.chainT = 3.2; S.mult = Math.min(8, 1 + S.chain * 0.3);
  ui.mult.classList.add('pulse'); setTimeout(() => ui.mult.classList.remove('pulse'), 110);
  const after = Math.floor(S.chain / 5);
  if (after > before) {
    const bonus = 1000 * Math.min(after, 5);
    addCash(bonus, 'pile');
    toast(after >= 3 ? 'MEGA PILE-UP! +' + fmt(bonus) : 'PILE-UP! +' + fmt(bonus), 1300);
    sfx.tally();
  }
}
function wreck(c) {
  if (c.counted || c.player) return;
  c.counted = true; S.wrecks++;
  bumpChain(1);
  const val = c.T.val * S.mult;
  addCash(val, 'wreck');
  pop(c.x, c.z, '+' + fmt(val), S.chain % 5 === 0 ? 'big' : '');
  if (c.T.explosive && c.fuse < 0) c.fuse = 0.5 + Math.random() * 0.4;
}

/* ------------------------------------------------------------- explosions */
function explode(x, z, R, power, src) {
  fx.explosion(x, z, R);
  sfx.boom(R / 10);
  S.shake = Math.max(S.shake, Math.min(1.6, 0.6 + R / 14));
  if (R >= 8) { S.slowT = 0.7; flash(0.6, '#ffd9a0'); vibrate([40, 30, 80]); S.punch = 1; S.fovKick = Math.max(S.fovKick, 10); S.roll = (Math.random() - 0.5) * 0.09; }
  else S.punch = Math.max(S.punch, 0.5);
  for (const c of S.cars) {
    if (c.gone || c === src || !c.root.visible) continue;
    const dx = c.x - x, dz = c.z - z, d = Math.hypot(dx, dz);
    if (d > R + c.T.L * 0.4) continue;
    const f = 1 - Math.min(1, d / (R + 4));
    if (c.rail) unrail(c);
    const k = power * f / Math.pow(c.mass / 1000, 0.55);
    const nx = d > 0.01 ? dx / d : 1, nz = d > 0.01 ? dz / d : 0;
    c.vx += nx * k; c.vz += nz * k;
    c.vy = Math.max(c.vy, k * rand(0.35, 0.7)); c.y = Math.max(c.y, 0.05);
    c.wr += rand(-1, 1) * k * 0.45; c.wp += rand(-1, 1) * k * 0.45; c.w += rand(-1, 1) * k * 0.3;
    c.dmg = Math.min(1, c.dmg + f * 1.2);
    if (!c.counted && !c.player) wreck(c);
    else if (c.counted && !c.player) { const v = Math.round(120 * f * S.mult); addCash(v, 'blast'); }
    if (c.T.explosive && !c.boomed && c.fuse < 0) c.fuse = 0.25 + Math.random() * 0.35;
    if (c.dmg > 0.8 && !c.onFire) { c.onFire = true; c.fireT = rand(3, 6); }
  }
  // blast moves the camera focus
  S.focus.x += (x - S.focus.x) * 0.3; S.focus.z += (z - S.focus.z) * 0.3;
}

function blowUp(c) {
  if (c.boomed) return;
  c.boomed = true; c.fuse = -2; c.dmg = 1; c.onFire = true; c.fireT = 5;
  const big = !!c.T.explosive;
  explode(c.x, c.z, big ? 10.5 : 5.5, big ? 30 : 15, c);
  fx.debrisBurst(c.x, 1, c.z, c.vx, c.vz, big ? 14 : 8, c.type === 'tanker' ? '#d92a2a' : '#888', big ? 12 : 8);
  if (big) pop(c.x, c.z, 'TANKER BOOM!', 'fire');
  c.vy = Math.max(c.vy, big ? 7 : 4);
}

function crashBreaker() {
  const p = S.player;
  if (S.phase !== 'crash' || !p || p.gone || !S.breakReady) return;
  S.breakReady = false;
  const R = 12 * (1 + 0.13 * save.up.blast);
  p.gone = true; p.root.visible = false;
  S.free = S.free.filter((c) => c !== p);
  fx.debrisBurst(p.x, 1, p.z, p.vx, p.vz, 22, save.color, 16);
  bumpChain(3);
  pop(p.x, p.z, 'CRASHBREAKER!', 'fire');
  explode(p.x, p.z, R, 40, p);
  S.cine = 1.25; S.cineX = p.x; S.cineZ = p.z;
  ui.brk.classList.remove('ready');
}

/* ----------------------------------------------------------------- impact */
function impact(a, b, vn, px, pz) {
  if (vn < 1.5) return;
  const k = Math.min(1, vn / 20);
  sfx.hit(vn);
  if (vn > 3) fx.spark(px, 0.8, pz, Math.min(9, (vn * 0.5) | 0), vn * 0.5);
  S.shake = Math.max(S.shake, k * 0.7);
  const ra = b.mass / (a.mass + b.mass), rb = 1 - ra;
  if (b.rail === null && a.rail === null) {
    a.dmg = Math.min(1, a.dmg + vn * 0.03 * ra * 2);
    b.dmg = Math.min(1, b.dmg + vn * 0.03 * rb * 2);
  }
  if (vn > 6) {
    for (const [c, sh] of [[a, ra], [b, rb]]) {
      if (c.static) continue;
      if (Math.random() < 0.6) {
        c.vy = Math.max(c.vy, vn * 0.3 * sh * rand(0.5, 1.3));
        c.wr += rand(-1, 1) * vn * 0.4 * sh; c.wp += rand(-1, 1) * vn * 0.4 * sh;
      }
    }
  }
  if (vn > 8) fx.debrisBurst(px, 0.8, pz, 0, 0, Math.min(5, (vn / 4) | 0), a.player ? save.color : (a.hex || '#999'), vn * 0.5);
  if (vn > 5) fx.glassBurst(px, 1.1, pz, (a.vx + b.vx) * 0.5, (a.vz + b.vz) * 0.5, Math.min(9, (vn * 0.7) | 0));
  if (vn > 11) for (const c of [a, b]) if (!c.static && c.wheelsLost < 2 && Math.random() < 0.28) { c.wheelsLost++; fx.wheelBurst(c.x, c.y, c.z, c.vx, c.vz, 1); }
  if (a.player || b.player) { S.fovKick = Math.max(S.fovKick, k * 8); S.roll = (Math.random() - 0.5) * k * 0.07; S.punch = Math.max(S.punch, k); if (vn > 9 && S.chaseT > 0.9) S.chaseT = 0.9; }
  else if (vn > 10) S.punch = Math.max(S.punch, k * 0.45);
  if (vn > 3.2) {
    for (const c of [a, b]) if (!c.static && !c.counted && !c.player) wreck(c);
    if (a.player || b.player) { if (!S.breakReady && S.phase === 'crash') { S.breakReady = true; ui.brk.classList.add('ready'); toast('CRASHBREAKER BEREIT!', 900); } }
    if (!S.bigHit && vn > 12) { S.bigHit = true; S.slowT = 0.45; }
    if (S.t - a.lastCash > 0.12) {
      a.lastCash = S.t;
      const cash = Math.round(vn * 2 * S.mult);
      addCash(cash, 'impact');
    }
  }
  for (const c of [a, b]) if (!c.static && c.T.explosive && c.fuse < 0 && vn > 7) c.fuse = 0.4;
}

/* ------------------------------------------------------------- collisions */
const E_REST = 0.32;
function pair(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z, rr = a.rad + b.rad;
  if (dx * dx + dz * dz > rr * rr) return;
  if (Math.abs(a.y - b.y) > 1.3) return;
  const ahx = Math.cos(a.a), ahz = Math.sin(a.a), bhx = Math.cos(b.a), bhz = Math.sin(b.a);
  const rs = a.cr + b.cr;
  let bp = 0, nx = 0, nz = 0, px = 0, pz = 0;
  for (const oa of a.offs) {
    const ax = a.x + ahx * oa, az = a.z + ahz * oa;
    for (const ob of b.offs) {
      const bx = b.x + bhx * ob, bz = b.z + bhz * ob, ddx = ax - bx, ddz = az - bz, d2 = ddx * ddx + ddz * ddz;
      if (d2 < rs * rs) {
        const d = Math.sqrt(d2) || 0.001, pen = rs - d;
        if (pen > bp) { bp = pen; nx = ddx / d; nz = ddz / d; px = (ax - nx * a.cr + bx + nx * b.cr) / 2; pz = (az - nz * a.cr + bz + nz * b.cr) / 2; }
      }
    }
  }
  if (bp <= 0) return;
  if (b.rail) unrail(b);
  if (a.rail) unrail(a);
  const ia = 1 / a.mass, ib = 1 / b.mass, tot = ia + ib;
  a.x += nx * bp * (ia / tot); a.z += nz * bp * (ia / tot);
  b.x -= nx * bp * (ib / tot); b.z -= nz * bp * (ib / tot);
  const rax = px - a.x, raz = pz - a.z, rbx = px - b.x, rbz = pz - b.z;
  const vax = a.vx - a.w * raz, vaz = a.vz + a.w * rax, vbx = b.vx - b.w * rbz, vbz = b.vz + b.w * rbx;
  const vn = (vax - vbx) * nx + (vaz - vbz) * nz;
  if (vn >= 0) return;
  const raxn = rax * nz - raz * nx, rbxn = rbx * nz - rbz * nx;
  const den = ia + ib + (raxn * raxn) / a.I + (rbxn * rbxn) / b.I;
  const j = (-(1 + E_REST) * vn) / den;
  a.vx += nx * j * ia; a.vz += nz * j * ia; a.w += (raxn * j) / a.I;
  b.vx -= nx * j * ib; b.vz -= nz * j * ib; b.w -= (rbxn * j) / b.I;
  impact(a, b, -vn, px, pz);
}

function collide() {
  const free = S.free;
  for (let i = 0; i < free.length; i++) {
    const a = free[i];
    if (a.gone) continue;
    for (let j = i + 1; j < free.length; j++) { const b = free[j]; if (!b.gone) pair(a, b); }
    for (const l of S.world.lanes) for (let k = l.cars.length - 1; k >= 0; k--) { const b = l.cars[k]; if (b) pair(a, b); }
  }
  // static colliders
  const cols = S.world.colliders;
  for (const c of free) {
    if (c.gone || c.y > 14) continue;
    const hx = Math.cos(c.a), hz = Math.sin(c.a);
    for (const o of c.offs) {
      const cx = c.x + hx * o, cz = c.z + hz * o;
      for (const b of cols) {
        const qx = clamp(cx, b.minx, b.maxx), qz = clamp(cz, b.minz, b.maxz);
        let dx = cx - qx, dz = cz - qz, d2 = dx * dx + dz * dz;
        if (d2 >= c.cr * c.cr) continue;
        let d = Math.sqrt(d2), pen;
        if (d < 0.0001) { // centre inside box: push along smallest axis
          const l = cx - b.minx, r = b.maxx - cx, t = cz - b.minz, bt = b.maxz - cz, m = Math.min(l, r, t, bt);
          dx = m === l ? -1 : m === r ? 1 : 0; dz = m === t ? -1 : m === bt ? 1 : 0; d = 1; pen = m + c.cr;
        } else { dx /= d; dz /= d; pen = c.cr - d; }
        c.x += dx * pen; c.z += dz * pen;
        const vn = c.vx * dx + c.vz * dz;
        if (vn < 0) {
          c.vx -= (1 + 0.28) * vn * dx; c.vz -= (1 + 0.28) * vn * dz;
          c.w *= 0.7;
          impact(c, { static: true, mass: 1e9, dmg: 0, rail: null, counted: true, T: {}, lastCash: 0, vy: 0, wr: 0, wp: 0, player: false }, -vn, cx - dx * c.cr, cz - dz * c.cr);
        }
      }
    }
  }
}

/* -------------------------------------------------------- integrate free */
function integrate(c, dt) {
  const air = c.y > 0.001 || c.vy > 0;
  if (air) {
    c.vy -= G * dt; c.y += c.vy * dt; c.pitch += c.wp * dt; c.roll += c.wr * dt;
    if (c.y <= 0 && c.vy < 0) {
      c.y = 0;
      if (c.vy < -5) {
        sfx.land(-c.vy); fx.dust(c.x, c.z, 4);
        if (c.vy < -9) { c.dmg = Math.min(1, c.dmg + -c.vy * 0.012); if (!c.counted && !c.player) wreck(c); S.shake = Math.max(S.shake, 0.25); }
        c.vy = -c.vy * 0.22; if (c.vy < 1.6) c.vy = 0;
      } else c.vy = 0;
      c.wp *= 0.35; c.wr *= 0.35;
    }
  }
  const grounded = c.y <= 0.001 && c.vy === 0;
  const hx = Math.cos(c.a), hz = Math.sin(c.a);
  if (grounded) {
    const kk = Math.min(1, dt * 9);
    c.pitch += (Math.round(c.pitch / Math.PI) * Math.PI - c.pitch) * kk;
    c.roll += (Math.round(c.roll / Math.PI) * Math.PI - c.roll) * kk;
    c.wp *= Math.exp(-6 * dt); c.wr *= Math.exp(-6 * dt);
    const flipped = Math.cos(c.pitch) * Math.cos(c.roll) < 0;
    let vf = c.vx * hx + c.vz * hz, vl = -c.vx * hz + c.vz * hx;
    vf *= Math.exp(-(flipped ? 2.4 : 0.55 + c.dmg * 0.5) * dt);
    vl *= Math.exp(-(flipped ? 2.2 : 4.5) * dt);
    const sp = Math.hypot(vf, vl);
    if (sp > 0) { const d = Math.max(0, sp - (flipped ? 3.5 : 1.6) * dt) / sp; vf *= d; vl *= d; }
    c.vx = hx * vf - hz * vl; c.vz = hz * vf + hx * vl;
    c.w *= Math.exp(-1.7 * dt);
    if (sp > 4 && (Math.abs(vl) > 2.4 || (flipped && sp > 5))) {
      c.skidD += sp * dt;
      if (c.skidD > 0.9) {
        c.skidD = 0;
        const ang = Math.atan2(c.vz, c.vx), qx = -Math.sin(ang), qz = Math.cos(ang);
        if (!flipped) for (const sg of [-1, 1]) fx.skid(c.x + qx * sg * c.T.W * 0.38 - hx * c.T.L * 0.3, c.z + qz * sg * c.T.W * 0.38 - hz * c.T.L * 0.3, ang, 1.5, 0.26);
        else { fx.skid(c.x, c.z, ang, 1.8, 0.7); fx.spark(c.x, 0.3, c.z, 3, 6); }
        if (Math.random() < 0.5) fx.smokePuff(c.x, 0.3, c.z, 0.8, 0.16);
      }
    }
    // align heading to velocity when driving freely (undamaged skid)
    if (!flipped && c.player && sp > 3) {
      const tgt = Math.atan2(c.vz, c.vx);
      let da = tgt - c.a; da = Math.atan2(Math.sin(da), Math.cos(da));
      c.w += da * 0.8 * dt * 10 * Math.min(1, sp / 15);
    }
  } else c.w *= Math.exp(-0.15 * dt);
  c.w = clamp(c.w, -12, 12);
  c.x += c.vx * dt; c.z += c.vz * dt; c.a += c.w * dt;
}

/* ---------------------------------------------------------- aftertouch */
function aftertouch(dt) {
  const p = S.player, st = S.stick;
  if (!p || p.gone || !st.active || S.after <= 0 || S.phase !== 'crash') return;
  const f = 36 * st.mag;
  const ca = Math.cos(S.cam.az), sa = Math.sin(S.cam.az);
  p.vx += (ca * st.x + sa * st.y) * f * dt; p.vz += (-sa * st.x + ca * st.y) * f * dt;
  S.after = Math.max(0, S.after - (dt * st.mag) / S.afterMax);
  if (p.y < 0.01 && Math.random() < 0.3) fx.spark(p.x, 0.2, p.z, 1, 3);
}

/* ------------------------------------------------------------ simulation */
let frameNo = 0;
function stepPhysics(dt) {
  S.t += dt; S.lightT += dt;
  updateRails(dt);
  if (S.phase === 'crash' || S.phase === 'tally' || S.mode === 'menu') {
    aftertouch(dt);
    for (const c of S.free) if (!c.gone) integrate(c, dt);
    collide();
  } else if (S.free.length) {
    for (const c of S.free) if (!c.gone) integrate(c, dt);
    collide();
  }
  // chain timer
  if (S.chain > 0) { S.chainT -= dt; if (S.chainT <= 0) { S.chain = 0; S.mult = 1; } }
  // fire / fuses
  for (const c of S.free) {
    if (c.gone) continue;
    if (c.fuse > 0) { c.fuse -= dt; if (Math.random() < 0.5) fx.flame(c.x, 1.2, c.z); if (c.fuse <= 0) blowUp(c); }
  }
}

function effectsTick(dt) {
  for (const c of S.free) {
    if (c.gone) continue;
    if (c.dmg > 0.45 || c.onFire) {
      c.smokeT -= dt;
      if (c.smokeT <= 0) { c.smokeT = c.onFire ? 0.06 : 0.14; fx.smokePuff(c.x, 1 + c.y, c.z, c.onFire ? 2 : 1.3, c.onFire ? 0.55 : 0.35); if (c.onFire) fx.flame(c.x, 0.9 + c.y, c.z); }
    }
    if (c.onFire) {
      c.fireT -= dt;
      if (c.fireT <= 0) { c.onFire = false; if (!c.boomed && c.dmg > 0.9 && !c.player && Math.random() < 0.35 && S.phase === 'crash') c.fuse = 0.2; }
    } else if (c.dmg > 0.85 && !c.boomed && !c.player && c.counted) { c.onFire = true; c.fireT = rand(2.5, 5); }
    if (c.T.explosive && c.counted && c.fuse < 0 && !c.boomed && c.dmg > 0.7) c.fuse = 0.3;
  }
}

/* --------------------------------------------------------------- phases */
function modelStats() { return TYPES[save.model]; }
function aimHeading() { return S.world.toCenter + S.aim; }

function prepareAim() {
  const w = S.world;
  if (S.player && !S.player.gone) { /* old player stays as wreck */ }
  const p = newCar(save.model, save.color);
  p.player = true; p.counted = true; p.mass *= 1 + 0.07 * save.up.power; p.I *= 1 + 0.07 * save.up.power;
  p.x = w.start.x; p.z = w.start.z; p.y = 0.7; p.a = aimHeading();
  S.player = p; S.aim = 0; p.a = aimHeading();
  S.chaseT = 0; S.cine = 0; S.camSnap = false;
  S.phase = 'aim'; S.breakReady = false; S.crashScore = 0; S.bigHit = false; S.timeSince = 0; S.quiet = 0;
  S.after = 1; S.afterMax = 2.6 * (1 + 0.28 * save.up.after);
  S.chain = 0; S.mult = 1;
  S.zoomW = S.L.view;
  ui.launch.classList.remove('hidden'); ui.stop.classList.add('hidden'); ui.gauge.style.display = 'none';
  ui.brk.classList.add('hidden'); ui.brk.classList.remove('ready');
  ui.hint.textContent = 'WISCHEN ZUM ZIELEN'; ui.hint.style.display = '';
  document.querySelector('#after').style.display = document.querySelector('#afterLbl').style.display = 'none';
  S.arrow.visible = true;
  renderCars();
  syncCar(p);
}

function startPower() {
  if (S.phase !== 'aim') return;
  S.phase = 'power'; S.gaugeT = 0;
  ui.launch.classList.add('hidden'); ui.stop.classList.remove('hidden'); ui.gauge.style.display = 'block';
  ui.hint.textContent = 'TIPPEN IM GELBEN BEREICH!';
  sfx.click();
}
function doLaunch() {
  if (S.phase !== 'power') return;
  const n = S.needle;
  let power = n;
  if (n > 0.97) { power = 0.55; toast('ÜBERDREHT!', 900); sfx.fail(); }
  else if (n >= 0.86) { power = 1; addCash(2500); toast('PERFEKTER START! +$2,500', 1000); sfx.tally(); }
  S.power = power;
  const T = modelStats();
  const v = lerp(24, 54, power) * (1 + 0.05 * save.up.power) * (T.launch || 1);
  const p = S.player, h = aimHeading();
  p.vx = Math.cos(h) * v; p.vz = Math.sin(h) * v; p.vy = 6.5; p.y = 0.8; p.a = h;
  S.free.push(p);
  S.phase = 'crash'; S.timeSince = 0; S.quiet = 0;
  S.arrow.visible = false;
  S.zoomW = Math.min(S.L.view, 62);
  ui.stop.classList.add('hidden'); ui.gauge.style.display = 'none'; ui.hint.textContent = '';
  ui.brk.classList.remove('hidden');
  document.querySelector('#after').style.display = document.querySelector('#afterLbl').style.display = '';
  ui.hint.textContent = 'FINGER ZIEHEN = AFTERTOUCH';
  setTimeout(() => { if (S.phase === 'crash' && ui.hint.textContent.startsWith('FINGER')) ui.hint.textContent = ''; }, 3500);
  S.chaseT = 2.4; S.fovKick = 6;
  fx.tireSmoke(p.x, p.z, p.vx, p.vz, 14); fx.spark(p.x, 0.6, p.z, 14, 9);
  sfx.launch(); vibrate(25);
}

function endCrash() {
  S.phase = 'tally'; S.phaseT = 2.4;
  const p = S.player;
  S.player = null;
  if (p && !p.gone) { /* stays as wreck obstacle */ }
  ui.tally.innerHTML = 'CRASH-WERTUNG<b>' + fmt(S.crashScore) + '</b>';
  ui.tally.style.display = '';
  ui.brk.classList.add('hidden'); ui.brk.classList.remove('ready');
  document.querySelector('#after').style.display = document.querySelector('#afterLbl').style.display = 'none';
  S.stick.active = false; ui.stick.style.display = 'none';
  S.chain = 0; S.mult = 1;
  sfx.tally();
}

function afterTally() {
  ui.tally.style.display = 'none';
  if (S.carsUsed >= S.carsTotal) showResults(); else { S.carsUsed++; renderCars(); prepareAim(); }
}

function startLevel(i) {
  initAudio(); resumeAudio();
  save.last = i; persist();
  loadLevel(i);
  S.mode = 'play'; S.score = 0; S.disp = 0; S.wrecks = 0;
  S.carsTotal = 3 + save.up.cars; S.carsUsed = 1;
  S.paused = false;
  showScreen(null);
  ui.name.textContent = (i + 1) + ' · ' + S.L.name;
  ui.tally.style.display = 'none'; ui.toast.style.opacity = 0;
  const g = S.L.goals[2];
  ui.goal.children[1].style.left = (S.L.goals[0] / g) * 100 + '%'; ui.goal.children[2].style.left = (S.L.goals[1] / g) * 100 + '%';
  prepareAim();
  S.camSnap = true;
}

function renderCars() {
  let h = '';
  for (let i = 0; i < S.carsTotal; i++) h += '<i class="' + (i < S.carsUsed - 1 ? 'used' : '') + '"></i>';
  ui.cars.innerHTML = h;
}

function medalFor(score, L) { return score >= L.goals[2] ? 3 : score >= L.goals[1] ? 2 : score >= L.goals[0] ? 1 : 0; }

function showResults() {
  S.phase = 'results';
  const L = S.L, m = medalFor(S.score, L);
  const bonus = [0, 10000, 25000, 50000][m];
  const total = S.score + bonus;
  save.money += total;
  const prev = save.medals[S.li] || 0;
  if (m > prev) save.medals[S.li] = m;
  if (m >= 1 && save.unlocked < S.li + 2) save.unlocked = Math.min(LEVELS.length, S.li + 2);
  persist();
  const next = m >= 1 && S.li + 1 < LEVELS.length;
  const icons = ['😵', '🥉', '🥈', '🥇'];
  const names = ['KEINE MEDAILLE', 'BRONZE', 'SILBER', 'GOLD'];
  screens.results.innerHTML = `<div class="res"><h2>${m ? 'LEVEL GESCHAFFT' : 'ZU WENIG CRASH'}</h2><div class="medalbig">${icons[m]}</div><b>${names[m]}</b>
  <table><tr><td>Crash-Wertung</td><td>${fmt(S.score)}</td></tr><tr><td>Zerstörte Fahrzeuge</td><td>${S.wrecks}</td></tr><tr><td>Medaillen-Bonus</td><td>${fmt(bonus)}</td></tr><tr><td>Bronze / Silber / Gold</td><td>${L.goals.map((g) => (g / 1000) + 'k').join(' / ')}</td></tr><tr><td><b>Verdient</b></td><td><b>${fmt(total)}</b></td></tr></table>
  ${next ? '<button class="btn" id="rNext">NÄCHSTE KREUZUNG</button>' : ''}<button class="btn ${next ? 'dark' : ''}" id="rAgain">NOCHMAL</button><button class="btn dark small" id="rGarage">GARAGE</button><button class="btn dark small" id="rMenu">MENÜ</button></div>`;
  showScreen('results');
  $('rAgain').onclick = () => { sfx.click(); startLevel(S.li); };
  $('rMenu').onclick = () => { sfx.click(); toMenu('levels'); };
  $('rGarage').onclick = () => { sfx.click(); toMenu('garage'); };
  if (next) $('rNext').onclick = () => { sfx.click(); startLevel(S.li + 1); };
  m ? sfx.fanfare() : sfx.fail();
}

/* ---------------------------------------------------------------- menus */
function toMenu(screen = 'title') {
  const wasPlay = S.mode === 'play';
  S.mode = 'menu'; S.phase = 'none'; S.paused = false;
  S.stick.active = false; ui.stick.style.display = 'none';
  if (wasPlay || !S.world || S.li !== (save.last || 0)) loadLevel(Math.min(save.last || 0, LEVELS.length - 1));
  if (S.showcase && screen !== 'garage') { scene.remove(S.showcase.root); S.cars = S.cars.filter((c) => c !== S.showcase); S.showcase = null; }
  showScreen(screen);
  if (S.world) S.world.ramp.visible = screen !== 'garage';
  if (screen === 'levels') renderLevels();
  if (screen === 'garage') { renderGarage(); makeShowcase(); }
  $('titleMoney').textContent = fmt(save.money);
  $('soundBtn').textContent = isMuted() ? 'SOUND AUS' : 'SOUND AN';
}

function renderLevels() {
  document.querySelectorAll('.lvMoney').forEach((e) => (e.textContent = fmt(save.money)));
  const list = $('lvlList'); list.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const locked = i >= save.unlocked, m = save.medals[i] || 0;
    const d = document.createElement('div'); d.className = 'card' + (locked ? ' locked' : '');
    d.innerHTML = `<div class="n">${locked ? '🔒' : i + 1}</div><div class="t"><b>${L.name}</b><small>${L.sub} · Gold ${(L.goals[2] / 1000)}k</small></div><div class="medals"><span class="medal ${m >= 1 ? 'on' : ''}">🥉</span><span class="medal ${m >= 2 ? 'on' : ''}">🥈</span><span class="medal ${m >= 3 ? 'on' : ''}">🥇</span></div>`;
    d.onclick = () => { sfx.click(); startLevel(i); };
    list.appendChild(d);
  });
}

const upCost = (lvlN) => Math.round(15000 * Math.pow(lvlN + 1, 1.6) / 1000) * 1000;
const UPS = [
  { k: 'power', name: 'LAUNCH-POWER', desc: 'Mehr Tempo & Masse beim Start', max: 5, cost: upCost },
  { k: 'blast', name: 'CRASHBREAKER-RADIUS', desc: 'Größere Explosion', max: 5, cost: upCost },
  { k: 'after', name: 'AFTERTOUCH', desc: 'Längere Lenkzeit nach dem Start', max: 5, cost: upCost },
  { k: 'cars', name: 'EXTRA AUTO', desc: '+1 Auto pro Kreuzung', max: 2, cost: (n) => [60000, 180000][n] },
];
function renderGarage() {
  document.querySelectorAll('.lvMoney').forEach((e) => (e.textContent = fmt(save.money)));
  const l = $('garList'); l.innerHTML = '';
  const mod = document.createElement('div'); mod.className = 'row'; mod.style.gap = '8px';
  PLAYER_MODELS.forEach((m) => {
    const owned = save.owned.includes(m.id);
    const c = document.createElement('div'); c.className = 'chip' + (save.model === m.id ? ' sel' : '');
    c.innerHTML = `${m.name}<small>${owned ? m.desc : fmt(m.price)}</small>`;
    c.onclick = () => {
      if (!owned) { if (save.money < m.price) { sfx.fail(); return; } save.money -= m.price; save.owned.push(m.id); sfx.coin(); }
      save.model = m.id; persist(); sfx.click(); renderGarage(); makeShowcase();
    };
    mod.appendChild(c);
  });
  l.appendChild(mod);
  const sw = document.createElement('div'); sw.className = 'sw';
  PLAYER_COLORS.forEach((col) => {
    const i = document.createElement('i'); i.style.background = col; if (save.color === col) i.className = 'sel';
    i.onclick = () => { save.color = col; persist(); sfx.click(); renderGarage(); makeShowcase(); };
    sw.appendChild(i);
  });
  l.appendChild(sw);
  for (const u of UPS) {
    const n = save.up[u.k], maxed = n >= u.max, cost = maxed ? 0 : u.cost(n);
    const d = document.createElement('div'); d.className = 'up';
    d.innerHTML = `<div class="t"><b>${u.name}</b><small>${u.desc}</small><div class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div></div>`;
    const b = document.createElement('button'); b.className = 'btn small' + (maxed ? ' dark' : ''); b.textContent = maxed ? 'MAX' : fmt(cost);
    b.disabled = maxed || save.money < cost;
    b.onclick = () => { if (save.money >= cost) { save.money -= cost; save.up[u.k]++; persist(); sfx.coin(); renderGarage(); } };
    d.appendChild(b); l.appendChild(d);
  }
}
function makeShowcase() {
  if (S.showcase) { scene.remove(S.showcase.root); S.cars = S.cars.filter((c) => c !== S.showcase); S.showcase.mat.dispose(); }
  const c = newCar(save.model, save.color);
  c.player = true; c.counted = true; c.x = S.world.start.x; c.z = S.world.start.z; c.y = 0.7; c.showcase = true;
  S.showcase = c; syncCar(c);
}

/* ------------------------------------------------------------ aim arrow */
function buildArrow() {
  const g = new THREE.Group();
  const geo = new THREE.ConeGeometry(0.9, 1.8, 3).rotateZ(-Math.PI / 2).scale(1, 0.12, 1.6);
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd500, transparent: true, opacity: 0.9, depthWrite: false }));
    m.position.y = 1.2; g.add(m);
  }
  S.arrow = g; g.visible = false; scene.add(g);
}
function updateArrow() {
  const a = S.arrow, p = S.player;
  if (!a || !a.visible || !p) return;
  const h = aimHeading(), off = (S.t * 12) % 4;
  a.children.forEach((m, i) => {
    const d = 4 + i * 4 + off;
    m.position.set(p.x + Math.cos(h) * d, 1.3, p.z + Math.sin(h) * d);
    m.rotation.y = -h;
    m.material.opacity = clamp(1 - i / 9, 0.1, 1);
    m.scale.setScalar(1 + i * 0.07);
  });
}

/* --------------------------------------------------------------- camera */
const aLerp = (a, b, t) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * t; };
const distForW = (W, fov) => { const tv = Math.tan((fov * Math.PI) / 360), th = tv * camera.aspect; return Math.max(W / 2 / th, (W * 0.85) / 2 / tv); };
const TG = { fx: 0, fz: 0, dist: 80, el: 58, az: 0, fov: 42, lookY: 0, rate: 2.5 };
const OV = { fx: 0, fz: 0, dist: 80, el: 58, az: 0, fov: 42, lookY: 0 };
function overheadTarget(T) {
  const p = S.player;
  let sx = 0, sz = 0, n = 0;
  if (p && !p.gone) { sx = p.x; sz = p.z; n = 1; }
  for (const c of S.free) { if (c.gone || c === p) continue; const sp = Math.hypot(c.vx, c.vz); if (sp > 4 || c.fuse > 0) { sx += c.x * 0.6; sz += c.z * 0.6; n += 0.6; } }
  if (n > 0) { T.fx = sx / n; T.fz = sz / n; } else { T.fx = S.cam.fx; T.fz = S.cam.fz; }
  T.dist = distForW(S.phase === 'tally' ? 66 : 50, 42); T.el = 58; T.az = 0; T.fov = 42; T.lookY = 0;
}
// first parametric hit (0..1) of a segment with any building box, 2 = free
function segHit(x0, y0, z0, x1, y1, z1) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, M = 1.6;
  let best = 2;
  for (const b of S.world.colliders) {
    if (!b.h) continue;
    let tmin = 0, tmax = 1, ok = true;
    const axes = [[x0, dx, b.minx - M, b.maxx + M], [y0, dy, 0, b.h], [z0, dz, b.minz - M, b.maxz + M]];
    for (const [o, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) { ok = false; break; } continue; }
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) { ok = false; break; }
    }
    if (ok && tmin < best) best = tmin;
  }
  return best;
}
// lift / pull the camera until the view of the focus point is not blocked by a building
function clearView(T) {
  if (!S.world) return;
  const base = T.el, d = T.dist;
  let lastT = 2;
  for (const add of [0, 10, 20, 32, 46]) {
    const el = Math.min(76, base + add), e = (el * Math.PI) / 180;
    const cx = T.fx + Math.sin(T.az) * Math.cos(e) * d, cy = Math.sin(e) * d, cz = T.fz + Math.cos(T.az) * Math.cos(e) * d;
    lastT = segHit(T.fx, T.lookY + 0.6, T.fz, cx, cy, cz);
    if (lastT > 1) { T.el = el; return; }
  }
  T.el = Math.min(76, base + 46);
  T.dist = d * Math.max(0.3, lastT - 0.08);
}
function computeCamTarget(rdt) {
  const T = TG; T.rate = 2.6; T.lookY = 0;
  if (S.mode === 'menu') {
    S.orbit += rdt * 0.07;
    const garage = !screens.garage.classList.contains('hidden');
    if (garage && S.world) {
      T.fx = S.world.start.x; T.fz = S.world.start.z; T.fov = 34; T.dist = 8.5; T.el = 15; T.az = -0.55 + Math.sin(S.orbit * 3) * 0.25; T.lookY = 0.8; T.rate = 3;
      S.viewShiftT = 0.4;
    } else {
      T.fx = 0; T.fz = 0; T.fov = 38; T.az = S.orbit; T.el = 34 + Math.sin(S.orbit * 0.7) * 5; T.dist = distForW(70, 38); T.lookY = 0; T.rate = 1.2;
      S.viewShiftT = 0;
    }
    return T;
  }
  S.viewShiftT = 0;
  const p = S.player;
  if (S.phase === 'aim' || S.phase === 'power') {
    const h = aimHeading();
    T.az = Math.atan2(-Math.cos(h), -Math.sin(h));
    T.fx = p.x + Math.cos(h) * 11; T.fz = p.z + Math.sin(h) * 11;
    T.el = 33; T.dist = 40; T.lookY = 0.5; T.rate = 3.2;
    T.fov = 46 - (S.phase === 'power' ? (S.needle || 0) * 9 : 0);
    return T;
  }
  overheadTarget(OV);
  let c = 0;
  if (S.phase === 'crash' && p && !p.gone) c = clamp(S.chaseT / 0.9, 0, 1);
  S.chaseT -= rdt;
  c = c * c * (3 - 2 * c);
  if (c > 0.001) {
    const sp = Math.hypot(p.vx, p.vz), ang = sp > 2 ? Math.atan2(p.vz, p.vx) : p.a;
    const cz = { fx: p.x + Math.cos(ang) * 8, fz: p.z + Math.sin(ang) * 8, az: Math.atan2(-Math.cos(ang), -Math.sin(ang)), dist: 25, el: 25, fov: 48 + Math.min(14, sp * 0.3), lookY: 1.1 };
    T.fx = lerp(OV.fx, cz.fx, c); T.fz = lerp(OV.fz, cz.fz, c); T.dist = lerp(OV.dist, cz.dist, c); T.el = lerp(OV.el, cz.el, c);
    T.fov = lerp(OV.fov, cz.fov, c); T.lookY = lerp(OV.lookY, cz.lookY, c); T.az = aLerp(OV.az, cz.az, c); T.rate = 4.5;
    S.speedFx = c * clamp((sp - 20) / 28, 0, 1);
  } else { Object.assign(T, OV); T.rate = 3; S.speedFx = 0; }
  if (S.cine > 0) {
    S.cine -= rdt;
    T.fx = S.cineX; T.fz = S.cineZ; T.dist = distForW(30, 38); T.el = 30; T.az = 0.6 + (1.25 - S.cine) * 0.7; T.fov = 38; T.lookY = 1.5; T.rate = 6;
  }
  return T;
}
function updateCamera(dt, rdt) {
  const T = computeCamTarget(S.paused ? 0 : rdt), C = S.cam;
  clearView(T);
  if (S.camSnap) { Object.assign(C, T); S.camSnap = false; }
  const k = (r) => 1 - Math.exp(-r * rdt), r = T.rate;
  C.fx += (T.fx - C.fx) * k(r); C.fz += (T.fz - C.fz) * k(r);
  C.dist += (T.dist - C.dist) * k(r * 0.8); C.el += (T.el - C.el) * k(r * 0.9);
  C.az = aLerp(C.az, T.az, k(r)); C.fov += (T.fov - C.fov) * k(r * 1.3); C.lookY += (T.lookY - C.lookY) * k(r);
  S.fovKick *= Math.exp(-6 * rdt); S.punch *= Math.exp(-5 * rdt); S.roll *= Math.exp(-4 * rdt);
  const d = C.dist * (1 - S.punch * 0.1), el = (C.el * Math.PI) / 180;
  const sx = (Math.random() - 0.5) * S.shake * 1.5, sz = (Math.random() - 0.5) * S.shake * 1.5, sy = (Math.random() - 0.5) * S.shake;
  camera.position.set(C.fx + Math.sin(C.az) * Math.cos(el) * d + sx, Math.sin(el) * d + sy, C.fz + Math.cos(C.az) * Math.cos(el) * d + sz);
  camera.up.set(0, 1, 0);
  camera.lookAt(C.fx + sx * 0.4, C.lookY, C.fz + sz * 0.4);
  camera.rotateZ(S.roll);
  const fov = C.fov + S.fovKick;
  S.viewShift += ((S.viewShiftT || 0) - S.viewShift) * k(5);
  if (Math.abs(fov - camera.fov) > 0.04 || Math.abs(S.viewShift - (S.vsApplied || 0)) > 0.001) {
    camera.fov = fov;
    const w = window.innerWidth, h = window.innerHeight;
    if (S.viewShift > 0.002) camera.setViewOffset(w, h, 0, h * S.viewShift, w, h); else camera.clearViewOffset();
    S.vsApplied = S.viewShift;
    camera.updateProjectionMatrix();
    fx.setScale((h * dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360)));
  }
  sky.position.copy(camera.position);
  // sun + shadow frustum follow the action
  const fxp = Math.round(C.fx / 2) * 2, fzp = Math.round(C.fz / 2) * 2;
  sun.position.set(fxp + SUN_DIR.x * 130, SUN_DIR.y * 130, fzp + SUN_DIR.z * 130);
  sun.target.position.set(fxp, 0, fzp);
  ui.speed.style.opacity = S.speedFx * 0.85;
}

/* --------------------------------------------------------------- input */
const app = $('app');
let aimLast = null;
app.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button') || e.target.closest('.screen')) return;
  initAudio(); resumeAudio();
  if (S.paused) return;
  if (S.phase === 'aim') { aimLast = { id: e.pointerId, x: e.clientX }; }
  else if (S.phase === 'power') doLaunch();
  else if (S.phase === 'crash') {
    const st = S.stick; st.active = true; st.id = e.pointerId; st.ox = e.clientX; st.oy = e.clientY; st.x = st.y = st.mag = 0;
    ui.stick.style.display = 'block'; ui.stick.style.left = e.clientX + 'px'; ui.stick.style.top = e.clientY + 'px'; ui.knob.style.transform = '';
  }
});
window.addEventListener('pointermove', (e) => {
  if (aimLast && e.pointerId === aimLast.id && S.phase === 'aim') {
    S.aim = clamp(S.aim + (e.clientX - aimLast.x) * 0.006, -1.0, 1.0); aimLast.x = e.clientX;
    if (S.player) S.player.a = aimHeading();
  }
  const st = S.stick;
  if (st.active && e.pointerId === st.id) {
    let dx = e.clientX - st.ox, dy = e.clientY - st.oy; const len = Math.hypot(dx, dy), max = 55;
    if (len > 0) { st.x = dx / len; st.y = dy / len; }
    st.mag = clamp(len / max, 0, 1);
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    ui.knob.style.transform = `translate(${dx}px,${dy}px)`;
  }
});
const up = (e) => {
  if (aimLast && e.pointerId === aimLast.id) aimLast = null;
  if (S.stick.active && e.pointerId === S.stick.id) { S.stick.active = false; S.stick.mag = 0; ui.stick.style.display = 'none'; }
};
window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

const press = (el, fn) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); initAudio(); resumeAudio(); fn(); });
press(ui.launch, startPower);
press(ui.stop, doLaunch);
press(ui.brk, crashBreaker);
press($('pauseBtn'), () => { if (S.mode === 'play' && S.phase !== 'results') { S.paused = true; showScreen('pause'); ui.hud.classList.remove('hidden'); } });
$('resumeBtn').onclick = () => { S.paused = false; showScreen(null); };
$('restartBtn').onclick = () => { startLevel(S.li); };
$('quitBtn').onclick = () => { toMenu('levels'); };
$('playBtn').onclick = () => { initAudio(); resumeAudio(); sfx.click(); toMenu('levels'); };
$('garageBtn').onclick = () => { initAudio(); resumeAudio(); sfx.click(); toMenu('garage'); };
$('soundBtn').onclick = () => { initAudio(); const m = !isMuted(); setMuted(m); save.mute = m; persist(); $('soundBtn').textContent = m ? 'SOUND AUS' : 'SOUND AN'; sfx.click(); };
document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => { sfx.click(); toMenu('title'); }));
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); if (S.phase === 'aim') startPower(); else if (S.phase === 'power') doLaunch(); else crashBreaker(); }
  if (e.code === 'ArrowLeft' && S.phase === 'aim') { S.aim = clamp(S.aim - 0.06, -1, 1); S.player.a = aimHeading(); }
  if (e.code === 'ArrowRight' && S.phase === 'aim') { S.aim = clamp(S.aim + 0.06, -1, 1); S.player.a = aimHeading(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && S.mode === 'play' && S.phase !== 'results' && !S.paused) { S.paused = true; showScreen('pause'); ui.hud.classList.remove('hidden'); } });

/* ----------------------------------------------------------------- glows */
const LAMP_COL = { green: [0.2, 1, 0.45], yellow: [1, 0.75, 0.1], red: [1, 0.12, 0.1] };
function updateGlows() {
  const g = fx.glow; g.begin();
  for (const c of S.cars) {
    if (!c.root.visible || c.gone || c.showcase) continue;
    const f = 1 - c.dmg;
    if (f < 0.12) continue;
    const flick = c.dmg > 0.4 ? (Math.sin(S.t * 38 + c.id * 3) > -0.2 ? 1 : 0.15) : 1;
    const hx = Math.cos(c.a), hz = Math.sin(c.a), qx = -hz, qz = hx, L2 = c.T.L / 2, wz = c.T.W * 0.3, y = 0.75 + c.y;
    const br = c.braking;
    for (const sg of [-1, 1]) {
      g.add(c.x + hx * L2 + qx * sg * wz, y, c.z + hz * L2 + qz * sg * wz, 1.2, 1, 0.94, 0.72, 0.6 * f * flick);
      g.add(c.x - hx * L2 + qx * sg * wz, y, c.z - hz * L2 + qz * sg * wz, br ? 1.7 : 0.8, 1, 0.07, 0.06, (br ? 0.9 : 0.5) * f * flick);
    }
    if (c.type === 'police') { const ph = Math.sin(S.t * 12 + c.id) > 0; g.add(c.x, 2.0 + c.y, c.z, 3.4, ph ? 1 : 0.15, 0.1, ph ? 0.1 : 1, 0.85); }
  }
  const w = S.world;
  if (w) {
    for (const p of w.poles) { const st = S.lampState[p.group]; if (!st) continue; const c = LAMP_COL[st]; g.add(p.x, p.y, p.z, 2.0, c[0], c[1], c[2], 0.75); }
    for (const h of w.lampHeads) g.add(h.x, h.y, h.z, 2.2, 1, 0.82, 0.5, 0.2);
  }
  g.end();
}

/* ----------------------------------------------------------------- loop */
let last = performance.now(), ema = 1 / 60, slow = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.05, (now - last) / 1000); last = now;
  if (rdt <= 0) return;
  ema = ema * 0.95 + rdt * 0.05;
  if (ema > 0.026 && !HQ) {
    slow++;
    if (slow > 70) {
      if (shadowsOn && dpr <= 1.25) { shadowsOn = false; sun.castShadow = false; }
      else if (dpr > 1) { dpr = Math.max(1, dpr - 0.25); resize(); }
      else if (shadowsOn) { shadowsOn = false; sun.castShadow = false; }
      slow = 0; ema = 1 / 60;
    }
  } else slow = 0;
  update(rdt);
  if (S.world) { updateCamera(rdt * (S.paused ? 0 : 1), rdt); renderer.render(scene, camera); }
}
function update(rdt) {
  frameNo++;
  if (!S.paused && S.world) {
    S.ts += ((S.slowT > 0 ? 0.35 : 1) - S.ts) * Math.min(1, rdt * 9);
    S.slowT -= rdt;
    const dt = rdt * S.ts;
    const n = Math.max(1, Math.ceil(dt / (1 / 100))), h = dt / n;
    for (let i = 0; i < n; i++) stepPhysics(h);
    effectsTick(dt);
    updatePickups(dt);
    fx.update(dt);
    updateLamps(false);
    for (const c of S.cars) if (c.root.visible && !c.gone) syncCar(c);
    updateGlows();
    updateArrow();
    S.shake *= Math.exp(-4.5 * rdt);

    if (S.mode === 'play') {
      if (S.phase === 'power') {
        S.gaugeT += rdt;
        const n01 = 0.5 - 0.5 * Math.cos(S.gaugeT * Math.PI * 1.7);
        S.needle = n01; needle.style.left = `calc(${n01 * 100}% - 3px)`;
        if (frameNo % 4 === 0) sfx.rev(n01);
      }
      if (S.phase === 'crash') {
        S.timeSince += dt;
        let moving = false;
        for (const c of S.free) if (!c.gone && (Math.hypot(c.vx, c.vz) > 1.2 || c.y > 0.15 || c.fuse > 0)) { moving = true; break; }
        if (moving) S.quiet = 0; else S.quiet += dt;
        if (S.player && S.player.gone && S.timeSince > 3.5) S.quiet += dt;
        if ((S.timeSince > 3.2 && S.quiet > 1.2) || S.timeSince > 30) endCrash();
      } else if (S.phase === 'tally') {
        S.phaseT -= rdt; if (S.phaseT <= 0) afterTally();
      }
      // HUD
      S.disp += (S.score - S.disp) * Math.min(1, rdt * 8);
      ui.score.textContent = fmt(S.disp);
      ui.goal.firstElementChild.style.width = clamp((S.score / S.L.goals[2]) * 100, 0, 100) + '%';
      ui.mult.textContent = S.chain > 0 ? 'x' + S.mult.toFixed(1) + '  ' + S.chain + ' CHAIN' : '';
      ui.chainbar.style.width = S.chain > 0 ? clamp(S.chainT / 3.2, 0, 1) * 100 + '%' : '0%';
      ui.after.style.height = clamp(S.after, 0, 1) * 100 + '%';
    }
    if (toastT > 0) { toastT -= rdt; if (toastT <= 0) ui.toast.style.opacity = 0; }
  }
}
requestAnimationFrame(frame);

/* ----------------------------------------------------------------- boot */
export function boot() {
  loadLevel(Math.min(save.last || 0, LEVELS.length - 1));
  toMenu('title');
  window.__cj = { get shadows() { return shadowsOn; }, update, S, save, startLevel, startPower, doLaunch, crashBreaker, LEVELS, toMenu, scene, camera, renderer };
  const l = document.getElementById('boot'); if (l) l.remove();
}
