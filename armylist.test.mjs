// node armylist.test.mjs
import assert from 'node:assert/strict';
import { parseArmyList, linesFromItems, fxKind, has } from './armylist.js';

// Excerpt of a BattleBase PDF export, as pdf.js text lines (linesFromItems).
const TEXT = `PRINTED WITH BATTLEBASE
2000/2000 points (Strike Force)
ATTACHED UNITS 2
AZRAEL 150 PTS
Warlord
Leading: Inner Circle Companions
Model M T SV W LD OC
1x Azrael 6" 5 2+/4++ 6 6+ 1
Weapon Range A WS/BS S AP D Abilities
1x Lion's Wrath 24" 2 2+ 8 -3 2 ANTI-INFANTRY 4+ | DEVASTATING
WOUNDS | RAPID FIRE 1
1x The Sword of Secrets Melee 6 2+ 6 -4 2 DEVASTATING WOUNDS
1x The Lion Helm
Leader | Transhuman Strategist | Combat Doctrines
Masterful Tactician: In your Movement phase, select up to one visible friendly Adeptus Astartes unit within 9" of this
Leader : This model can be attached to the following units:
CHAPTER MASTER, CHARACTER, DEATHWING, EPIC HERO, EXPLOSIVES, IMPERIUM, INFANTRY, TACTICUS
INTERCESSOR SQUAD 85 PTS
Support: Ancient
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
4x Bolt Rifle – Focused Fire 24" 1 3+ 6 -1 2 HEAVY | RAPID FIRE 1
1x Grenade Launcher – Krak 24" 1 3+ 10 -2 3 RAPID FIRE 1
4x Knives and Fists Melee 3 3+ 5 0 1
Combat Doctrines
Intercessor: BATTLELINE, EXPLOSIVES, IMPERIUM, INFANTRY, TACTICUS
Intercessor Sergeant: BATTLELINE, EXPLOSIVES, IMPERIUM, INFANTRY, TACTICUS
BRUTALIS DREADNOUGHT 200 PTS
Model M T SV W LD OC
1x Brutalis Dreadnought 10" 10 2+ 12 6+ 4
Weapon Range A WS/BS S AP D Abilities
1x Twin Heavy Bolter 36" 3 3+ 5 -1 2 RAPID FIRE 2 | SUSTAINED HITS 1 |
TWIN-LINKED
1x Twin Icarus Ironhail Heavy Stubber 36" 3 3+ 4 -1 1 ANTI-FLY 3+ | RAPID FIRE 3 | TWIN-
LINKED
1x Heavy Flamer 12" 3 - 5 -1 1 BLAST 2 | TORRENT
1x Macro Plasma Incinerator – 36" D3+3 3+ 10 -4 3 BLAST 1 | HAZARDOUS
Supercharge
1x Multi-melta 18" 2 3+ 10 -3 D3+2 MELTA 3
1x Onslaught Gatling Cannon 24" 8 3+ 5 -1 1 DEVASTATING WOUNDS: non-
MONSTER/VEHICLE
1x Brutalis Fists Melee 6 3+ 12 -3 D3+3 TWIN-LINKED
Enhancement: Artificer Sarcophagus
Deadly Demise D3 | Damaged 4 | Combat Doctrines
Brutalis Charge (Once per phase, per unit): You can target this unit with the Crushing Impact stratagem, regardless of
DREADNOUGHT, IMPERIUM, VEHICLE, WALKER
INCEPTOR SQUAD 130 PTS
Model M T SV W LD OC
2x Inceptor 10" 6 3+ 3 6+ -
Weapon Range A WS/BS S AP D Abilities
2x Assault Bolters 18" 3 3+ 5 -1 2 ASSAULT | CLOSE-QUARTERS |
SUSTAINED HITS 2 | TWIN-LINKED
Deep Strike | Combat Doctrines
Inceptor: FLY, GRAVIS, IMPERIUM, INFANTRY, JUMP PACK
ARMY RULES
FAKE UNIT 10 PTS`;

const [az, isq, bru, inc, ...rest] = parseArmyList(TEXT);
assert.equal(rest.length, 0, 'stops at ARMY RULES');

