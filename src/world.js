import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANE_W } from './levels.js';
import { rand } from './util.js';

const _c = new THREE.Color();
function paint(g, hex) {
  if (g.index) g = g.toNonIndexed();
  g.computeVertexNormals();
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  _c.set(hex);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function sbox(w, h, d, x, y, z, hex) {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  g.deleteAttribute('uv');
  return paint(g, hex);
}
// building box with window UVs (tile = 4 units)
function bbox(w, h, d, x, y, z, hex) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [du, dv] = dims[f];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      if (f === 2 || f === 3) uv.setXY(k, 0.03, 0.03);
      else uv.setXY(k, uv.getX(k) * Math.round(du / 4), uv.getY(k) * Math.round(h / 4));
    }
  }
  g.translate(x, y, z);
  return paint(g, hex);
}
function windowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#4a5d7a'; g.fillRect(14, 12, 36, 40);
  g.fillStyle = '#7d93b5'; g.fillRect(16, 14, 32, 14);
  g.fillStyle = '#d9d9de'; g.fillRect(0, 0, 64, 5);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 2;
  return t;
}

export function buildWorld(L) {
  const E = L.ext;
  const group = new THREE.Group();
  const hs = L.roads.filter((r) => r.o === 'h').map((r) => ({ ...r, hw: r.lanes * LANE_W })).sort((a, b) => a.c - b.c);
  const vs = L.roads.filter((r) => r.o === 'v').map((r) => ({ ...r, hw: r.lanes * LANE_W })).sort((a, b) => a.c - b.c);

  const statics = [];
  // ground
  statics.push(sbox(E * 2 + 400, 0.2, E * 2 + 400, 0, -0.12, 0, '#7f8590'));
  // roads
  for (const r of hs) statics.push(sbox(E * 2, 0.06, r.hw * 2, 0, 0.03, r.c, '#2c2f36'));
  for (const r of vs) statics.push(sbox(r.hw * 2, 0.06, E * 2, r.c, 0.03, 0, '#2c2f36'));

  const ints = [];
  for (const h of hs) for (const v of vs) ints.push({ x: v.c, z: h.c, hwh: h.hw, hwv: v.hw });
  const inInt = (axis, s, margin) => ints.some((it) => (axis === 'x' ? Math.abs(s - it.x) < it.hwv + margin : Math.abs(s - it.z) < it.hwh + margin));
  const nearInt = (r, s) => ints.some((it) => (r.o === 'h' ? it.z === r.c && Math.abs(s - it.x) < it.hwv + 1.2 : it.x === r.c && Math.abs(s - it.z) < it.hwh + 1.2));

  // lane markings
  const MY = 0.075;
  for (const r of hs) {
    for (let s = -E + 2; s < E; s += 6) {
      if (nearInt(r, s + 1.5)) continue;
      for (let i = 1; i < r.lanes; i++) {
        statics.push(sbox(3, 0.02, 0.16, s + 1.5, MY, r.c + i * LANE_W, '#d8d8d8'));
        statics.push(sbox(3, 0.02, 0.16, s + 1.5, MY, r.c - i * LANE_W, '#d8d8d8'));
      }
    }
    for (let s = -E; s < E; s += 4) {
      if (nearInt(r, s + 2)) continue;
      statics.push(sbox(3.2, 0.02, 0.14, s + 2, MY, r.c - 0.18, '#f2c500'), sbox(3.2, 0.02, 0.14, s + 2, MY, r.c + 0.18, '#f2c500'));
    }
    statics.push(sbox(E * 2, 0.02, 0.18, 0, MY, r.c - r.hw + 0.25, '#d8d8d8'), sbox(E * 2, 0.02, 0.18, 0, MY, r.c + r.hw - 0.25, '#d8d8d8'));
  }
  for (const r of vs) {
    for (let s = -E + 2; s < E; s += 6) {
      if (nearInt(r, s + 1.5)) continue;
      for (let i = 1; i < r.lanes; i++) {
        statics.push(sbox(0.16, 0.02, 3, r.c + i * LANE_W, MY, s + 1.5, '#d8d8d8'));
        statics.push(sbox(0.16, 0.02, 3, r.c - i * LANE_W, MY, s + 1.5, '#d8d8d8'));
      }
    }
    for (let s = -E; s < E; s += 4) {
      if (nearInt(r, s + 2)) continue;
      statics.push(sbox(0.14, 0.02, 3.2, r.c - 0.18, MY, s + 2, '#f2c500'), sbox(0.14, 0.02, 3.2, r.c + 0.18, MY, s + 2, '#f2c500'));
    }
    statics.push(sbox(0.18, 0.02, E * 2, r.c - r.hw + 0.25, MY, 0, '#d8d8d8'), sbox(0.18, 0.02, E * 2, r.c + r.hw - 0.25, MY, 0, '#d8d8d8'));
  }
  // crosswalks + stop lines
  for (const it of ints) {
    for (const sgn of [-1, 1]) {
      // horizontal road arms (crossing across h road width, placed beside vertical road)
      const cxp = it.x + sgn * (it.hwv + 1.2);
      for (let k = -it.hwh + 0.8; k < it.hwh; k += 1.4) statics.push(sbox(1.8, 0.02, 0.7, cxp, MY, it.z + k, '#e8e8e8'));
      const czp = it.z + sgn * (it.hwh + 1.2);
      for (let k = -it.hwv + 0.8; k < it.hwv; k += 1.4) statics.push(sbox(0.7, 0.02, 1.8, it.x + k, MY, czp, '#e8e8e8'));
    }
  }

  // block cells
  const xb = [-E, ...vs.flatMap((v) => [v.c - v.hw, v.c + v.hw]), E];
  const zb = [-E, ...hs.flatMap((h) => [h.c - h.hw, h.c + h.hw]), E];
  const colliders = [];
  const bparts = [];
  const cellsX = [], cellsZ = [];
  for (let i = 0; i < xb.length; i += 2) cellsX.push([xb[i], xb[i + 1]]);
  for (let i = 0; i < zb.length; i += 2) cellsZ.push([zb[i], zb[i + 1]]);
  const pal = ['#e9d8c4', '#d4dbe6', '#e6c9c9', '#cfe3d4', '#e8e2b8', '#c9cfe8', '#f0d9b5', '#d8d0e6'];
  let start = null;
  const sc = { x: 0, z: 0 };
  cellsX.forEach(([x0, x1], ci) => cellsZ.forEach(([z0, z1], ri) => {
    statics.push(sbox(x1 - x0, 0.24, z1 - z0, (x0 + x1) / 2, 0.08, (z0 + z1) / 2, '#a9acb3'));
    const isStart = ci === 0 && ri === cellsZ.length - 1;
    const mx0 = x0 + (ci === 0 ? 0 : 1.6), mx1 = x1 - (ci === cellsX.length - 1 ? 0 : 1.6);
    const mz0 = z0 + (ri === 0 ? 0 : 1.6), mz1 = z1 - (ri === cellsZ.length - 1 ? 0 : 1.6);
    if (isStart) {
      start = { x: mx1 - (mx1 - mx0) * 0.28, z: mz0 + (mz1 - mz0) * 0.28 };
      statics.push(sbox(mx1 - mx0 - 2, 0.04, mz1 - mz0 - 2, (mx0 + mx1) / 2, 0.21, (mz0 + mz1) / 2, '#555a66'));
      return;
    }
    const w = mx1 - mx0, d = mz1 - mz0;
    const nx = w > 52 ? 3 : w > 26 ? 2 : 1, nz = d > 52 ? 3 : d > 26 ? 2 : 1;
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      const lw = w / nx, ld = d / nz;
      const gap = 0.9;
      const bw = lw - gap * 2, bd = ld - gap * 2;
      const cx = mx0 + lw * (a + 0.5), cz = mz0 + ld * (b + 0.5);
      const h = rand(7, 24) * (Math.random() < 0.2 ? 1.6 : 1);
      const col = pal[(Math.random() * pal.length) | 0];
      bparts.push(bbox(bw, h, bd, cx, 0.2 + h / 2, cz, col));
      bparts.push(bbox(bw * 0.5, 1.2, bd * 0.5, cx, 0.2 + h + 0.6, cz, '#8c8f99'));
      colliders.push({ minx: cx - bw / 2, maxx: cx + bw / 2, minz: cz - bd / 2, maxz: cz + bd / 2 });
    }
  }));
  // map boundary
  const B = 60;
  colliders.push({ minx: -E - B, maxx: -E, minz: -E - B, maxz: E + B }, { minx: E, maxx: E + B, minz: -E - B, maxz: E + B },
    { minx: -E - B, maxx: E + B, minz: -E - B, maxz: -E }, { minx: -E - B, maxx: E + B, minz: E, maxz: E + B });

  // launch ramp
  start = start || { x: -E * 0.6, z: E * 0.6 };
  const toC = Math.atan2(-start.z, -start.x);
  const ramp = new THREE.Group();
  {
    const rg = [];
    rg.push(sbox(7, 0.5, 6, 0, 0.45, 0, '#f2c500'));
    const w = new THREE.BoxGeometry(5, 0.3, 6); w.rotateZ(0.22); w.translate(4.6, 0.8, 0); w.deleteAttribute('uv');
    rg.push(paint(w, '#e8202a'));
    rg.push(sbox(0.5, 3, 0.5, -3, 2, -2.7, '#333'), sbox(0.5, 3, 0.5, -3, 2, 2.7, '#333'));
    const m = new THREE.Mesh(mergeGeometries(rg), new THREE.MeshLambertMaterial({ vertexColors: true }));
    ramp.add(m);
    ramp.position.set(start.x, 0, start.z);
    ramp.rotation.y = -toC;
    group.add(ramp);
  }

  // traffic light poles
  const lampGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
  const lampMatH = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const lampMatV = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const lampsH = new THREE.InstancedMesh(lampGeo, lampMatH, Math.max(1, ints.length * 4));
  const lampsV = new THREE.InstancedMesh(lampGeo, lampMatV, Math.max(1, ints.length * 4));
  const dm = new THREE.Object3D();
  let li = 0;
  for (const it of ints) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = it.x + sx * (it.hwv + 0.9), pz = it.z + sz * (it.hwh + 0.9);
      statics.push(sbox(0.22, 4.4, 0.22, px, 2.3, pz, '#3a3d46'));
      dm.position.set(px, 4.7, pz); dm.updateMatrix();
      lampsH.setMatrixAt(li, dm.matrix);
      dm.position.set(px + sx * 0.05, 4.7, pz + sz * 0.45); dm.updateMatrix();
      lampsV.setMatrixAt(li, dm.matrix);
      li++;
    }
  }
  lampsH.instanceMatrix.needsUpdate = true; lampsV.instanceMatrix.needsUpdate = true;
  lampsH.setColorAt(0, _c.set('#fff')); lampsV.setColorAt(0, _c.set('#fff'));
  lampsH.frustumCulled = lampsV.frustumCulled = false;

  const matStatic = new THREE.MeshLambertMaterial({ vertexColors: true });
  group.add(new THREE.Mesh(mergeGeometries(statics), matStatic));
  if (bparts.length) group.add(new THREE.Mesh(mergeGeometries(bparts), new THREE.MeshLambertMaterial({ vertexColors: true, map: windowTexture() })));
  group.add(lampsH, lampsV);

  // lanes
  const lanes = [];
  const mkLane = (axis, fixed, dir, group_, a, b, r) => lanes.push({ axis, fixed, dir, group: group_, a, b, len: Math.abs(b - a), cars: [], waiting: [], stops: [], zones: [], hw: r.hw });
  for (const r of hs) for (let i = 0; i < r.lanes; i++) {
    mkLane('x', r.c + (i + 0.5) * LANE_W, 1, 'H', -E, E, r);
    mkLane('x', r.c - (i + 0.5) * LANE_W, -1, 'H', E, -E, r);
  }
  for (const r of vs) for (let i = 0; i < r.lanes; i++) {
    mkLane('z', r.c - (i + 0.5) * LANE_W, 1, 'V', -E, E, r);
    mkLane('z', r.c + (i + 0.5) * LANE_W, -1, 'V', E, -E, r);
  }
  for (const l of lanes) {
    for (const it of ints) {
      const crossesRoad = l.axis === 'x' ? Math.abs(l.fixed - it.z) < it.hwh : Math.abs(l.fixed - it.x) < it.hwv;
      if (!crossesRoad) continue;
      const ix = l.axis === 'x' ? it.x : it.z;
      const ch = l.axis === 'x' ? it.hwv : it.hwh;
      l.stops.push({ p: (ix - l.dir * (ch + 2.4) - l.a) * l.dir });
      l.zones.push([(ix - l.dir * ch - l.a) * l.dir - 1, (ix + l.dir * ch - l.a) * l.dir + 1]);
    }
    l.stops.sort((p, q) => p.p - q.p);
  }

  return { group, colliders, lanes, ints, lampsH, lampsV, start, toCenter: toC, hs, vs, ramp };
}

export function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && o.material.map && o.material.map !== undefined && !o.material.map.isShared) o.material.map.dispose();
  });
}
