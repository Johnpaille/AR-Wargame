// Army list import: BattleBase PDF export (text lines) -> unit profiles. Pure, tested by armylist.test.mjs.
// Format (one datasheet per unit, as pdf.js gives it):
//   AZRAEL 150 PTS
//   Leading: Inner Circle Companions
//   Model M T SV W LD OC
//   1x Azrael 6" 5 2+/4++ 6 6+ 1
//   Weapon Range A WS/BS S AP D Abilities
//   1x Lion's Wrath 24" 2 2+ 8 -3 2 ANTI-INFANTRY 4+ | DEVASTATING
//   WOUNDS | RAPID FIRE 1                                  <- abilities wrap
//   1x The Sword of Secrets Melee 6 2+ 6 -4 2 DEVASTATING WOUNDS
//   Deadly Demise D3 | Damaged 4 | Combat Doctrines        <- unit abilities
//   CHAPTER MASTER, CHARACTER, ..., INFANTRY, TACTICUS     <- keywords
// A unit can have several "Model" blocks (sergeant, troopers), each with its own weapons: one profile per block.
// A GW-app text export without profiles gives units with names only (stats left to the defaults).

const UNIT = /^(.+?) (\d+) ?PTS$/;
const MODEL = /^(\d+)x (.+?) (\d+) ?" (\d+) (\d)\+(?:\/(\d)\+\+)? (\d+) (\d+)\+ (\d+|-)/;
// count, name, range (or Melee), A, WS/BS, S, AP, then D glued to the abilities ("D3+3TWIN-LINKED")
const WEAPON = /^(\d+)x (.+?) (?:(\d+) ?"|Melee) (\S+) (\d\+|-) (\d+) (-?\d+) (D?\d+(?:\+\d+)?) ?(.*)$/;
const KEYWORDS = /^([\w' -]+: )?[A-Z][A-Z0-9 '-]*(, [A-Z0-9][A-Z0-9 '-]*)+$/;
const CORE = /^[A-Z][A-Za-z' -]*( D?\d+\+?)?$/; // "Deep Strike", "Deadly Demise D3", "Damaged 4"

const title = (s) => s.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const abilities = (s) => s.split('|').map((a) => a.trim()).filter(Boolean);
const allCaps = (s) => !/[a-z]/.test(s.replace(/\bnon-/g, ''));

export function parseArmyList(text) {
  const units = [];
  let u = null, prof = null, section = '', carry = '', lastW = null;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/\s+/g, ' ').replace(/[“”″]/g, '"').trim();
    if (!line) continue;
    if (/^ARMY RULES$/.test(line)) break; // rules pages follow the datasheets
    const head = line.match(UNIT);
    if (head && head[1] === head[1].toUpperCase()) {
      u = { name: title(head[1]), pts: Number(head[2]), models: 0, move: 6, oc: 2, ld: 7, w: 1, type: 'inf',
        weapons: [], melee: [], profiles: [], keywords: [], abilities: [], damaged: 0, demise: '', attach: '' };
      units.push(u);
      section = carry = '';
      prof = lastW = null;
      continue;
    }
    if (!u) continue;
    const att = line.match(/^(Leading|Supporting): (.+)$/);
    if (att) { u.attach = title(att[2]); continue; }
    if (/^Model M T SV W LD OC/i.test(line)) { section = 'model'; carry = ''; continue; }
    if (/^Weapon Range/i.test(line)) { section = 'weapon'; carry = ''; continue; }
    if (section === 'model') {
      const m = line.match(MODEL);
      if (m) {
        prof = { name: m[2], count: Number(m[1]), move: Number(m[3]), t: Number(m[4]), sv: Number(m[5]), inv: Number(m[6]) || 0,
          w: Number(m[7]), ld: Number(m[8]), oc: m[9] === '-' ? 0 : Number(m[9]), weapons: [], melee: [] };
        u.profiles.push(prof);
        // first model block (sergeant / champion) sets the unit-level stats
        if (!u.models) Object.assign(u, { move: prof.move, w: prof.w, ld: prof.ld, oc: prof.oc });
        u.models += prof.count;
      }
      continue;
    }
    if (section === 'weapon') {
      // a long weapon name can wrap before its stats: "1x Macro Plasma Incinerator –" / "Supercharge" / "36" D3+3 ..."
      if (carry && (/^[\p{L} –-]+$/u.test(line) || /^\d+ ?"/.test(line))) line = `${carry} ${line}`;
      carry = '';
      if (/^\d+x /.test(line)) {
        const w = line.match(WEAPON);
        if (w) {
          const name = w[2].replace(/\s*–\s*/g, ' – ').trim(), melee = !w[3];
          const list = melee ? u.melee : u.weapons;
          lastW = list.find((x) => x.name === name);
          if (!lastW) {
            lastW = { name, range: melee ? 0 : Number(w[3]), a: w[4], skill: w[5] === '-' ? 0 : parseInt(w[5]), s: Number(w[6]), ap: Number(w[7]), d: w[8], abilities: abilities(w[9]), raw: w[9] };
            list.push(lastW);
          }
          if (prof && !prof[melee ? 'melee' : 'weapons'].includes(name)) prof[melee ? 'melee' : 'weapons'].push(name);
        } else carry = line; // wargear without a profile, or a name wrapping before its stats
        continue;
      }
      // the name's end alone below the stats line (pdf.js order): "Supercharge"
      if (lastW?.name.endsWith('–') && /^[\p{L} ]+$/u.test(line)) { lastW.name += ` ${line}`; continue; }
      // wrapped weapon abilities: "WOUNDS | RAPID FIRE 1", "TWIN-" + "LINKED", "non-MONSTER/VEHICLE"
      if (lastW && allCaps(line) && !line.includes(',')) {
        lastW.raw += (lastW.raw.endsWith('-') ? '' : ' ') + line; // keeps a trailing '|' / 'TWIN-'
        lastW.abilities = abilities(lastW.raw);
        continue;
      }
      section = '';
    }
    lastW = null;
    if (!line.includes(':') && line.split(' | ').every((p) => CORE.test(p) && /[a-z]/.test(p))) {
      for (const a of line.split(' | ')) {
        const dd = a.match(/^Deadly Demise (D?\d+)$/), dm = a.match(/^Damaged (\d+)$/);
        if (dd) u.demise = dd[1];
        else if (dm) u.damaged = Number(dm[1]);
        else if (!u.abilities.includes(a)) u.abilities.push(a);
      }
      continue;
    }
    if (KEYWORDS.test(line)) {
      section = '';
      for (const k of line.replace(/^[\w' -]+: /, '').split(', ')) if (!u.keywords.includes(k)) u.keywords.push(k);
      if (/\b(VEHICLE|MONSTER)\b/.test(line)) u.type = 'other';
    }
  }
  for (const x of units) {
    for (const w of [...x.weapons, ...x.melee]) delete w.raw;
    if (!x.weapons.length) x.weapons.push({ name: 'Arme 1', range: 24, abilities: [] });
  }
  return units;
}

// Weapon / unit ability lookup, e.g. has(weapon.abilities, 'RAPID FIRE') or has(unit.abilities, 'Deep Strike').
export const has = (list = [], name) => list.some((a) => a.toUpperCase().startsWith(name.toUpperCase()));

// Rebuild text lines from pdf.js text items ({ str, transform: [.., .., .., .., x, y] }), top to bottom.
export function linesFromItems(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str?.trim()) continue;
    const x = it.transform[4], y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) < 3);
    if (!row) rows.push((row = { y, parts: [] }));
    row.parts.push({ x, s: it.str });
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s.trim()).join(' ')).join('\n');
}

// Shot effect from the weapon name (works for imported and hand-typed weapons alike).
export function fxKind(name = '') {
  const n = name.toLowerCase();
  if (/melta|fuseur/.test(n)) return 'melta';
  if (/plasma/.test(n)) return 'plasma';
  if (/\blas|laser/.test(n)) return 'laser'; // \b: not the "las" in plasma or blast
  if (/flam|incinerat|pyre|torch/.test(n)) return 'flame';
  if (/missile|rocket|roquette|krak|frag|grenade|launcher|lance-/.test(n)) return 'missile';
  return 'bolt';
}
