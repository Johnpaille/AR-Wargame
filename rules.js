// Pure game-rule maths. All positions/radii in real metres on the table plane (x, z).
export const INCH = 0.0254;
export const BASES_MM = [25, 28.5, 32, 40, 50, 60, 90];

export const toIn = (m) => m / INCH;

// Base-to-base (edge-to-edge) horizontal distance, as 40k measures it.
export function edgeDist(a, b) {
  return Math.max(0, Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r);
}

// 40k 10th ed coherency: each model within 2" of 1 other model, or 2 others if the unit has 7+ models.
// shortcut: ignores the 5" vertical limit (flat table assumed), check values if the edition changes.
export function incoherent(models, rangeIn = 2, bigUnit = 7) {
  if (models.length < 2) return [];
  const need = models.length >= bigUnit ? 2 : 1;
  const max = rangeIn * INCH + 1e-6;
  return models.filter((m) => models.filter((o) => o !== m && edgeDist(m, o) <= max).length < need);
}

// Target can be shot by at least one model: in range and in line of sight.
export const inRange = (shooters, target, rangeIn, terrains = []) =>
  shooters.some((s) => edgeDist(s, target) <= rangeIn * INCH + 1e-6 && lineOfSight(s, target, terrains));

// ---------- terrain & line of sight (2D footprints on the table) ----------

// Oriented rectangle from 3 taps: a-b is one wall edge, c gives the depth. Returns 4 corners or null.
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
const crossesPoly = (p, q, poly) => poly.some((a, i) => segHit(p, q, a, poly[(i + 1) % poly.length])) || inPoly(p, poly) || inPoly(q, poly);

// Sample points on a base: centre + 4 rim points. A point target (r=0) is just itself.
const samples = (m) => (m.r ? [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] : [[0, 0]]).map(([i, j]) => ({ x: m.x + i * m.r * 0.95, z: m.z + j * m.r * 0.95 }));

// 40k-ish visibility: visible if any rim-to-rim line misses every blocking footprint.
// A blocking footprint does not block when the shooter or the target stands inside it (see into / out of ruins).
// shortcut: 2D only, ignores model and terrain heights; upgrade with per-model heights + LiDAR/volumes.
export function lineOfSight(a, b, terrains) {
  const walls = terrains.filter((t) => t.blocks && !inPoly(a, t.poly) && !inPoly(b, t.poly));
  if (!walls.length) return true;
  const sa = samples(a), sb = samples(b);
  return sa.some((p) => sb.some((q) => !walls.some((t) => crossesPoly(p, q, t.poly))));
}

// Benefit of cover: target inside a footprint, or some sight line crosses terrain.
// shortcut: simplified vs the real rule (which depends on terrain type), good enough as a reminder.
export function hasCover(a, b, terrains) {
  const sa = samples(a), sb = samples(b);
  return terrains.some((t) => inPoly(b, t.poly) || (!inPoly(a, t.poly) && sa.some((p) => sb.some((q) => crossesPoly(p, q, t.poly)))));
}

// ---------- dice ----------
export const d6 = (rand = Math.random) => 1 + Math.floor(rand() * 6);

// Calibration: a real `realIn` ruler measured as `measured` local metres under current scale k.
// Returns the new world-per-real scale so local units become real metres.
export const newScale = (measured, k, realIn) => (measured * k) / (realIn * INCH);
