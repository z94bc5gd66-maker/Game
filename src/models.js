import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();
const GLASS = '#26364d';

function finish(g, hex) {
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  _c.set(hex);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const box = (w, h, d, x, y, z, hex) => finish(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
function cab(len, wid, h, x, y, fs, rs, hex) {
  const g = new THREE.BoxGeometry(len, h, wid);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      const px = p.getX(i);
      p.setX(i, px > 0 ? px - fs : px + rs);
      p.setZ(i, p.getZ(i) * 0.86);
    }
  }
  g.translate(x, y, 0);
  return finish(g, hex);
}
const wheel = (r, w, x, z) => finish(new THREE.CylinderGeometry(r, r, w, 10).rotateX(Math.PI / 2).translate(x, r, z), '#161618');
const hub = (r, w, x, z) => finish(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w, 8).rotateX(Math.PI / 2).translate(x, r, z), '#9a9aa2');

function wheels(L, W, r, w, xs) {
  const out = [];
  for (const x of xs) for (const s of [-1, 1]) {
    out.push(wheel(r, w, x, s * (W / 2 - w / 2 + 0.02)));
    out.push(hub(r, w + 0.04, x, s * (W / 2 - w / 2 + 0.02)));
  }
  return out;
}
function lights(L, W, y, h = 0.16) {
  const o = [];
  for (const s of [-1, 1]) {
    o.push(box(0.08, h, 0.36, L / 2, y, s * W * 0.33, '#fff6c0'));
    o.push(box(0.08, h, 0.36, -L / 2, y, s * W * 0.33, '#ff2a2a'));
  }
  return o;
}

function passenger(o) {
  const p = [];
  const y0 = 0.28;
  p.push(box(o.L, o.bodyH, o.W, 0, y0 + o.bodyH / 2, 0, o.color));
  p.push(cab(o.cabL, o.W * 0.96, o.cabH, o.cabX, y0 + o.bodyH + o.cabH / 2, o.fs ?? 0.5, o.rs ?? 0.4, GLASS));
  p.push(box(o.cabL * 0.6, 0.07, o.W * 0.76, o.cabX - 0.05, y0 + o.bodyH + o.cabH + 0.02, 0, o.color));
  p.push(box(o.L + 0.1, 0.1, o.W + 0.06, 0, y0 + 0.05, 0, '#222226')); // bumper line
  p.push(...wheels(o.L, o.W, 0.37, 0.3, [o.L * 0.31, -o.L * 0.31]));
  p.push(...lights(o.L, o.W, y0 + o.bodyH * 0.6));
  if (o.spoiler) p.push(box(0.5, 0.07, o.W * 0.9, -o.L / 2 + 0.3, y0 + o.bodyH + 0.35, 0, '#151518'), box(0.1, 0.35, 0.1, -o.L / 2 + 0.3, y0 + o.bodyH + 0.18, o.W * 0.3, '#151518'), box(0.1, 0.35, 0.1, -o.L / 2 + 0.3, y0 + o.bodyH + 0.18, -o.W * 0.3, '#151518'));
  if (o.stripes) p.push(box(o.L * 0.98, 0.02, 0.28, 0, y0 + o.bodyH + 0.015, 0.3, o.stripes), box(o.L * 0.98, 0.02, 0.28, 0, y0 + o.bodyH + 0.015, -0.3, o.stripes));
  if (o.sign) p.push(box(0.5, 0.2, 0.9, o.cabX, y0 + o.bodyH + o.cabH + 0.17, 0, '#fff3a0'));
  if (o.bar) p.push(box(0.3, 0.16, 0.5, o.cabX, y0 + o.bodyH + o.cabH + 0.14, 0.35, '#ff2030'), box(0.3, 0.16, 0.5, o.cabX, y0 + o.bodyH + o.cabH + 0.14, -0.35, '#2a60ff'));
  if (o.band) p.push(box(o.L + 0.02, 0.18, o.W + 0.02, 0, y0 + o.bodyH * 0.55, 0, o.band));
  return { parts: p, H: y0 + o.bodyH + o.cabH + 0.1 };
}

