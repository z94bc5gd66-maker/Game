import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/* ---------------------------------------------------------------- helpers */
const _c = new THREE.Color();
const rgb = (hex, k = 1) => { _c.set(hex); return [_c.r * k, _c.g * k, _c.b * k]; };
const lerp = (a, b, t) => a + (b - a) * t;

// primitive geometry with flat colour (keeps its own normals if smooth)
function prim(g, hex, k = 1, flat = true) {
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('uv');
  if (flat) g.computeVertexNormals();
  const n = g.attributes.position.count, a = new Float32Array(n * 3), c = rgb(hex, k);
  for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const box = (w, h, d, x, y, z, hex, k = 1) => prim(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex, k);
const cyl = (r, len, x, y, z, hex, axis = 'z', seg = 14, k = 1) => {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'z') g.rotateX(Math.PI / 2); else if (axis === 'x') g.rotateZ(Math.PI / 2);
  return prim(g.translate(x, y, z), hex, k, false);
};

// piecewise linear interpolation over [x,y] keys (x normalised −0.5…0.5)
function lin(keys, x, def) {
  if (!keys || !keys.length) return def;
  if (x < keys[0][0] || x > keys[keys.length - 1][0]) return def;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (x <= b[0]) return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1);
  }
  return def;
}
function blur(arr, n = 2) {
  let a = arr.slice();
  for (let k = 0; k < n; k++) {
    const b = a.slice();
    for (let i = 1; i < a.length - 1; i++) b[i] = (a[i - 1] + a[i] * 2 + a[i + 1]) / 4;
    a = b;
  }
  return a;
}

/* ------------------------------------------------------- lofted monocoque */
const K = 11; // half-profile points
function halfProfile(yb, belt, yt, hw, gw, rw, crown) {
  const hood = [
    [yb, 0], [yb, hw * 0.6], [yb + 0.04, hw * 0.93], [yb + 0.12, hw], [lerp(yb, belt, 0.55), hw], [belt - 0.03, hw * 0.97],
    [belt + 0.005, hw * 0.86], [belt + 0.02, hw * 0.64], [belt + 0.03, hw * 0.42], [belt + 0.035, hw * 0.2], [belt + crown, 0],
  ];
  const cab = [
    [yb, 0], [yb, hw * 0.6], [yb + 0.04, hw * 0.93], [yb + 0.12, hw], [lerp(yb, belt, 0.55), hw], [belt - 0.03, hw * 0.97],
    [belt + 0.02, gw], [lerp(belt, yt, 0.55), lerp(gw, rw, 0.55)], [yt - 0.05, rw], [yt, rw * 0.55], [yt + 0.01, 0],
  ];
  const t = Math.min(1, Math.max(0, (yt - belt) / 0.25));
  return hood.map((h, i) => [lerp(h[0], cab[i][0], t), lerp(h[1], cab[i][1], t)]);
}

