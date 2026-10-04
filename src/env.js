import * as THREE from 'three';

// Procedural environment map (sky gradient + warm sun + street) for glossy car paint.
export function makeEnv(renderer) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const g = cv.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#3f78c8'); sky.addColorStop(0.42, '#a9cdf2'); sky.addColorStop(0.5, '#e9f1fa'); sky.addColorStop(0.52, '#6c6a70'); sky.addColorStop(1, '#2b2b30');
  g.fillStyle = sky; g.fillRect(0, 0, 512, 256);
  const sun = g.createRadialGradient(150, 70, 0, 150, 70, 70);
  sun.addColorStop(0, 'rgba(255,244,214,1)'); sun.addColorStop(0.25, 'rgba(255,228,170,.8)'); sun.addColorStop(1, 'rgba(255,220,160,0)');
  g.fillStyle = sun; g.fillRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(255,255,255,.55)';
  for (let i = 0; i < 9; i++) g.fillRect(i * 58 + 8, 120 + (i % 3) * 6, 38, 14); // building highlights band
  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromEquirectangular(tex).texture;
  tex.dispose(); pm.dispose();
  return env;
}
