export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export function wpick(obj) {
  let t = 0;
  for (const k in obj) t += obj[k];
  let r = Math.random() * t;
  for (const k in obj) {
    r -= obj[k];
    if (r <= 0) return k;
  }
  return Object.keys(obj)[0];
}
export const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');