function loft(sp, paint, N = 22) {
  const { L, W } = sp;
  const xs = [], belt = [], roof = [], hwA = [], ybA = [];
  for (let i = 0; i < N; i++) {
    const xn = -0.5 + i / (N - 1);
    xs.push(xn);
    belt.push(lin(sp.tub, xn, sp.tub[0][1]));
    hwA.push((W / 2) * lin(sp.w, xn, 1));
    ybA.push(lin(sp.ybk, xn, sp.yb));
  }
  for (let i = 0; i < N; i++) roof.push(lin(sp.roof, xs[i], belt[i]));
  const bB = blur(belt, 2), hB = blur(hwA, 1), yB = blur(ybA, 1);
  const rB = blur(roof, 2).map((r, i) => Math.max(r, bB[i]));
  const rings = [];
  for (let i = 0; i < N; i++) {
    const hw = hB[i], p = halfProfile(yB[i], bB[i], rB[i], hw, hw * (sp.gw ?? 0.88), hw * (sp.rw ?? 0.7), sp.crown ?? 0.04);
    const ring = [];
    for (let k = 0; k < K; k++) ring.push([p[k][0], p[k][1]]);
    for (let k = K - 2; k >= 1; k--) ring.push([p[k][0], -p[k][1]]);
    rings.push(ring);
  }
  const M = rings[0].length;
  const P = rings.map((r, i) => r.map(([y, z]) => [xs[i] * L, y, z]));
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // orientation test
  const t0 = cross(sub(P[1][0], P[0][0]), sub(P[0][1], P[0][0]));
  const cen = [0, 0, 0]; P[0].forEach((p) => { cen[1] += p[1] / M; });
  const flip = t0[1] * (P[0][1][1] - cen[1]) + t0[2] * P[0][1][2] + 0 < 0 ? -1 : 1;
  // vertex normals
  const faceN = [];
  for (let i = 0; i < N - 1; i++) {
    faceN[i] = [];
    for (let j = 0; j < M; j++) {
      const n = cross(sub(P[i + 1][j], P[i][j]), sub(P[i][(j + 1) % M], P[i][j]));
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      faceN[i][j] = [(n[0] / l) * flip, (n[1] / l) * flip, (n[2] / l) * flip];
    }
  }
  const VN = P.map((row, i) => row.map((_, j) => {
    const s = [0, 0, 0];
    for (const [di, dj] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      const ii = i + di, jj = (j + dj + M) % M;
      if (ii < 0 || ii > N - 2) continue;
      const f = faceN[ii][jj]; s[0] += f[0]; s[1] += f[1]; s[2] += f[2];
    }
    const l = Math.hypot(s[0], s[1], s[2]) || 1;
    return [s[0] / l, s[1] / l, s[2] / l];
  }));
  const pos = [], nor = [], col = [];
  const push = (p, n, c) => { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); col.push(c[0], c[1], c[2]); };
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < M; j++) {
      const j2 = (j + 1) % M;
      const a = P[i][j], b = P[i + 1][j], c = P[i][j2], d = P[i + 1][j2];
      const f = faceN[i][j];
      const cx = (a[0] + b[0] + c[0] + d[0]) / 4, cy = (a[1] + b[1] + c[1] + d[1]) / 4, cz = (a[2] + b[2] + c[2] + d[2]) / 4;
      const color = paint(cx, cy, cz, f[0], f[1], f[2], (xs[i] + xs[i + 1]) / 2, (bB[i] + bB[i + 1]) / 2, false);
      const tri = flip > 0 ? [[a, i, j], [b, i + 1, j], [c, i, j2], [b, i + 1, j], [d, i + 1, j2], [c, i, j2]] : [[a, i, j], [c, i, j2], [b, i + 1, j], [b, i + 1, j], [c, i, j2], [d, i + 1, j2]];
      for (const [p, ii, jj] of tri) push(p, VN[ii][jj], color);
    }
  }
  // caps
  for (const [ii, sgn] of [[0, -1], [N - 1, 1]]) {
    const ring = P[ii];
    const c = [ring[0][0], 0, 0]; ring.forEach((p) => { c[1] += p[1] / M; });
    for (let j = 0; j < M; j++) {
      const a = ring[j], b = ring[(j + 1) % M];
      const cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2]) / 3;
      const color = paint(a[0], cy, cz, sgn, 0, 0, sgn * 0.5, bB[ii], true);
      const n = [sgn, 0, 0];
      const order = (sgn > 0) === (flip > 0) ? [c, a, b] : [c, b, a];
      // ensure CCW seen from +/-x
      const wind = (order[1][2] - order[0][2]) * (order[2][1] - order[0][1]) - (order[1][1] - order[0][1]) * (order[2][2] - order[0][2]);
      const ord = (wind * sgn > 0) ? order : [order[0], order[2], order[1]];
      for (const p of ord) push(p, n, color);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return { geo: g, belt: bB, roof: rB, xs, hw: hB };
}

