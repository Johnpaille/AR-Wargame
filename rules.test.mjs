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

console.log('rules ok');
