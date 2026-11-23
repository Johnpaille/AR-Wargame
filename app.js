import * as THREE from 'three';
import {
  INCH, BASES_MM, RULES, edgeDist, incoherent, engaged, inRange, chargeReach, newScale, toIn, rectFromTaps,
  inArea, inPoly, modelCover, unitCover, control, toFrame, fromFrame, d6,
  hidden, canSee, halfStrength, leadershipPass, endPhaseOwner, PHASES, elevIn, moveDist, plunging, trueLosAreas,
} from './rules.js';
import { parseArmyList, linesFromItems, fxKind, has } from './armylist.js';
import { battleId, fetchBattle, battleState, battleText } from './battlebase.js';

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

// Saved games: an index (name, last save, turn, unit count) + per-game keys "<key>:<id>" (state, army lists, BattleBase link).
// Switching game reloads the page, so every per-game value is read once at start.
const GAME_KEYS = ['game', 'armies', 'armiesAt', 'bbLink'];
const games = JSON.parse(store.get('games') || '[]');
let cur = store.get('cur');
if (!games.length) { // first run, or a single save from before multi-games: it becomes "Partie 1"
  const old = JSON.parse(store.get('game') || 'null');
  games.push({ id: 'g1', name: 'Partie 1', at: Date.now(), turn: old?.turn ?? 1, units: old?.units.length ?? 0 });
  for (const key of GAME_KEYS) {
    const v = store.get(key);
    if (v != null) { store.set(`${key}:g1`, v); store.set(key, null); }
  }
}
if (!games.some((g) => g.id === cur)) cur = games[0].id;
const saveGames = () => store.set('games', JSON.stringify(games));
saveGames();
store.set('cur', cur);
const gstore = { get: (key) => store.get(`${key}:${cur}`), set: (key, v) => store.set(`${key}:${cur}`, v) };
const curGame = () => games.find((g) => g.id === cur);

// Multiplayer: open the page with ?room=name on each phone; the game state is relayed by serve.js.
const room = new URLSearchParams(location.search).get('room');
const clientId = Math.random().toString(36).slice(2);
let applyingRemote = false, remoteState = null, sendTimer = 0, lastSync = '';

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
const live = new THREE.Group(); // live distance while aiming the 2nd point
const lassoG = new THREE.Group(); // Grouper: the line drawn by the finger
root.add(notes, refMarks, live, lassoG);

// ---------- depth occlusion (WebXR depth-sensing, CPU path, optional) ----------
// Virtual fragments farther than the real surface ARCore measured are dropped, so rings and auras hide behind real minis and terrain.
const occ = { uDepth: { value: null }, uUvT: { value: new THREE.Matrix4() }, uVp: { value: new THREE.Vector4(0, 0, 1, 1) }, uOn: { value: 0 } };
let depthTex = null, occlusionOn = false, xrSession = null;
function occlude(mat) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, occ);
    sh.vertexShader = 'varying float vOccZ;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vOccZ = -mvPosition.z;');
    sh.fragmentShader = 'uniform sampler2D uDepth; uniform mat4 uUvT; uniform vec4 uVp; uniform float uOn; varying float vOccZ;\n'
      + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (uOn > 0.5) {
    vec2 uv = (gl_FragCoord.xy - uVp.xy) / uVp.zw;
    uv.y = 1.0 - uv.y; // normalized view coords start top-left
    float real = texture2D(uDepth, (uUvT * vec4(uv, 0.0, 1.0)).xy).r;
    if (real > 0.0 && vOccZ > real + 0.02) discard; // 2 cm tolerance so the table itself does not hide the rings
  }`);
  };
  return mat;
}
function updateDepth(frame, ref) {
  occ.uOn.value = 0;
  if (!occlusionOn) return;
  const view = frame.getViewerPose(ref)?.views[0];
  let info = null;
  try { info = view && frame.getDepthInformation(view); } catch { return; }
  if (!info) return;
  const { width: w, height: h } = info;
  const src = xrSession.depthDataFormat === 'float32' ? new Float32Array(info.data) : new Uint16Array(info.data);
  if (!depthTex || depthTex.image.width !== w || depthTex.image.height !== h) {
    depthTex?.dispose();
    depthTex = new THREE.DataTexture(new Float32Array(w * h), w, h, THREE.RedFormat, THREE.FloatType);
    depthTex.minFilter = depthTex.magFilter = THREE.NearestFilter;
    occ.uDepth.value = depthTex;
  }
  const dst = depthTex.image.data, s = info.rawValueToMeters;
  for (let i = 0; i < dst.length; i++) dst[i] = src[i] * s;
  depthTex.needsUpdate = true;
  occ.uUvT.value.fromArray(info.normDepthBufferFromNormView.matrix);
  const vp = xrSession.renderState.baseLayer.getViewport(view);
  occ.uVp.value.set(vp.x, vp.y, vp.width, vp.height);
  occ.uOn.value = 1;
}

// Aura discs: stencil makes overlapping discs of one unit draw as a single union, no alpha stacking.
const auraMat = (color, ref, opacity) => occlude(new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, depthWrite: false,
  stencilWrite: true, stencilRef: ref, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
}));
const moveMat = auraMat(GREEN, 1, 0.25);
const rangeMat = auraMat(WHITE, 2, 0.12);
const terrainMat = (color, opacity) => occlude(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
const basic = (color) => occlude(new THREE.MeshBasicMaterial({ color }));
const TERRAIN = {
  dense: { mat: terrainMat(0x8b5a2b, 0.35), label: 'dense' },
  light: { mat: terrainMat(0xc8a165, 0.25), label: 'léger' },
  exposed: { mat: terrainMat(0x9b9b9b, 0.15), label: 'exposé' },
};
const edgeMat = occlude(new THREE.LineBasicMaterial({ color: WHITE }));
const objEdgeMat = occlude(new THREE.LineBasicMaterial({ color: GOLD }));
const SHARED = new Set([moveMat, rangeMat, edgeMat, objEdgeMat, ...Object.values(TERRAIN).map((t) => t.mat)]);
const ringGeo = (r0, r1) => new THREE.RingGeometry(r0, r1, 48).rotateX(-Math.PI / 2);

// ---------- state ----------
const units = [];
const terrains = []; // { poly, type, h, objective, mesh, tag }
const objectives = []; // markers: { x, y, z, r, mesh, tag }
let sel = null, mode = 'place', pending = null, refs = null;
// Turn = player turn (J1 plays odd turns). `started` flips at the first phase change: before that, removing a model is a setup fix.
let turn = 1, phase = 0, started = false;
const fx = [];

// Move allowance after an Advance (M + D6) or a Charge (2D6) roll.
const allowedMove = (u) => (u.roll?.kind === 'advance' ? u.move + u.roll.n : u.roll?.kind === 'charge' ? u.roll.n : u.move);
const uname = (u) => `J${u.side} ${u.name}`;
const enemiesOf = (side) => units.filter((u) => u.side !== side).flatMap((u) => u.models);
const activeSide = () => (turn % 2 ? 1 : 2);
const infantry = (u) => u.type === 'inf'; // INFANTRY / BEASTS / SWARM
const shotRecently = (u) => u.lastShot >= turn - 1; // ranged attacks this turn or the previous one
const isHidden = (m) => hidden(m, terrains, infantry(m.u), shotRecently(m.u));
const weaponOf = (u) => u.weapons[u.weapon] ?? { name: '–', range: 0 };
const rangeOf = (u) => weaponOf(u).range;
// Per-model profile (army list): m.p indexes m.u.profiles (sergeant, troopers, attached leader...).
const profOf = (m) => m.u.profiles?.[m.p];
const wMax = (m) => profOf(m)?.w ?? m.u.w;
// does this model carry the unit's selected weapon? (no profile: every model does)
const armed = (m) => !profOf(m) || profOf(m).weapons.includes(weaponOf(m.u).name);
const shooters = (u) => u.models.filter(armed);
const loneOp = (u) => has(u.abilities, 'Lone Operative');
const kw = (u, k) => !!u?.keywords?.includes(k);
const groundY = () => refs?.A.y ?? 0; // the table: root origin is the first tap on it
const moved = (u, a, b) => moveDist(a, b, kw(u, 'FLY'));
// next profile still short of its count, else the last one (extra troopers)
function autoProfile(u) {
  if (!u.profiles?.length) return undefined;
  const i = u.profiles.findIndex((pr, j) => u.models.filter((m) => m.p === j).length < pr.count);
  return i < 0 ? u.profiles.length - 1 : i;
}
const half = (u) => halfStrength(u.start, u.models.length, u.models[0]?.wounds, u.models[0] ? wMax(u.models[0]) : u.w);

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
  const u = {
    oc: 2, ld: 7, w: 1, type: 'inf', shocked: false, start: 0, lastShot: -9, weapon: 0, // defaults also cover saves from older versions
    weapons: [{ name: 'Arme 1', range: props.range ?? 24 }],
    roll: null, ...props, models: [], group: new THREE.Group(), aura: new THREE.Group(),
  };
  u.group.add(u.aura);
  root.add(u.group);
  units.push(u);
  return u;
}
function newUnit() {
  const u = makeUnit({
    name: `Unité ${units.length + 1}`, side: Number($('side').value), color: COLORS[units.length % COLORS.length],
    move: 6, type: $('uType').value,
  });
  selectUnit(u);
  return u;
}
function selectUnit(u) {
  if (sel && sel !== u) sel.roll = null; // a roll lasts while you work on that unit
  sel = u;
  $('side').value = u.side;
  $('move').value = u.move;
  $('oc').value = u.oc;
  $('ld').value = u.ld;
  $('w').value = u.w;
  $('uName').value = u.name;
  $('uType').value = u.type;
  renderWeapons();
  renderList();
  refresh();
}
// Weapon quick-switch in the main panel + editable list in the unit sheet.
// Read-only datasheet in the unit sheet, from the army list.
function renderProfile() {
  const u = sel, sv = (p) => `Sv${p.sv}+${p.inv ? ` (${p.inv}++)` : ''}`;
  const wl = (w, melee) => `${w.name} ${melee ? 'mêlée' : w.range + '"'} A${w.a} ${melee ? 'CC' : 'CT'}${w.skill ? w.skill + '+' : ' auto'} F${w.s} PA${w.ap} D${w.d}${w.abilities?.length ? ` [${w.abilities.join(', ')}]` : ''}`;
  $('profileInfo').textContent = !u?.profiles?.length ? '' : [
    ...u.profiles.map((p) => `${p.name} ×${p.count} : M${p.move}" E${p.t} ${sv(p)} PV${p.w} Cd${p.ld}+ OC${p.oc}`),
    ...u.weapons.map((w) => wl(w, false)), ...(u.melee ?? []).map((w) => wl(w, true)),
    [u.abilities?.join(', '), u.damaged && `Endommagé à ${u.damaged} PV ou moins : -1 touche`, u.demise && `Deadly Demise ${u.demise}`].filter(Boolean).join(' · '),
  ].join('\n');
}
function renderWeapons() {
  renderProfile();
  const sw = $('weapon');
  sw.replaceChildren(...(sel?.weapons ?? []).map((wp, i) => new Option(`${wp.name} ${wp.range}"`, i, false, i === sel.weapon)));
  const list = $('weapons');
  list.replaceChildren();
  sel?.weapons.forEach((wp, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    const name = Object.assign(document.createElement('input'), { className: 'name', value: wp.name, ariaLabel: 'Nom de l\'arme' });
    const range = Object.assign(document.createElement('input'), { type: 'number', min: 0, value: wp.range, ariaLabel: 'Portée' });
    const del = Object.assign(document.createElement('button'), { textContent: '✕', ariaLabel: 'Supprimer l\'arme' });
    name.onchange = () => ((wp.name = name.value || wp.name), renderWeapons());
    range.onchange = () => ((wp.range = Number(range.value) || 0), renderWeapons(), refresh());
    del.onclick = () => {
      if (sel.weapons.length < 2) return status('Une unité garde au moins une arme');
      sel.weapons.splice(i, 1);
      sel.weapon = Math.min(sel.weapon, sel.weapons.length - 1);
      renderWeapons();
      refresh();
    };
    row.append(name, range, '"', del);
    list.append(row);
  });
}
function addModel(u, p, r = Number($('base').value) / 2000, wounds, prof = autoProfile(u)) {
  wounds ??= u.profiles?.[prof]?.w ?? u.w;
  const mesh = new THREE.Mesh(ringGeo(r - 0.002, r), basic(u.color));
  const halo = new THREE.Mesh(ringGeo(r + 0.003, r + 0.006), basic(WHITE));
  halo.visible = false;
  mesh.add(halo);
  mesh.position.set(p.x, p.y + 0.001, p.z);
  u.group.add(mesh);
  u.models.push({ x: p.x, y: p.y, z: p.z, r, wounds, p: prof, mesh, halo, tag: null, tagKey: '', u });
  u.start = Math.max(u.start, u.models.length); // starting strength
}