/* ------------------------------------------------------------------ specs */
const windows = (a, b, step, gap) => { const o = []; for (let x = a; x < b; x += step) o.push([x, x + step - gap]); return o; };
const SPEC = {
  sedan: { L: 4.5, W: 1.82, yb: 0.3, tub: [[-0.5, 0.8], [-0.44, 0.92], [-0.3, 0.95], [0.1, 0.96], [0.28, 0.92], [0.42, 0.82], [0.5, 0.64]], roof: [[-0.31, 0.95], [-0.22, 1.3], [-0.12, 1.44], [0.06, 1.46], [0.14, 1.38], [0.24, 1.12], [0.3, 0.97]], w: [[-0.5, 0.84], [-0.46, 0.95], [-0.38, 1], [0.38, 1], [0.46, 0.96], [0.5, 0.86]], ybk: [[-0.5, 0.5], [-0.43, 0.34], [0.43, 0.34], [0.5, 0.48]], side: [[-0.25, -0.04], [0.03, 0.22]], r: 0.36, ax: [0.31, -0.3] },
  hatch: { L: 3.75, W: 1.76, yb: 0.3, tub: [[-0.5, 0.86], [-0.42, 0.94], [0.1, 0.95], [0.3, 0.9], [0.42, 0.78], [0.5, 0.62]], roof: [[-0.45, 0.95], [-0.41, 1.35], [-0.3, 1.5], [0.04, 1.52], [0.14, 1.42], [0.26, 1.1], [0.32, 0.96]], w: [[-0.5, 0.88], [-0.46, 0.97], [-0.38, 1], [0.38, 1], [0.46, 0.96], [0.5, 0.86]], ybk: [[-0.5, 0.45], [-0.43, 0.34], [0.43, 0.34], [0.5, 0.46]], side: [[-0.36, -0.06], [0.0, 0.23]], r: 0.34, ax: [0.3, -0.3] },
  sports: { L: 4.35, W: 1.98, yb: 0.25, tub: [[-0.5, 0.74], [-0.42, 0.86], [-0.2, 0.84], [0.1, 0.8], [0.3, 0.72], [0.42, 0.6], [0.5, 0.48]], roof: [[-0.3, 0.84], [-0.22, 1.06], [-0.1, 1.22], [0, 1.24], [0.1, 1.12], [0.2, 0.9], [0.25, 0.8]], w: [[-0.5, 0.88], [-0.45, 0.99], [-0.35, 1], [0.35, 1], [0.45, 0.97], [0.5, 0.86]], ybk: [[-0.5, 0.4], [-0.43, 0.28], [0.43, 0.28], [0.5, 0.38]], rw: 0.62, side: [[-0.22, 0.12]], r: 0.36, ax: [0.31, -0.29], spoiler: true },
  taxi: null, police: null,
  muscle: { L: 4.75, W: 2.0, yb: 0.3, tub: [[-0.5, 0.9], [-0.44, 1.0], [-0.2, 1.0], [0.1, 0.98], [0.28, 0.95], [0.42, 0.88], [0.5, 0.7]], roof: [[-0.32, 1.0], [-0.24, 1.3], [-0.14, 1.43], [0, 1.43], [0.08, 1.34], [0.14, 1.1], [0.18, 1.0]], w: [[-0.5, 0.86], [-0.46, 0.96], [-0.38, 1], [0.38, 1], [0.46, 0.97], [0.5, 0.88]], ybk: [[-0.5, 0.5], [-0.43, 0.34], [0.43, 0.34], [0.5, 0.48]], side: [[-0.24, -0.02], [0.03, 0.13]], r: 0.4, ax: [0.31, -0.3], stripe: '#f2f2f2', stripeW: 0.26, spoiler: true },
  psport: { L: 4.4, W: 2.0, yb: 0.24, tub: [[-0.5, 0.76], [-0.42, 0.88], [-0.2, 0.86], [0.1, 0.8], [0.3, 0.72], [0.42, 0.62], [0.5, 0.5]], roof: [[-0.26, 0.86], [-0.18, 1.1], [-0.06, 1.22], [0.04, 1.2], [0.14, 1.0], [0.2, 0.86]], w: [[-0.5, 0.88], [-0.45, 0.99], [-0.35, 1], [0.35, 1], [0.45, 0.97], [0.5, 0.86]], ybk: [[-0.5, 0.4], [-0.43, 0.27], [0.43, 0.27], [0.5, 0.38]], rw: 0.6, side: [[-0.19, 0.11]], r: 0.37, ax: [0.31, -0.29], stripe: '#111114', stripeW: 0.22, spoiler: true },
  van: { L: 5.2, W: 2.0, yb: 0.34, tub: [[-0.5, 1.05], [-0.45, 1.15], [0.2, 1.15], [0.36, 1.0], [0.5, 0.8]], roof: [[-0.5, 1.9], [-0.46, 2.08], [0.14, 2.08], [0.26, 1.7], [0.34, 1.2]], w: [[-0.5, 0.94], [-0.46, 1], [0.4, 1], [0.5, 0.94]], gw: 0.98, rw: 0.92, side: [[-0.02, 0.28]], r: 0.38, ax: [0.3, -0.3] },
  bus: { L: 10.5, W: 2.6, yb: 0.4, tub: [[-0.5, 1.35], [0.5, 1.35]], roof: [[-0.5, 2.9], [-0.485, 3.05], [0.465, 3.05], [0.5, 2.85]], w: [[-0.5, 0.95], [-0.48, 1], [0.48, 1], [0.5, 0.95]], gw: 1, rw: 0.97, side: windows(-0.45, 0.45, 0.095, 0.012), r: 0.52, ax: [0.34, -0.3], glassFront: true, crown: 0.02 },
  truck: { L: 7.5, W: 2.4, yb: 0.5, tub: [[-0.5, 1.0], [0.5, 1.0]], roof: [[-0.5, 3.25], [0.1, 3.25], [0.115, 2.0], [0.15, 2.55], [0.3, 2.75], [0.38, 2.4], [0.46, 1.4]], w: [[-0.5, 0.97], [-0.45, 1], [0.45, 1], [0.5, 0.95]], gw: 1, rw: 0.95, side: [[0.2, 0.37]], r: 0.5, ax: [0.37, -0.1, -0.3], cargo: 0.11, crown: 0.02 },
  cab: { L: 2.8, W: 2.4, yb: 0.5, tub: [[-0.5, 1.0], [0.5, 1.0]], roof: [[-0.5, 2.6], [-0.2, 2.7], [0.3, 2.75], [0.4, 2.4], [0.46, 1.4]], w: [[-0.5, 1], [0.45, 1], [0.5, 0.95]], gw: 1, rw: 0.95, side: [[-0.2, 0.3]], r: 0.5, ax: [], crown: 0.02 },
  monster: { L: 4.6, W: 2.3, yb: 0.85, tub: [[-0.5, 1.75], [0.1, 1.8], [0.4, 1.7], [0.5, 1.5]], roof: [[-0.12, 1.8], [-0.04, 2.6], [0.1, 2.7], [0.2, 2.5], [0.28, 1.85]], w: [[-0.5, 0.9], [-0.45, 1], [0.45, 1], [0.5, 0.9]], ybk: [[-0.5, 0.95], [-0.45, 0.85], [0.45, 0.85], [0.5, 0.95]], gw: 0.9, rw: 0.78, side: [[-0.08, 0.22]], r: 0.95, ax: [0.32, -0.32], big: true },
};
SPEC.taxi = { ...SPEC.sedan, taxi: true };
SPEC.police = { ...SPEC.sedan, police: true, L: 4.55 };

