import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANE_W } from './levels.js';
import { rand, pick } from './util.js';

const _c = new THREE.Color();
function paint(g, hex, k = 1, flat = true) {
  if (g.index) g = g.toNonIndexed();
  if (flat) g.computeVertexNormals();
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  _c.set(hex);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r * k; a[i * 3 + 1] = _c.g * k; a[i * 3 + 2] = _c.b * k; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function sbox(w, h, d, x, y, z, hex, k = 1) {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  g.deleteAttribute('uv');
  return paint(g, hex, k);
}
// road slab with planar world UVs (asphalt texture)
function rbox(w, h, d, x, y, z, tile = 12) {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / tile, p.getZ(i) / tile);
  return paint(g, '#ffffff');
}
// building box with window UVs (tile = 6.4 units = 4 windows × 2 floors)
function bbox(w, h, d, x, y, z, hex, tile = 6.4) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [du] = dims[f];
    const tu = Math.max(1, Math.round(du / tile)), tv = Math.max(1, Math.round(h / tile));
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      if (f === 2 || f === 3) uv.setXY(k, 0.03, 0.03);
      else uv.setXY(k, uv.getX(k) * tu, uv.getY(k) * tv);
    }
  }
  g.translate(x, y, z);
  return paint(g, hex);
}
function plain(g, x, y, z, hex, k = 1) { // untextured part inside textured mesh: map to wall-corner uv
  const gg = g.translate(x, y, z);
  const uv = gg.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.03, 0.03);
  return paint(gg, hex, k);
}

/* ---------------------------------------------------------------- textures */
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function finishTex(cv, repeat = true, aniso = 4) {
  const t = new THREE.CanvasTexture(cv);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function asphaltTexture() {
  const cv = mkCanvas(256, 256), g = cv.getContext('2d');
  g.fillStyle = '#3a3d45'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) { const v = 40 + Math.random() * 40; g.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + Math.random() * 0.4})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2); }
  for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(${70 + Math.random() * 20},${70 + Math.random() * 20},${76},0.07)`; g.beginPath(); g.ellipse(Math.random() * 256, Math.random() * 256, 20 + Math.random() * 40, 8 + Math.random() * 18, Math.random() * 3, 0, 6.28); g.fill(); }
  g.strokeStyle = 'rgba(15,15,18,.5)'; g.lineWidth = 1;
  for (let i = 0; i < 5; i++) { g.beginPath(); let x = Math.random() * 256, y = Math.random() * 256; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); }
  return finishTex(cv, true, 8);
}
function windowTexture(style) {
  const cv = mkCanvas(128, 128), g = cv.getContext('2d');
  g.fillStyle = '#f1f1f3'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.04})`; g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  const cols = style === 'office' ? 2 : 4, rows = 2, cw = 128 / cols, rh = 128 / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * cw, y = r * rh;
    const ix = style === 'office' ? 5 : cw * 0.2, iy = style === 'office' ? 14 : 12;
    const w = cw - ix * 2, h = rh - iy - (style === 'office' ? 12 : 16);
    const lit = Math.random() < 0.22;
    const gr = g.createLinearGradient(0, y + iy, 0, y + iy + h);
    if (lit) { gr.addColorStop(0, '#ffe6a8'); gr.addColorStop(1, '#ffc766'); } else if (style === 'office') { gr.addColorStop(0, '#9fc3e6'); gr.addColorStop(0.5, '#4d6f97'); gr.addColorStop(1, '#2d4262'); } else { gr.addColorStop(0, '#6f8db0'); gr.addColorStop(1, '#2f4562'); }
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x + ix - 2, y + iy - 2, w + 4, h + 4);
    g.fillStyle = gr; g.fillRect(x + ix, y + iy, w, h);
    if (style !== 'office') { g.fillStyle = '#d8d6d2'; g.fillRect(x + ix - 3, y + iy + h, w + 6, 4); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + ix + w / 2 - 1, y + iy, 2, h); }
    else { g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x + ix, y + iy, w, 3); }
  }
  g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 0, 128, 3); g.fillRect(0, 64, 128, 2);
  return finishTex(cv);
}
function shopTexture() {
  const cv = mkCanvas(128, 128), g = cv.getContext('2d');
  g.fillStyle = '#e9e7e2'; g.fillRect(0, 0, 128, 128);
  for (let c = 0; c < 2; c++) {
    const x = c * 64;
    const gr = g.createLinearGradient(0, 30, 0, 118); gr.addColorStop(0, '#b8d6f0'); gr.addColorStop(1, '#2f4258');
    g.fillStyle = '#2a2c31'; g.fillRect(x + 4, 28, 56, 94);
    g.fillStyle = gr; g.fillRect(x + 7, 31, 50, 88);
    g.fillStyle = 'rgba(255,230,160,.5)'; g.fillRect(x + 10, 80 + c * 6, 44, 30);
  }
  return finishTex(cv);
}
function billboardAtlas() {
  const cv = mkCanvas(1024, 128), g = cv.getContext('2d');
  const defs = [['CRASH!', '#ffd500', '#e8202a'], ['MEGA TIRES', '#ffffff', '#1b5fd6'], ['BURGER BOOM', '#fff2b0', '#d9480f'], ['$$$ CASH $$$', '#0b2a12', '#3ddc6a']];
  defs.forEach(([t, fg, bg], i) => {
    const x = i * 256;
    g.fillStyle = bg; g.fillRect(x, 0, 256, 128);
    g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(x + 6, 6, 244, 116);
    g.fillStyle = fg; g.font = 'italic 900 44px "Arial Black",Impact,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(t, x + 128, 66, 226);
  });
  return finishTex(cv, false, 4);
}