function removeModel(m) {
  m.u.models.splice(m.u.models.indexOf(m), 1);
  removeObj(m.mesh);
}

// ---------- terrain & objectives ----------
function addTerrain(poly, y, type, hIn, objective = false, owner = 0, secured = false) {
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
  terrains.push({ poly: poly.map(({ x, z }) => ({ x, z })), y, type, h: hIn, objective, owner, secured, mesh, tag: null, top: new THREE.Vector3(cx, y + h + 0.03, cz) });
}
function setTerrainObjective(t, on) {
  t.objective = on;
  t.mesh.children[0].material = on ? objEdgeMat : edgeMat;
}
function addObjective(p, owner = 0, secured = false) {
  const r = RULES.objectiveMm / 2000;
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 32).rotateX(-Math.PI / 2), basic(GOLD));
  mesh.add(new THREE.Mesh(ringGeo(r + RULES.objective * INCH - 0.002, r + RULES.objective * INCH), basic(GOLD)));
  mesh.position.set(p.x, p.y + 0.001, p.z);
  root.add(mesh);
  objectives.push({ x: p.x, y: p.y, z: p.z, r, owner, secured, mesh, tag: null, top: new THREE.Vector3(p.x, p.y + 0.04, p.z) });
}
// Label above each objective: live levels of control, coloured by the controller decided at the last phase end (14.02).
function updateObjectiveTag(o) {
  const c = control(o, units);
  const text = `J1 ${c[1]} – J2 ${c[2]}${o.secured ? ' [S]' : ''}`;
  const key = text + o.owner;
  if (o.tagKey === key) return;
  if (o.tag) removeObj(o.tag);
  o.tag = label(text, o.top, SIDE_CSS[o.owner]);
  o.tagKey = key;
  root.add(o.tag);
}

// ---------- refresh: colours, auras, halos, objective control, autosave ----------
function refresh() {
  for (const u of units) {
    const bad = new Set(incoherent(u.models)), foes = enemiesOf(u.side);
    for (const m of u.models) {
      m.mesh.material.color.setHex(bad.has(m) ? RED : engaged(m, foes) ? ORANGE : u.color);
      // hidden models (13.09) are drawn faded
      const hid = isHidden(m);
      m.mesh.material.transparent = hid;
      m.mesh.material.opacity = hid ? 0.4 : 1;
      // Rightful-Ruler style halo on enemy models: shootable (range + visible), or reachable by the charge roll.
      const enemy = !!sel && u.side !== sel.side;
      const tgt = enemy && (sel.roll?.kind === 'charge' ? chargeReach(sel.models, m, sel.roll.n) : canTarget(sel, m, hid));
      m.halo.visible = !!tgt;
      m.halo.material.color.setHex(tgt === 'check' ? ORANGE : WHITE); // orange: real line of sight to check
      // remaining wounds above damaged multi-wound models; Damaged x: -1 to hit at x wounds or fewer
      const dmgd = u.damaged && m.wounds <= u.damaged;
      const up = elevIn(m, groundY()), upTxt = up >= 1 ? ` ↑${up.toFixed(1)}"` : '';
      const key = (m.wounds < wMax(m) || dmgd ? `${m.wounds}/${wMax(m)} PV${dmgd ? ' -1 CT' : ''}` : '') + upTxt;
      if (key !== m.tagKey) {
        if (m.tag) removeObj(m.tag);
        m.tag = key ? label(key, new THREE.Vector3(0, 0.03, 0), '#ff9500') : null;
        if (m.tag) m.mesh.add(m.tag);
        m.tagKey = key;
      }
    }
    disposeTree(u.aura);
  }
  if (sel) {
    rangeMat.color.setHex(sel.color);
    const mv = allowedMove(sel);
    const wp = weaponOf(sel), halfRange = has(wp.abilities, 'RAPID FIRE') || has(wp.abilities, 'MELTA');
    for (const m of sel.models) {
      const discs = [[m.r + mv * INCH, moveMat, 1]];
      if (armed(m)) discs.push([m.r + rangeOf(sel) * INCH, rangeMat, 2]);
      for (const [R, mat, order] of discs) {
        const d = new THREE.Mesh(new THREE.CircleGeometry(R, 64).rotateX(-Math.PI / 2), mat);
        d.position.set(m.x, m.y + 0.0005, m.z);
        d.renderOrder = order;
        sel.aura.add(d);
      }
      // Rapid Fire / Melta bonus range: a ring at half range
      if (halfRange && armed(m)) {
        const R = m.r + (rangeOf(sel) / 2) * INCH, ring = new THREE.Mesh(ringGeo(R - 0.0015, R), new THREE.MeshBasicMaterial({ color: sel.color }));
        ring.position.set(m.x, m.y + 0.0008, m.z);
        sel.aura.add(ring);
      }
    }
    const nBad = incoherent(sel.models).length;
    const roll = sel.roll ? ` – ${sel.roll.kind === 'advance' ? 'avance' : 'charge'} ${allowedMove(sel)}"` : '';
    const flags = [
      roll,
      nBad ? ' – cohésion !' : '',
      half(sel) ? ' – ½' : '',
      sel.shocked ? ' – ébranlée' : '',
      sel.models.length && sel.models.every(isHidden) ? ' – cachée' : '',
    ].join('');
    $('unitName').textContent = `${uname(sel)} (${sel.models.length}/${sel.start})${flags}`;
  } else $('unitName').textContent = '–';
  $('phase').textContent = `T${turn} J${activeSide()} · ${PHASES[phase]} ›`;
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
function line(a, b, color, text, group = notes) {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
  const s = new THREE.Vector3(a.x + ux * a.r, a.y + 0.003, a.z + uz * a.r);
  const e = new THREE.Vector3(b.x - ux * b.r, b.y + 0.003, b.z - uz * b.r);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(Math.max(s.distanceTo(e), 0.001), 0.001, 0.003), new THREE.MeshBasicMaterial({ color }));
  bar.position.lerpVectors(s, e, 0.5);
  bar.rotation.y = -Math.atan2(e.z - s.z, e.x - s.x);
  group.add(bar, label(text, bar.position.clone().setY(bar.position.y + 0.04)));
}
function dot(p, group = notes, color = WHITE) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 8), new THREE.MeshBasicMaterial({ color }));
  m.position.set(p.x, p.y + 0.003, p.z);
  group.add(m);
}