const GLASS = '#16243a';

function makePaint(sp, hex) {
  const body = rgb(hex), dark = rgb('#0e0e11'), glass = rgb(GLASS), roofc = rgb(sp.police ? '#f4f5f8' : hex);
  const stripe = sp.stripe ? rgb(sp.stripe) : null;
  const police = sp.police ? rgb('#14214a') : null;
  const cargo = rgb('#e8eaee'), cargoStripe = rgb(hex);
  return (cx, cy, cz, nx, ny, nz, xn, belt, cap) => {
    if (ny < -0.5) return dark;
    if (cap) {
      if (xn > 0) { if (sp.glassFront && cy > belt + 0.1) return glass; if (cy < sp.yb + 0.3) return dark; return body; }
      return cy < sp.yb + 0.22 ? dark : sp.cargo ? cargo : body;
    }
    if (sp.cargo !== undefined && xn < sp.cargo) {
      if (cy > 1.3 && cy < 1.8 && Math.abs(nz) > 0.5) return cargoStripe;
      return cargo;
    }
    if (cy > belt + 0.04) {
      if (nx > 0.38) return sp.noFrontGlass ? body : glass;
      if (nx < -0.38) return sp.cargo !== undefined ? body : glass;
      if (ny > 0.8) return roofc;
      for (const [a, b] of sp.side) if (xn > a && xn < b) return glass;
      return sp.police ? roofc : body;
    }
    if (stripe && ny > 0.7 && Math.abs(cz) < sp.stripeW) return stripe;
    if (police && cy < belt - 0.22 && ny < 0.6) return police;
    return body;
  };
}

