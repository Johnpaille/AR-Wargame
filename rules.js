// Pure game-rule maths, Warhammer 40,000 11th edition core rules.
// All positions/radii in real metres. Models: { x, z, r, y? }; y = height of the base measured by AR (table = groundY).
// Ranges are horizontal; the vertical limits (5") apply only when both models have a y.
// shortcut: no model heights (a sight line runs base to base) and no Solid gaps: Obscuring areas block sight at any height.
export const INCH = 0.0254;
export const BASES_MM = [25, 28.5, 32, 40, 50, 60, 90];
export const RULES = {
  coherency: 2,     // 03.03 within 2" of at least one other model...
  coherencyMax: 9,  // ...and within 9" of every other model
  engagement: 2,    // 03.04 engagement range
  chargeDeclare: 12, // 11.04 charge targets within 12"
  objective: 3,     // 14.01.01 objective marker range
  objectiveMm: 40,  // objective marker diameter
  detection: 15,    // 13.09 hidden models: detection range
  goneToGround: 3,  // 13.11.01 detection range reduction
  vertical: 5,      // 03.03 / 03.04 / 14.01.01: "... horizontally and 5" vertically"
  plunging: 3,      // 22.05 attacker on a terrain section 3" or more in height
  towering: 12,     // 22.05 TOWERING attacker: target within 12"
  ground: 1,        // shortcut: "ground level" = base less than 1" above the table (AR height noise ~0.4")
};
export const PHASES = ['Commandement', 'Mouvement', 'Tir', 'Charge', 'Combat'];

export const toIn = (m) => m / INCH;
const EPS = 1e-6;
const within = (d, inches) => d <= inches * INCH + EPS;

// Base-to-base (closest part to closest part) horizontal distance.
export function edgeDist(a, b) {
  return Math.max(0, Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r);
}

// Vertical gap within 5" (unknown heights count as level).
export const vOk = (a, b) => a.y == null || b.y == null || within(Math.abs(a.y - b.y), RULES.vertical);
const near = (a, b, inches) => within(edgeDist(a, b), inches) && vOk(a, b);
// Height of a model's base above the table, in inches.
export const elevIn = (m, groundY = 0) => toIn((m.y ?? groundY) - groundY);

// Models breaking coherency (03.03): within 2" (and 5" vertically) of one model, within 9" (and 5" vertically) of all.
export function incoherent(models) {
  if (models.length < 2) return [];
  return models.filter((m) => {
    const others = models.filter((o) => o !== m);
    return !others.some((o) => near(m, o, RULES.coherency)) || others.some((o) => !near(m, o, RULES.coherencyMax));
  });
}

// 03.04: engagement range is 2" horizontally and 5" vertically.
export const engaged = (m, enemies) => enemies.some((e) => near(m, e, RULES.engagement));

// Distance moved (13.06): straight line horizontally, plus the vertical distance climbed or dropped.
// 21.03: FLY ignores vertical distance.
export const moveDist = (from, to, fly = false) =>
  Math.hypot(to.x - from.x, to.z - from.z) + (fly || from.y == null || to.y == null ? 0 : Math.abs(to.y - from.y));

// 22.05 Plunging Fire: +1 BS against a unit with models on ground level, if the attacker stands on terrain 3"+ high
// (or is TOWERING and the target is within 12"). 23.03: never for AIRCRAFT.
// shortcut: "on terrain 3"+ high" = base measured 2.5"+ above the table (AR noise), not the feature's own height.
export function plunging(a, targets, groundY = 0, { towering = false, aircraft = false } = {}) {
  if (aircraft || !targets.some((t) => elevIn(t, groundY) < RULES.ground)) return false;
  return elevIn(a, groundY) >= RULES.plunging - 0.5 || (towering && targets.some((t) => within(edgeDist(a, t), RULES.towering)));
}

// ---------- terrain areas ----------
// Terrain: { poly: [{x,z}, ...] any outline (triangle, L...), type: 'dense' | 'light' | 'exposed' }.
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

// Deployment: the base is wholly within the union of a player's zone rectangles (an L-shaped zone is 2 rectangles).
// shortcut: centre + 8 rim points, a base poking out by under ~4% of its radius between two samples passes.
export const whollyIn = (m, polys) => [[0, 0], ...[...Array(8)].map((_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)])]
  .every(([i, j]) => polys.some((poly) => inPoly({ x: m.x + i * m.r, z: m.z + j * m.r }, poly)));

const crossesPoly = (p, q, poly) => poly.some((a, i) => segHit(p, q, a, poly[(i + 1) % poly.length])) || inPoly(p, poly) || inPoly(q, poly);

// Sample points on a base: centre + 4 rim points. A point target (r=0) is just itself.
const samples = (m) => (m.r ? [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] : [[0, 0]]).map(([i, j]) => ({ x: m.x + i * m.r * 0.95, z: m.z + j * m.r * 0.95 }));

