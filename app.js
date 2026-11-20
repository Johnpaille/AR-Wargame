import * as THREE from 'three';
import { INCH, BASES_MM, edgeDist, incoherent, inRange, newScale, toIn } from './rules.js';

const $ = (id) => document.getElementById(id);
const COLORS = [0x3fa9f5, 0xf5a623, 0xbd10e0, 0x50e3c2, 0xf8e71c, 0xff6f91, 0x9b9b9b, 0x7ed321];
const RED = 0xff3b30, GREEN = 0x34c759, YELLOW = 0xffcc00, WHITE = 0xffffff;
const fmt = (m) => toIn(m).toFixed(1) + '"';
const status = (t) => ($('status').textContent = t);

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
let k = 1;
try { k = Number(localStorage.getItem('scale')) || 1; } catch {}
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
root.add(notes);

// Aura discs: stencil makes overlapping discs of one unit draw as a single union, no alpha stacking.
const auraMat = (color, ref, opacity) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, depthWrite: false,
  stencilWrite: true, stencilRef: ref, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
});
const moveMat = auraMat(GREEN, 1, 0.25);
const rangeMat = auraMat(WHITE, 2, 0.12);
const ringGeo = (r0, r1) => new THREE.RingGeometry(r0, r1, 48).rotateX(-Math.PI / 2);
const boltGeo = new THREE.SphereGeometry(0.005, 8, 8);
const boltMat = new THREE.MeshBasicMaterial({ color: YELLOW });

// ---------- state ----------
const units = [];
let sel = null, mode = 'place', pending = null;
const fx = [];

function newUnit() {
  const u = { name: `Unité ${units.length + 1}`, color: COLORS[units.length % COLORS.length], models: [], move: 6, range: 24, group: new THREE.Group(), aura: new THREE.Group() };
  u.group.add(u.aura);
  root.add(u.group);
  units.push(u);
  selectUnit(u);
  return u;
}

function selectUnit(u) {
  sel = u;
  $('move').value = u.move;
  $('range').value = u.range;
  refresh();
}

function addModel(u, p) {
  const r = Number($('base').value) / 2000; // diameter mm -> radius m
  const mesh = new THREE.Mesh(ringGeo(r - 0.002, r), new THREE.MeshBasicMaterial({ color: u.color }));
  const halo = new THREE.Mesh(ringGeo(r + 0.003, r + 0.006), new THREE.MeshBasicMaterial({ color: WHITE }));
  halo.visible = false;
  mesh.add(halo);
  mesh.position.set(p.x, p.y + 0.001, p.z);
  u.group.add(mesh);
  u.models.push({ x: p.x, y: p.y, z: p.z, r, mesh, halo, u });
}

function disposeTree(o) {
  o.traverse((c) => { c.geometry?.dispose(); if (c.material && c.material !== moveMat && c.material !== rangeMat) { c.material.map?.dispose(); c.material.dispose(); } });
  o.clear();
}

function refresh() {
  for (const u of units) {
    const bad = new Set(incoherent(u.models));
    for (const m of u.models) {
      m.mesh.material.color.setHex(bad.has(m) ? RED : u.color);
      // Rightful-Ruler style: highlight enemy models within the selected unit's weapon range
      m.halo.visible = !!sel && u !== sel && inRange(sel.models, m, sel.range);
    }
    disposeTree(u.aura);
  }
  if (sel) {
    rangeMat.color.setHex(sel.color);
    for (const m of sel.models) {
      for (const [R, mat, order] of [[m.r + sel.move * INCH, moveMat, 1], [m.r + sel.range * INCH, rangeMat, 2]]) {
        const d = new THREE.Mesh(new THREE.CircleGeometry(R, 64).rotateX(-Math.PI / 2), mat);
        d.position.set(m.x, m.y + 0.0005, m.z);
        d.renderOrder = order;
        sel.aura.add(d);
      }
    }
    const nBad = incoherent(sel.models).length;
    $('unitName').textContent = `${sel.name} (${sel.models.length})${nBad ? ' – cohésion !' : ''}`;
  } else $('unitName').textContent = '–';
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

function label(text, pos) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,.65)';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#fff';
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

