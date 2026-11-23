// Chapter Approved 2026-27 deployment cards (Strike Force, 44" x 60"), read off the Wahapedia card images.
// Map frame in inches: x along the 44" top edge (0 = top-left corner, always in the attacker's zone), y down the 60" side.
// Every card is symmetric by a 180° turn: the defender's zone and objectives are the attacker's, rotated.
// Objectives: each side's home objective, the no man's land objective on its side, plus the centre.
export const TABLE = { w: 44, h: 60 };

// Search and Destroy: quarter minus a 9" circle around the centre, arc as 8 segments
const arc = [...Array(9)].map((_, i) => { const t = (i / 8) * (Math.PI / 2); return [22 - 9 * Math.sin(t), 30 - 9 * Math.cos(t)]; });

export const DEPLOYMENTS = {
  'tipping-point': { name: 'Tipping Point', att: [[[0, 0], [44, 0], [44, 12], [22, 12], [22, 20], [0, 20]]], obj: [[11, 14], [38, 24]] },
  'hammer-and-anvil': { name: 'Hammer and Anvil', att: [[[0, 0], [44, 0], [44, 18], [0, 18]]], obj: [[10, 14], [36, 24]] },
  'search-and-destroy': { name: 'Search and Destroy', att: [[[0, 0], [22, 0], ...arc, [0, 30]]], obj: [[10, 14], [34, 14]] },
  'dawn-of-war': { name: 'Dawn of War', att: [[[0, 0], [12, 0], [12, 60], [0, 60]]], obj: [[10, 30], [25, 10]] },
  'sweeping-engagement': { name: 'Sweeping Engagement', att: [[[0, 0], [14, 0], [14, 30], [8, 30], [8, 60], [0, 60]]], obj: [[10, 14], [30, 10]] },
  'crucible-of-battle': { name: 'Crucible of Battle', att: [[[0, 0], [44, 0], [0, 30]]], obj: [[10, 12], [34, 15]] },
};

const turn = ([x, y]) => [TABLE.w - x, TABLE.h - y];

// -> { att: [poly], def: [poly], objectives: [[x, y]] } in map inches
export function layout(key) {
  const d = DEPLOYMENTS[key];
  if (!d) return null;
  return { att: d.att, def: d.att.map((p) => p.map(turn)), objectives: [...d.obj, ...d.obj.map(turn), [22, 30]] };
}

// BattleBase deployment id ("deployment-chapter-approved-2026-27-tipping-point") or name -> key
export const deploymentKey = (s = '') => Object.keys(DEPLOYMENTS).find((k) => s.toLowerCase().replace(/ /g, '-').endsWith(k)) ?? null;
