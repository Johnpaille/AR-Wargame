// Run: node rules.test.mjs
import assert from 'node:assert/strict';
import { INCH, edgeDist, incoherent, inRange, newScale, toIn } from './rules.js';

const r = 0.016; // 32mm base
const at = (xIn) => ({ x: xIn * INCH, z: 0, r });

// 2" edge gap between two 32mm bases
const a = at(0), b = { x: 2 * INCH + 2 * r, z: 0, r };
assert.ok(Math.abs(toIn(edgeDist(a, b)) - 2) < 1e-9);
assert.equal(edgeDist(a, { ...a }), 0); // overlapping clamps to 0

// coherency: 2.0" ok, 2.1" broken
assert.deepEqual(incoherent([a, b]), []);
assert.deepEqual(incoherent([a]), []);
const far = { x: 2.1 * INCH + 2 * r, z: 0, r };
assert.equal(incoherent([a, far]).length, 2);

// 7-model line: end models only have 1 neighbour, need 2
const step = 1.5 * INCH + 2 * r;
const line = Array.from({ length: 7 }, (_, i) => ({ x: i * step, z: 0, r }));
assert.deepEqual(incoherent(line), [line[0], line[6]]);
assert.deepEqual(incoherent(line.slice(0, 6)), []);

// range is edge-to-edge
const t = { x: 24 * INCH + 2 * r, z: 0, r };
assert.ok(inRange([a], t, 24));
assert.ok(!inRange([a], t, 23.9));

// calibration: ruler of 6" read as 0.15m local with k=1 -> scale 0.15/0.1524
const k = newScale(0.15, 1, 6);
assert.ok(Math.abs(0.15 / k - 6 * INCH) < 1e-12);

// ---------- terrain / LoS ----------
const { rectFromTaps, segHit, inPoly, lineOfSight, hasCover, d6 } = await import('./rules.js');
const P = (x, z) => ({ x, z });

// rect: wall from (0,0) to (0.2,0), depth tap at z=-0.1 -> corners on the negative side
const rect = rectFromTaps(P(0, 0), P(0.2, 0), P(0.05, -0.1));
assert.deepEqual(rect.map((c) => [+c.x.toFixed(6), +c.z.toFixed(6)]), [[0, 0], [0.2, 0], [0.2, -0.1], [0, -0.1]]);
assert.equal(rectFromTaps(P(0, 0), P(0.005, 0), P(0, 1)), null);
assert.equal(rectFromTaps(P(0, 0), P(0.2, 0), P(0.1, 0.001)), null);

assert.ok(segHit(P(-1, 0), P(1, 0), P(0, -1), P(0, 1)));
assert.ok(!segHit(P(-1, 0), P(1, 0), P(2, -1), P(2, 1)));
assert.ok(inPoly(P(0.1, -0.05), rect));
assert.ok(!inPoly(P(0.1, 0.05), rect));

// ruin 20x10cm centred on x=0; shooter left, target right
const ruin = { poly: rectFromTaps(P(-0.1, -0.05), P(0.1, -0.05), P(0, 0.05)), blocks: true };
const shooter = { x: -0.3, z: 0, r }, tgt = { x: 0.3, z: 0, r };
assert.ok(!lineOfSight(shooter, tgt, [ruin]));                // fully behind
assert.ok(lineOfSight(shooter, tgt, [{ ...ruin, blocks: false }])); // non-blocking terrain
assert.ok(lineOfSight(shooter, { x: 0.3, z: 0.3, r }, [ruin]));   // clear diagonal
assert.ok(lineOfSight(shooter, { x: 0.05, z: 0, r }, [ruin]));     // target inside ruin: see into
// target peeking: rim pokes past the ruin edge -> visible
assert.ok(lineOfSight({ x: -0.3, z: 0.06, r }, { x: 0.3, z: 0.06, r }, [ruin]));

const { inRange: canShoot } = await import('./rules.js');
assert.ok(!canShoot([shooter], tgt, 48, [ruin]));
assert.ok(canShoot([shooter, { x: -0.3, z: 0.3, r }], { x: 0.3, z: 0.3, r }, 48, [ruin]));

assert.ok(hasCover(shooter, { x: 0.05, z: 0, r }, [ruin]));        // in terrain
assert.ok(hasCover({ x: -0.3, z: 0.06, r }, { x: 0.3, z: 0.06, r }, [ruin])); // partly obscured
assert.ok(!hasCover(shooter, { x: 0.3, z: 0.3, r }, [ruin]));

assert.equal(d6(() => 0), 1);
assert.equal(d6(() => 0.9999), 6);

console.log('rules ok');