// Effects: each one is a mesh animated by step(mesh, t), t from 0 to 1 over dur ms, then removed.
function spawn(mesh, delay, dur, step) { fx.push({ t0: performance.now() + delay, dur, mesh, step, on: false }); }
const fxMat = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
const ball = (r, color) => new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), fxMat(color));
const fade = (m, t) => (m.material.opacity = 1 - t);
function blast(P, delay, r, color) {
  const m = ball(r, color);
  m.position.copy(P);
  spawn(m, delay, 350, (m, t) => (m.scale.setScalar(1 + t * 3), fade(m, t)));
}
function bullet(A, B, delay, dur, r, color, trail) {
  spawn(ball(r, color), delay, dur, (m, t) => m.position.lerpVectors(A, B, t));
  if (trail) for (let i = 0; i < 10; i++) {
    const puff = ball(r * 1.2, 0x999999);
    puff.position.lerpVectors(A, B, i / 10);
    spawn(puff, delay + (dur * i) / 10, 600, (m, t) => (m.scale.setScalar(1 + t * 2), (m.material.opacity = 0.6 * (1 - t))));
  }
}
// Shot from a to b; the look follows the weapon name, vehicles and monsters fire bigger.
function fire(a, b, kind = 'bolt', big = false) {
  const A = new THREE.Vector3(a.x, a.y + 0.02, a.z), B = new THREE.Vector3(b.x, b.y + 0.02, b.z), s = big ? 2 : 1;
  if (kind === 'laser' || kind === 'melta') {
    const color = kind === 'laser' ? 0xff2020 : 0xff8a00, len = A.distanceTo(B);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.0015 * s, 0.0015 * s, len, 6), fxMat(color));
    beam.position.lerpVectors(A, B, 0.5);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    spawn(beam, 0, 450, (m, t) => { m.scale.x = m.scale.z = 1 + Math.sin(t * 60) * 0.5; fade(m, t); });
    blast(B, 100, 0.006 * s, color);
  } else if (kind === 'plasma') {
    bullet(A, B, 0, 600, 0.007 * s, 0x40a0ff);
    blast(B, 600, 0.012 * s, 0x9fd4ff);
  } else if (kind === 'missile') {
    bullet(A, B, 0, 700, 0.004 * s, 0xffffff, true);
    blast(B, 700, 0.014 * s, ORANGE);
  } else if (kind === 'flame') {
    const side = new THREE.Vector3(B.z - A.z, 0, A.x - B.x).normalize();
    for (let i = 0; i < 24; i++) {
      const spread = (Math.random() - 0.5) * 0.4, f = ball(0.004 * s, i % 3 ? ORANGE : RED);
      spawn(f, Math.random() * 350, 450, (m, t) => {
        m.position.lerpVectors(A, B, t).addScaledVector(side, spread * t * A.distanceTo(B));
        m.scale.setScalar(1 + t * 2);
        fade(m, t);
      });
    }
  } else {
    for (let i = 0; i < 3; i++) {
      bullet(A, B, i * 120, 250, 0.003 * s, YELLOW);
      blast(B, i * 120 + 250, 0.004 * s, YELLOW);
    }
  }
}
// Destroyed model: fireball + debris thrown out.
function explode(m, big) {
  const P = new THREE.Vector3(m.x, m.y + 0.01, m.z), s = big ? 2 : 1;
  blast(P, 0, 0.015 * s, ORANGE);
  blast(P, 120, 0.01 * s, RED);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, v = 0.04 * s * (0.6 + Math.random() * 0.6);
    spawn(ball(0.002 * s, 0x777777), 0, 700, (d, t) => {
      d.position.set(P.x + Math.cos(a) * v * t, P.y + 0.06 * s * t - 0.08 * s * t * t, P.z + Math.sin(a) * v * t);
      fade(d, t);
    });
  }
}
function animate() {
  const now = performance.now();
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i], t = (now - f.t0) / f.dur;
    if (t < 0) continue;
    if (!f.on) root.add(f.mesh), (f.on = true);
    if (t < 1) f.step(f.mesh, t);
    else removeObj(f.mesh), fx.splice(i, 1);
  }
}

// ---------- save / restore in the reference frame ----------
function snapshot() {
  // rounded to 0.1 mm so the same table gives the same JSON on both phones (no float-noise echoes)
  const f = (p) => {
    const { u, v } = toFrame(p, refs.A, refs.B);
    const q = { u: Math.round(u * 1e4) / 1e4, v: Math.round(v * 1e4) / 1e4 };
    if (p.y != null && Math.abs(p.y - refs.A.y) > 0.002) q.h = Math.round((p.y - refs.A.y) * 1e4) / 1e4; // height above the table
    return q;
  };
  return {
    d: Math.hypot(refs.B.x - refs.A.x, refs.B.z - refs.A.z),
    turn, phase, started,
    units: units.map(({ name, side, color, move, oc, ld, w, type, shocked, start, lastShot, weapons, weapon, roll, list, size, models,
      profiles, melee, abilities, keywords, damaged, demise, attached }) =>
      ({ name, side, color, move, oc, ld, w, type, shocked, start, lastShot, weapons, weapon, roll, list, size,
        profiles, melee, abilities, keywords, damaged, demise, attached,
        models: models.map((m) => ({ ...f(m), r: m.r, wounds: m.wounds, p: m.p })) })),
    terrains: terrains.map((t) => ({ poly: t.poly.map(f), type: t.type, h: t.h, objective: t.objective, owner: t.owner, secured: t.secured })),
    objectives: objectives.map((o) => ({ ...f(o), owner: o.owner, secured: o.secured })),
  };
}
function clearAll(keepView = false) {
  for (const u of units) removeObj(u.group);
  for (const t of terrains) { if (t.tag) removeObj(t.tag); removeObj(t.mesh); }
  for (const o of objectives) { if (o.tag) removeObj(o.tag); removeObj(o.mesh); }
  units.length = terrains.length = objectives.length = 0;
  turn = 1; phase = 0; started = false;
  sel = null;
  pending = null;
  if (keepView) return; // remote update: keep the measure lines and the open sheet
  $('sheet').hidden = true;
  renderWeapons();
  disposeTree(notes);
}
function restore(s, keepView = false) {
  clearAll(keepView);
  const g = (q) => ({ ...fromFrame(q, refs.A, refs.B), y: refs.A.y + (q.h ?? 0) });
  ({ turn = 1, phase = 0, started = false } = s);
  for (const su of s.units) {
    const { models, ...props } = su;
    const u = makeUnit(props);
    for (const m of models) addModel(u, g(m), m.r, m.wounds, m.p ?? undefined);
  }
  for (const t of s.terrains) addTerrain(t.poly.map(g), refs.A.y, TERRAIN[t.type] ? t.type : 'dense', Number(t.h) || 0, t.objective, t.owner, t.secured);
  for (const o of s.objectives) addObjective(g(o), o.owner, o.secured);
  refresh();
}
function autosave() {
  if (!refs || refs === LOCAL) return; // LOCAL: undo restore in progress, not a real table frame
  gstore.set('game', JSON.stringify(snapshot()));
  Object.assign(curGame(), { at: Date.now(), turn, units: units.length });
  saveGames();
  // an empty table is never broadcast, so joining a room can't wipe the other player's game
  if (!room || applyingRemote || !(units.length || terrains.length || objectives.length)) return;
  clearTimeout(sendTimer);
  sendTimer = setTimeout(() => {
    if (!refs) return;
    // only real game changes are sent: a selection change must not overwrite the other player's newer state
    // army lists travel with the game: each phone ends up with both players' lists (newest import wins per side)
    const json = JSON.stringify(snapshot()), key = json + JSON.stringify(armiesAt);
    if (key === lastSync) return;
    lastSync = key;
    const lists = Object.fromEntries(Object.keys(armiesAt).map((side) => [side, { at: armiesAt[side], units: armies[side] }]));
    fetch(`/state?room=${encodeURIComponent(room)}`, { method: 'POST', body: `{"from":${JSON.stringify(clientId)},"state":${json},"armies":${JSON.stringify(lists)}}` })
      .then((r) => r.ok || status(`Synchro : envoi refusé (${r.status})`))
      .catch(() => status('Synchro : envoi impossible'));
  }, 150);
}
// Apply the other player's state, keeping this player's selection and half-finished 2-tap action.
function applyRemote(s) {
  const idx = (m) => (m?.u ? [units.indexOf(m.u), m.u.models.indexOf(m)] : null);
  const selIdx = units.indexOf(sel), pend = idx(pending), keep = pending && !pend ? pending : null;
  applyingRemote = true;
  try {
    restore(s, true);
    undoStack.length = 0; // undoing now would overwrite the other player's change
    lastSync = JSON.stringify(snapshot()) + JSON.stringify(armiesAt);
    if (units[selIdx]) selectUnit(units[selIdx]);
    pending = pend ? units[pend[0]]?.models[pend[1]] ?? null : keep;
  } catch (err) {
    status(`Synchro : état reçu invalide (${err.message})`);
  } finally {
    applyingRemote = false;
  }
}
if (room) {
  const es = new EventSource(`/events?room=${encodeURIComponent(room)}`);
  es.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.from === clientId || !Array.isArray(msg.state?.units)) return;
    mergeArmies(msg.armies);
    if (!refs) return (remoteState = msg.state), status('Synchro : partie reçue, pose les Repères pour l\'afficher');
    applyRemote(msg.state);
  };
  es.onerror = () => status('Synchro : connexion perdue, reconnexion…');
}
function drawRefs() {
  disposeTree(refMarks);
  for (const p of [refs.A, refs.B]) {
    dot(p, refMarks, GOLD);
    const ring = new THREE.Mesh(ringGeo(0.008, 0.011), basic(GOLD));
    ring.position.set(p.x, p.y + 0.002, p.z);
    refMarks.add(ring);
  }
}

