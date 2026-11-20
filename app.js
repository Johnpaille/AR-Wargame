import * as THREE from 'three';
import {
  INCH, BASES_MM, RULES, edgeDist, incoherent, engaged, inRange, chargeReach, newScale, toIn, rectFromTaps,
  inArea, lineOfSight, modelCover, unitCover, control, toFrame, fromFrame, d6,
} from './rules.js';

const $ = (id) => document.getElementById(id);
const COLORS = [0x3fa9f5, 0xf5a623, 0xbd10e0, 0x50e3c2, 0xf8e71c, 0xff6f91, 0x9b9b9b, 0x7ed321];
const RED = 0xff3b30, GREEN = 0x34c759, YELLOW = 0xffcc00, WHITE = 0xffffff, ORANGE = 0xff9500, GOLD = 0xd4af37;
const SIDE_CSS = { 0: '#ccc', 1: '#3fa9f5', 2: '#ff6f91' };
const fmt = (m) => toIn(m).toFixed(1) + '"';
const status = (t) => ($('status').textContent = t);
const store = {
  get: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, v) => { try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, v); } catch {} },
};

// ---------- three.js / WebXR setup ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();

// Table frame: anchored at the first tap, scaled so that local units = real metres (calibration).
const root = new THREE.Group();
root.matrixAutoUpdate = false;
scene.add(root);
let k = Number(store.get('scale')) || 1;
let rootPose = null, anchor = null;
const tmp = new THREE.Matrix4();
function setRoot(pose) {
  rootPose = pose;
  root.matrix.copy(pose).multiply(tmp.makeScale(k, k, k));
  root.matrixWorldNeedsUpdate = true;
  root.updateMatrixWorld(true);
}

const reticle = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: WHITE }));
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);
const hitPose = new THREE.Matrix4();

const notes = new THREE.Group(); // measure lines + labels
const refMarks = new THREE.Group(); // reference points
root.add(notes, refMarks);

// Aura discs: stencil makes overlapping discs of one unit draw as a single union, no alpha stacking.
const auraMat = (color, ref, opacity) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, depthWrite: false,
  stencilWrite: true, stencilRef: ref, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
});
const moveMat = auraMat(GREEN, 1, 0.25);
const rangeMat = auraMat(WHITE, 2, 0.12);
const terrainMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
const TERRAIN = {
  dense: { mat: terrainMat(0x8b5a2b, 0.35), label: 'dense' },
  light: { mat: terrainMat(0xc8a165, 0.25), label: 'léger' },
  exposed: { mat: terrainMat(0x9b9b9b, 0.15), label: 'exposé' },
};
const edgeMat = new THREE.LineBasicMaterial({ color: WHITE });
const objEdgeMat = new THREE.LineBasicMaterial({ color: GOLD });
const SHARED = new Set([moveMat, rangeMat, edgeMat, objEdgeMat, ...Object.values(TERRAIN).map((t) => t.mat)]);
const ringGeo = (r0, r1) => new THREE.RingGeometry(r0, r1, 48).rotateX(-Math.PI / 2);
const boltGeo = new THREE.SphereGeometry(0.005, 8, 8);
const boltMat = new THREE.MeshBasicMaterial({ color: YELLOW });

// ---------- state ----------
const units = [];
const terrains = []; // { poly, type, h, objective, mesh, tag }
const objectives = []; // markers: { x, y, z, r, mesh, tag }
let sel = null, mode = 'place', pending = null, refs = null;
const fx = [];

// Move allowance after an Advance (M + D6) or a Charge (2D6) roll.
const allowedMove = (u) => (u.roll?.kind === 'advance' ? u.move + u.roll.n : u.roll?.kind === 'charge' ? u.roll.n : u.move);
const uname = (u) => `J${u.side} ${u.name}`;
const enemiesOf = (side) => units.filter((u) => u.side !== side).flatMap((u) => u.models);

function disposeTree(o) {
  o.traverse((c) => { c.geometry?.dispose(); if (c.material && !SHARED.has(c.material)) { c.material.map?.dispose(); c.material.dispose(); } });
  o.clear();
}
function removeObj(o) {
  o.parent?.remove(o);
  disposeTree(o);
}

function label(text, pos, color = '#fff') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,.65)';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = color;
  g.font = 'bold 64px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(0.12, 0.03, 1);
  s.position.copy(pos);
  s.renderOrder = 10;
  return s;
}

