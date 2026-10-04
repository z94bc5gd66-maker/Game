import * as THREE from 'three';
import { carGeometry, TYPES, TRAFFIC_COLORS, setCarEnv, makeCarMaterial } from './models.js';
import { makeEnv } from './env.js';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(1400, 900); renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xb8c4d4);
const env = makeEnv(renderer); setCarEnv(env);
scene.add(new THREE.HemisphereLight(0xdcebff, 0x707078, 1.0));
const sun = new THREE.DirectionalLight(0xfff0d0, 2.4); sun.position.set(-30, 50, 30); scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x555a62 })); scene.add(ground);
const close = window.location.hash.includes('close');
const names = close ? ['muscle', 'sedan', 'police', 'psport', 'hatch', 'van'] : Object.keys(TYPES);
const cols = close ? 3 : 4;
names.forEach((n, i) => {
  const { geo } = carGeometry(n, i === 8 ? '#fff' : TRAFFIC_COLORS[(i * 3) % TRAFFIC_COLORS.length]);
  const m = new THREE.Mesh(geo, makeCarMaterial(env));
  m.position.set((i % cols) * (close ? 7.5 : 14) - (close ? 7.5 : 21), 0, Math.floor(i / cols) * (close ? 6.5 : 11) - (close ? 3 : 11));
  m.rotation.y = -0.6;
  if (window.location.hash.includes('dmg')) m.material.userData.dmg.value = 0.8;
  scene.add(m);
});
const cam = new THREE.PerspectiveCamera(32, 1400 / 900, 1, 500);
if (close) { cam.position.set(-6, 9, 17); cam.lookAt(0, 0.6, 0); } else { cam.position.set(-6, 38, 48); cam.lookAt(0, 0, 0); }
renderer.render(scene, cam);
window.__done = true;