function dot(p) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 8), new THREE.MeshBasicMaterial({ color: WHITE }));
  m.position.set(p.x, p.y + 0.003, p.z);
  notes.add(m);
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

// ---------- tap handlers (p = reticle hit in table-local real metres) ----------
const handlers = {
  place(p) {
    const m = pick(p);
    if (m) return selectUnit(m.u), status(`${m.u.name} sélectionnée`);
    addModel(sel ?? newUnit(), p);
    refresh();
    status(`${sel.name} : ${sel.models.length} figurine(s)`);
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
      return status(`Vise la nouvelle position (M ${m.u.move}")`);
    }
    const m = pending;
    pending = null;
    disposeTree(notes);
    const d = Math.hypot(p.x - m.x, p.z - m.z), over = toIn(d) > m.u.move + 1e-6;
    line({ ...m, r: 0 }, { ...p, r: 0 }, over ? RED : GREEN, fmt(d));
    Object.assign(m, { x: p.x, y: p.y, z: p.z });
    m.mesh.position.set(p.x, p.y + 0.001, p.z);
    refresh();
    status(over ? `TROP LOIN : ${fmt(d)} > M ${m.u.move}"` : `Déplacé de ${fmt(d)}`);
  },
  shoot(p) {
    if (!pending) {
      const m = pick(p);
      if (!m) return status('Vise un tireur');
      pending = m;
      selectUnit(m.u);
      return status(`Vise la cible (portée ${m.u.range}")`);
    }
    const a = pending, b = target(p), d = edgeDist(a, b), ok = toIn(d) <= a.u.range + 1e-6;
    pending = null;
    disposeTree(notes);
    line(a, b, ok ? YELLOW : RED, fmt(d));
    if (ok) fire(a, b);
    status(ok ? `Tir à ${fmt(d)}` : `Hors de portée : ${fmt(d)} > ${a.u.range}"`);
  },
  calib(p) {
    if (!pending) return disposeTree(notes), dot(p), (pending = p), status('Calibration : vise l\'autre bout de la règle');
    const d = Math.hypot(p.x - pending.x, p.z - pending.z), real = Number($('calibLen').value);
    pending = null;
    if (!(d > 0.01 && real > 0)) return status('Calibration annulée : points trop proches');
    k = newScale(d, k, real);
    try { localStorage.setItem('scale', k); } catch {}
    disposeTree(notes);
    setRoot(rootPose);
    status(`Calibré (facteur ${k.toFixed(3)}). Les figurines déjà posées peuvent avoir glissé.`);
  },
};

const HINTS = {
  place: 'Poser : vise un socle et tape. Taper une figurine existante sélectionne son unité.',
  measure: 'Mesurer : vise 2 points ou figurines (socle à socle).',
  move: 'Déplacer : vise la figurine, puis sa nouvelle position.',
  shoot: 'Tirer : vise le tireur, puis la cible.',
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
$('newUnit').onclick = () => (newUnit(), status(`${sel.name} créée : pose ses figurines`));
$('move').onchange = () => sel && ((sel.move = Number($('move').value) || 0), refresh());
$('range').onchange = () => sel && ((sel.range = Number($('range').value) || 0), refresh());
$('undo').onclick = () => {
  const m = sel?.models.pop();
  if (m) sel.group.remove(m.mesh), disposeTree(m.mesh), refresh();
};
$('clear').onclick = () => (disposeTree(notes), (pending = null));
for (const b of document.querySelectorAll('#modes button')) {
  b.onclick = () => {
    mode = b.dataset.mode;
    pending = null;
    for (const o of document.querySelectorAll('#modes button')) o.classList.toggle('on', o === b);
    $('calibLabel').hidden = mode !== 'calib';
    status(HINTS[mode]);
  };
}
// Taps on the controls must not also count as AR taps.
$('ui').addEventListener('beforexrselect', (e) => e.target.closest('#panel, #status') && e.preventDefault());

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
  session.addEventListener('end', () => { hitSource = null; $('ui').hidden = true; $('start').hidden = false; });
  $('start').hidden = true;
  $('ui').hidden = false;
  status('Conseil : commence par Calibrer avec une règle, puis Poser.');
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