/* ------------------------------------------------------------------- world */
export function buildWorld(L) {
  const E = L.ext;
  const group = new THREE.Group();
  const hs = L.roads.filter((r) => r.o === 'h').map((r) => ({ ...r, hw: r.lanes * LANE_W })).sort((a, b) => a.c - b.c);
  const vs = L.roads.filter((r) => r.o === 'v').map((r) => ({ ...r, hw: r.lanes * LANE_W })).sort((a, b) => a.c - b.c);

  const statics = [], roads = [];
  statics.push(sbox(E * 2 + 600, 0.2, E * 2 + 600, 0, -0.12, 0, '#6f7480'));
  for (const r of hs) roads.push(rbox(E * 2, 0.06, r.hw * 2, 0, 0.03, r.c));
  for (const r of vs) roads.push(rbox(r.hw * 2, 0.06, E * 2, r.c, 0.03, 0, 12));

  const ints = [];
  for (const h of hs) for (const v of vs) ints.push({ x: v.c, z: h.c, hwh: h.hw, hwv: v.hw });
  const nearInt = (r, s, m = 1.2) => ints.some((it) => (r.o === 'h' ? it.z === r.c && Math.abs(s - it.x) < it.hwv + m : it.x === r.c && Math.abs(s - it.z) < it.hwh + m));

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
  // crosswalks
  for (const it of ints) {
    for (const sgn of [-1, 1]) {
      const cxp = it.x + sgn * (it.hwv + 1.2);
      for (let k = -it.hwh + 0.8; k < it.hwh; k += 1.4) statics.push(sbox(1.8, 0.02, 0.7, cxp, MY, it.z + k, '#ececec'));
      const czp = it.z + sgn * (it.hwh + 1.2);
      for (let k = -it.hwv + 0.8; k < it.hwv; k += 1.4) statics.push(sbox(0.7, 0.02, 1.8, it.x + k, MY, czp, '#ececec'));
    }
  }

  // block cells
  const xb = [-E, ...vs.flatMap((v) => [v.c - v.hw, v.c + v.hw]), E];
  const zb = [-E, ...hs.flatMap((h) => [h.c - h.hw, h.c + h.hw]), E];
  const colliders = [];
  const B = { office: [], resid: [], shop: [], awn: [] };
  const roofParts = [];
  const cellsX = [], cellsZ = [];
  for (let i = 0; i < xb.length; i += 2) cellsX.push([xb[i], xb[i + 1]]);
  for (let i = 0; i < zb.length; i += 2) cellsZ.push([zb[i], zb[i + 1]]);
  const palOffice = ['#cfd8e6', '#dfe4ea', '#bfd0e2', '#e4e0d6', '#c8d6d0'];
  const palResid = ['#d9b08c', '#c9805f', '#e3cba5', '#b9674d', '#d6c0a0', '#a9b8a0', '#e4b7a0'];
  const awnCols = ['#e8202a', '#1b6fd6', '#f2a900', '#2fa866', '#8e44ad'];
  let start = null;
  const billboards = [];
  const treeSpots = [];
  cellsX.forEach(([x0, x1], ci) => cellsZ.forEach(([z0, z1], ri) => {
    statics.push(sbox(x1 - x0, 0.24, z1 - z0, (x0 + x1) / 2, 0.08, (z0 + z1) / 2, '#b3b5bc'));
    const isStart = ci === 0 && ri === cellsZ.length - 1;
    const mx0 = x0 + (ci === 0 ? 0 : 1.7), mx1 = x1 - (ci === cellsX.length - 1 ? 0 : 1.7);
    const mz0 = z0 + (ri === 0 ? 0 : 1.7), mz1 = z1 - (ri === cellsZ.length - 1 ? 0 : 1.7);
    // curb line along road edges
    if (ci > 0) statics.push(sbox(0.3, 0.26, z1 - z0, x0 + 0.15, 0.09, (z0 + z1) / 2, '#d0d1d6'));
    if (ci < cellsX.length - 1) statics.push(sbox(0.3, 0.26, z1 - z0, x1 - 0.15, 0.09, (z0 + z1) / 2, '#d0d1d6'));
    if (ri > 0) statics.push(sbox(x1 - x0, 0.26, 0.3, (x0 + x1) / 2, 0.09, z0 + 0.15, '#d0d1d6'));
    if (ri < cellsZ.length - 1) statics.push(sbox(x1 - x0, 0.26, 0.3, (x0 + x1) / 2, 0.09, z1 - 0.15, '#d0d1d6'));
    if (isStart) {
      start = { x: mx1 - (mx1 - mx0) * 0.28, z: mz0 + (mz1 - mz0) * 0.28 };
      statics.push(sbox(mx1 - mx0 - 2, 0.04, mz1 - mz0 - 2, (mx0 + mx1) / 2, 0.21, (mz0 + mz1) / 2, '#4b505c'));
      // parking stripes + safety barriers on the plaza edge
      for (let k = 0; k < 9; k++) statics.push(sbox(0.15, 0.02, 5, mx0 + 6 + k * 3.4, 0.24, mz1 - 6, '#e6e6e6'));
      for (let k = 0; k < 6; k++) statics.push(sbox(2.4, 0.7, 0.5, mx0 + 4 + k * 3.2, 0.6, mz1 - 1.2, k % 2 ? '#f2f2f2' : '#e8202a'));
      return;
    }
    const w = mx1 - mx0, d = mz1 - mz0;
    const nx = w > 52 ? 3 : w > 26 ? 2 : 1, nz = d > 52 ? 3 : d > 26 ? 2 : 1;
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      const lw = w / nx, ld = d / nz, gap = 0.9;
      const bw = lw - gap * 2, bd = ld - gap * 2;
      const cx = mx0 + lw * (a + 0.5), cz = mz0 + ld * (b + 0.5);
      const style = pick(['office', 'resid', 'resid', 'office']);
      const h = rand(8, 24) * (Math.random() < 0.18 ? 1.7 : 1);
      const col = style === 'office' ? pick(palOffice) : pick(palResid);
      const base = 0.2;
      B[style].push(bbox(bw, h, bd, cx, base + h / 2, cz, col));
      let top = base + h;
      // setback tier
      if (h > 14 && Math.random() < 0.7) {
        const th = rand(4, 9);
        B[style].push(bbox(bw * 0.7, th, bd * 0.7, cx, top + th / 2, cz, col));
        top += th;
      }
      // roof cap + equipment
      roofParts.push(sbox(bw + 0.3, 0.35, bd + 0.3, cx, base + h + 0.17, cz, '#8f929c'));
      const rw = style === 'office' ? 0.5 : 0.7;
      if (top > base + h + 1) roofParts.push(sbox(bw * 0.7 + 0.3, 0.35, bd * 0.7 + 0.3, cx, top + 0.17, cz, '#8f929c'));
      for (let k = 0; k < 2; k++) roofParts.push(sbox(rand(1.2, 2.4), rand(0.8, 1.4), rand(1.2, 2.2), cx + rand(-1, 1) * bw * rw * 0.5, top + 0.7, cz + rand(-1, 1) * bd * rw * 0.5, '#b5b8c0'));
      if (Math.random() < 0.3) { roofParts.push(prismTank(cx + bw * 0.2, top, cz - bd * 0.2)); }
      if (Math.random() < 0.35) roofParts.push(sbox(0.15, rand(3, 7), 0.15, cx - bw * 0.25, top + 2.5, cz + bd * 0.2, '#5d6068'));
      // shop front + awning on road-facing sides (south & north wall)
      if (h < 20 && Math.random() < 0.8) {
        const sh = 3.6;
        const sc = new THREE.BoxGeometry(bw * 0.96, sh, 0.25);
        const front = Math.random() < 0.5 ? 1 : -1;
        const g1 = sc.translate(cx, base + sh / 2, cz + front * (bd / 2 + 0.08));
        const uv = g1.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(bw / 6.4)), uv.getY(i));
        B.shop.push(paint(g1, '#ffffff'));
        B.awn.push(sbox(bw * 0.96, 0.18, 1.3, cx, base + sh + 0.1, cz + front * (bd / 2 + 0.7), pick(awnCols)));
      }
      colliders.push({ minx: cx - bw / 2, maxx: cx + bw / 2, minz: cz - bd / 2, maxz: cz + bd / 2, h: top + 0.5 });
      if (Math.random() < 0.22 && h > 12) { const bwid = Math.min(bw * 0.8, 11), bz = cz + bd * 0.15; billboards.push({ x: cx, y: top + 0.35, z: bz, w: bwid, k: (Math.random() * 4) | 0 }); roofParts.push(sbox(0.2, 1.8, 0.2, cx - bwid * 0.3, top + 1.2, bz - 0.2, '#555a62'), sbox(0.2, 1.8, 0.2, cx + bwid * 0.3, top + 1.2, bz - 0.2, '#555a62')); }
    }
  }));
  // map boundary
  const BW = 60;
  colliders.push({ minx: -E - BW, maxx: -E, minz: -E - BW, maxz: E + BW }, { minx: E, maxx: E + BW, minz: -E - BW, maxz: E + BW },
    { minx: -E - BW, maxx: E + BW, minz: -E - BW, maxz: -E }, { minx: -E - BW, maxx: E + BW, minz: E, maxz: E + BW });

  // launch ramp
  start = start || { x: -E * 0.6, z: E * 0.6 };
  const toC = Math.atan2(-start.z, -start.x);
  const ramp = new THREE.Group();
  {
    const rg = [];
    rg.push(sbox(7, 0.5, 6, 0, 0.45, 0, '#f2c500'));
    const w = new THREE.BoxGeometry(5, 0.3, 6); w.rotateZ(0.22); w.translate(4.6, 0.8, 0); w.deleteAttribute('uv');
    rg.push(paint(w, '#e8202a'));
    for (let k = 0; k < 6; k++) rg.push(sbox(0.4, 0.04, 6.02, 2.6 + k * 0.8, 0.9 + k * 0.17, 0, k % 2 ? '#ffffff' : '#111111'));
    rg.push(sbox(0.5, 3.2, 0.5, -3, 2.1, -2.7, '#33353c'), sbox(0.5, 3.2, 0.5, -3, 2.1, 2.7, '#33353c'), sbox(0.4, 0.5, 6, -3, 3.6, 0, '#ffd500', 1.2));
    const m = new THREE.Mesh(mergeGeometries(rg), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 }));
    m.castShadow = m.receiveShadow = true;
    ramp.add(m);
    ramp.position.set(start.x, 0, start.z);
    ramp.rotation.y = -toC;
    group.add(ramp);
  }

  // traffic light poles
  const poles = [];
  const lampGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
  const lampMatH = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const lampMatV = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const lampsH = new THREE.InstancedMesh(lampGeo, lampMatH, Math.max(1, ints.length * 4));
  const lampsV = new THREE.InstancedMesh(lampGeo, lampMatV, Math.max(1, ints.length * 4));
  const dm = new THREE.Object3D();
  let li = 0;
  for (const it of ints) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = it.x + sx * (it.hwv + 0.9), pz = it.z + sz * (it.hwh + 0.9);
      statics.push(sbox(0.22, 4.4, 0.22, px, 2.3, pz, '#3a3d46'), sbox(0.9, 1.5, 0.4, px, 4.7, pz, '#1a1b1f'));
      dm.position.set(px, 4.7, pz); dm.updateMatrix(); lampsH.setMatrixAt(li, dm.matrix);
      const vx = px + sx * 0.05, vz = pz + sz * 0.45;
      dm.position.set(vx, 4.7, vz); dm.updateMatrix(); lampsV.setMatrixAt(li, dm.matrix);
      poles.push({ group: 'H', x: px, y: 4.7, z: pz }, { group: 'V', x: vx, y: 4.7, z: vz });
      li++;
    }
  }
  lampsH.instanceMatrix.needsUpdate = true; lampsV.instanceMatrix.needsUpdate = true;
  lampsH.setColorAt(0, _c.set('#fff')); lampsV.setColorAt(0, _c.set('#fff'));
  lampsH.frustumCulled = lampsV.frustumCulled = false;

  // street lamps + trees along sidewalks
  const lampHeads = [], treeParts = [];
  const nearStart = (x, z) => Math.hypot(x - start.x, z - start.z) < 16;
  const decorate = (x, z, idx, side) => {
    if (nearStart(x, z)) return;
    if (idx % 2 === 0) {
      statics.push(sbox(0.16, 6.2, 0.16, x, 3.3, z, '#4a4d56'));
      const ax = side === 'x' ? 0.9 : 0, az = side === 'z' ? 0.9 : 0;
      statics.push(sbox(side === 'x' ? 1.8 : 0.14, 0.14, side === 'z' ? 1.8 : 0.14, x + ax * 0.0, 6.35, z, '#4a4d56'));
      statics.push(sbox(0.7, 0.18, 0.7, x, 6.3, z, '#fff3c8', 2.2));
      lampHeads.push({ x, y: 6.1, z });
    } else {
      treeParts.push(...treeGeo(x, z));
    }
  };
  for (const r of hs) {
    let idx = 0;
    for (let s = -E + 8; s < E - 4; s += 15) {
      if (nearInt(r, s, 4.5)) continue;
      idx++;
      decorate(s, r.c - r.hw - 0.9, idx, 'x'); decorate(s + 7, r.c + r.hw + 0.9, idx + 1, 'x');
    }
  }
  for (const r of vs) {
    let idx = 0;
    for (let s = -E + 8; s < E - 4; s += 15) {
      if (nearInt(r, s, 4.5)) continue;
      idx++;
      decorate(r.c - r.hw - 0.9, s, idx, 'z'); decorate(r.c + r.hw + 0.9, s + 7, idx + 1, 'z');
    }
  }

  const aniso = 4;
  const roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: asphaltTexture(), roughness: 0.92, metalness: 0 });
  const roadMesh = new THREE.Mesh(mergeGeometries(roads), roadMat);
  roadMesh.receiveShadow = true;
  const statMesh = new THREE.Mesh(mergeGeometries(statics), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
  statMesh.receiveShadow = true; statMesh.castShadow = true;
  group.add(roadMesh, statMesh);
  const addB = (parts, tex, rough = 0.8) => {
    if (!parts.length) return;
    const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: rough, metalness: 0 }));
    m.castShadow = m.receiveShadow = true; group.add(m);
  };
  addB(B.office, windowTexture('office'), 0.55);
  addB(B.resid, windowTexture('resid'));
  addB(B.shop, shopTexture());
  if (B.awn.length) { const m = new THREE.Mesh(mergeGeometries(B.awn), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })); m.castShadow = true; group.add(m); }
  if (roofParts.length) { const m = new THREE.Mesh(mergeGeometries(roofParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })); m.castShadow = m.receiveShadow = true; group.add(m); }
  if (treeParts.length) { const m = new THREE.Mesh(mergeGeometries(treeParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })); m.castShadow = true; group.add(m); }
  // billboards
  if (billboards.length) {
    const atlas = billboardAtlas();
    const parts = [];
    for (const b of billboards) {
      const pg = new THREE.PlaneGeometry(b.w, b.w * 0.5);
      const uv = pg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) + b.k) / 4);
      pg.rotateX(-0.12).translate(b.x, b.y + b.w * 0.25 + 1.4, b.z);
      parts.push(pg);
    }
    const bm = new THREE.Mesh(mergeGeometries(parts.map((p) => { p.deleteAttribute('normal'); return p; })), new THREE.MeshBasicMaterial({ map: atlas, side: THREE.DoubleSide, toneMapped: false }));
    group.add(bm);
  }

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

  return { group, colliders, lanes, ints, lampsH, lampsV, start, toCenter: toC, hs, vs, ramp, poles, lampHeads };
}

