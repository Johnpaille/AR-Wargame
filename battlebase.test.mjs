// node battlebase.test.mjs
import assert from 'node:assert/strict';
import { battleId, battleState, battleText } from './battlebase.js';

assert.equal(battleId('https://www.battlebase.app/battles/abdd0843-0d29-494a-bf36-7daeca824260?x=1'), 'abdd0843-0d29-494a-bf36-7daeca824260');
assert.equal(battleId('https://www.battlebase.app/'), null);

const A = { id: 'a', username: 'p1' }, B = { id: 'b', username: 'p2' };
const ev = (type, actor, value, data) => ({ type, actor, value, data });
const b = { createdBy: A, opponent: B, isFinished: false, eventsJson: [
  ev('GAINED_BONUS_VP_FOR_PAINTED_ARMY', 'a', 10), ev('GAINED_BONUS_VP_FOR_PAINTED_ARMY', 'b', 10),
  ev('STARTED_TURN', 'a', undefined, { turnNumber: 1 }), ev('STARTED_COMMAND_PHASE', 'a'),
  ev('GAINED_COMMAND_POINT', 'a'), ev('GAINED_COMMAND_POINT', 'b'),
  ev('STARTED_MOVEMENT_PHASE', 'a'), ev('USED_COMMAND_POINTS', 'a', 1), ev('ADJUSTED_CP', 'b', 2),
  ev('GAINED_PRIMARY_VICTORY_POINTS', 'a', 5), ev('ADJUSTED_VP', 'b', -3),
  ev('STARTED_TURN', 'b', undefined, { turnNumber: 1 }), ev('STARTED_COMMAND_PHASE', 'b'),
] };
const s = battleState(b);
assert.deepEqual(s.players, [{ name: 'p1', vp: 15, cp: 0 }, { name: 'p2', vp: 7, cp: 3 }]);
assert.equal(s.round, 1);
assert.equal(s.phase, 'Commandement');
assert.equal(s.active, 1);
assert.equal(battleText(s), 'BB · R1 Commandement (p2) · p1 15PV 0PC | p2 7PV 3PC');

// no turnNumber: round from the turn count; finished game
b.eventsJson.push(ev('STARTED_TURN', 'a'), ev('FINISHED_GAME', 'a'));
const f = battleState(b);
assert.equal(f.round, 2);
assert.ok(f.done);
assert.ok(battleText(f).startsWith('BB · Fin ·'));
console.log('battlebase ok');
