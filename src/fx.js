import * as THREE from 'three';

function softTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
function skidTex() {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 16;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 64, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.2, 'rgba(255,255,255,1)'); gr.addColorStop(0.8, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 2, 64, 12);
  return new THREE.CanvasTexture(cv);
}
function scorchTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, r = 20 + Math.random() * 38; g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 3 + Math.random() * 8, 0, 6.28); g.fill(); }
  return new THREE.CanvasTexture(cv);
}

function pointsMaterial(tex, additive, scaleUniform) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, scale: scaleUniform }, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC; uniform float scale;
      void main(){ vA=alpha; vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*scale/max(1.0,-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D map; varying float vA; varying vec3 vC;
      void main(){ vec4 t=texture2D(map,gl_PointCoord); gl_FragColor=vec4(vC,vA*t.a); }`,
  });
}

class Particles {
  constructor(n, additive, tex, scaleUniform) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.a0 = new Float32Array(n);
    this.c0 = new Float32Array(n * 3); this.c1 = new Float32Array(n * 3);
    this.drag = new Float32Array(n); this.up = new Float32Array(n);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, pointsMaterial(tex, additive, scaleUniform));
    this.points.frustumCulled = false;
    this.geo = g;
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, a, drag = 0.9, up = 0) {
    const i = this.i; this.i = (i + 1) % this.n;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a;
    this.c0[k] = c0[0]; this.c0[k + 1] = c0[1]; this.c0[k + 2] = c0[2];
    this.c1[k] = c1[0]; this.c1[k + 1] = c1[1]; this.c1[k + 2] = c1[2];
    this.drag[i] = drag; this.up[i] = up;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.size[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; } continue; }
      this.life[i] -= dt;
      const k = i * 3, t = 1 - Math.max(0, this.life[i]) / this.max[i];
      const d = Math.pow(this.drag[i], dt * 60);
      this.vel[k] *= d; this.vel[k + 1] = this.vel[k + 1] * d + this.up[i] * dt; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.1 && this.up[i] < 0) { this.pos[k + 1] = 0.1; this.vel[k + 1] *= -0.3; }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.alpha[i] = this.a0[i] * (1 - t) * Math.min(1, t * 12 + 0.2);
      this.col[k] = this.c0[k] + (this.c1[k] - this.c0[k]) * t;
      this.col[k + 1] = this.c0[k + 1] + (this.c1[k + 1] - this.c0[k + 1]) * t;
      this.col[k + 2] = this.c0[k + 2] + (this.c1[k + 2] - this.c0[k + 2]) * t;
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true;
  }
  clear() { this.life.fill(0); for (let i = 0; i < this.n; i++) { this.pos[i * 3 + 1] = -999; this.size[i] = 0; this.alpha[i] = 0; } }
}

// immediate-mode additive glow sprites (head/tail lights, signals) – rewritten every frame
class Glow {
  constructor(n, tex, scaleUniform) {
    this.n = n; this.k = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, pointsMaterial(tex, true, scaleUniform));
    this.points.frustumCulled = false; this.geo = g;
  }
  begin() { this.k = 0; }
  add(x, y, z, s, r, g, b, a) {
    if (this.k >= this.n) return;
    const i = this.k++, k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z; this.col[k] = r; this.col[k + 1] = g; this.col[k + 2] = b; this.size[i] = s; this.alpha[i] = a;
  }
  end() {
    for (let i = this.k; i < this.n; i++) { this.size[i] = 0; this.alpha[i] = 0; }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true;
  }
}

const FIRE0 = [1, 0.9, 0.45], FIRE1 = [0.95, 0.2, 0.02];
const SMOKE0 = [0.38, 0.38, 0.4], SMOKE1 = [0.09, 0.09, 0.1];

export class FX {
  constructor(scene) {
    const tex = softTex();
    this.scaleU = { value: 500 };
    this.smoke = new Particles(520, false, tex, this.scaleU);
    this.fire = new Particles(640, true, tex, this.scaleU);
    this.glow = new Glow(520, tex, this.scaleU);
    scene.add(this.smoke.points, this.fire.points, this.glow.points);

    // decals
    const dm = (m, n) => { const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), m, n); im.frustumCulled = false; const o = new THREE.Object3D(); o.scale.setScalar(0); o.updateMatrix(); for (let i = 0; i < n; i++) im.setMatrixAt(i, o.matrix); return im; };
    this.skids = dm(new THREE.MeshBasicMaterial({ map: skidTex(), color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 600);
    this.scorches = dm(new THREE.MeshBasicMaterial({ map: scorchTex(), color: 0x000000, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }), 28);
    this.skidsN = 600; this.sk = 0; this.scN = 28; this.sc = 0;
    scene.add(this.skids, this.scorches);

    // debris
    this.dn = 220;
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), this.dn);
    this.debris.frustumCulled = false;
    this.dd = Array.from({ length: this.dn }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, sx: 0.3, sy: 0.3, sz: 0.3 }));
    this.di = 0;
    this.dmm = new THREE.Object3D();
    const col = new THREE.Color(0x000000);
    for (let i = 0; i < this.dn; i++) { this.debris.setColorAt(i, col); this.dmm.scale.setScalar(0); this.dmm.updateMatrix(); this.debris.setMatrixAt(i, this.dmm.matrix); }
    scene.add(this.debris);

    // flying wheels
    this.wn = 18;
    this.wheels = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 12).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x18181a }), this.wn);
    this.wheels.frustumCulled = false;
    this.ww = Array.from({ length: this.wn }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, spin: 0, ws: 0 }));
    this.wi = 0;
    for (let i = 0; i < this.wn; i++) { this.dmm.scale.setScalar(0); this.dmm.updateMatrix(); this.wheels.setMatrixAt(i, this.dmm.matrix); }
    scene.add(this.wheels);

    // fireballs + rings
    this.balls = [];
    const bg = new THREE.SphereGeometry(1, 14, 10);
    const rg = new THREE.RingGeometry(0.88, 1, 36).rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      const r = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      m.visible = r.visible = false; scene.add(m, r);
      this.balls.push({ m, r, t: 1, dur: 1, R: 5, x: 0, z: 0 });
    }
    this.bi = 0;
    this.light = new THREE.PointLight(0xff9a40, 0, 80, 1.7);
    this.light.position.set(0, 6, 0);
    scene.add(this.light);
    this.lightI = 0;
  }
  setScale(s) { this.scaleU.value = s; }
  clear() {
    this.smoke.clear(); this.fire.clear();
    this.dd.forEach((d) => (d.life = 0)); this.ww.forEach((d) => (d.life = 0));
    this.balls.forEach((b) => { b.t = 1; b.m.visible = b.r.visible = false; });
    const o = this.dmm; o.scale.setScalar(0); o.updateMatrix();
    for (let i = 0; i < this.skidsN; i++) this.skids.setMatrixAt(i, o.matrix);
    for (let i = 0; i < this.scN; i++) this.scorches.setMatrixAt(i, o.matrix);
    this.skids.instanceMatrix.needsUpdate = this.scorches.instanceMatrix.needsUpdate = true;
    this.sk = this.sc = 0; this.lightI = 0; this.light.intensity = 0;
  }
  /* ---- decals */
  skid(x, z, ang, len = 1.2, wid = 0.28) {
    const o = this.dmm;
    o.position.set(x, 0.082, z); o.rotation.set(0, -ang, 0); o.scale.set(len, 1, wid); o.updateMatrix();
    this.skids.setMatrixAt(this.sk, o.matrix); this.sk = (this.sk + 1) % this.skidsN; this.skids.instanceMatrix.needsUpdate = true;
    o.rotation.set(0, 0, 0);
  }
  scorch(x, z, R) {
    const o = this.dmm;
    o.position.set(x, 0.086, z); o.rotation.set(0, Math.random() * 6.28, 0); o.scale.set(R * 1.7, 1, R * 1.7); o.updateMatrix();
    this.scorches.setMatrixAt(this.sc, o.matrix); this.sc = (this.sc + 1) % this.scN; this.scorches.instanceMatrix.needsUpdate = true;
    o.rotation.set(0, 0, 0);
  }
  /* ---- particle helpers */
  spark(x, y, z, n, speed = 8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = speed * (0.4 + Math.random());
      this.fire.emit(x, y, z, Math.cos(a) * s, Math.random() * s * 0.9 + 1, Math.sin(a) * s, 0.35 + Math.random() * 0.45, 0.42, 0.08, [1, 0.97, 0.7], [1, 0.45, 0.08], 1, 0.95, -22);
    }
  }
  smokePuff(x, y, z, s = 1.5, a = 0.5) {
    this.smoke.emit(x + (Math.random() - 0.5), y, z + (Math.random() - 0.5), (Math.random() - 0.5) * 1.5, 1.5 + Math.random(), (Math.random() - 0.5) * 1.5, 1.4 + Math.random() * 0.8, s * 0.6, s * 2.6, SMOKE0, SMOKE1, a, 0.97, 0.5);
  }
  flame(x, y, z, big = 1) {
    this.fire.emit(x + (Math.random() - 0.5) * 1.3, y, z + (Math.random() - 0.5) * 1.3, (Math.random() - 0.5), 2.2 + Math.random() * 2.2, (Math.random() - 0.5), 0.45 + Math.random() * 0.35, 1.7 * big, 0.3, FIRE0, FIRE1, 0.95, 0.96, 1.2);
    if (Math.random() < 0.35) this.fire.emit(x, y + 0.5, z, (Math.random() - 0.5) * 2, 3 + Math.random() * 3, (Math.random() - 0.5) * 2, 0.9 + Math.random() * 0.8, 0.3, 0.1, [1, 0.8, 0.3], [1, 0.3, 0.05], 1, 0.98, -3);
  }
  dust(x, z, n = 4) {
    for (let i = 0; i < n; i++) this.smoke.emit(x, 0.3, z, (Math.random() - 0.5) * 6, 0.5 + Math.random(), (Math.random() - 0.5) * 6, 0.8, 0.9, 2.6, [0.62, 0.6, 0.58], [0.5, 0.5, 0.5], 0.38, 0.9);
  }
  tireSmoke(x, z, vx, vz, n = 6) {
    for (let i = 0; i < n; i++) this.smoke.emit(x + (Math.random() - 0.5) * 2, 0.4, z + (Math.random() - 0.5) * 2, vx * 0.1 + (Math.random() - 0.5) * 3, 0.6 + Math.random() * 1.2, vz * 0.1 + (Math.random() - 0.5) * 3, 1.1 + Math.random() * 0.6, 1.2, 4, [0.9, 0.9, 0.9], [0.6, 0.6, 0.62], 0.55, 0.94);
  }
  debrisBurst(x, y, z, vx, vz, n, hex, power = 8) {
    const col = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const idx = this.di, d = this.dd[idx]; this.di = (this.di + 1) % this.dn;
      d.life = 2.5 + Math.random() * 1.8; d.x = x; d.y = y; d.z = z;
      const a = Math.random() * 6.283, s = power * (0.3 + Math.random());
      d.vx = vx * 0.4 + Math.cos(a) * s; d.vz = vz * 0.4 + Math.sin(a) * s; d.vy = 3 + Math.random() * power * 0.7;
      d.rx = d.ry = d.rz = Math.random() * 6; d.wx = (Math.random() - 0.5) * 16; d.wy = (Math.random() - 0.5) * 16; d.wz = (Math.random() - 0.5) * 16;
      const panel = Math.random() < 0.6;
      d.sx = 0.25 + Math.random() * (panel ? 0.8 : 0.3); d.sy = panel ? 0.05 + Math.random() * 0.08 : 0.2 + Math.random() * 0.3; d.sz = 0.25 + Math.random() * (panel ? 0.7 : 0.3);
      col.set(Math.random() < 0.25 ? '#1a1a1c' : hex);
      this.debris.setColorAt(idx, col);
    }
    this.debris.instanceColor.needsUpdate = true;
  }
  glassBurst(x, y, z, vx, vz, n) {
    const col = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const idx = this.di, d = this.dd[idx]; this.di = (this.di + 1) % this.dn;
      d.life = 1.6 + Math.random(); d.x = x; d.y = y; d.z = z;
      const a = Math.random() * 6.283, s = 3 + Math.random() * 7;
      d.vx = vx * 0.3 + Math.cos(a) * s; d.vz = vz * 0.3 + Math.sin(a) * s; d.vy = 2 + Math.random() * 6;
      d.rx = d.ry = d.rz = Math.random() * 6; d.wx = (Math.random() - 0.5) * 22; d.wy = (Math.random() - 0.5) * 22; d.wz = (Math.random() - 0.5) * 22;
      d.sx = 0.12 + Math.random() * 0.2; d.sy = 0.02; d.sz = 0.12 + Math.random() * 0.2;
      col.setRGB(1.6, 2.2, 2.6);
      this.debris.setColorAt(idx, col);
    }
    this.debris.instanceColor.needsUpdate = true;
  }
  wheelBurst(x, y, z, vx, vz, n = 1) {
    for (let k = 0; k < n; k++) {
      const w = this.ww[this.wi]; this.wi = (this.wi + 1) % this.wn;
      const a = Math.random() * 6.283, s = 4 + Math.random() * 9;
      w.life = 7; w.x = x; w.y = y + 0.4; w.z = z; w.vx = vx * 0.5 + Math.cos(a) * s; w.vz = vz * 0.5 + Math.sin(a) * s; w.vy = 4 + Math.random() * 7;
      w.yaw = Math.atan2(w.vz, w.vx) + Math.PI / 2; w.spin = 0; w.ws = 14 + Math.random() * 8;
    }
  }
  explosion(x, z, R) {
    const b = this.balls[this.bi]; this.bi = (this.bi + 1) % this.balls.length;
    b.t = 0; b.dur = 0.75 + R * 0.05; b.R = R; b.x = x; b.z = z; b.m.visible = b.r.visible = true;
    const n = Math.min(46, 16 + R * 2.2);
    this.fire.emit(x, 2, z, 0, 0, 0, 0.28, R * 2.2, R * 3.6, [1, 0.95, 0.75], [1, 0.6, 0.2], 0.95, 1, 0);
    this.fire.emit(x, 2.5, z, 0, 3, 0, 0.5, R * 1.2, R * 2.4, [1, 0.8, 0.4], [1, 0.3, 0.05], 0.9, 1, 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = Math.random() * R * 1.5, up = Math.random() * R;
      this.fire.emit(x, 0.8 + Math.random() * 1.5, z, Math.cos(a) * s, up, Math.sin(a) * s, 0.55 + Math.random() * 0.7, R * 0.3, R * 0.08, FIRE0, FIRE1, 1, 0.93, 0);
      this.smoke.emit(x, 1, z, Math.cos(a) * s * 0.55, up * 0.75, Math.sin(a) * s * 0.55, 2.2 + Math.random() * 1.8, R * 0.26, R * 0.8, SMOKE0, SMOKE1, 0.72, 0.95, 1.4);
    }
    this.spark(x, 1, z, 34, R * 1.7);
    // embers falling slowly
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * 6.283, s = Math.random() * R * 0.9;
      this.fire.emit(x, 2, z, Math.cos(a) * s, 6 + Math.random() * R, Math.sin(a) * s, 1.6 + Math.random() * 1.2, 0.35, 0.1, [1, 0.7, 0.2], [0.8, 0.15, 0.02], 1, 0.985, -9);
    }
    this.scorch(x, z, R * 0.9);
    this.lightI = Math.max(this.lightI, 70 + R * 14);
    this.light.position.set(x, 6 + R * 0.3, z);
  }
  lightFlash(x, z, i) { this.light.position.set(x, 5, z); this.lightI = Math.max(this.lightI, i); }
  update(dt) {
    this.smoke.update(dt); this.fire.update(dt);
    const dm = this.dmm;
    for (let i = 0; i < this.dn; i++) {
      const d = this.dd[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      d.vy -= 24 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.y < 0.12) { d.y = 0.12; d.vy *= -0.35; d.vx *= 0.7; d.vz *= 0.7; d.wx *= 0.6; d.wy *= 0.6; d.wz *= 0.6; }
      d.rx += d.wx * dt; d.ry += d.wy * dt; d.rz += d.wz * dt;
      const f = Math.min(1, d.life);
      dm.position.set(d.x, d.y, d.z); dm.rotation.set(d.rx, d.ry, d.rz); dm.scale.set(d.sx * f, d.sy * f, d.sz * f);
      dm.updateMatrix(); this.debris.setMatrixAt(i, dm.matrix);
      if (d.life <= 0) { dm.scale.setScalar(0); dm.updateMatrix(); this.debris.setMatrixAt(i, dm.matrix); }
    }
    this.debris.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.wn; i++) {
      const w = this.ww[i];
      if (w.life <= 0) continue;
      w.life -= dt;
      w.vy -= 24 * dt; w.x += w.vx * dt; w.y += w.vy * dt; w.z += w.vz * dt;
      if (w.y < 0.4) { w.y = 0.4; w.vy *= -0.4; w.vx *= 0.985; w.vz *= 0.985; if (Math.random() < 0.05) this.dust(w.x, w.z, 1); }
      w.vx *= 1 - 0.25 * dt; w.vz *= 1 - 0.25 * dt;
      w.spin += w.ws * dt; w.ws *= 1 - 0.2 * dt;
      dm.position.set(w.x, w.y, w.z); dm.rotation.set(0, w.yaw, w.spin, 'YXZ'); dm.scale.setScalar(w.life < 1 ? w.life : 1);
      dm.updateMatrix(); this.wheels.setMatrixAt(i, dm.matrix);
      if (w.life <= 0) { dm.scale.setScalar(0); dm.updateMatrix(); this.wheels.setMatrixAt(i, dm.matrix); }
      dm.rotation.order = 'XYZ';
    }
    this.wheels.instanceMatrix.needsUpdate = true;
    dm.rotation.set(0, 0, 0);
    for (const b of this.balls) {
      if (b.t >= 1) continue;
      b.t += dt / b.dur;
      if (b.t >= 1) { b.m.visible = b.r.visible = false; continue; }
      const e = 1 - Math.pow(1 - b.t, 3);
      b.m.position.set(b.x, 1.4 + e * b.R * 0.35, b.z);
      b.m.scale.setScalar(0.4 + e * b.R * 0.55);
      b.m.material.opacity = (1 - b.t) * (1 - b.t) * 0.9;
      b.m.material.color.setRGB(1, 0.8 - b.t * 0.55, 0.28 - b.t * 0.2);
      b.r.position.set(b.x, 0.3, b.z);
      b.r.scale.setScalar(0.5 + e * b.R * 1.7);
      b.r.material.opacity = (1 - b.t) * 0.65;
      if (b.t < 0.55 && Math.random() < 0.85) this.smoke.emit(b.x + (Math.random() - 0.5) * b.R * 0.4, 2 + e * b.R * 0.5, b.z + (Math.random() - 0.5) * b.R * 0.4, 0, 3 + b.R * 0.3, 0, 2.4, b.R * 0.3, b.R * 0.85, [0.3, 0.28, 0.27], SMOKE1, 0.55, 0.97, 0.8);
    }
    if (this.lightI > 0.05) { this.lightI *= Math.exp(-7 * dt); this.light.intensity = this.lightI; } else if (this.light.intensity) { this.lightI = 0; this.light.intensity = 0; }
  }
}