// Can sel's armed models shoot this enemy model with the selected weapon? (range, sight, Hidden, Lone Operative, Indirect Fire)
// Returns false, true, or 'check' when every shooter that could fire needs the real line of sight (a model in an area).
function canTarget(u, m, hid) {
  const indirect = has(weaponOf(u).abilities, 'INDIRECT FIRE');
  const ok = shooters(u).filter((a) => inRange([a], m, rangeOf(u), indirect ? [] : terrains, !indirect && hid)
    && (!loneOp(m.u) || toIn(edgeDist(a, m)) <= 12 + 1e-6));
  if (!ok.length) return false;
  return !indirect && ok.every((a) => trueLosAreas(a, m, terrains).length) ? 'check' : true;
}
// Deadly Demise x: when the model is destroyed, roll D6; on a 6 each unit within 6" suffers x mortal wounds.
function deadlyDemise(m) {
  if (!m.u.demise) return '';
  const roll = d6();
  if (roll < 6) return ` – Deadly Demise : ${roll}, rien`;
  const ring = new THREE.Mesh(ringGeo(m.r + 6 * INCH - 0.003, m.r + 6 * INCH), new THREE.MeshBasicMaterial({ color: RED }));
  ring.position.set(m.x, m.y + 0.001, m.z);
  notes.add(ring);
  const hit = units.filter((u) => u.models.some((o) => toIn(edgeDist(m, o)) <= 6 + 1e-6)).map(uname);
  return ` – DEADLY DEMISE 6 ! ${m.u.demise} BM à : ${hit.join(', ') || 'personne'}`;
}

// Shot result. answer (the player's look at the real models, see losAsk): 'full' | 'partial' | 'none' | null (footprints decide).
function resolveShot(a, b, los, vis, answer) {
  const d = edgeDist(a, b), wp = weaponOf(a.u), indirect = has(wp.abilities, 'INDIRECT FIRE');
  const lone = !!b.u && loneOp(b.u) && toIn(d) > 12 + 1e-6, inR = toIn(d) <= rangeOf(a.u) + 1e-6;
  if (answer === 'none') vis = false;
  // 13.08: INFANTRY/BEASTS/SWARM within a terrain area, or not fully visible (here: the player's answer)
  const inAreaCover = (m) => infantry(m.u ?? {}) && terrains.some((t) => inArea(m, t.poly));
  const cover = vis && (answer === 'partial' ? true
    : answer === 'full' ? (b.u ? b.u.models.every(inAreaCover) : false)
    : b.u ? unitCover(a, b.u.models, terrains, infantry(b.u)) : modelCover(a, b, terrains));
  disposeTree(notes);
  line(a, b, inR && vis ? YELLOW : RED, fmt(d) + (!los ? ' pas de LdV' : !vis ? ' cachée' : cover ? ' couvert' : ''));
    if (inR && vis) {
      fire(a, b, fxKind(weaponOf(a.u).name), a.u.type !== 'inf');
      a.u.lastShot = turn; // the shooting unit can no longer be hidden this turn and next
      refresh();
    }
    const extra = [
      cover && ' – unité à couvert : CT -1',
      plunging(a, b.u ? b.u.models : [b], groundY(), { towering: kw(a.u, 'TOWERING'), aircraft: kw(a.u, 'AIRCRAFT') || kw(b.u, 'AIRCRAFT') })
        && ' – tir plongeant : CT +1',
      indirect && !canSee(a, b, terrains) && ' – tir indirect sans visibilité : -1 touche, cible à couvert',
      has(wp.abilities, 'TORRENT') && ' – Torrent : touche auto',
      has(wp.abilities, 'RAPID FIRE') && toIn(d) <= rangeOf(a.u) / 2 + 1e-6 && ` – Tir rapide : +${wp.abilities.find((x) => /^RAPID FIRE/i.test(x)).split(' ').pop()} A`,
      has(wp.abilities, 'MELTA') && toIn(d) <= rangeOf(a.u) / 2 + 1e-6 && ` – Melta : +${wp.abilities.find((x) => /^MELTA/i.test(x)).split(' ').pop()} D`,
      a.u.damaged && a.wounds <= a.u.damaged && ' – tireur endommagé : -1 touche',
    ].filter(Boolean).join('');
  status(lone ? `Lone Operative : ciblable à 12" max (${fmt(d)})`
    : !los ? `Pas de ligne de vue (${fmt(d)})`
    : answer === 'none' ? `Pas de ligne de vue réelle : la cible est entièrement cachée (${fmt(d)})`
    : !vis ? `Cible cachée : hors de sa portée de détection (${fmt(d)})`
    : !inR ? `Hors de portée : ${fmt(d)} > ${wp.name} ${rangeOf(a.u)}"`
    : `Tir à ${fmt(d)}${extra}`);
}
// Answer to "does the target stick out?" for the shot waiting in losAsk.
let losAsk = null;
function answerLos(answer) {
  $('losAsk').hidden = true;
  if (!losAsk) return;
  const { a, b } = losAsk;
  losAsk = null;
  resolveShot(a, b, true, true, answer);
}
for (const btn of document.querySelectorAll('#losAsk [data-los]')) btn.onclick = () => answerLos(btn.dataset.los);

