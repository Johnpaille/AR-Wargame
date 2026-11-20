// Pure game-rule maths, Warhammer 40,000 11th edition core rules.
// All positions/radii in real metres on the table plane (x, z). Models: { x, z, r }.
// shortcut: everything is 2D (horizontal); the 5" vertical limits and model/terrain heights are ignored.
export const INCH = 0.0254;
export const BASES_MM = [25, 28.5, 32, 40, 50, 60, 90];
export const RULES = {
  coherency: 2,     // 03.03 within 2" of at least one other model...
  coherencyMax: 9,  // ...and within 9" of every other model
  engagement: 2,    // 03.04 engagement range
  chargeDeclare: 12, // 11.04 charge targets within 12"
  objective: 3,     // 14.01.01 objective marker range
  objectiveMm: 40,  // objective marker diameter
};

export const toIn = (m) => m / INCH;
const EPS = 1e-6;
const within = (d, inches) => d <= inches * INCH + EPS;

// Base-to-base (closest part to closest part) horizontal distance.
export function edgeDist(a, b) {
  return Math.max(0, Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r);
}

// Models breaking coherency (03.03).
export function incoherent(models) {
  if (models.length < 2) return [];
  return models.filter((m) => {
    const others = models.filter((o) => o !== m);
    return !others.some((o) => within(edgeDist(m, o), RULES.coherency)) || others.some((o) => !within(edgeDist(m, o), RULES.coherencyMax));
  });
}

export const engaged = (m, enemies) => enemies.some((e) => within(edgeDist(m, e), RULES.engagement));

// ---------- terrain areas ----------
// Terrain: { poly: [{x,z}x4], type: 'dense' | 'light' | 'exposed' }.
// 13.10: areas containing light or dense features are obscuring.
export const obscuring = (t) => t.type === 'dense' || t.type === 'light';

// Oriented rectangle from 3 taps: a-b is one edge, c gives the depth. Returns 4 corners or null.
export function rectFromTaps(a, b, c) {
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  if (L < 0.01) return null;
  const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, nx = -uz, nz = ux;
  const d = (c.x - a.x) * nx + (c.z - a.z) * nz;
  if (Math.abs(d) < 0.01) return null;
  return [a, b, { x: b.x + nx * d, z: b.z + nz * d }, { x: a.x + nx * d, z: a.z + nz * d }].map(({ x, z }) => ({ x, z }));
}

const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
export function segHit(p, q, a, b) {
  const d1 = cross(a, b, p), d2 = cross(a, b, q), d3 = cross(p, q, a), d4 = cross(p, q, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
export function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function segDist(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
  const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
// A model is within a terrain area if any part of its base is over the footprint.
// shortcut: "any part of the base" reading of "within", check against the rulebook FAQ.
export const inArea = (m, poly) => inPoly(m, poly) || poly.some((a, i) => segDist(m, a, poly[(i + 1) % poly.length]) < (m.r ?? 0));

const crossesPoly = (p, q, poly) => poly.some((a, i) => segHit(p, q, a, poly[(i + 1) % poly.length])) || inPoly(p, poly) || inPoly(q, poly);

// Sample points on a base: centre + 4 rim points. A point target (r=0) is just itself.
const samples = (m) => (m.r ? [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] : [[0, 0]]).map(([i, j]) => ({ x: m.x + i * m.r * 0.95, z: m.z + j * m.r * 0.95 }));

// 13.10 Obscuring: not visible if every line of sight crosses an obscuring area that neither model is within.
// Lines are sampled between 5 points per base, an approximation of "any part of the model".
export function lineOfSight(a, b, terrains) {
  const walls = terrains.filter((t) => obscuring(t) && !inArea(a, t.poly) && !inArea(b, t.poly));
  if (!walls.length) return true;
  const sa = samples(a), sb = samples(b);
  return sa.some((p) => sb.some((q) => !walls.some((t) => crossesPoly(p, q, t.poly))));
}

// 13.08 per model: (INFANTRY/BEASTS/SWARM within a terrain area) or not fully visible due to intervening terrain.
// shortcut: target assumed INFANTRY; "not fully visible" = some sampled line crosses a terrain area the shooter is not in.
export function modelCover(a, b, terrains) {
  const sa = samples(a), sb = samples(b);
  return terrains.some((t) => inArea(b, t.poly) || (!inArea(a, t.poly) && !inArea(b, t.poly) && sa.some((p) => sb.some((q) => crossesPoly(p, q, t.poly)))));
}
// The target unit has the benefit of cover only if every one of its models qualifies.
export const unitCover = (shooter, targets, terrains) => targets.length > 0 && targets.every((m) => modelCover(shooter, m, terrains));

// Target can be shot by at least one model: in range and visible.
export const inRange = (shooters, target, rangeIn, terrains = []) =>
  shooters.some((s) => within(edgeDist(s, target), rangeIn) && lineOfSight(s, target, terrains));

// 11.04: a charge target must be within 12" and the unit must be able to end engaged (roll + 2").
// shortcut: straight-line reach, ignores moving around terrain and other models.
export const chargeReach = (chargers, target, roll) =>
  chargers.some((s) => within(edgeDist(s, target), RULES.chargeDeclare) && within(edgeDist(s, target), roll + RULES.engagement));

// ---------- objectives (14) ----------
// obj: { x, z, r } marker or { poly } terrain objective. sides: [{ side, oc, models }].
export const inObjRange = (m, obj) => (obj.poly ? inArea(m, obj.poly) : within(edgeDist(m, obj), RULES.objective));
export function control(obj, units) {
  const lvl = { 1: 0, 2: 0 };
  for (const u of units) for (const m of u.models) if (inObjRange(m, obj)) lvl[u.side] += Math.max(0, u.oc);
  return { ...lvl, owner: lvl[1] > lvl[2] ? 1 : lvl[2] > lvl[1] ? 2 : 0 };
}

// ---------- table frame (2 reference points) ----------
// Coordinates relative to A, x-axis towards B. Survives a session restart or tracking drift.
function axes(A, B) {
  const L = Math.hypot(B.x - A.x, B.z - A.z);
  return { ux: (B.x - A.x) / L, uz: (B.z - A.z) / L };
}
export function toFrame(p, A, B) {
  const { ux, uz } = axes(A, B), dx = p.x - A.x, dz = p.z - A.z;
  return { u: dx * ux + dz * uz, v: -dx * uz + dz * ux };
}
export function fromFrame(q, A, B) {
  const { ux, uz } = axes(A, B);
  return { x: A.x + q.u * ux - q.v * uz, z: A.z + q.u * uz + q.v * ux };
}

// ---------- dice / calibration ----------
export const d6 = (rand = Math.random) => 1 + Math.floor(rand() * 6);

// A real `realIn` ruler measured as `measured` local metres under current scale k.
// Returns the new world-per-real scale so local units become real metres.
export const newScale = (measured, k, realIn) => (measured * k) / (realIn * INCH);