// ---------- units ----------
function makeUnit(props) {
  const u = { roll: null, models: [], group: new THREE.Group(), aura: new THREE.Group(), ...props };
  u.group.add(u.aura);
  root.add(u.group);
  units.push(u);
  return u;
}
function newUnit() {
  const u = makeUnit({ name: `Unité ${units.length + 1}`, side: Number($('side').value), color: COLORS[units.length % COLORS.length], move: 6, range: 24, oc: 2 });
  selectUnit(u);
  return u;
}
function selectUnit(u) {
  if (sel && sel !== u) sel.roll = null; // a roll lasts while you work on that unit
  sel = u;
  $('side').value = u.side;
  $('move').value = u.move;
  $('range').value = u.range;
  $('oc').value = u.oc;
  refresh();
}
function addModel(u, p, r = Number($('base').value) / 2000) {
  const mesh = new THREE.Mesh(ringGeo(r - 0.002, r), new THREE.MeshBasicMaterial({ color: u.color }));
  const halo = new THREE.Mesh(ringGeo(r + 0.003, r + 0.006), new THREE.MeshBasicMaterial({ color: WHITE }));
  halo.visible = false;
  mesh.add(halo);
  mesh.position.set(p.x, p.y + 0.001, p.z);
  u.group.add(mesh);
  u.models.push({ x: p.x, y: p.y, z: p.z, r, mesh, halo, u });
}

// ---------- terrain & objectives ----------
function addTerrain(poly, y, type, hIn, objective = false) {
  const [a, b, , d] = poly;
  const h = Math.max(hIn, 0.5) * INCH;
  const geo = new THREE.BoxGeometry(Math.hypot(b.x - a.x, b.z - a.z), h, Math.hypot(d.x - a.x, d.z - a.z));
  const mesh = new THREE.Mesh(geo, TERRAIN[type].mat);
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), objective ? objEdgeMat : edgeMat));
  const cx = poly.reduce((s, c) => s + c.x, 0) / 4, cz = poly.reduce((s, c) => s + c.z, 0) / 4;
  mesh.position.set(cx, y + h / 2, cz);
  mesh.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
  mesh.renderOrder = 3;
  root.add(mesh);
  terrains.push({ poly: poly.map(({ x, z }) => ({ x, z })), y, type, h: hIn, objective, mesh, tag: null, top: new THREE.Vector3(cx, y + h + 0.03, cz) });
}
function setTerrainObjective(t, on) {
  t.objective = on;
  t.mesh.children[0].material = on ? objEdgeMat : edgeMat;
}
function addObjective(p) {
  const r = RULES.objectiveMm / 2000;
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: GOLD }));
  mesh.add(new THREE.Mesh(ringGeo(r + RULES.objective * INCH - 0.002, r + RULES.objective * INCH), new THREE.MeshBasicMaterial({ color: GOLD })));
  mesh.position.set(p.x, p.y + 0.001, p.z);
  root.add(mesh);
  objectives.push({ x: p.x, y: p.y, z: p.z, r, mesh, tag: null, top: new THREE.Vector3(p.x, p.y + 0.04, p.z) });
}
// Control label above each objective (14.02), rebuilt only when the text changes.
function updateObjectiveTag(o) {
  const c = control(o, units);
  const text = c[1] + c[2] === 0 ? 'Objectif' : `J1 ${c[1]} – J2 ${c[2]}`;
  const key = text + c.owner;
  if (o.tagKey === key) return;
  if (o.tag) removeObj(o.tag);
  o.tag = label(text, o.top, SIDE_CSS[c.owner]);
  o.tagKey = key;
  root.add(o.tag);
}