// ---------- tap handlers (p = reticle hit in table-local real metres) ----------
const handlers = {
  place(p) {
    const m = pick(p);
    if (m && m.u === sel && sel.profiles?.length > 1) {
      // per-model profile: tap again to cycle (sergeant, trooper, attached leader...)
      m.p = ((m.p ?? -1) + 1) % sel.profiles.length;
      m.wounds = wMax(m);
      refresh();
      return status(`Figurine : ${profOf(m).name} (${profOf(m).weapons.join(', ') || 'pas d’arme de tir'})`);
    }
    if (m) return selectUnit(m.u), status(`${uname(m.u)} sélectionnée${m.u.profiles?.length > 1 ? ' (re-touche une figurine pour changer son profil)' : ''}`);
    addModel(sel ?? newUnit(), p);
    refresh();
    const placed = sel.models.at(-1);
    // Deep Strike reminder once the battle has started: set up more than 9" from enemy models
    const foe = started && has(sel.abilities, 'Deep Strike') ? Math.min(...enemiesOf(sel.side).map((e) => toIn(edgeDist(placed, e)))) : Infinity;
    status(`${uname(sel)} : ${sel.models.length}${sel.size ? '/' + sel.size : ''} figurine(s)${profOf(placed) ? ` – ${profOf(placed).name}` : ''}`
      + (foe < 9 ? ` – Frappe en profondeur : ${foe.toFixed(1)}" d'un ennemi (9" min)` : ''));
  },
  measure(p) {
    const pt = target(p);
    if (!pending) return disposeTree(notes), dot(pt), (pending = pt), status('Mesure : touche le 2e point');
    const d = edgeDist(pending, pt), dy = Math.abs((pt.y ?? 0) - (pending.y ?? 0));
    line(pending, pt, WHITE, fmt(d));
    pending = null;
    status(`Distance socle à socle : ${fmt(d)}${toIn(dy) >= 0.5 ? ` – écart vertical ${fmt(dy)}${toIn(dy) > RULES.vertical ? ' (> 5" : hors engagement/cohésion)' : ''}` : ''}`);
  },
  move(p) {
    if (!pending) {
      const m = pick(p);
      if (!m) return status('Touche une figurine à déplacer');
      pending = m;
      selectUnit(m.u);
      return status(`Touche la nouvelle position (max ${allowedMove(m.u)}")`);
    }
    const m = pending, max = allowedMove(m.u);
    pending = null;
    disposeTree(notes);
    const d = moved(m.u, m, p), over = toIn(d) > max + 1e-6, climb = Math.abs(p.y - m.y);
    line({ ...m, r: 0 }, { ...p, r: 0 }, over ? RED : GREEN, fmt(d));
    Object.assign(m, { x: p.x, y: p.y, z: p.z });
    m.mesh.position.set(p.x, p.y + 0.001, p.z);
    refresh();
    const eng = engaged(m, enemiesOf(m.u.side)) && m.u.roll?.kind !== 'charge' ? ` – engagée (moins de ${RULES.engagement}")` : '';
    const v = toIn(climb) >= 0.5 ? (kw(m.u, 'FLY') ? ` (vol : ${fmt(climb)} vertical ignoré)` : ` (dont ${fmt(climb)} vertical)`) : '';
    status((over ? `TROP LOIN : ${fmt(d)} > ${max}"` : `Déplacé de ${fmt(d)}`) + v + eng);
  },
  shoot(p) {
    if (!pending) {
      const m = pick(p);
      if (!m) return status('Touche un tireur');
      selectUnit(m.u);
      if (!armed(m)) return status(`${profOf(m).name} n'a pas ${weaponOf(m.u).name} : choisis une autre arme ou une autre figurine`);
      pending = m;
      return status(`Touche la cible (${weaponOf(m.u).name} ${rangeOf(m.u)}")`);
    }
    const a = pending, b = target(p), d = edgeDist(a, b), wp = weaponOf(a.u);
    const hid = !!b.u && isHidden(b), indirect = has(wp.abilities, 'INDIRECT FIRE');
    const lone = !!b.u && loneOp(b.u) && toIn(d) > 12 + 1e-6; // Lone Operative: only targetable within 12"
    const los = indirect || canSee(a, b, terrains), vis = !lone && (indirect || canSee(a, b, terrains, hid));
    const inR = toIn(d) <= rangeOf(a.u) + 1e-6;
    pending = null;
    disposeTree(notes);
    // one of them is within an obscuring area: the footprint can't tell, the player looks at the real models
    if (inR && vis && !indirect && trueLosAreas(a, b, terrains).length) {
      line(a, b, ORANGE, `${fmt(d)} LdV réelle ?`);
      losAsk = { a, b };
      $('losAsk').hidden = false;
      return status(`Dans un décor : regarde les vraies figurines. La cible dépasse-t-elle (côtés ou dessus) ? (${fmt(d)})`);
    }
    resolveShot(a, b, los, vis, null);
  },
  // Lasso (table-local path): the models inside it move to a new unit, ready to link to an army-list entry.
  // If both sides are inside, the side with more models in the lasso is taken.
  group(path) {
    if (!Array.isArray(path) || path.length < 3) return status('Grouper : entoure les figurines d’un trait du doigt (doigt posé, puis lâché)');
    const inside = units.flatMap((u) => u.models).filter((m) => inPoly(m, path));
    if (!inside.length) return status('Aucune figurine dans le tracé');
    const n1 = inside.filter((m) => m.u.side === 1).length, side = n1 * 2 >= inside.length ? 1 : 2;
    const picked = inside.filter((m) => m.u.side === side);
    $('side').value = side; // newUnit() takes its side from the picker
    const donors = new Set(picked.map((m) => m.u)), u = newUnit();
    for (const m of picked) {
      m.u.models.splice(m.u.models.indexOf(m), 1);
      u.group.add(m.mesh);
      m.u = u;
      u.models.push(m);
    }
    u.start = u.models.length;
    for (const d of donors) {
      if (!started) d.start = d.models.length; // still deploying: the donor's starting strength follows
      if (!d.models.length) units.splice(units.indexOf(d), 1), removeObj(d.group);
    }
    selectUnit(u);
    status(`${picked.length} figurine(s) regroupée(s) dans ${uname(u)}${$('listUnit').hidden ? '' : ' : choisis son profil dans le menu Liste'}`);
  },
  // Allocate damage to one model; excess damage is lost, a model at 0 wounds is destroyed.
  wound(p) {
    const m = pick(p);
    if (!m) return status('Touche une figurine');
    const dmg = Math.max(1, Number($('dmg').value) || 1);
    m.wounds -= dmg;
    if (m.wounds > 0) return refresh(), status(`${uname(m.u)} : figurine à ${m.wounds}/${wMax(m)} PV${m.u.damaged && m.wounds <= m.u.damaged ? ' – endommagée : -1 touche' : ''}`);
    removeModel(m);
    explode(m, m.u.type !== 'inf');
    refresh();
    status(`${uname(m.u)} : figurine détruite (${m.u.models.length}/${m.u.start})${half(m.u) ? ' – demi-effectif, test de moral au prochain Commandement' : ''}${deadlyDemise(m)}`);
  },
  terrain(p) {
    if (!pending) disposeTree(notes);
    pending = [...(pending ?? []), p];
    dot(p);
    if (pending.length === 1) return status('Décor : touche le 2e coin du même côté');
    if (pending.length === 2) return status('Décor : touche le côté opposé (profondeur)');
    const [a, b, c] = pending, poly = rectFromTaps(a, b, c), type = $('tType').value;
    pending = null;
    disposeTree(notes);
    if (!poly) return status('Décor trop petit, recommence');
    addTerrain(poly, a.y, type, Number($('tH').value) || 0);
    refresh();
    status(`Décor ${terrains.length} (${TERRAIN[type].label}) ajouté`);
  },
  // Poser: tap inside a terrain area toggles it as a terrain objective (14.01), tap a marker removes it, else places one.
  // Sécuriser: tap an objective to toggle "secured" for its current controller (14.03).
  objective(p) {
    const o = objectives.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < q.r + 0.005);
    const t = !o && terrains.find((q) => inArea({ ...p, r: 0 }, q.poly));
    if ($('objAct').value === 'secure') {
      const target = o ?? (t?.objective ? t : null);
      if (!target) return status('Touche un objectif');
      if (!target.owner) return status('Objectif contrôlé par personne : rien à sécuriser');
      target.secured = !target.secured;
      refresh();
      return status(target.secured ? `Objectif sécurisé par J${target.owner}` : 'Objectif plus sécurisé');
    }
    if (o) {
      objectives.splice(objectives.indexOf(o), 1);
      if (o.tag) removeObj(o.tag);
      removeObj(o.mesh);
      refresh();
      return status('Objectif retiré');
    }
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
    if (!pending) return disposeTree(notes), dot(p), (pending = p), status('Repère 2 : touche le 2e point de référence');
    const A = pending, B = p, dist = Math.hypot(B.x - A.x, B.z - A.z);
    pending = null;
    disposeTree(notes);
    if (dist < 0.05) return status('Repères trop proches (5 cm minimum)');
    const before = refs ? snapshot() : null;
    // in a room, the shared game wins over this phone's own save
    const saved = !before && !units.length && !terrains.length && !objectives.length ? remoteState ?? JSON.parse(gstore.get('game') || 'null') : null;
    remoteState = null;
    refs = { A, B };
    drawRefs();
    const s = before ?? saved;
    if (!s) return autosave(), status('Repères posés. La partie est sauvegardée en continu.');
    restore(s);
    const gapTxt = `écart entre repères ${fmt(Math.abs(dist - s.d))}`;
    status(before ? `Recalé (${gapTxt})` : `Partie restaurée : ${units.length} unité(s) (${gapTxt})`);
  },
  calib(p) {
    if (!pending) return disposeTree(notes), dot(p), (pending = p), status('Calibration : touche l\'autre bout de la règle');
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

// Undo: game state before each tap that changed it. Without Repères the table-local frame is used (origin = first tap).
const LOCAL = { A: { x: 0, y: 0, z: 0 }, B: { x: 1, y: 0, z: 0 } };
const undoStack = [];
function inFrame(fn) {
  const r = refs;
  refs = r ?? LOCAL;
  try { return fn(); } finally { refs = r; }
}
function tap(p) {
  if (losAsk) (losAsk = null), ($('losAsk').hidden = true);
  // Repères change the frame the saved states are in: older undo steps would land in the wrong place
  if (mode === 'refs') undoStack.length = 0;
  const before = (mode === 'refs' || mode === 'calib') ? null : inFrame(() => JSON.stringify(snapshot()));
  handlers[mode](p);
  if (before && before !== inFrame(() => JSON.stringify(snapshot()))) undoStack.push(before) > 30 && undoStack.shift();
}
$('undoAct').onclick = () => {
  const s = undoStack.pop();
  if (!s) return status('Rien à annuler');
  inFrame(() => restore(JSON.parse(s)));
  status(`Action annulée (${undoStack.length} restante(s))`);
};

// Live bar from the first point (measure / move / shoot) to where the finger or reticle is now.
let liveKey = '';
function preview(p) {
  let a = null, b = null, color = WHITE, d = 0;
  if (p && pending?.x !== undefined) {
    if (mode === 'measure') { a = pending; b = target(p); d = edgeDist(a, b); }
    else if (mode === 'move' && pending.u) {
      a = { ...pending, r: 0 }; b = { ...p, r: 0 }; d = moved(pending.u, a, b);
      color = toIn(d) > allowedMove(pending.u) + 1e-6 ? RED : GREEN;
    } else if (mode === 'shoot' && pending.u) {
      a = pending; b = target(p); d = edgeDist(a, b);
      color = toIn(d) <= rangeOf(a.u) + 1e-6 ? YELLOW : RED;
    }
  }
  // rebuilt only when the end point moves by 2 mm or more
  const key = a ? [a.x, a.z, b.x, b.z].map((v) => Math.round(v * 500)).join() + color : '';
  if (key === liveKey) return;
  liveKey = key;
  disposeTree(live);
  if (a) line(a, b, color, fmt(d), live);
}

const HINTS = {
  group: 'Grouper : entoure des figurines au doigt pour en faire une nouvelle unité, puis lie-la à la liste.',
  place: 'Poser : tape sur un socle (le point se pose au lever du doigt). Taper une figurine existante sélectionne son unité.',
  measure: 'Mesurer : touche 2 points ou figurines (socle à socle).',
  move: 'Déplacer : touche la figurine, puis sa nouvelle position.',
  shoot: 'Tirer : touche le tireur, puis la cible.',
  wound: 'Blesser : règle les dégâts, puis tape une figurine. À 0 PV elle est retirée.',
  terrain: 'Décor : touche 2 coins d\'un côté, puis le côté opposé.',
  objective: 'Objectif : tape pour poser un pion, dans un décor pour en faire un objectif, sur un pion pour le retirer. Choix "Sécuriser" pour verrouiller un objectif.',
  refs: 'Repères : touche 2 points fixes de la table (ex. 2 coins). Refais-le pour recaler ou reprendre une partie.',
  calib: 'Calibrer : touche les 2 bouts d\'une règle de longueur connue.',
};

// 'select' fires when the finger lifts. The point goes where the finger was (last hit of that touch),
// falling back to the centre reticle on phones without transient hit-test.
let lasso = null; // table-local points traced while the finger is down in Grouper mode
function drawLasso() {
  disposeTree(lassoG);
  if (lasso?.length > 1) lassoG.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(lasso.map((p) => new THREE.Vector3(p.x, p.y + 0.003, p.z))), new THREE.LineBasicMaterial({ color: WHITE })));
}
function onSelect(e) {
  const touch = touchHits.get(e.inputSource);
  touchHits.delete(e.inputSource);
  if (mode === 'group') {
    const path = lasso ?? [];
    lasso = null;
    drawLasso();
    return tap(path);
  }
  const pose = touch ?? (reticle.visible ? hitPose.clone() : null);
  if (!pose) return status('Pas de surface sous le doigt : bouge un peu le téléphone au-dessus de la table.');
  if (!rootPose) {
    setRoot(pose.clone());
    // no plane-attached anchors on this browser: fall back to a free-space anchor
    if (!window.XRHitTestResult?.prototype.createAnchor) {
      const pos = new THREE.Vector3(), q = new THREE.Quaternion();
      pose.decompose(pos, q, new THREE.Vector3());
      e.frame.createAnchor?.(new XRRigidTransform(pos, q), renderer.xr.getReferenceSpace())?.then((a) => { anchor = a; anchorOffset = new THREE.Matrix4(); }).catch(() => {});
    }
  }
  tap(root.worldToLocal(new THREE.Vector3().setFromMatrixPosition(pose)));
}