// 13.10 Obscuring: not visible if every line of sight crosses an obscuring area that neither model is within.
// Lines are sampled between 5 points per base, an approximation of "any part of the model".
// 13.10 excludes the obscuring areas either model is within. Through those, visibility is true line of sight (06.01:
// any part to any part, over or around the real feature, Solid gaps under 3" blocked), which a footprint can't tell.
// Returns those areas: empty means the footprints alone decide.
export const trueLosAreas = (a, b, terrains) => terrains.filter((t) => obscuring(t) && (inArea(a, t.poly) || inArea(b, t.poly)));

// 13.10: not visible if every sight line crosses an obscuring area neither model is within.
export function lineOfSight(a, b, terrains) {
  const walls = terrains.filter((t) => obscuring(t) && !inArea(a, t.poly) && !inArea(b, t.poly));
  if (!walls.length) return true;
  const sa = samples(a), sb = samples(b);
  return sa.some((p) => sb.some((q) => !walls.some((t) => crossesPoly(p, q, t.poly))));
}

// Some sampled sight line from a to b crosses terrain t that the shooter is not in ("not fully visible due to intervening terrain").
// shortcut: footprint stands in for the feature, so a model inside a ruin counts as partly hidden by its walls.
const partlyBlocked = (a, b, t) => !inArea(a, t.poly) && samples(a).some((p) => samples(b).some((q) => crossesPoly(p, q, t.poly)));

// 13.08 per model: (INFANTRY/BEASTS/SWARM within a terrain area) or not fully visible due to intervening terrain.
export function modelCover(a, b, terrains, infantry = true) {
  return terrains.some((t) => (infantry && inArea(b, t.poly)) || partlyBlocked(a, b, t));
}
// The target unit has the benefit of cover only if every one of its models qualifies.
export const unitCover = (shooter, targets, terrains, infantry = true) =>
  targets.length > 0 && targets.every((m) => modelCover(shooter, m, terrains, infantry));

// 13.09 Hidden: INFANTRY/BEASTS/SWARM within a light/dense area, unit made no ranged attack this turn or the previous one.
export const hidden = (m, terrains, infantry, shotRecently) =>
  infantry && !shotRecently && terrains.some((t) => obscuring(t) && inArea(m, t.poly));

// 13.11.01 Gone to ground: hidden and not fully visible due to intervening dense terrain -> detection range -3".
export const goneToGround = (attacker, m, terrains) =>
  terrains.some((t) => t.type === 'dense' && partlyBlocked(attacker, m, t));

// Visibility of b to a: line of sight (13.10), and if b is hidden, a must be within b's detection range (13.09).
export function canSee(a, b, terrains, bHidden = false) {
  if (!lineOfSight(a, b, terrains)) return false;
  if (!bHidden) return true;
  const det = RULES.detection - (goneToGround(a, b, terrains) ? RULES.goneToGround : 0);
  return within(edgeDist(a, b), det);
}

// Target can be shot by at least one model: in range and visible.
export const inRange = (shooters, target, rangeIn, terrains = [], targetHidden = false) =>
  shooters.some((s) => within(edgeDist(s, target), rangeIn) && canSee(s, target, terrains, targetHidden));

// ---------- morale (01.06, 01.07, 08.03) ----------
// 01.02.01: multi-model units count models; a single-model unit counts its remaining wounds against its W.
export const halfStrength = (start, now, wounds = 0, w = 1) => (start > 1 ? now * 2 <= start : now === 1 && w > 1 && wounds * 2 <= w);
export const leadershipPass = (roll2d6, ld) => roll2d6 >= ld;

// 11.04: a charge target must be within 12" and the unit must be able to end engaged (roll + 2").
// shortcut: straight-line reach, ignores moving around terrain and other models.
export const chargeReach = (chargers, target, roll) =>
  chargers.some((s) => within(edgeDist(s, target), RULES.chargeDeclare) && within(edgeDist(s, target), roll + RULES.engagement));

// ---------- objectives (14) ----------
// obj: { x, z, r } marker or { poly } terrain objective. sides: [{ side, oc, models }].
// 14.01.01: within 3" horizontally and 5" vertically of a marker.
export const inObjRange = (m, obj) => (obj.poly ? inArea(m, obj.poly) : near(m, obj, RULES.objective));
// Level of control (14.02). Battle-shocked units have OC '-' (01.07).
export function control(obj, units) {
  const lvl = { 1: 0, 2: 0 };
  for (const u of units) for (const m of u.models) if (!u.shocked && inObjRange(m, obj)) lvl[u.side] += Math.max(0, u.oc);
  return { ...lvl, owner: lvl[1] > lvl[2] ? 1 : lvl[2] > lvl[1] ? 2 : 0 };
}
// Controller at the end of a phase/turn. A secured objective (14.03) stays with its owner until the opponent's level is greater.
export function endPhaseOwner(prev, secured, lvl) {
  if (secured && prev) {
    const opp = prev === 1 ? 2 : 1;
    if (!(lvl[opp] > lvl[prev])) return { owner: prev, secured: true };
  }
  return { owner: lvl.owner, secured: false };
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
