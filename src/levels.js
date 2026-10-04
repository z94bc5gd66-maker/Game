export const LANE_W = 3.6;
const H = (c, lanes = 2) => ({ o: 'h', c, lanes });
const V = (c, lanes = 2) => ({ o: 'v', c, lanes });

export const LEVELS = [
  {
    name: 'DOWNTOWN CROSS', sub: 'Einsteiger-Kreuzung', ext: 72,
    roads: [H(0), V(0)], goals: [20000, 45000, 80000],
    density: 20, speed: [11, 15], cycle: [5.5, 1.3, 1.2],
    mix: { sedan: 5, hatch: 4, taxi: 2, van: 1, sports: 1, police: 1 },
    view: 70, startCell: 'sw',
  },
  {
    name: 'TWIN JUNCTION', sub: 'Zwei Ampeln, doppelter Spaß', ext: 80,
    roads: [H(0), V(-26), V(26)], goals: [40000, 85000, 145000],
    density: 19, speed: [12, 16], cycle: [5, 1.3, 1.2],
    mix: { sedan: 4, hatch: 3, taxi: 2, van: 2, sports: 2, police: 1, truck: 1 },
    view: 86, startCell: 'sw',
  },
  {
    name: 'HIGHWAY RUSH', sub: 'Schnell, breit, tödlich', ext: 88,
    roads: [H(0, 3), V(0, 1)], goals: [25000, 50000, 85000],
    density: 17, speed: [18, 24], cycle: [8, 1.3, 1.2],
    mix: { sedan: 4, sports: 3, van: 2, truck: 2, bus: 1, taxi: 1, hatch: 2 },
    view: 80, startCell: 'sw',
  },
  {
    name: 'TANKER TOWN', sub: 'Benzin. Viel Benzin.', ext: 80,
    roads: [H(0), V(-22, 1), V(22, 1)], goals: [45000, 100000, 170000],
    density: 18, speed: [10, 14], cycle: [5, 1.3, 1.2],
    mix: { tanker: 5, bus: 2, truck: 2, sedan: 3, van: 2, police: 1 },
    view: 84, startCell: 'sw',
  },
  {
    name: 'CITY GRID', sub: 'Vier Kreuzungen', ext: 84,
    roads: [H(-24, 1), H(24, 1), V(-24, 1), V(24, 1)], goals: [35000, 70000, 120000],
    density: 18, speed: [11, 15], cycle: [4.5, 1.3, 1.2],
    mix: { sedan: 4, hatch: 3, taxi: 3, van: 2, bus: 1, tanker: 2, sports: 1, police: 1, truck: 1 },
    view: 96, startCell: 'sw',
  },
  {
    name: 'MEGA GRID', sub: 'Neun Kreuzungen. Chaos.', ext: 92,
    roads: [H(-32, 1), H(0, 1), H(32, 1), V(-32, 1), V(0, 1), V(32, 1)], goals: [45000, 95000, 170000],
    density: 17, speed: [11, 15], cycle: [4, 1.2, 1.1],
    mix: { sedan: 4, hatch: 3, taxi: 3, van: 2, bus: 2, tanker: 3, sports: 2, police: 1, truck: 1 },
    view: 108, startCell: 'sw',
  },
];