// ---------- UI ----------
for (const mm of BASES_MM) $('base').add(new Option(`${mm} mm`, mm, mm === 32, mm === 32));
$('newUnit').onclick = () => (newUnit(), status(`${uname(sel)} créée : pose ses figurines`));
const unitInput = (id, key) => ($(id).onchange = () => sel && ((sel[key] = Number($(id).value) || 0), refresh()));
unitInput('side', 'side');
unitInput('move', 'move');
unitInput('oc', 'oc');
unitInput('ld', 'ld');
// W: changing it heals models to full / caps them; done while setting up the unit
$('w').onchange = () => {
  if (!sel) return;
  sel.w = Math.max(1, Number($('w').value) || 1);
  for (const m of sel.models) m.wounds = sel.w;
  refresh();
};
$('uName').onchange = () => sel && ((sel.name = $('uName').value || sel.name), refresh());
$('uType').onchange = () => sel && ((sel.type = $('uType').value), refresh());
$('weapon').onchange = () => sel && ((sel.weapon = Number($('weapon').value)), refresh());
$('addWeapon').onclick = () => {
  if (!sel) return;
  sel.weapons.push({ name: `Arme ${sel.weapons.length + 1}`, range: 12 });
  sel.weapon = sel.weapons.length - 1;
  renderWeapons();
  refresh();
};
$('unitName').onclick = () => (sel ? ($('sheet').hidden = !$('sheet').hidden) : status('Sélectionne ou crée une unité'));
$('closeSheet').onclick = () => ($('sheet').hidden = true);
$('fold').onclick = () => {
  const folded = $('panel').classList.toggle('folded');
  $('fold').textContent = folded ? '▴' : '▾';
  store.set('folded', folded ? '1' : null);
};
if (store.get('folded')) $('fold').click();

