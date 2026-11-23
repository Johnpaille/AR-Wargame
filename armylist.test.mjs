// node armylist.test.mjs
import assert from 'node:assert/strict';
import { parseArmyList, linesFromItems, fxKind } from './armylist.js';

// Excerpt of a BattleBase PDF export, as pdf.js text lines.
const TEXT = `PRINTED WITH BATTLEBASE
2000/2000 points (Strike Force)
ATTACHED UNITS 2
AZRAEL 150 PTS
Warlord
Model M T SV W LD OC
1x Azrael 6" 5 2+/4++ 6 6+ 1
Weapon Range A WS/BS S AP D Abilities
1x Lion's Wrath 24" 2 2+ 8 -3 2 ANTI-INFANTRY 4+ | DEVASTATING
WOUNDS | RAPID FIRE 1
1x The Sword of Secrets Melee 6 2+ 6 -4 2 DEVASTATING WOUNDS
1x The Lion Helm
Leader | Transhuman Strategist | Combat Doctrines
Masterful Tactician: In your Movement phase, select up to one visible friendly Adeptus Astartes unit within 9" of this
CHAPTER MASTER, CHARACTER, DEATHWING, EPIC HERO, EXPLOSIVES, IMPERIUM, INFANTRY, TACTICUS
INTERCESSOR SQUAD 85 PTS
Model M T SV W LD OC
1x Intercessor Sergeant 6" 5 3+ 2 6+ 2
Weapon Range A WS/BS S AP D Abilities
1x Bolt Pistol 12" 1 3+ 5 -1 1 CLOSE-QUARTERS
1x Bolt Rifle – Focused Fire 24" 1 3+ 6 -1 2 HEAVY | RAPID FIRE 1
1x Power Fist Melee 3 3+ 8 -2 2
Model M T SV W LD OC
4x Intercessor 6" 5 3+ 2 6+ 2
Weapon Range A WS/BS S AP D Abilities
4x Bolt Pistol 12" 1 3+ 5 -1 1 CLOSE-QUARTERS
1x Grenade Launcher – Krak 24" 1 3+ 10 -2 3 RAPID FIRE 1
Intercessor: BATTLELINE, EXPLOSIVES, IMPERIUM, INFANTRY, TACTICUS
REDEMPTOR DREADNOUGHT 220 PTS
Model M T SV W LD OC
1x Redemptor Dreadnought 8" 10 2+ 12 6+ 4
Weapon Range A WS/BS S AP D Abilities
1x Heavy Flamer 12" 3 - 5 -1 1 BLAST 2 | TORRENT
1x Macro Plasma Incinerator –
Supercharge
36" D3+3 3+ 10 -4 3 BLAST 1 | HAZARDOUS
1x Grav-pistol 12" 2 2+ 2 -1 3 ANTI-VEHICLE 2+ | CLOSE-QUARTERS
1x Redemptor Fist Melee 5 3+ 12 -3 D3+3
Duty Eternal: Attacks that target this unit with a S greater than this unit's T have -1 to wound rolls.
DREADNOUGHT, IMPERIUM, VEHICLE, WALKER
ARMY RULES
FAKE UNIT 10 PTS`;

const [az, isq, red, ...rest] = parseArmyList(TEXT);
assert.equal(rest.length, 0, 'stops at ARMY RULES');
assert.deepEqual({ ...az, weapons: undefined }, { name: 'Azrael', pts: 150, models: 1, move: 6, oc: 1, ld: 6, w: 6, type: 'inf', weapons: undefined });
assert.deepEqual(az.weapons, [{ name: 'Lion\'s Wrath', range: 24 }], 'melee and wargear skipped, no "9\\"" false hit');
assert.equal(isq.models, 5);
assert.equal(isq.w, 2);
assert.deepEqual(isq.weapons.map((w) => w.name), ['Bolt Pistol', 'Bolt Rifle – Focused Fire', 'Grenade Launcher – Krak'], 'deduped across model lines');
assert.equal(red.type, 'other');
assert.equal(red.move, 8);
assert.deepEqual(red.weapons, [
  { name: 'Heavy Flamer', range: 12 },
  { name: 'Macro Plasma Incinerator – Supercharge', range: 36 },
  { name: 'Grav-pistol', range: 12 },
]);
assert.deepEqual(parseArmyList('nothing here'), []);
// wrapped the other way (as pdf.js gives it): stats on the first line, end of the name below
assert.deepEqual(parseArmyList(`X 1 PTS\nWeapon Range A\n1x Macro Plasma Incinerator – 36" D3+3 3+ 10 -4 3 BLAST 1\nSupercharge\n1x Storm Bolters 24" 4 3+ 5 -1 1`).at(0).weapons.map((w) => w.name),
  ['Macro Plasma Incinerator – Supercharge', 'Storm Bolters']);

// pdf.js items: same baseline -> one line, left to right; top of page first
assert.equal(linesFromItems([
  { str: '6"', transform: [1, 0, 0, 1, 300, 700.5] },
  { str: '1x Azrael', transform: [1, 0, 0, 1, 50, 700] },
  { str: 'AZRAEL 150 PTS', transform: [1, 0, 0, 1, 50, 720] },
  { str: ' ', transform: [1, 0, 0, 1, 80, 600] },
]), 'AZRAEL 150 PTS\n1x Azrael 6"');

assert.equal(fxKind('Godhammer Lascannon'), 'laser');
assert.equal(fxKind('Multi-melta'), 'melta');
assert.equal(fxKind('Macro Plasma Incinerator – Standard'), 'plasma');
assert.equal(fxKind('Heavy Flamer'), 'flame');
assert.equal(fxKind('Ballistus Missile Launcher – Krak'), 'missile');
assert.equal(fxKind('Bolt Rifle'), 'bolt');
console.log('armylist ok');
