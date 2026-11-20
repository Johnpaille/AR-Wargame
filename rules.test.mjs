// Run: node rules.test.mjs
import assert from 'node:assert/strict';
import {
  INCH, edgeDist, incoherent, engaged, inRange, chargeReach, newScale, toIn, rectFromTaps, segHit, inPoly, inArea,
  lineOfSight, modelCover, unitCover, control, toFrame, fromFrame, d6,
} from './rules.js';

const r = 0.016; // 32mm base
const gap = (inches) => inches * INCH + 2 * r; // centre distance giving an edge gap of `inches`
const M = (x, z = 0) => ({ x, z, r });
const P = (x, z) => ({ x, z });
const close = (a, b) => Math.abs(a - b) < 1e-9;

// ---------- distances ----------
assert.ok(close(toIn(edgeDist(M(0), M(gap(2)))), 2));
assert.equal(edgeDist(M(0), M(0)), 0); // overlapping clamps to 0

// ---------- coherency (11th: 2" to one model, 9" to all) ----------
assert.deepEqual(incoherent([M(0)]), []);
assert.deepEqual(incoherent([M(0), M(gap(2))]), []);
assert.equal(incoherent([M(0), M(gap(2.1))]).length, 2);
const line = (n, g) => Array.from({ length: n }, (_, i) => M(i * gap(g)));
// no more "2 neighbours at 7+ models": a 3-model line is fine
assert.deepEqual(incoherent(line(3, 1.5)), []);
// 9" rule: 4 models at 2" gaps -> ends 6" + 2 bases (~8.5") apart, ok
assert.deepEqual(incoherent(line(4, 2)), []);
// 5 models at 2" gaps -> ends 8" + 3 bases (~11.8") apart, both ends break it
const five = line(5, 2);
assert.deepEqual(incoherent(five), [five[0], five[4]]);

// ---------- engagement (2") ----------
assert.ok(engaged(M(0), [M(gap(2))]));
assert.ok(!engaged(M(0), [M(gap(2.05))]));

// ---------- terrain ----------
const rect = rectFromTaps(P(0, 0), P(0.2, 0), P(0.05, -0.1));
assert.deepEqual(rect.map((c) => [+c.x.toFixed(6), +c.z.toFixed(6)]), [[0, 0], [0.2, 0], [0.2, -0.1], [0, -0.1]]);
assert.equal(rectFromTaps(P(0, 0), P(0.005, 0), P(0, 1)), null);
assert.equal(rectFromTaps(P(0, 0), P(0.2, 0), P(0.1, 0.001)), null);
assert.ok(segHit(P(-1, 0), P(1, 0), P(0, -1), P(0, 1)));
assert.ok(!segHit(P(-1, 0), P(1, 0), P(2, -1), P(2, 1)));
assert.ok(inPoly(P(0.1, -0.05), rect));
assert.ok(!inPoly(P(0.1, 0.05), rect));
// base overlapping the edge counts as within the area
assert.ok(inArea(M(0.1, 0.01), rect));
assert.ok(!inArea(M(0.1, 0.02), rect));

// ruin 20x10cm centred on origin
const area = (type) => ({ poly: rectFromTaps(P(-0.1, -0.05), P(0.1, -0.05), P(0, 0.05)), type });
const dense = area('dense'), light = area('light'), exposed = area('exposed');
const shooter = M(-0.3), tgt = M(0.3);
assert.ok(!lineOfSight(shooter, tgt, [dense]));
assert.ok(!lineOfSight(shooter, tgt, [light]));          // light areas are obscuring too
assert.ok(lineOfSight(shooter, tgt, [exposed]));          // exposed never blocks
assert.ok(lineOfSight(shooter, M(0.3, 0.3), [dense]));   // clear diagonal
assert.ok(lineOfSight(shooter, M(0.05), [dense]));       // target within the area
assert.ok(lineOfSight(M(-0.05), tgt, [dense]));          // shooter within the area
assert.ok(lineOfSight(M(-0.3, 0.06), M(0.3, 0.06), [dense])); // rim peeks past the edge

// ---------- cover (every model of the target unit must qualify) ----------
assert.ok(modelCover(shooter, M(0.05), [exposed]));       // within any terrain area
assert.ok(modelCover(M(-0.3, 0.06), M(0.3, 0.06), [dense])); // partly obscured
assert.ok(!modelCover(shooter, M(0.3, 0.3), [dense]));
assert.ok(unitCover(shooter, [M(0.05), M(0.05, 0.03)], [dense]));
assert.ok(!unitCover(shooter, [M(0.05), M(0.3, 0.3)], [dense]));

// ---------- shooting / charging ----------
assert.ok(inRange([M(0)], M(gap(24)), 24));
assert.ok(!inRange([M(0)], M(gap(24)), 23.9));
assert.ok(!inRange([shooter], tgt, 48, [dense]));
assert.ok(inRange([shooter, M(-0.3, 0.3)], M(0.3, 0.3), 48, [dense]));
assert.ok(chargeReach([M(0)], M(gap(9)), 7));             // 7" roll + 2" engagement
assert.ok(!chargeReach([M(0)], M(gap(9.1)), 7));
assert.ok(!chargeReach([M(0)], M(gap(12.5)), 12));        // beyond 12" declare range

// ---------- objectives ----------
const obj = { x: 0, z: 0, r: 0.02 };
const J = (side, oc, models) => ({ side, oc, models });
const at3 = (x) => M(x * INCH + 0.02 + r); // edge gap of x" to the marker
assert.deepEqual(control(obj, [J(1, 2, [at3(3)]), J(2, 1, [at3(2)])]), { 1: 2, 2: 1, owner: 1 });
assert.deepEqual(control(obj, [J(1, 2, [at3(3.1)]), J(2, 1, [at3(2)])]), { 1: 0, 2: 1, owner: 2 });
assert.equal(control(obj, [J(1, 1, [at3(1)]), J(2, 1, [at3(1)])]).owner, 0); // tie
assert.equal(control({ poly: dense.poly }, [J(1, 1, [M(0.05)]), J(2, 5, [tgt])]).owner, 1); // terrain objective

// ---------- frame ----------
const A = P(0.1, 0.2), B = P(0.5, -0.1), p = P(0.3, 0.4);
const f = toFrame(p, A, B);
const back = fromFrame(f, A, B);
assert.ok(close(back.x, p.x) && close(back.z, p.z));
// same physical point seen after drift (whole table rotated 30deg + shifted) maps back correctly
const rot = (q, a = Math.PI / 6) => ({ x: Math.cos(a) * q.x - Math.sin(a) * q.z + 1, z: Math.sin(a) * q.x + Math.cos(a) * q.z - 2 });
const moved = fromFrame(f, rot(A), rot(B));
assert.ok(close(moved.x, rot(p).x) && close(moved.z, rot(p).z));

// ---------- dice / calibration ----------
assert.equal(d6(() => 0), 1);
assert.equal(d6(() => 0.9999), 6);
const k = newScale(0.15, 1, 6);
assert.ok(close(0.15 / k, 6 * INCH));

console.log('rules ok');