// ---------- army lists ----------
// One imported list per side (localStorage). Picking a list entry links the selected unit to it (if not linked yet,
// so models already placed keep their place) or creates a new linked unit; its profile and weapons are copied.
const armies = JSON.parse(gstore.get('armies') || '{}');
const armiesAt = JSON.parse(gstore.get('armiesAt') || '{}'); // side -> import time, to keep the newest list per side
function mergeArmies(remote) {
  if (!remote || typeof remote !== 'object') return;
  let got = 0;
  for (const side of ['1', '2']) {
    const r = remote[side];
    if (!Array.isArray(r?.units) || !(Number(r.at) > (armiesAt[side] ?? 0))) continue;
    armies[side] = r.units;
    armiesAt[side] = Number(r.at);
    got++;
  }
  if (!got) return;
  gstore.set('armies', JSON.stringify(armies));
  gstore.set('armiesAt', JSON.stringify(armiesAt));
  renderList();
}
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
async function pdfText(file) {
  const pdfjs = await import(PDFJS + 'pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push(linesFromItems((await (await doc.getPage(i)).getTextContent()).items));
  return pages.join('\n');
}
function renderList() {
  const list = armies[$('side').value] ?? [], pick = $('listUnit');
  pick.hidden = !list.length;
  const used = new Set(units.filter((u) => u.side === Number($('side').value)).flatMap((u) => [u.list, ...(u.attached ?? [])]));
  pick.replaceChildren(new Option(sel && sel.list == null ? 'Lier à la liste…' : '+ Unité de la liste…', ''),
    ...list.map((lu, i) => new Option(`${used.has(i) ? '✓ ' : ''}${lu.name} (${lu.models || '?'} fig.)`, i)));
  $('armySummary').textContent = list.length
    ? `J${$('side').value} : ${list.length} unités, ${list.reduce((n, lu) => n + lu.pts, 0)} pts` : 'Aucune liste pour ce camp.';
}
$('listUnit').onchange = () => {
  const i = Number($('listUnit').value), lu = armies[$('side').value]?.[i];
  if (!lu || $('listUnit').value === '') return;
  const side = Number($('side').value), list = armies[side];
  const u = sel && sel.list == null && sel.side === side ? sel : newUnit();
  const copy = (x) => JSON.parse(JSON.stringify(x ?? []));
  Object.assign(u, { name: lu.name, move: lu.move, oc: lu.oc, ld: lu.ld, w: lu.w, type: lu.type, list: i, size: lu.models,
    weapons: copy(lu.weapons), weapon: 0, melee: copy(lu.melee), profiles: copy(lu.profiles), abilities: copy(lu.abilities),
    keywords: copy(lu.keywords), damaged: lu.damaged ?? 0, demise: lu.demise ?? '', attached: [] });
  // models already on the table get the profiles in list order (sergeant first), at full wounds
  for (const m of u.models) m.p = undefined;
  for (const m of u.models) (m.p = autoProfile(u)), (m.wounds = wMax(m));
  // attached character (Leading / Supporting): merged with its bodyguard unit once both are on the table
  const other = units.find((o) => o !== u && o.side === side && o.list != null && list[o.list]
    && (list[o.list].attach === lu.name || lu.attach === list[o.list].name));
  const res = other ? attach(lu.attach ? other : u, lu.attach ? u : other) : u;
  selectUnit(res);
  renderList();
  status(other ? `${uname(res)} : personnage attaché, ${res.models.length}/${res.size} figurine(s)`
    : `${uname(u)} liée à la liste : ${u.models.length}/${lu.models || '?'} figurine(s) posée(s)`);
};
// Merge a character unit into its bodyguard: one unit on the table, each model keeps its own profile.
function attach(body, chr) {
  const n = body.profiles.length;
  for (const m of [...chr.models]) {
    chr.models.splice(chr.models.indexOf(m), 1);
    body.group.add(m.mesh);
    m.u = body;
    m.p = m.p == null ? undefined : m.p + n;
    body.models.push(m);
  }
  const union = (a, b) => [...a, ...b.filter((x) => !a.some((y) => (y.name ?? y) === (x.name ?? x)))];
  Object.assign(body, {
    name: `${body.name} + ${chr.name}`, size: (body.size || 0) + (chr.size || 0), start: body.start + chr.start,
    profiles: [...body.profiles, ...chr.profiles], weapons: union(body.weapons, chr.weapons), melee: union(body.melee, chr.melee),
    abilities: union(body.abilities, chr.abilities.filter((a) => !/^(Leader|Support|Lone Operative)$/.test(a))),
    keywords: union(body.keywords, chr.keywords), attached: [...(body.attached ?? []), chr.list],
    move: Math.min(body.move, chr.move),
  });
  units.splice(units.indexOf(chr), 1);
  removeObj(chr.group);
  return body;
}
$('armyOpen').onclick = () => { $('army').hidden = !$('army').hidden; renderList(); };
$('armyClose').onclick = () => ($('army').hidden = true);
$('armyImport').onclick = async () => {
  const file = $('armyFile').files[0];
  try {
    status('Lecture de la liste…');
    const text = file ? (/pdf$/i.test(file.type || file.name) ? await pdfText(file) : await file.text()) : $('armyText').value;
    const list = parseArmyList(text);
    if (!list.length) return status('Aucune unité reconnue (format attendu : export BattleBase, "NOM 150 PTS" puis les profils)');
    armies[$('side').value] = list;
    armiesAt[$('side').value] = Date.now();
    gstore.set('armies', JSON.stringify(armies));
    gstore.set('armiesAt', JSON.stringify(armiesAt));
    autosave(); // shared with the other phone (with the next game change if the table is still empty)
    renderList();
    status(`Liste J${$('side').value} importée : ${list.length} unités. Choisis-les dans le menu à côté de l'arme.`);
  } catch (err) {
    status(`Import impossible : ${err.message}`);
  }
};
$('side').addEventListener('change', renderList);
renderList();

// BattleBase live score: paste the battle's share link, read every 15 s (read-only, link kept on this phone only)
let bbTimer = 0;
async function bbPoll(id) {
  try {
    $('bb').textContent = battleText(battleState(await fetchBattle(id)));
  } catch (err) {
    $('bb').textContent = `BB : lecture impossible (${err.message})`;
  }
}
function bbFollow(link) {
  clearInterval(bbTimer);
  const id = battleId(link);
  gstore.set('bbLink', id ? link : null);
  $('bb').hidden = !id;
  $('bbFollow').textContent = id ? 'Arrêter' : 'Suivre';
  if (!id) return link && status('Lien BattleBase non reconnu (attendu : battlebase.app/battles/…)');
  $('bb').textContent = 'BB : lecture…';
  bbPoll(id);
  bbTimer = setInterval(() => bbPoll(id), 15000);
}
$('bbFollow').onclick = () => bbFollow(gstore.get('bbLink') ? '' : $('bbLink').value.trim());
$('bbLink').value = gstore.get('bbLink') || '';
if ($('bbLink').value) bbFollow($('bbLink').value);

// on-device test checklist
const CHECKS = [
  'Calibrer : règle de 6" mesurée à 6" (±0,1") avec Mesurer',
  'Mètre ruban : 12" et 24" mesurés, écart noté',
  'Point posé là où le doigt se lève (pas au centre)',
  'Points collés aux figurines / décors / table (pas flottants)',
  'Après 5 min, figurines toujours en place (sinon Repères recale)',
  'Étiquettes lisibles à 50 cm',
  'Panneau ne gêne pas (▾ replie)',
  'Auras mouvement / arme à la bonne taille',
  'Ligne de vue bloquée par un décor dense',
  'Occlusion : anneau caché derrière une figurine (si cochée au départ)',
  'Reprise de partie après fermeture (Repères sur les mêmes points)',
  'Lancement hors ligne sans le PC',
  'Ajout à l\'écran d\'accueil avec icône',
  'Partie à 2 téléphones (?room=) (optionnel)',
];
const checks = JSON.parse(store.get('checklist') || '{}');
const saveChecks = () => store.set('checklist', JSON.stringify(checks));
$('checkItems').replaceChildren(...CHECKS.map((text, i) => {
  const l = document.createElement('label'), c = document.createElement('input');
  c.type = 'checkbox'; c.checked = !!checks[i];
  c.onchange = () => { checks[i] = c.checked; saveChecks(); };
  l.append(c, text);
  return l;
}));
$('checkNotes').value = checks.notes || '';
$('checkNotes').oninput = () => { checks.notes = $('checkNotes').value; saveChecks(); };
$('checkOpen').onclick = () => ($('checklist').hidden = !$('checklist').hidden);
$('checkClose').onclick = () => ($('checklist').hidden = true);
$('checkReset').onclick = () => {
  CHECKS.forEach((_, i) => (checks[i] = false));
  for (const c of $('checkItems').querySelectorAll('input')) c.checked = false;
  saveChecks();
};
$('checkCopy').onclick = () => {
  const txt = CHECKS.map((t, i) => `[${checks[i] ? 'x' : ' '}] ${t}`).join('\n') + (checks.notes ? `\n\nNotes : ${checks.notes}` : '');
  if (!navigator.clipboard) return status('Copie indisponible ici');
  navigator.clipboard.writeText(txt).then(() => status('Rapport copié'), () => status('Copie refusée par le navigateur'));
};

// End of phase: settle objective control (14.02, 14.03), then move on. After the Fight phase, the next player's turn starts.
$('phase').onclick = () => {
  for (const o of [...objectives, ...terrains.filter((t) => t.objective)]) Object.assign(o, endPhaseOwner(o.owner, o.secured, control(o, units)));
  started = true;
  phase = (phase + 1) % PHASES.length;
  if (phase === 0) {
    turn++;
    for (const u of units) u.roll = null;
  }
  refresh();
  if (phase !== 0) return status(`${PHASES[phase]} (J${activeSide()}) – contrôle des objectifs mis à jour`);
  // 08.03 battle-shock step: the active player tests units that are battle-shocked or at/below half-strength
  const due = units.filter((u) => u.side === activeSide() && (u.shocked || half(u)));
  status(`Tour ${turn}, J${activeSide()} – ` + (due.length ? `tests de moral : ${due.map((u) => u.name).join(', ')}` : 'aucun test de moral'));
};
// Battle-shock roll (01.07): 2D6 >= Ld, else battle-shocked (OC '-').
$('morale').onclick = () => {
  if (!sel) return status('Sélectionne une unité d\'abord');
  const [x, y] = [d6(), d6()], ok = leadershipPass(x + y, sel.ld);
  sel.shocked = !ok;
  refresh();
  status(`Moral ${uname(sel)} : ${x} + ${y} = ${x + y} vs Ld ${sel.ld}+ → ${ok ? 'réussi' : 'ÉBRANLÉE (OC -)'}`);
};
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
  if (mode === 'objective') {
    const o = objectives.pop();
    if (o) { if (o.tag) removeObj(o.tag); removeObj(o.mesh); refresh(); }
    return;
  }
  const m = sel?.models.at(-1);
  if (!m) return;
  removeModel(m);
  if (!started) sel.start = sel.models.length; // still deploying: fix the starting strength, not a casualty
  refresh();
};
$('clear').onclick = () => (disposeTree(notes), (pending = null));
for (const b of document.querySelectorAll('#modes [data-mode]')) {
  b.onclick = () => {
    mode = b.dataset.mode;
    pending = null;
    if (losAsk) (losAsk = null), ($('losAsk').hidden = true);
    for (const o of document.querySelectorAll('#modes [data-mode]')) o.classList.toggle('on', o === b);
    $('dmgLabel').hidden = mode !== 'wound';
    $('calibLabel').hidden = mode !== 'calib';
    $('terrainOpts').hidden = mode !== 'terrain';
    $('objAct').hidden = mode !== 'objective';
    $('undo').textContent = mode === 'terrain' ? 'Retirer décor' : mode === 'objective' ? 'Retirer pion' : 'Retirer fig.';
    status(HINTS[mode]);
  };
}
// Taps on the controls must not also count as AR taps.
$('ui').addEventListener('beforexrselect', (e) => e.target.closest('#panel, #status') && e.preventDefault());