const SPEC = {
  sedan: (c) => passenger({ L: 4.4, W: 1.8, bodyH: 0.6, cabH: 0.55, cabL: 2.3, cabX: -0.2, color: c }),
  hatch: (c) => passenger({ L: 3.7, W: 1.75, bodyH: 0.62, cabH: 0.6, cabL: 2.2, cabX: -0.25, color: c, rs: 0.1 }),
  sports: (c) => passenger({ L: 4.3, W: 1.95, bodyH: 0.5, cabH: 0.44, cabL: 2.0, cabX: -0.3, color: c, spoiler: true, fs: 0.8 }),
  taxi: () => passenger({ L: 4.4, W: 1.8, bodyH: 0.6, cabH: 0.55, cabL: 2.3, cabX: -0.2, color: '#ffc61a', sign: true, band: '#222' }),
  police: () => passenger({ L: 4.5, W: 1.85, bodyH: 0.6, cabH: 0.55, cabL: 2.3, cabX: -0.2, color: '#f2f4f8', bar: true, band: '#1c2a55' }),
  muscle: (c) => passenger({ L: 4.7, W: 2.0, bodyH: 0.62, cabH: 0.5, cabL: 2.0, cabX: -0.45, color: c, spoiler: true, stripes: '#f4f4f4', fs: 0.9, rs: 0.5 }),
  psport: (c) => passenger({ L: 4.4, W: 2.0, bodyH: 0.48, cabH: 0.42, cabL: 1.9, cabX: -0.35, color: c, spoiler: true, stripes: '#111', fs: 1.0, rs: 0.6 }),
  van(c) {
    const p = []; const L = 5.2, W = 2.0;
    p.push(box(L, 1.45, W, 0, 0.28 + 0.72, 0, c));
    p.push(box(0.06, 0.7, W * 0.88, L / 2 + 0.01, 1.55, 0, GLASS));
    p.push(box(L * 0.35, 0.55, W + 0.02, L * 0.2, 1.4, 0, GLASS));
    p.push(...wheels(L, W, 0.38, 0.3, [L * 0.3, -L * 0.3]), ...lights(L, W, 0.75));
    return { parts: p, H: 1.8 };
  },
  bus(c) {
    const p = []; const L = 10.5, W = 2.6;
    p.push(box(L, 2.9, W, 0, 0.35 + 1.45, 0, c));
    p.push(box(L * 0.92, 0.85, W + 0.04, 0, 2.2, 0, GLASS));
    p.push(box(0.06, 1.2, W * 0.9, L / 2 + 0.01, 2.0, 0, GLASS));
    p.push(box(L, 0.2, W + 0.02, 0, 1.0, 0, '#f2f2f2'));
    p.push(box(L * 0.5, 0.1, W * 0.7, -1, 3.28, 0, '#d8d8dc'));
    p.push(...wheels(L, W, 0.55, 0.42, [L * 0.33, -L * 0.3]), ...lights(L, W, 0.8, 0.25));
    return { parts: p, H: 3.3 };
  },
  truck(c) {
    const p = []; const L = 7.5, W = 2.4;
    p.push(box(2.2, 2.0, W, L / 2 - 1.1, 1.3, 0, c));
    p.push(box(0.06, 0.8, W * 0.86, L / 2 + 0.01, 1.7, 0, GLASS));
    p.push(box(L - 2.5, 2.6, W, -1.25, 1.55, 0, '#e9ebef'));
    p.push(box(L - 2.5, 0.35, W + 0.04, -1.25, 0.7, 0, '#2a2a2e'));
    p.push(box(L - 2.5, 0.25, W + 0.04, -1.25, 1.9, 0, c));
    p.push(...wheels(L, W, 0.5, 0.4, [L * 0.38, -L * 0.1, -L * 0.34]), ...lights(L, W, 0.8, 0.2));
    return { parts: p, H: 2.9 };
  },
  tanker() {
    const p = []; const L = 9, W = 2.4;
    p.push(box(2.2, 2.0, W, L / 2 - 1.1, 1.3, 0, '#d92a2a'));
    p.push(box(0.06, 0.8, W * 0.86, L / 2 + 0.01, 1.7, 0, GLASS));
    p.push(box(L - 2.4, 0.45, 1.6, -1.2, 0.75, 0, '#1b1b1f'));
    p.push(finish(new THREE.CylinderGeometry(1.2, 1.2, L - 2.8, 14).rotateZ(Math.PI / 2).translate(-1.4, 1.95, 0), '#c8ccd4'));
    for (const x of [-3.2, -1.4, 0.4]) p.push(finish(new THREE.CylinderGeometry(1.23, 1.23, 0.5, 14).rotateZ(Math.PI / 2).translate(x, 1.95, 0), '#e8321f'));
    p.push(box(1.6, 0.2, 0.5, -1.4, 3.2, 0, '#ffd500'));
    p.push(...wheels(L, W, 0.5, 0.4, [L * 0.38, -L * 0.2, -L * 0.36]), ...lights(L, W, 0.8, 0.2));
    return { parts: p, H: 3.2 };
  },
  monster(c) {
    const p = []; const L = 4.6, W = 2.3;
    p.push(box(L, 0.9, W, 0, 1.7, 0, c));
    p.push(cab(2.2, W * 0.94, 0.8, -0.3, 2.55, 0.5, 0.3, GLASS));
    p.push(box(1.3, 0.07, 1.6, -0.35, 2.98, 0, c));
    p.push(box(L + 0.1, 0.12, W + 0.05, 0, 1.3, 0, '#111'));
    for (const x of [1.5, -1.5]) for (const s of [-1, 1]) {
      p.push(finish(new THREE.CylinderGeometry(0.95, 0.95, 0.9, 12).rotateX(Math.PI / 2).translate(x, 0.95, s * 1.45), '#141416'));
      p.push(finish(new THREE.CylinderGeometry(0.5, 0.5, 0.94, 8).rotateX(Math.PI / 2).translate(x, 0.95, s * 1.45), '#d8c24a'));
    }
    p.push(...lights(L, W, 1.7, 0.2));
    return { parts: p, H: 3.1 };
  },
};

