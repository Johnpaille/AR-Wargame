// Run: node rules.test.mjs
import assert from 'node:assert/strict';
import {
  INCH, edgeDist, incoherent, engaged, inRange, chargeReach, newScale, toIn, rectFromTaps, segHit, inPoly, inArea, whollyIn,
  lineOfSight, modelCover, unitCover, control, toFrame, fromFrame, d6,
} from './rules.js';
import { vOk, elevIn, moveDist, plunging, inObjRange, trueLosAreas } from './rules.js';

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

// ---------- keywords, hidden, gone to ground (13.08, 13.09, 13.11.01) ----------
// a vehicle within an area but fully visible gets no cover; infantry does
const openArea = { poly: rectFromTaps(P(0.25, -0.05), P(0.35, -0.05), P(0.3, 0.05)), type: 'light' };
assert.ok(modelCover(shooter, M(0.3), [openArea], true));
assert.ok(unitCover(shooter, [M(0.3)], [openArea], true));
// a model inside the area's footprint is partly behind it, so even non-infantry get cover from it
assert.ok(modelCover(shooter, M(0.3), [openArea], false));
assert.ok(!modelCover(shooter, M(0.3, 0.3), [openArea], false));

const {
  hidden, goneToGround, canSee, halfStrength, leadershipPass, endPhaseOwner, RULES,
} = await import('./rules.js');
assert.ok(hidden(M(0.3), [openArea], true, false));
assert.ok(!hidden(M(0.3), [openArea], true, true));     // shot this/previous turn
assert.ok(!hidden(M(0.3), [openArea], false, false));   // not infantry
assert.ok(!hidden(M(0.3), [{ ...openArea, type: 'exposed' }], true, false));
assert.ok(!hidden(M(0.6), [openArea], true, false));    // not within the area

// target hidden in a light area 20" away: visible line, but beyond 15" detection
const lightHere = { poly: rectFromTaps(P(-0.05, -0.05), P(0.05, -0.05), P(0, 0.05)), type: 'light' };
const hid = M(0);
const far20 = M(-(20 * INCH + 2 * r)), near14 = M(-(14 * INCH + 2 * r)), near12 = M(-(11.9 * INCH + 2 * r));
assert.ok(canSee(far20, hid, [lightHere], false));
assert.ok(!canSee(far20, hid, [lightHere], true));
assert.ok(canSee(near14, hid, [lightHere], true));
// same in a dense area: gone to ground, detection 12"
const denseHere = { ...lightHere, type: 'dense' };
assert.ok(goneToGround(near14, hid, [denseHere]));
assert.ok(!canSee(near14, hid, [denseHere], true));
assert.ok(canSee(near12, hid, [denseHere], true));
assert.equal(RULES.detection - RULES.goneToGround, 12);

// ---------- morale ----------
assert.ok(halfStrength(10, 5) && !halfStrength(10, 6) && !halfStrength(1, 0));
// single-model unit: by wounds (vehicle W11 with 5 left is below half, 6 left is not)
assert.ok(halfStrength(1, 1, 5, 11) && !halfStrength(1, 1, 6, 11) && !halfStrength(1, 1, 1, 1));
assert.ok(leadershipPass(7, 7) && !leadershipPass(6, 7));
// battle-shocked units have OC '-'
assert.equal(control(obj, [{ side: 1, oc: 2, shocked: true, models: [at3(1)] }, J(2, 1, [at3(1)])]).owner, 2);

// ---------- secured objectives (14.03) ----------
assert.deepEqual(endPhaseOwner(1, true, { 1: 0, 2: 0, owner: 0 }), { owner: 1, secured: true });   // left, still held
assert.deepEqual(endPhaseOwner(1, true, { 1: 2, 2: 2, owner: 0 }), { owner: 1, secured: true });   // tie keeps it
assert.deepEqual(endPhaseOwner(1, true, { 1: 1, 2: 3, owner: 2 }), { owner: 2, secured: false });  // opponent greater
assert.deepEqual(endPhaseOwner(1, false, { 1: 0, 2: 0, owner: 0 }), { owner: 0, secured: false }); // not secured

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