function prismTank(x, y, z) {
  const parts = [];
  const c = new THREE.CylinderGeometry(1.1, 1.1, 2.0, 10).translate(x, y + 2.4, z); c.deleteAttribute('uv');
  const cone = new THREE.ConeGeometry(1.25, 0.8, 10).translate(x, y + 3.8, z); cone.deleteAttribute('uv');
  const legs = sbox(0.2, 1.6, 0.2, x - 0.6, y + 0.8, z, '#4a3a2a');
  parts.push(paint(c, '#9c6a43', 1, false), paint(cone, '#5c4430', 1, false), legs);
  return mergeGeometries(parts);
}
const GREENS = ['#3e8e41', '#4fa34a', '#2f7d3a', '#68b04f', '#3a8a58'];
function treeGeo(x, z) {
  const base = 0.2, h = rand(1.6, 2.4), r = rand(1.3, 1.9);
  const trunk = new THREE.CylinderGeometry(0.14, 0.2, h, 6).translate(x, base + h / 2, z); trunk.deleteAttribute('uv');
  const f1 = new THREE.IcosahedronGeometry(r, 0).translate(x, base + h + r * 0.55, z); f1.deleteAttribute('uv');
  const f2 = new THREE.IcosahedronGeometry(r * 0.7, 0).translate(x + rand(-0.4, 0.4), base + h + r * 1.4, z + rand(-0.4, 0.4)); f2.deleteAttribute('uv');
  return [paint(trunk, '#6b4a2e', 1, false), paint(f1, pick(GREENS)), paint(f2, pick(GREENS))];
}

export function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
  });
}