export const TYPES = {
  sedan: { L: 4.4, W: 1.8, m: 1, val: 250 },
  hatch: { L: 3.7, W: 1.75, m: 0.8, val: 200 },
  sports: { L: 4.3, W: 1.95, m: 1, val: 450 },
  taxi: { L: 4.4, W: 1.8, m: 1, val: 300 },
  police: { L: 4.5, W: 1.85, m: 1.05, val: 500 },
  van: { L: 5.2, W: 2.0, m: 1.8, val: 400 },
  bus: { L: 10.5, W: 2.6, m: 6, val: 1200 },
  truck: { L: 7.5, W: 2.4, m: 4, val: 700 },
  tanker: { L: 9, W: 2.4, m: 5, val: 1500, explosive: true },
  muscle: { L: 4.7, W: 2.0, m: 1.5, val: 0, launch: 1 },
  psport: { L: 4.4, W: 2.0, m: 1.2, val: 0, launch: 1.1 },
  monster: { L: 4.6, W: 2.3, m: 3.4, val: 0, launch: 0.95 },
};
export const PLAYER_MODELS = [
  { id: 'muscle', name: 'MUSCLE', price: 0, desc: 'Allrounder' },
  { id: 'psport', name: 'SPORTS', price: 50000, desc: 'Schneller Launch' },
  { id: 'monster', name: 'MONSTER', price: 150000, desc: 'Extra schwer' },
];
export const PLAYER_COLORS = ['#e8202a', '#ffd500', '#1e90ff', '#22c55e', '#ff7a00', '#a855f7', '#f4f4f4', '#222226'];
export const TRAFFIC_COLORS = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#bdc3c7', '#ecf0f1', '#16a085', '#d35400', '#34495e', '#e84393'];

const geoCache = new Map();
export function carGeometry(type, hex) {
  const key = type + '|' + hex;
  let e = geoCache.get(key);
  if (!e) {
    const { parts, H } = SPEC[type](hex);
    e = { geo: mergeGeometries(parts), H };
    parts.forEach((g) => g.dispose());
    geoCache.set(key, e);
  }
  return e;
}

const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
let shadowTex = null;
function getShadowTex() {
  if (shadowTex) return shadowTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.65)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  shadowTex = new THREE.CanvasTexture(cv);
  return shadowTex;
}
const shadowMat = () => new THREE.MeshBasicMaterial({ map: getShadowTex(), transparent: true, depthWrite: false });
let sharedShadowMat = null;
const baseMat = new THREE.MeshLambertMaterial({ vertexColors: true });

export function createCarMesh(type, hex) {
  const T = TYPES[type];
  const { geo, H } = carGeometry(type, hex);
  const mat = baseMat.clone();
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  const body = new THREE.Mesh(geo, mat);
  body.position.y = -H / 2;
  pivot.position.y = H / 2;
  pivot.add(body);
  root.add(pivot);
  if (!sharedShadowMat) sharedShadowMat = shadowMat();
  const shadow = new THREE.Mesh(shadowGeo, sharedShadowMat);
  shadow.scale.set(T.L * 1.25, 1, T.W * 1.7);
  shadow.position.y = 0.07;
  root.add(shadow);
  return { root, pivot, body, mat, shadow, H, T };
}

export function circlesFor(T) {
  const r = T.W / 2;
  const span = T.L / 2 - r;
  const n = Math.max(2, Math.ceil((2 * span) / (r * 1.5)) + 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(-span + (2 * span * i) / (n - 1));
  return { r, offs: out };
}