// ---------- refresh: colours, auras, halos, objective control, autosave ----------
function refresh() {
  for (const u of units) {
    const bad = new Set(incoherent(u.models)), foes = enemiesOf(u.side);
    for (const m of u.models) {
      m.mesh.material.color.setHex(bad.has(m) ? RED : engaged(m, foes) ? ORANGE : u.color);
      // Rightful-Ruler style halo on enemy models: shootable (range + visible), or reachable by the charge roll.
      const enemy = !!sel && u.side !== sel.side;
      m.halo.visible = enemy && (sel.roll?.kind === 'charge' ? chargeReach(sel.models, m, sel.roll.n) : inRange(sel.models, m, sel.range, terrains));
    }
    disposeTree(u.aura);
  }
  if (sel) {
    rangeMat.color.setHex(sel.color);
    const mv = allowedMove(sel);
    for (const m of sel.models) {
      for (const [R, mat, order] of [[m.r + mv * INCH, moveMat, 1], [m.r + sel.range * INCH, rangeMat, 2]]) {
        const d = new THREE.Mesh(new THREE.CircleGeometry(R, 64).rotateX(-Math.PI / 2), mat);
        d.position.set(m.x, m.y + 0.0005, m.z);
        d.renderOrder = order;
        sel.aura.add(d);
      }
    }
    const nBad = incoherent(sel.models).length;
    const roll = sel.roll ? ` – ${sel.roll.kind === 'advance' ? 'avance' : 'charge'} ${allowedMove(sel)}"` : '';
    $('unitName').textContent = `${uname(sel)} (${sel.models.length})${roll}${nBad ? ' – cohésion !' : ''}`;
  } else $('unitName').textContent = '–';
  for (const o of [...objectives, ...terrains.filter((t) => t.objective)]) updateObjectiveTag(o);
  autosave();
}

function pick(p) {
  let best = null, bd = 0.005; // 5mm tolerance outside the base
  for (const u of units) for (const m of u.models) {
    const d = Math.hypot(m.x - p.x, m.z - p.z) - m.r;
    if (d < bd) { best = m; bd = d; }
  }
  return best;
}
const target = (p) => pick(p) ?? { x: p.x, y: p.y, z: p.z, r: 0 };

// Edge-to-edge bar between two points/models, with a distance label.
function line(a, b, color, text) {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
  const s = new THREE.Vector3(a.x + ux * a.r, a.y + 0.003, a.z + uz * a.r);
  const e = new THREE.Vector3(b.x - ux * b.r, b.y + 0.003, b.z - uz * b.r);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(Math.max(s.distanceTo(e), 0.001), 0.001, 0.003), new THREE.MeshBasicMaterial({ color }));
  bar.position.lerpVectors(s, e, 0.5);
  bar.rotation.y = -Math.atan2(e.z - s.z, e.x - s.x);
  notes.add(bar, label(text, bar.position.clone().setY(bar.position.y + 0.04)));
}
function dot(p, group = notes, color = WHITE) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 8), new THREE.MeshBasicMaterial({ color }));
  m.position.set(p.x, p.y + 0.003, p.z);
  group.add(m);
}

function fire(a, b) {
  const A = new THREE.Vector3(a.x, a.y + 0.02, a.z), B = new THREE.Vector3(b.x, b.y + 0.02, b.z);
  const now = performance.now();
  for (let i = 0; i < 3; i++) fx.push({ t0: now + i * 120, A, B, mesh: null });
}
function animate() {
  const now = performance.now();
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i], t = (now - f.t0) / 250;
    if (t < 0) continue;
    if (!f.mesh) root.add((f.mesh = new THREE.Mesh(boltGeo, boltMat)));
    if (t < 1) f.mesh.position.lerpVectors(f.A, f.B, t);
    else if (t < 1.5) f.mesh.position.copy(f.B), f.mesh.scale.setScalar(1 + (t - 1) * 8); // impact flash
    else root.remove(f.mesh), fx.splice(i, 1);
  }
}

// ---------- save / restore in the reference frame ----------
function snapshot() {
  const f = (p) => toFrame(p, refs.A, refs.B);
  return {
    d: Math.hypot(refs.B.x - refs.A.x, refs.B.z - refs.A.z),
    units: units.map((u) => ({ name: u.name, side: u.side, color: u.color, move: u.move, range: u.range, oc: u.oc, models: u.models.map((m) => ({ ...f(m), r: m.r })) })),
    terrains: terrains.map((t) => ({ poly: t.poly.map(f), type: t.type, h: t.h, objective: t.objective })),
    objectives: objectives.map(f),
  };
}
function clearAll() {
  for (const u of units) removeObj(u.group);
  for (const t of terrains) { if (t.tag) removeObj(t.tag); removeObj(t.mesh); }
  for (const o of objectives) { if (o.tag) removeObj(o.tag); removeObj(o.mesh); }
  units.length = terrains.length = objectives.length = 0;
  sel = null;
  pending = null;
  disposeTree(notes);
}
function restore(s) {
  clearAll();
  const g = (q) => ({ ...fromFrame(q, refs.A, refs.B), y: refs.A.y });
  for (const su of s.units) {
    const { models, ...props } = su;
    const u = makeUnit(props);
    for (const m of models) addModel(u, g(m), m.r);
  }
  for (const t of s.terrains) addTerrain(t.poly.map(g), refs.A.y, t.type, t.h, t.objective);
  for (const o of s.objectives) addObjective(g(o));
  refresh();
}
function autosave() {
  if (refs) store.set('game', JSON.stringify(snapshot()));
}
function drawRefs() {
  disposeTree(refMarks);
  for (const p of [refs.A, refs.B]) {
    dot(p, refMarks, GOLD);
    const ring = new THREE.Mesh(ringGeo(0.008, 0.011), new THREE.MeshBasicMaterial({ color: GOLD }));
    ring.position.set(p.x, p.y + 0.002, p.z);
    refMarks.add(ring);
  }
}