// Launch screen: pick the game to continue, delete one, or start a new one (optionally linked to a BattleBase battle).
function switchGame(id) {
  store.set('cur', id);
  location.reload();
}
function renderGames() {
  const g = curGame();
  $('gHint').textContent = gstore.get('game')
    ? `Partie choisie : ${g.name}. Pour la reprendre en AR : mode Repères, touche les 2 mêmes points.`
    : `Partie choisie : ${g.name} (vide).`;
  $('games').replaceChildren(...[...games].sort((a, b) => b.at - a.at).map((x) => {
    const row = document.createElement('div');
    row.className = 'row';
    const pick = document.createElement('button'), del = document.createElement('button');
    const when = new Date(x.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    pick.textContent = `${x.name} · ${when} · ${x.units ? `T${x.turn} · ${x.units} unité(s)` : 'vide'}${store.get(`bbLink:${x.id}`) ? ' · BB' : ''}`;
    if (x.id === cur) pick.className = 'on';
    pick.onclick = () => x.id !== cur && switchGame(x.id);
    del.textContent = '✕';
    del.setAttribute('aria-label', `Supprimer ${x.name}`);
    del.onclick = () => {
      if (!confirm(`Supprimer « ${x.name} » ? Positions, listes et lien BattleBase seront perdus.`)) return;
      for (const key of GAME_KEYS) store.set(`${key}:${x.id}`, null);
      games.splice(games.indexOf(x), 1);
      saveGames();
      if (x.id === cur) switchGame(games[0]?.id ?? ''); // none left: a fresh "Partie 1" is made on reload
      else renderGames();
    };
    row.append(pick, del);
    return row;
  }));
}
$('gNew').onclick = async () => {
  const link = $('gBB').value.trim(), bid = battleId(link);
  if (link && !bid) return ($('gHint').textContent = 'Lien BattleBase non reconnu (attendu : battlebase.app/battles/…)');
  let name = $('gName').value.trim();
  if (!name && bid) {
    try { const b = await fetchBattle(bid); name = `${b.createdBy.username} vs ${b.opponent.username}`; } catch {}
  }
  const id = `g${Date.now().toString(36)}`;
  games.push({ id, name: name || `Partie ${games.length + 1}`, at: Date.now(), turn: 1, units: 0 });
  saveGames();
  if (bid) store.set(`bbLink:${id}`, link);
  switchGame(id);
};
renderGames();
$('occl').checked = !!store.get('occl');

// Desktop testing without AR: open index.html#debug, then call dbg.tap(mode, x, z) from the console (metres).
if (location.hash === '#debug') {
  window.dbg = {
    handlers, units, terrains, objectives, store, occ,
    tap: (m, x, z) => { mode = m; tap({ x, y: 0, z }); },
    lasso: (pts) => { mode = 'group'; tap(pts.map(([x, z]) => ({ x, y: 0, z }))); },
    undoStack, preview, fire, explode, fx, animate, // effects: call animate() to step them when rAF is throttled
    setMode: (m) => document.querySelector(`[data-mode=${m}]`).click(),
    compile: () => renderer.compile(scene, camera), // forces every shader (incl. occlusion patch) to build
    renderer, scene, THREE,
  };
}

// Offline cache (sw.js). Skipped in #debug so desktop tests always run the files on disk.
if ('serviceWorker' in navigator && location.hash !== '#debug') navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- session ----------
let hitSource = null, touchSource = null, anchorPending = false, anchorOffset = null;
const touchHits = new Map(); // touch input source -> last hit pose under the finger
// Hit-test 'point' (feature points) as well as 'plane', so taps land on minis and terrain, not on a guessed plane.
// Browsers that reject entityTypes get the default (planes only).
const hitTestSource = (session, opts) =>
  session[opts.space ? 'requestHitTestSource' : 'requestHitTestSourceForTransientInput']({ ...opts, entityTypes: ['plane', 'point'] })
    .catch(() => session[opts.space ? 'requestHitTestSource' : 'requestHitTestSourceForTransientInput'](opts))
    .catch(() => null);
(async () => {
  const ok = navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar').catch(() => false));
  $('support').textContent = ok ? 'ARCore prêt.' : 'AR indisponible : il faut Chrome Android + ARCore, page servie en https ou localhost.';
  $('enter').disabled = !ok;
})();

$('enter').onclick = async () => {
  let session;
  const wantDepth = $('occl').checked;
  store.set('occl', wantDepth ? '1' : null);
  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'anchors', ...(wantDepth ? ['depth-sensing'] : [])],
      domOverlay: { root: $('ui') },
      ...(wantDepth && { depthSensing: { usagePreference: ['cpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] } }),
    });
  } catch (err) {
    return ($('support').textContent = `Échec du démarrage AR : ${err.message}`);
  }
  xrSession = session;
  // enabledFeatures is missing on older Chrome: then trust the request, updateDepth tolerates a missing depth map
  occlusionOn = wantDepth && (session.enabledFeatures?.includes('depth-sensing') ?? true);
  await renderer.xr.setSession(session);
  const viewer = await session.requestReferenceSpace('viewer');
  // centre reticle: planes only, it is the stable table surface used for anchoring
  hitSource = await session.requestHitTestSource({ space: viewer });
  touchSource = session.requestHitTestSourceForTransientInput ? await hitTestSource(session, { profile: 'generic-touchscreen' }) : null;
  session.addEventListener('select', onSelect);
  session.addEventListener('selectstart', () => { if (mode === 'group') lasso = []; });
  session.addEventListener('selectend', () => { lasso = null; drawLasso(); });
  session.addEventListener('end', () => {
    // the next session has a new world origin: positions only survive through the saved reference frame
    hitSource = null; touchSource = null; touchHits.clear(); undoStack.length = 0; anchor = null; anchorPending = false; anchorOffset = null; rootPose = null; refs = null; xrSession = null; occlusionOn = false; occ.uOn.value = 0;
    clearAll();
    disposeTree(refMarks);
    renderGames();
    $('ui').hidden = true; $('start').hidden = false;
  });
  $('start').hidden = true;
  $('ui').hidden = false;
  status((wantDepth && !occlusionOn ? 'Occlusion non disponible sur ce téléphone. ' : '')
    + (room ? `Partie partagée « ${room} » : pose les Repères sur les mêmes points que l'adversaire. ` : '')
    + (gstore.get('game') || remoteState ? 'Partie à reprendre : mode Repères, touche les 2 mêmes points.' : 'Conseil : Calibrer, puis Repères, puis Poser.'));
};

renderer.setAnimationLoop((t, frame) => {
  if (frame) {
    const ref = renderer.xr.getReferenceSpace();
    if (anchor && anchorOffset) {
      const ap = frame.getPose(anchor.anchorSpace, ref);
      if (ap) setRoot(new THREE.Matrix4().fromArray(ap.transform.matrix).multiply(anchorOffset));
    }
    const hits = hitSource ? frame.getHitTestResults(hitSource) : [];
    if (hits.length) hitPose.fromArray(hits[0].getPose(ref).transform.matrix);
    // Anchor the table frame to the detected plane (moves with ARCore's plane refinements, so points stay on the table).
    // Hit results only live in their frame, so it is done here, keeping the root's offset from that anchor.
    if (rootPose && !anchor && !anchorPending && hits[0]?.createAnchor) {
      anchorPending = true;
      const at = hitPose.clone();
      hits[0].createAnchor().then((a) => { anchorOffset = at.invert().multiply(rootPose); anchor = a; }).catch(() => (anchorPending = false));
    }
    // touches: remember the hit under each finger; the reticle follows the finger while it is down
    let touchPose = null;
    if (touchSource) {
      for (const { inputSource, results } of frame.getHitTestResultsForTransientInput(touchSource)) {
        if (!results.length) continue;
        touchPose = new THREE.Matrix4().fromArray(results[0].getPose(ref).transform.matrix);
        touchHits.set(inputSource, touchPose);
      }
    }
    const show = touchPose ?? (hits.length ? hitPose : null);
    reticle.visible = !!show;
    if (show) {
      // in place mode the reticle previews the chosen base size
      const s = mode === 'place' ? (Number($('base').value) / 2000) * k : 0.01;
      reticle.matrix.copy(show).multiply(tmp.makeScale(s, s, s));
    }
    preview(show && root.worldToLocal(new THREE.Vector3().setFromMatrixPosition(show)));
    // lasso follows the finger (or the reticle on phones without touch hit-test), one point every 5 mm
    if (lasso && show && rootPose) {
      const q = root.worldToLocal(new THREE.Vector3().setFromMatrixPosition(show)), last = lasso.at(-1);
      if (!last || Math.hypot(q.x - last.x, q.z - last.z) > 0.005) lasso.push({ x: q.x, y: q.y, z: q.z }), drawLasso();
    }
    updateDepth(frame, ref);
  }
  animate();
  renderer.render(scene, camera);
});