/* ---------------------------------------------------------------- details */
function wheelSet(sp, W, ex = {}) {
  const parts = [], r = sp.r, w = ex.w || (sp.big ? 0.9 : r > 0.45 ? 0.42 : 0.3);
  const zOff = sp.big ? 1.3 : W / 2 - w / 2 + 0.04;
  for (const ax of sp.ax) {
    const x = ax * sp.L;
    for (const s of [-1, 1]) {
      const z = s * zOff;
      parts.push(cyl(r, w, x, r, z, '#121214', 'z', 16));
      parts.push(cyl(r * 0.62, w + 0.03, x, r, z, sp.big ? '#c9b23c' : '#7d818b', 'z', 12, 1));
      parts.push(cyl(r * 0.22, w + 0.05, x, r, z, '#222226', 'z', 8));
      if (!sp.big) parts.push(cyl(r * 1.12, 0.03, x, r + 0.04, s * (W / 2 + 0.005), '#09090b', 'z', 18));
    }
  }
  return parts;
}
function details(type, sp, hex) {
  const p = [], L = sp.L, W = sp.W;
  const topAt = (xn) => lin(sp.tub, xn, sp.tub[0][1]);
  const front = L / 2, rear = -L / 2;
  const hy = topAt(0.5) - 0.12, ry = topAt(-0.5) - 0.18;
  const passenger = ['sedan', 'hatch', 'sports', 'taxi', 'police', 'muscle', 'psport'].includes(type);
  if (passenger) {
    for (const s of [-1, 1]) {
      p.push(box(0.1, 0.13, 0.42, front - 0.04, hy + 0.0, s * W * 0.31, '#fff6c8', 2.6)); // headlights
      p.push(box(0.12, 0.1, 0.36, rear + 0.03, ry + 0.02, s * W * 0.33, '#ff1f1f', 2.4)); // tail lights
      p.push(box(0.1, 0.1, 0.18, 0.12 * L, topAt(0.12) + 0.08, s * (W / 2 + 0.05), hex)); // mirrors
      p.push(cyl(0.06, 0.2, rear - 0.02, 0.38, s * 0.55, '#8a8d95', 'x', 8));
    }
    p.push(box(0.06, 0.12, W * 0.42, front - 0.02, 0.5, 0, '#0b0b0d')); // grille
    p.push(box(0.12, 0.13, W * 0.88, front - 0.1, 0.38, 0, '#17171b')); // bumper
    p.push(box(0.12, 0.13, W * 0.88, rear + 0.1, 0.38, 0, '#17171b'));
    p.push(box(0.04, 0.14, 0.46, rear - 0.005, 0.56, 0, '#f4f4f0'));
    
  }
  if (sp.spoiler) {
    const sy = topAt(-0.46) + 0.22, sx = rear + 0.28;
    p.push(box(0.46, 0.05, W * 0.88, sx, sy, 0, '#101013'), box(0.1, 0.24, 0.06, sx, sy - 0.12, W * 0.32, '#101013'), box(0.1, 0.24, 0.06, sx, sy - 0.12, -W * 0.32, '#101013'));
  }
  if (sp.taxi) { p.push(box(0.5, 0.2, 0.9, -0.3, 1.58, 0, '#fff0a0', 1.8)); p.push(box(L * 0.55, 0.06, W + 0.01, -0.1, 0.78, 0, '#16161a')); }
  if (sp.police) { p.push(box(0.3, 0.14, 0.55, -0.3, 1.52, 0.34, '#ff2030', 2.2), box(0.3, 0.14, 0.55, -0.3, 1.52, -0.34, '#2a60ff', 2.2)); }
  if (type === 'van') {
    for (const s of [-1, 1]) { p.push(box(0.1, 0.16, 0.4, front - 0.04, 0.78, s * 0.7, '#fff6c8', 2.6), box(0.1, 0.4, 0.2, rear + 0.03, 0.95, s * 0.8, '#ff1f1f', 2.2)); }
    p.push(box(0.08, 0.2, W * 0.6, front - 0.03, 0.55, 0, '#0b0b0d'), box(0.2, 0.16, W, front - 0.05, 0.42, 0, '#17171b'));
  }
  if (type === 'bus' || type === 'truck' || type === 'cab') {
    for (const s of [-1, 1]) { p.push(box(0.1, 0.22, 0.4, front - 0.04, 0.8, s * (W * 0.34), '#fff6c8', 2.6), box(0.1, 0.24, 0.3, rear + 0.03, 0.85, s * (W * 0.4), '#ff1f1f', 2.2)); }
    p.push(box(0.22, 0.2, W, front - 0.05, 0.52, 0, '#17171b'), box(0.22, 0.2, W, rear + 0.05, 0.52, 0, '#17171b'));
    if (type === 'bus') p.push(box(0.04, 0.3, 1.6, front + 0.0, 2.95, 0, '#ffc21a', 1.5), box(L * 0.4, 0.12, W * 0.7, -1.0, 3.12, 0, '#cfd2d8'));
  }
  if (type === 'monster') {
    for (const s of [-1, 1]) p.push(box(0.1, 0.16, 0.5, front - 0.04, 1.62, s * 0.8, '#fff6c8', 2.6));
    for (let i = -2; i <= 2; i++) p.push(box(0.14, 0.14, 0.2, 0.0, 2.78, i * 0.22, '#ffe08a', 2.4));
    p.push(box(0.2, 0.12, W, front - 0.03, 1.1, 0, '#17171b'));
  }
  p.push(...wheelSet(sp, W));
  return p;
}

