// Army list import: BattleBase PDF export (text lines) -> unit profiles. Pure, tested by armylist.test.mjs.
// Format (one datasheet per unit):
//   AZRAEL 150 PTS
//   Model M T SV W LD OC
//   1x Azrael 6" 5 2+/4++ 6 6+ 1
//   Weapon Range A WS/BS S AP D Abilities
//   1x Lion's Wrath 24" 2 2+ 8 -3 2 ANTI-INFANTRY 4+ | ...
//   1x The Sword of Secrets Melee 6 2+ 6 -4 2 ...
//   CHAPTER MASTER, CHARACTER, ..., INFANTRY, TACTICUS
// A GW-app text export without profiles gives units with names only (stats left to the defaults).

const UNIT = /^(.+?) (\d+) ?PTS$/;
const MODEL = /^(\d+)x (.+?) (\d+) ?" (\d+) (\S+) (\d+) (\d+)\+ (\d+|-)/;
const RANGED = /^(\d+)x (.+?) (\d+) ?" (\S+) (\d\+|-) /; // range, A, then WS/BS: not a 9" inside rules text
const KEYWORDS = /^([\w' -]+: )?[A-Z][A-Z0-9 '-]*(, [A-Z0-9][A-Z0-9 '-]*)+$/;

const title = (s) => s.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

export function parseArmyList(text) {
  const units = [];
  let u = null, section = '', carry = '';
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/\s+/g, ' ').replace(/[“”″]/g, '"').trim();
    if (!line) continue;
    if (/^ARMY RULES$/.test(line)) break; // rules pages follow the datasheets
    const head = line.match(UNIT);
    if (head && head[1] === head[1].toUpperCase()) {
      u = { name: title(head[1]), pts: Number(head[2]), models: 0, move: 6, oc: 2, ld: 7, w: 1, type: 'inf', weapons: [] };
      units.push(u);
      section = carry = '';
      continue;
    }
    if (!u) continue;
    if (/^Model M T SV W LD OC/i.test(line)) { section = 'model'; carry = ''; continue; }
    if (/^Weapon Range/i.test(line)) { section = 'weapon'; carry = ''; continue; }
    if (section === 'model') {
      const m = line.match(MODEL);
      if (m) {
        // first model line (sergeant / champion) sets the unit's profile
        if (!u.models) Object.assign(u, { move: Number(m[3]), w: Number(m[6]), ld: Number(m[7]), oc: m[8] === '-' ? 0 : Number(m[8]) });
        u.models += Number(m[1]);
      }
      continue;
    }
    if (section === 'weapon') {
      // a long weapon name can wrap: "1x Macro Plasma Incinerator –" / "Supercharge" / "36" D3+3 ..."
      if (carry) line = `${carry} ${line}`;
      if (/^\d+x /.test(line) && !/ Melee /.test(line + ' ')) {
        const w = line.match(RANGED);
        if (w) {
          const name = w[2].replace(/\s*–\s*/g, ' – ').trim();
          if (!u.weapons.some((x) => x.name === name)) u.weapons.push({ name, range: Number(w[3]) });
          carry = '';
        } else carry = line.split(' ').length > 12 ? '' : line; // give up on runaway joins
        continue;
      }
      carry = '';
      // pdf.js can also put the stats on the first name line and the name's end alone on the next one
      const last = u.weapons.at(-1);
      if (last?.name.endsWith('–') && /^[\p{L} ]+$/u.test(line)) { last.name += ` ${line}`; continue; }
    }
    if (KEYWORDS.test(line)) {
      section = '';
      if (/\b(VEHICLE|MONSTER)\b/.test(line)) u.type = 'other';
    }
  }
  for (const x of units) if (!x.weapons.length) x.weapons.push({ name: 'Arme 1', range: 24 });
  return units;
}

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