// ---------- true line of sight (13.10 exclusion) ----------
assert.equal(trueLosAreas(shooter, tgt, [dense]).length, 0, 'footprint between, neither model in it: the app decides (blocked)');
assert.equal(trueLosAreas(shooter, M(0.05), [dense]).length, 1, 'target within the area: real line of sight decides');
assert.equal(trueLosAreas(M(-0.05), tgt, [dense]).length, 1, 'shooter within the area');
assert.equal(trueLosAreas(shooter, M(0.05), [exposed]).length, 0, 'exposed areas never obscure');

// ---------- heights ----------
const H = (x, yIn, z = 0) => ({ x, z, r, y: yIn * INCH });
assert.ok(engaged(H(0, 0), [H(gap(1), 4.9)]), 'engaged: 1" apart, 4.9" above');
assert.ok(!engaged(H(0, 0), [H(gap(1), 5.5)]), 'not engaged: 5.5" above (03.04)');
assert.ok(engaged(M(0), [M(gap(1))]), 'no heights: 2D as before');
assert.deepEqual(incoherent([H(0, 0), H(gap(1), 6)]).length, 2, 'coherency needs 5" vertically (03.03)');
assert.ok(vOk(M(0), H(0, 9)), 'unknown height counts as level');
assert.ok(close(elevIn(H(0, 3), 0), 3));
assert.ok(close(moveDist(H(0, 0), H(4 * INCH, 3)), 7 * INCH), 'climb 3" + 4" across = 7"');
assert.ok(close(moveDist(H(0, 0), H(4 * INCH, 3), true), 4 * INCH), 'FLY ignores vertical (21.03)');
assert.ok(plunging(H(0, 3), [H(0.3, 0)]), 'on 3" terrain vs ground level: +1 BS');
assert.ok(!plunging(H(0, 3), [H(0.3, 3)]), 'target not on ground level');
assert.ok(!plunging(H(0, 1), [H(0.3, 0)]), 'attacker too low');
assert.ok(!plunging(H(0, 4), [H(0.3, 0)], 0, { aircraft: true }), 'AIRCRAFT: never (23.03)');
assert.ok(plunging(H(0, 0), [H(gap(10), 0)], 0, { towering: true }), 'TOWERING within 12"');
assert.ok(!plunging(H(0, 0), [H(gap(13), 0)], 0, { towering: true }));
const mk = { x: 0, z: 0, r: 0.02, y: 0 };
assert.ok(inObjRange(H(gap(2), 4), mk) && !inObjRange(H(gap(2), 6), mk), 'objective: 5" vertically (14.01.01)');

// deployment zones: wholly within the union of rectangles
const zA = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 }], zB = zA.map((p) => ({ x: p.x + 1, z: p.z }));
assert.ok(whollyIn({ x: 0.5, z: 0.5, r: 0.1 }, [zA]));
assert.ok(!whollyIn({ x: 0.95, z: 0.5, r: 0.1 }, [zA]), 'base pokes out');
assert.ok(whollyIn({ x: 1, z: 0.5, r: 0.1 }, [zA, zB]), 'straddles 2 rectangles of the same zone');
assert.ok(!whollyIn({ x: 0.5, z: 0.5, r: 0.1 }, []));

// any outline: a dense triangle blocks the line through it, not the one passing beside its sloped side
const tri = { poly: [P(-0.1, -0.1), P(0.1, -0.1), P(-0.1, 0.1)], type: 'dense' };
assert.ok(!lineOfSight({ x: -0.05, z: -0.5, r: 0.01 }, { x: -0.05, z: 0.5, r: 0.01 }, [tri]));
assert.ok(lineOfSight({ x: 0.4, z: -0.32, r: 0.01 }, { x: -0.32, z: 0.4, r: 0.01 }, [tri]), 'line in the empty half of the bounding box sees through');
assert.ok(inArea({ x: -0.09, z: 0.05, r: 0 }, tri.poly) && !inArea({ x: 0.09, z: 0.05, r: 0 }, tri.poly), 'inside / outside the sloped side');

console.log('rules ok');