// ---------- tap handlers (p = reticle hit in table-local real metres) ----------
const handlers = {
  place(p) {
    const m = pick(p);
    if (m) return selectUnit(m.u), status(`${uname(m.u)} sélectionnée`);
    addModel(sel ?? newUnit(), p);
    refresh();
    status(`${uname(sel)} : ${sel.models.length} figurine(s)`);
  },
  measure(p) {
    const pt = target(p);
    if (!pending) return disposeTree(notes), dot(pt), (pending = pt), status('Mesure : vise le 2e point');
    const d = edgeDist(pending, pt);
    line(pending, pt, WHITE, fmt(d));
    pending = null;
    status(`Distance socle à socle : ${fmt(d)}`);
  },
  move(p) {
    if (!pending) {
      const m = pick(p);
      if (!m) return status('Vise une figurine à déplacer');
      pending = m;
      selectUnit(m.u);
      return status(`Vise la nouvelle position (max ${allowedMove(m.u)}")`);
    }
    const m = pending, max = allowedMove(m.u);
    pending = null;
    disposeTree(notes);
    const d = Math.hypot(p.x - m.x, p.z - m.z), over = toIn(d) > max + 1e-6;
    line({ ...m, r: 0 }, { ...p, r: 0 }, over ? RED : GREEN, fmt(d));
    Object.assign(m, { x: p.x, y: p.y, z: p.z });
    m.mesh.position.set(p.x, p.y + 0.001, p.z);
    refresh();
    const eng = engaged(m, enemiesOf(m.u.side)) && m.u.roll?.kind !== 'charge' ? ` – engagée (moins de ${RULES.engagement}")` : '';
    status((over ? `TROP LOIN : ${fmt(d)} > ${max}"` : `Déplacé de ${fmt(d)}`) + eng);
  },
  shoot(p) {
    if (!pending) {
      const m = pick(p);
      if (!m) return status('Vise un tireur');
      pending = m;
      selectUnit(m.u);
      return status(`Vise la cible (portée ${m.u.range}")`);
    }
    const a = pending, b = target(p), d = edgeDist(a, b);
    const inR = toIn(d) <= a.u.range + 1e-6, vis = lineOfSight(a, b, terrains);
    const cover = vis && (b.u ? unitCover(a, b.u.models, terrains) : modelCover(a, b, terrains));
    pending = null;
    disposeTree(notes);
    line(a, b, inR && vis ? YELLOW : RED, fmt(d) + (vis ? (cover ? ' couvert' : '') : ' pas de LdV'));
    if (inR && vis) fire(a, b);
    status(!vis ? `Pas de ligne de vue (${fmt(d)})`
      : !inR ? `Hors de portée : ${fmt(d)} > ${a.u.range}"`
      : `Tir à ${fmt(d)}${cover ? ' – unité à couvert : CT -1' : ''}`);
  },
  terrain(p) {
    if (!pending) disposeTree(notes);
    pending = [...(pending ?? []), p];
    dot(p);
    if (pending.length === 1) return status('Décor : vise le 2e coin du même côté');
    if (pending.length === 2) return status('Décor : vise le côté opposé (profondeur)');
    const [a, b, c] = pending, poly = rectFromTaps(a, b, c), type = $('tType').value;
    pending = null;
    disposeTree(notes);
    if (!poly) return status('Décor trop petit, recommence');
    addTerrain(poly, a.y, type, Number($('tH').value) || 0);
    refresh();
    status(`Décor ${terrains.length} (${TERRAIN[type].label}) ajouté`);
  },
  // Tap inside a terrain area: toggle it as a terrain objective (14.01). Tap an objective marker: remove it. Else: place a marker.
  objective(p) {
    const o = objectives.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < q.r + 0.005);
    if (o) {
      objectives.splice(objectives.indexOf(o), 1);
      if (o.tag) removeObj(o.tag);
      removeObj(o.mesh);
      refresh();
      return status('Objectif retiré');
    }
    const t = terrains.find((q) => inArea({ ...p, r: 0 }, q.poly));
    if (t) {
      setTerrainObjective(t, !t.objective);
      if (!t.objective && t.tag) removeObj(t.tag), (t.tag = null), (t.tagKey = null);
      refresh();
      return status(t.objective ? 'Décor = objectif (on le tient depuis l\'intérieur de la zone)' : 'Ce décor n\'est plus un objectif');
    }
    addObjective(p);
    refresh();
    status(`Objectif ${objectives.length} posé (portée ${RULES.objective}")`);
  },
  refs(p) {
    if (!pending) return disposeTree(notes), dot(p), (pending = p), status('Repère 2 : vise le 2e point de référence');
    const A = pending, B = p, dist = Math.hypot(B.x - A.x, B.z - A.z);
    pending = null;
    disposeTree(notes);
    if (dist < 0.05) return status('Repères trop proches (5 cm minimum)');
    const before = refs ? snapshot() : null;
    const saved = !before && !units.length && !terrains.length && !objectives.length ? JSON.parse(store.get('game') || 'null') : null;
    refs = { A, B };
    drawRefs();
    const s = before ?? saved;
    if (!s) return autosave(), status('Repères posés. La partie est sauvegardée en continu.');
    restore(s);
    const gapTxt = `écart entre repères ${fmt(Math.abs(dist - s.d))}`;
    status(before ? `Recalé (${gapTxt})` : `Partie restaurée : ${units.length} unité(s) (${gapTxt})`);
  },
  calib(p) {
    if (!pending) return disposeTree(notes), dot(p), (pending = p), status('Calibration : vise l\'autre bout de la règle');
    const d = Math.hypot(p.x - pending.x, p.z - pending.z), real = Number($('calibLen').value);
    pending = null;
    if (!(d > 0.01 && real > 0)) return status('Calibration annulée : points trop proches');
    k = newScale(d, k, real);
    store.set('scale', k);
    disposeTree(notes);
    setRoot(rootPose);
    status(`Calibré (facteur ${k.toFixed(3)}). Recale avec les Repères si des figurines étaient déjà posées.`);
  },
};