export const TYPES = {
  sedan: { L: 4.5, W: 1.82, m: 1, val: 250 },
  hatch: { L: 3.75, W: 1.76, m: 0.8, val: 200 },
  sports: { L: 4.35, W: 1.98, m: 1, val: 450 },
  taxi: { L: 4.5, W: 1.82, m: 1, val: 300 },
  police: { L: 4.55, W: 1.82, m: 1.05, val: 500 },
  van: { L: 5.2, W: 2.0, m: 1.8, val: 400 },
  bus: { L: 10.5, W: 2.6, m: 6, val: 1200 },
  truck: { L: 7.5, W: 2.4, m: 4, val: 700 },
  tanker: { L: 9, W: 2.4, m: 5, val: 1500, explosive: true },
  muscle: { L: 4.75, W: 2.0, m: 1.5, val: 0, launch: 1 },
  psport: { L: 4.4, W: 2.0, m: 1.2, val: 0, launch: 1.1 },
  monster: { L: 4.6, W: 2.3, m: 3.4, val: 0, launch: 0.95 },
};
export const PLAYER_MODELS = [
  { id: 'muscle', name: 'MUSCLE', price: 0, desc: 'Allrounder' },
  { id: 'psport', name: 'SPORTS', price: 50000, desc: 'Schneller Launch' },
  { id: 'monster', name: 'MONSTER', price: 150000, desc: 'Extra schwer' },
];
export const PLAYER_COLORS = ['#e8202a', '#ffd500', '#1e90ff', '#22c55e', '#ff7a00', '#a855f7', '#f4f4f4', '#222226'];
export const TRAFFIC_COLORS = ['#c0392b', '#2f6fd0', '#2fa866', '#e8a317', '#8e44ad', '#aeb6bd', '#f1f3f5', '#16a085', '#d35400', '#2c3e50', '#e84393', '#6b7a8f'];

