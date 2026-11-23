// BattleBase live battle (read-only): public share link -> round, phase, VP, CP per player.
// Unofficial: the same GraphQL query the battlebase.app spectator page makes; scores are rebuilt from the
// event log like their client does (undo removes events from the log, so a plain sum is right).
// shortcut: no official API, if BattleBase changes its schema the banner just shows the error.

const VP = ['GAINED_PRIMARY_VICTORY_POINTS', 'GAINED_SECONDARY_VICTORY_POINTS', 'GAINED_GAMBIT_VICTORY_POINTS',
  'GAINED_SECRET_MISSION_VICTORY_POINTS', 'GAINED_CHALLENGER_CARD_MISSION_VICTORY_POINTS', 'GAINED_BONUS_VP_FOR_PAINTED_ARMY', 'ADJUSTED_VP'];
const PHASES = { STARTED_COMMAND_PHASE: 'Commandement', STARTED_MOVEMENT_PHASE: 'Mouvement', STARTED_SHOOTING_PHASE: 'Tir',
  STARTED_CHARGE_PHASE: 'Charge', STARTED_FIGHT_PHASE: 'Combat' };

export const battleId = (s = '') => s.match(/battles\/([0-9a-f-]{36})/i)?.[1] ?? null;

export async function fetchBattle(id) {
  const r = await fetch('https://www.battlebase.app/graphql', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'query($id: ID!){battle(id:$id){isFinished eventsJson battleSetupJson createdBy{id username} opponent{id username}}}', variables: { id } }),
  });
  const j = await r.json();
  if (!j.data?.battle) throw new Error(j.errors?.[0]?.message || `HTTP ${r.status}`);
  return j.data.battle;
}

// battle: { isFinished, eventsJson, createdBy: {id, username}, opponent: {id, username} }
export function battleState(b) {
  const ev = b.eventsJson || [];
  const players = [b.createdBy, b.opponent].map((p) => {
    let vp = 0, cp = 0;
    for (const e of ev) {
      if (e.actor !== p.id) continue;
      if (VP.includes(e.type)) vp += e.value ?? 0;
      else if (e.type === 'GAINED_COMMAND_POINT') cp += e.value ?? 1;
      else if (e.type === 'USED_COMMAND_POINTS') cp -= e.value || 0;
      else if (e.type === 'ADJUSTED_CP') cp += e.value ?? 0;
    }
    return { name: p.username, vp, cp };
  });
  let round = 0, turns = 0, active = null, phase = '';
  for (const e of ev) {
    if (e.type === 'STARTED_TURN') { turns++; round = e.data?.turnNumber || Math.ceil(turns / 2); active = e.actor; phase = ''; }
    else if (PHASES[e.type]) phase = PHASES[e.type];
  }
  const done = b.isFinished || ev.some((e) => e.type === 'FINISHED_GAME' || e.type === 'CONCEDED_BATTLE');
  const who = [b.createdBy, b.opponent].findIndex((p) => p.id === active);
  // turn: player turn count, like the app's T counter (the player who goes first is J1)
  const dep = b.battleSetupJson?.missionSelection?.deploymentId ?? '';
  const deployment = dep.replace(/^deployment-(chapter-approved-[\d-]+-|pariah-nexus-)?/, '').replace(/-\d{4}-\d{2}$/, '')
    .split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  return { round, turn: turns, phase, active: who, done, players, deployment };
}

export function battleText(s) {
  const [a, c] = s.players;
  const head = s.done ? 'Fin' : `R${s.round}${s.phase ? ` ${s.phase}` : ''}${s.active >= 0 ? ` (${s.players[s.active].name})` : ''}`;
  return `BB · ${head} · ${a.name} ${a.vp}PV ${a.cp}PC | ${c.name} ${c.vp}PV ${c.cp}PC${s.deployment ? ` · ${s.deployment}` : ''}`;
}
