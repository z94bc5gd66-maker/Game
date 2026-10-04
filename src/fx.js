import * as THREE from 'three';

function softTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

class Particles {
  constructor(n, additive, tex) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.a0 = new Float32Array(n);
    this.c0 = new Float32Array(n * 3); this.c1 = new Float32Array(n * 3);
    this.drag = new Float32Array(n); this.up = new Float32Array(n);
    this.pos.fill(0, 0); for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { map: { value: tex }, scale: { value: 500 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC; uniform float scale;
        void main(){ vA=alpha; vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*scale/max(1.0,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D map; varying float vA; varying vec3 vC;
        void main(){ vec4 t=texture2D(map,gl_PointCoord); gl_FragColor=vec4(vC,vA*t.a); }`,
    });
    this.points = new THREE.Points(g, mat);
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
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3, t = 1 - Math.max(0, this.life[i]) / this.max[i];
      const d = Math.pow(this.drag[i], dt * 60);
      this.vel[k] *= d; this.vel[k + 1] = this.vel[k + 1] * d + this.up[i] * dt; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.alpha[i] = this.a0[i] * (1 - t) * Math.min(1, t * 12 + 0.2);
      this.col[k] = this.c0[k] + (this.c1[k] - this.c0[k]) * t;
      this.col[k + 1] = this.c0[k + 1] + (this.c1[k + 1] - this.c0[k + 1]) * t;
      this.col[k + 2] = this.c0[k + 2] + (this.c1[k + 2] - this.c0[k + 2]) * t;
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true;
  }
  clear() { this.life.fill(0); this.pos.forEach((_, i) => { if (i % 3 === 1) this.pos[i] = -999; }); }
}

const FIRE0 = [1, 0.85, 0.35], FIRE1 = [0.9, 0.18, 0.02];
const SMOKE0 = [0.35, 0.35, 0.38], SMOKE1 = [0.1, 0.1, 0.12];

export class FX {
  constructor(scene) {
    const tex = softTex();
    this.smoke = new Particles(450, false, tex);
    this.fire = new Particles(500, true, tex);
    scene.add(this.smoke.points, this.fire.points);
    // debris
    this.dn = 180;
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), this.dn);
    this.debris.frustumCulled = false;
    this.dd = Array.from({ length: this.dn }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, s: 0.3 }));
    this.di = 0;
    this.dm = new THREE.Object3D();
    const col = new THREE.Color(0x000000);
    for (let i = 0; i < this.dn; i++) { this.debris.setColorAt(i, col); this.dm.scale.setScalar(0); this.dm.updateMatrix(); this.debris.setMatrixAt(i, this.dm.matrix); }
    scene.add(this.debris);
    // fireballs + rings
    this.balls = [];
    const bg = new THREE.SphereGeometry(1, 12, 9);
    const rg = new THREE.RingGeometry(0.85, 1, 28).rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      const r = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = r.visible = false; scene.add(m, r);
      this.balls.push({ m, r, t: 1, dur: 1, R: 5 });
    }
    this.bi = 0;
  }
  setScale(s) { this.smoke.uniforms.scale.value = s; this.fire.uniforms.scale.value = s; }
  clear() {
    this.smoke.clear(); this.fire.clear();
    this.dd.forEach((d) => (d.life = 0));
    this.balls.forEach((b) => { b.t = 1; b.m.visible = b.r.visible = false; });
  }
  spark(x, y, z, n, speed = 8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = speed * (0.4 + Math.random());
      this.fire.emit(x, y, z, Math.cos(a) * s, Math.random() * s * 0.8, Math.sin(a) * s, 0.25 + Math.random() * 0.3, 0.5, 0.1, [1, 0.95, 0.6], [1, 0.4, 0.05], 1, 0.94);
    }
  }
  smokePuff(x, y, z, s = 1.5, a = 0.5) {
    this.smoke.emit(x + (Math.random() - 0.5), y, z + (Math.random() - 0.5), (Math.random() - 0.5) * 1.5, 1.5 + Math.random(), (Math.random() - 0.5) * 1.5, 1.4 + Math.random() * 0.8, s * 0.6, s * 2.4, SMOKE0, SMOKE1, a, 0.97, 0.4);
  }
  flame(x, y, z) {
    this.fire.emit(x + (Math.random() - 0.5) * 1.2, y, z + (Math.random() - 0.5) * 1.2, (Math.random() - 0.5), 2 + Math.random() * 2, (Math.random() - 0.5), 0.5 + Math.random() * 0.3, 1.5, 0.3, FIRE0, FIRE1, 0.9, 0.96, 1);
  }
  dust(x, z, n = 4) {
    for (let i = 0; i < n; i++) this.smoke.emit(x, 0.3, z, (Math.random() - 0.5) * 6, 0.5 + Math.random(), (Math.random() - 0.5) * 6, 0.7, 0.8, 2.2, [0.6, 0.6, 0.62], [0.5, 0.5, 0.52], 0.35, 0.9);
  }
  debrisBurst(x, y, z, vx, vz, n, hex, power = 8) {
    for (let k = 0; k < n; k++) {
      const d = this.dd[this.di]; const idx = this.di; this.di = (this.di + 1) % this.dn;
      d.life = 2.5 + Math.random() * 1.5; d.x = x; d.y = y; d.z = z;
      const a = Math.random() * 6.283, s = power * (0.3 + Math.random());
      d.vx = vx * 0.4 + Math.cos(a) * s; d.vz = vz * 0.4 + Math.sin(a) * s; d.vy = 3 + Math.random() * power * 0.7;
      d.rx = d.ry = d.rz = Math.random() * 6; d.wx = (Math.random() - 0.5) * 14; d.wy = (Math.random() - 0.5) * 14; d.wz = (Math.random() - 0.5) * 14;
      d.s = 0.2 + Math.random() * 0.45;
      this.debris.setColorAt(idx, new THREE.Color(Math.random() < 0.3 ? '#222' : hex));
    }
    this.debris.instanceColor.needsUpdate = true;
  }
  explosion(x, z, R) {
    const b = this.balls[this.bi]; this.bi = (this.bi + 1) % this.balls.length;
    b.t = 0; b.dur = 0.7 + R * 0.05; b.R = R; b.x = x; b.z = z; b.m.visible = b.r.visible = true;
    const n = Math.min(40, 14 + R * 2);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = Math.random() * R * 1.4, up = Math.random() * R * 0.9;
      this.fire.emit(x, 0.8 + Math.random() * 1.5, z, Math.cos(a) * s, up, Math.sin(a) * s, 0.6 + Math.random() * 0.7, R * 0.28, R * 0.08, FIRE0, FIRE1, 1, 0.93, 0);
      this.smoke.emit(x, 1, z, Math.cos(a) * s * 0.6, up * 0.7, Math.sin(a) * s * 0.6, 2 + Math.random() * 1.5, R * 0.25, R * 0.7, SMOKE0, SMOKE1, 0.7, 0.95, 1.2);
    }
    this.spark(x, 1, z, 24, R * 1.6);
  }
  update(dt) {
    this.smoke.update(dt); this.fire.update(dt);
    const dm = this.dm;
    for (let i = 0; i < this.dn; i++) {
      const d = this.dd[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      d.vy -= 24 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.y < 0.15) { d.y = 0.15; d.vy *= -0.35; d.vx *= 0.7; d.vz *= 0.7; d.wx *= 0.6; d.wy *= 0.6; d.wz *= 0.6; }
      d.rx += d.wx * dt; d.ry += d.wy * dt; d.rz += d.wz * dt;
      dm.position.set(d.x, d.y, d.z); dm.rotation.set(d.rx, d.ry, d.rz);
      dm.scale.setScalar(d.s * Math.min(1, d.life));
      dm.updateMatrix(); this.debris.setMatrixAt(i, dm.matrix);
      if (d.life <= 0) { dm.scale.setScalar(0); dm.updateMatrix(); this.debris.setMatrixAt(i, dm.matrix); }
    }
    this.debris.instanceMatrix.needsUpdate = true;
    for (const b of this.balls) {
      if (b.t >= 1) continue;
      b.t += dt / b.dur;
      if (b.t >= 1) { b.m.visible = b.r.visible = false; continue; }
      const e = 1 - Math.pow(1 - b.t, 3);
      b.m.position.set(b.x, 1.2 + e * b.R * 0.15, b.z);
      b.m.scale.setScalar(0.4 + e * b.R * 0.55);
      b.m.material.opacity = (1 - b.t) * 0.85;
      b.m.material.color.setRGB(1, 0.75 - b.t * 0.5, 0.2);
      b.r.position.set(b.x, 0.3, b.z);
      b.r.scale.setScalar(0.5 + e * b.R * 1.5);
      b.r.material.opacity = (1 - b.t) * 0.7;
    }
  }
}