const geoCache = new Map();
export function carGeometry(type, hex) {
  if (type === 'taxi') hex = '#ffc61a'; else if (type === 'police') hex = '#f4f5f8';
  const key = type + '|' + hex;
  let e = geoCache.get(key);
  if (e) return e;
  const parts = [];
  let H;
  if (type === 'tanker') {
    const L = 9, W = 2.4;
    const cabSp = SPEC.cab;
    const cab = loft(cabSp, makePaint(cabSp, '#d92a2a'));
    cab.geo.translate(L / 2 - 1.4, 0, 0);
    parts.push(cab.geo);
    parts.push(box(L - 2.6, 0.45, 1.6, -1.35, 0.75, 0, '#1b1b1f'));
    parts.push(cyl(1.2, L - 3.0, -1.5, 1.95, 0, '#cfd3da', 'x', 18));
    for (const x of [-3.4, -1.5, 0.4]) parts.push(cyl(1.23, 0.5, x, 1.95, 0, '#e8321f', 'x', 18));
    parts.push(box(1.6, 0.22, 0.5, -1.5, 3.22, 0, '#ffd500'), box(0.6, 0.3, 0.6, 0.0, 3.25, 0, '#9aa0a8'));
    for (const s of [-1, 1]) {
      parts.push(box(0.1, 0.22, 0.4, L / 2 - 0.04, 0.8, s * 0.8, '#fff6c8', 2.6), box(0.1, 0.24, 0.3, -L / 2 + 0.03, 0.85, s * 0.9, '#ff1f1f', 2.2));
    }
    parts.push(box(0.22, 0.2, W, L / 2 - 0.05, 0.52, 0, '#17171b'));
    parts.push(...wheelSet({ r: 0.5, L, ax: [0.37, -0.2, -0.36] }, W));
    H = 3.5;
  } else {
    const sp = SPEC[type];
    const lf = loft(sp, makePaint(sp, hex));
    parts.push(lf.geo);
    parts.push(...details(type, sp, hex));
    H = Math.max(...lf.roof) + 0.15;
    if (sp.taxi || sp.police) H += 0.2;
    if (type === 'bus') H = 3.3;
  }
  e = { geo: mergeGeometries(parts), H };
  parts.forEach((g) => g.dispose());
  geoCache.set(key, e);
  return e;
}

/* ---------------------------------------------------------------- material */
const SHADER_KEY = 'carpaint-v2';
export function makeCarMaterial(env) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.28, envMap: env || null, envMapIntensity: 1.0 });
  mat.userData.dmg = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDmg = mat.userData.dmg;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uDmg; varying float vDmg; varying float vDn;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float dn = sin(position.x*2.7+position.y*4.1)*sin(position.z*3.3+position.x*1.9+position.y*2.1);
        vDn = dn*0.5+0.5; vDmg = uDmg;
        transformed += normal * (dn*0.5-0.2) * uDmg * 0.24;
        transformed.y *= 1.0 - uDmg*0.2*smoothstep(0.5,1.4,position.y);
        transformed.x -= sign(position.x)*uDmg*0.34*smoothstep(1.0,2.4,abs(position.x));`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDmg; varying float vDn;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(1.0, 0.45, vDmg);
        float burn = clamp(vDmg*1.5-0.45, 0.0, 1.0) * smoothstep(0.2, 0.62, vDn);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02,0.02,0.022), burn);`);
  };
  mat.customProgramCacheKey = () => SHADER_KEY;
  return mat;
}

const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
let shadowTex = null;
function getShadowTex() {
  if (shadowTex) return shadowTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  shadowTex = new THREE.CanvasTexture(cv);
  return shadowTex;
}
let sharedShadowMat = null;
let ENV = null;
export function setCarEnv(t) { ENV = t; }

export function createCarMesh(type, hex) {
  const T = TYPES[type];
  const { geo, H } = carGeometry(type, hex);
  const mat = makeCarMaterial(ENV);
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  const body = new THREE.Mesh(geo, mat);
  body.castShadow = true; body.receiveShadow = true;
  body.position.y = -H / 2;
  pivot.position.y = H / 2;
  pivot.add(body);
  root.add(pivot);
  if (!sharedShadowMat) sharedShadowMat = new THREE.MeshBasicMaterial({ map: getShadowTex(), transparent: true, depthWrite: false });
  const shadow = new THREE.Mesh(shadowGeo, sharedShadowMat);
  shadow.scale.set(T.L * 1.25, 1, T.W * 1.7);
  shadow.position.y = 0.09;
  root.add(shadow);
  return { root, pivot, body, mat, shadow, H, T, hex };
}

export function circlesFor(T) {
  const r = T.W / 2;
  const span = T.L / 2 - r;
  const n = Math.max(2, Math.ceil((2 * span) / (r * 1.5)) + 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(-span + (2 * span * i) / (n - 1));
  return { r, offs: out };
}
