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

export const inRange = (shooters, target, rangeIn) =>
  shooters.some((s) => edgeDist(s, target) <= rangeIn * INCH + 1e-6);

// Calibration: a real `realIn` ruler measured as `measured` local metres under current scale k.
// Returns the new world-per-real scale so local units become real metres.
export const newScale = (measured, k, realIn) => (measured * k) / (realIn * INCH);
