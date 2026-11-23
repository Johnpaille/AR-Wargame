// node deployments.test.mjs
import assert from 'node:assert/strict';
import { DEPLOYMENTS, layout, deploymentKey, TABLE } from './deployments.js';
import { inPoly } from './rules.js';

const P = ([x, z]) => ({ x, z }), poly = (p) => p.map(P);
for (const key of Object.keys(DEPLOYMENTS)) {
  const l = layout(key);
  // top-left corner in the attacker's zone, bottom-right in the defender's, centre in neither
  assert.ok(l.att.some((p) => inPoly(P([0.5, 0.5]), poly(p))), `${key}: attacker at top-left`);
  assert.ok(l.def.some((p) => inPoly(P([TABLE.w - 0.5, TABLE.h - 0.5]), poly(p))), `${key}: defender at bottom-right`);
  assert.ok(![...l.att, ...l.def].some((p) => inPoly(P([22, 30.5]), poly(p))), `${key}: centre is no man's land`);
  assert.equal(l.objectives.length, 5);
  for (const [x, y] of l.objectives) assert.ok(x > 0 && x < TABLE.w && y > 0 && y < TABLE.h, `${key}: objective on the table`);
}
// Tipping Point: 20" deep on the attacker's left half, 12" on the right; the defender's mirror
const tp = layout('tipping-point');
assert.ok(inPoly(P([5, 19]), poly(tp.att[0])) && !inPoly(P([30, 19]), poly(tp.att[0])));
assert.ok(inPoly(P([30, 41]), poly(tp.def[0])) && !inPoly(P([5, 41]), poly(tp.def[0])));
assert.deepEqual(tp.objectives, [[11, 14], [38, 24], [33, 46], [6, 36], [22, 30]]);
// Search and Destroy: the 9" circle is cut out of the quarter
const sd = layout('search-and-destroy');
assert.ok(inPoly(P([12, 20]), poly(sd.att[0])) && !inPoly(P([16, 25]), poly(sd.att[0])));

assert.equal(deploymentKey('deployment-chapter-approved-2026-27-tipping-point'), 'tipping-point');
assert.equal(deploymentKey('Crucible Of Battle'), 'crucible-of-battle');
assert.equal(deploymentKey('deployment-king-of-the-colosseum-2025-26'), null);
console.log('deployments ok');