// Azrael: profile, invulnerable save, attachment, wrapped abilities, wargear and rules text ignored
assert.equal(az.name, 'Azrael');
assert.equal(az.attach, 'Inner Circle Companions');
assert.deepEqual(az.profiles, [{ name: 'Azrael', count: 1, move: 6, t: 5, sv: 2, inv: 4, w: 6, ld: 6, oc: 1, weapons: ['Lion\'s Wrath'], melee: ['The Sword of Secrets'] }]);
assert.deepEqual(az.weapons, [{ name: 'Lion\'s Wrath', range: 24, a: '2', skill: 2, s: 8, ap: -3, d: '2', abilities: ['ANTI-INFANTRY 4+', 'DEVASTATING WOUNDS', 'RAPID FIRE 1'] }]);
assert.equal(az.melee[0].range, 0);
assert.deepEqual(az.abilities, ['Warlord', 'Leader', 'Transhuman Strategist', 'Combat Doctrines']);
assert.ok(az.keywords.includes('CHARACTER') && az.keywords.includes('INFANTRY'));
assert.equal(az.type, 'inf');

// Intercessors: two profiles, weapons per profile, deduped unit weapon list
assert.equal(isq.models, 5);
assert.equal(isq.attach, '', '"Support: Ancient" is the bodyguard side, only the character carries the link');
assert.deepEqual(isq.profiles.map((p) => [p.name, p.count, p.w, p.weapons]), [
  ['Intercessor Sergeant', 1, 2, ['Bolt Pistol', 'Bolt Rifle – Focused Fire']],
  ['Intercessor', 4, 2, ['Bolt Pistol', 'Bolt Rifle – Focused Fire', 'Grenade Launcher – Krak']],
]);
assert.deepEqual(isq.weapons.map((w) => w.name), ['Bolt Pistol', 'Bolt Rifle – Focused Fire', 'Grenade Launcher – Krak']);
assert.ok(isq.keywords.includes('BATTLELINE'));

// Brutalis: vehicle, Damaged / Deadly Demise, wrapped abilities and names, torrent (no BS)
assert.equal(bru.type, 'other');
assert.equal(bru.damaged, 4);
assert.equal(bru.demise, 'D3');
assert.deepEqual(bru.abilities, ['Combat Doctrines']);
const w = Object.fromEntries(bru.weapons.map((x) => [x.name, x]));
assert.deepEqual(w['Twin Heavy Bolter'].abilities, ['RAPID FIRE 2', 'SUSTAINED HITS 1', 'TWIN-LINKED']);
assert.deepEqual(w['Twin Icarus Ironhail Heavy Stubber'].abilities, ['ANTI-FLY 3+', 'RAPID FIRE 3', 'TWIN-LINKED']);
assert.equal(w['Heavy Flamer'].skill, 0);
assert.ok(has(w['Heavy Flamer'].abilities, 'TORRENT'));
assert.equal(w['Macro Plasma Incinerator – Supercharge'].d, '3');
assert.deepEqual(w['Multi-melta'].abilities, ['MELTA 3']);
assert.equal(w['Multi-melta'].d, 'D3+2');
assert.deepEqual(w['Onslaught Gatling Cannon'].abilities, ['DEVASTATING WOUNDS: non-MONSTER/VEHICLE']);
assert.deepEqual(bru.melee[0].abilities, ['TWIN-LINKED']);

// Inceptors: OC '-', Deep Strike, three-line abilities
assert.equal(inc.oc, 0);
assert.ok(has(inc.abilities, 'Deep Strike'));
assert.deepEqual(inc.weapons[0].abilities, ['ASSAULT', 'CLOSE-QUARTERS', 'SUSTAINED HITS 2', 'TWIN-LINKED']);

assert.deepEqual(parseArmyList('nothing here'), []);
// name wrapping before its stats (other PDF readers)
assert.deepEqual(parseArmyList(`X 1 PTS\nWeapon Range A\n1x Macro Plasma Incinerator –\nSupercharge\n36" D3+3 3+ 10 -4 3 BLAST 1`)[0].weapons.map((x) => x.name),
  ['Macro Plasma Incinerator – Supercharge']);

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