const HINTS = {
  place: 'Poser : vise un socle et tape. Taper une figurine existante sélectionne son unité.',
  measure: 'Mesurer : vise 2 points ou figurines (socle à socle).',
  move: 'Déplacer : vise la figurine, puis sa nouvelle position.',
  shoot: 'Tirer : vise le tireur, puis la cible.',
  terrain: 'Décor : vise 2 coins d\'un côté, puis le côté opposé.',
  objective: 'Objectif : tape pour poser un pion, dans un décor pour en faire un objectif, sur un pion pour le retirer.',
  refs: 'Repères : vise 2 points fixes de la table (ex. 2 coins). Refais-le pour recaler ou reprendre une partie.',
  calib: 'Calibrer : vise les 2 bouts d\'une règle de longueur connue.',
};

function onSelect(e) {
  if (!reticle.visible) return status('Pas de surface détectée : bouge un peu le téléphone au-dessus de la table.');
  const ref = renderer.xr.getReferenceSpace();
  if (!rootPose) {
    setRoot(hitPose.clone());
    const pos = new THREE.Vector3(), q = new THREE.Quaternion();
    hitPose.decompose(pos, q, new THREE.Vector3());
    e.frame.createAnchor?.(new XRRigidTransform(pos, q), ref)?.then((a) => (anchor = a)).catch(() => {});
  }
  handlers[mode](root.worldToLocal(new THREE.Vector3().setFromMatrixPosition(hitPose)));
}

