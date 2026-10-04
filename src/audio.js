// Tiny WebAudio synth – no asset files needed.
let ctx = null, master = null, noiseBuf = null, muted = false, lastHit = 0;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { ctx = null; }
}
export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.8; }
export function isMuted() { return muted; }

function noise(dur, type, f0, f1, gain, q = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t); s.stop(t + dur + 0.05);
}
function tone(type, f0, f1, dur, gain, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  hit(v) {
    if (!ctx) return;
    const now = performance.now();
    if (now - lastHit < 45) return;
    lastHit = now;
    const k = Math.min(1, v / 22);
    noise(0.12 + k * 0.25, 'bandpass', 1800 + Math.random() * 1500, 300, 0.25 + k * 0.5, 0.8);
    tone('sine', 120 + k * 40, 40, 0.18 + k * 0.2, 0.35 + k * 0.4);
    if (k > 0.35) tone('square', 700 + Math.random() * 400, 120, 0.1, 0.05);
  },
  boom(big = 1) {
    noise(0.9 + big * 0.5, 'lowpass', 2500, 80, 0.9);
    tone('sine', 90, 25, 0.9 + big * 0.4, 0.9);
    noise(0.25, 'highpass', 4000, 1500, 0.2);
  },
  coin() { tone('square', 988, 988, 0.07, 0.12); tone('square', 1319, 1319, 0.18, 0.12, 0.07); },
  click() { tone('square', 520, 380, 0.07, 0.1); },
  tick() { tone('square', 900, 900, 0.03, 0.06); },
  launch() { noise(0.7, 'bandpass', 300, 3000, 0.4, 2); tone('sawtooth', 80, 380, 0.7, 0.18); },
  rev(p) { tone('sawtooth', 70 + p * 220, 70 + p * 220, 0.07, 0.07); },
  tally() { tone('triangle', 660, 880, 0.15, 0.15); tone('triangle', 880, 1320, 0.25, 0.15, 0.12); },
  fanfare() { [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, 0.22, 0.12, i * 0.12)); },
  fail() { tone('sawtooth', 300, 90, 0.6, 0.15); },
  land(v) { noise(0.15, 'lowpass', 900, 150, Math.min(0.5, v / 30)); },
  siren() { tone('sine', 700, 900, 0.25, 0.05); },
};