// ---------- UI ----------
for (const mm of BASES_MM) $('base').add(new Option(`${mm} mm`, mm, mm === 32, mm === 32));
$('newUnit').onclick = () => (newUnit(), status(`${uname(sel)} créée : pose ses figurines`));
const unitInput = (id, key) => ($(id).onchange = () => sel && ((sel[key] = Number($(id).value) || 0), refresh()));
unitInput('side', 'side');
unitInput('move', 'move');
unitInput('range', 'range');
unitInput('oc', 'oc');
$('advance').onclick = () => {
  if (!sel) return status('Sélectionne une unité d\'abord');
  const n = d6();
  sel.roll = { kind: 'advance', n };
  refresh();
  status(`Avance : M ${sel.move}" + ${n} = ${sel.move + n}" (pas de charge ce tour)`);
};
$('charge').onclick = () => {
  if (!sel) return status('Sélectionne une unité d\'abord');
  const [x, y] = [d6(), d6()];
  sel.roll = { kind: 'charge', n: x + y };
  refresh();
  const reach = enemiesOf(sel.side).filter((m) => m.halo.visible).length;
  status(`Charge : ${x} + ${y} = ${x + y}" – ${reach} figurine(s) ennemie(s) atteignable(s) (cibles à ${RULES.chargeDeclare}" max)`);
};
// "Retirer" removes the last decor in Décor mode, else the last model of the selected unit.
$('undo').onclick = () => {
  if (mode === 'terrain') {
    const t = terrains.pop();
    if (t) { if (t.tag) removeObj(t.tag); removeObj(t.mesh); refresh(); }
    return;
  }
  const m = sel?.models.pop();
  if (m) removeObj(m.mesh), refresh();
};
$('clear').onclick = () => (disposeTree(notes), (pending = null));
for (const b of document.querySelectorAll('#modes button')) {
  b.onclick = () => {
    mode = b.dataset.mode;
    pending = null;
    for (const o of document.querySelectorAll('#modes button')) o.classList.toggle('on', o === b);
    $('calibLabel').hidden = mode !== 'calib';
    $('terrainOpts').hidden = mode !== 'terrain';
    $('undo').textContent = mode === 'terrain' ? 'Retirer décor' : 'Retirer fig.';
    status(HINTS[mode]);
  };
}
// Taps on the controls must not also count as AR taps.
$('ui').addEventListener('beforexrselect', (e) => e.target.closest('#panel, #status') && e.preventDefault());

const savedGame = store.get('game');
$('saved').hidden = !savedGame;
$('forget').onclick = () => { store.set('game', null); $('saved').hidden = true; };

// Desktop testing without AR: open index.html#debug, then call dbg.tap(mode, x, z) from the console (metres).
if (location.hash === '#debug') window.dbg = { handlers, units, terrains, objectives, store, tap: (m, x, z) => handlers[m]({ x, y: 0, z }), setMode: (m) => document.querySelector(`[data-mode=${m}]`).click() };

// ---------- session ----------
let hitSource = null;
(async () => {
  const ok = navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar').catch(() => false));
  $('support').textContent = ok ? 'ARCore prêt.' : 'AR indisponible : il faut Chrome Android + ARCore, page servie en https ou localhost.';
  $('enter').disabled = !ok;
})();

$('enter').onclick = async () => {
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'anchors'],
      domOverlay: { root: $('ui') },
    });
  } catch (err) {
    return ($('support').textContent = `Échec du démarrage AR : ${err.message}`);
  }
  await renderer.xr.setSession(session);
  const viewer = await session.requestReferenceSpace('viewer');
  hitSource = await session.requestHitTestSource({ space: viewer });
  session.addEventListener('select', onSelect);
  session.addEventListener('end', () => {
    // the next session has a new world origin: positions only survive through the saved reference frame
    hitSource = null; anchor = null; rootPose = null; refs = null;
    clearAll();
    disposeTree(refMarks);
    $('saved').hidden = !store.get('game');
    $('ui').hidden = true; $('start').hidden = false;
  });
  $('start').hidden = true;
  $('ui').hidden = false;
  status(store.get('game') ? 'Partie sauvegardée : va en mode Repères et vise les 2 mêmes points pour la reprendre.' : 'Conseil : Calibrer, puis Repères, puis Poser.');
};

renderer.setAnimationLoop((t, frame) => {
  if (frame) {
    const ref = renderer.xr.getReferenceSpace();
    if (anchor) {
      const ap = frame.getPose(anchor.anchorSpace, ref);
      if (ap) setRoot(new THREE.Matrix4().fromArray(ap.transform.matrix));
    }
    const hits = hitSource ? frame.getHitTestResults(hitSource) : [];
    reticle.visible = hits.length > 0;
    if (reticle.visible) {
      hitPose.fromArray(hits[0].getPose(ref).transform.matrix);
      // in place mode the reticle previews the chosen base size
      const s = mode === 'place' ? (Number($('base').value) / 2000) * k : 0.01;
      reticle.matrix.copy(hitPose).multiply(tmp.makeScale(s, s, s));
    }
  }
  animate();
  renderer.render(scene, camera);
});
