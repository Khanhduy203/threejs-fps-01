// The one place match state lives. Systems read and write this object; nobody keeps a
// second copy of the score, the timer or the bomb. Entity state (positions, health)
// lives with the entity modules, and this file only names the shared match facts.
export const TEAMS = { STRIKE: 0, WARDEN: 1 };
export const TEAM_NAME = ['STRIKE', 'WARDEN'];

// Match shape: first to 5 rounds, at most 9 rounds (5-4 is the longest match).
export const MATCH = {
  winsToTake: 5,
  maxRounds: 9,
  roundTime: 100, // seconds of live play before the defenders win on time
  buyTime: 15, // seconds frozen at the round start, buy menu open
  bombTime: 30, // seconds from plant to explosion
  plantTime: 3.5,
  defuseTime: 5.0,
  roundEndPause: 4.0, // seconds the round banner shows before the next round
};

export const ECONOMY = {
  startMoney: 800,
  killReward: 300,
  winReward: 3000,
  lossReward: 1900,
  lossStreakBonus: 500, // per consecutive loss, up to 3 streaks
  maxMoney: 16000,
};

export function createState() {
  return {
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    round: 1,
    score: [0, 0],
    timer: 0, // counts down in buy and live; the bomb timer once planted
    roundEndAt: 0, // elapsed time when the roundEnd pause finishes
    money: ECONOMY.startMoney,
    lossStreak: 0,
    kills: 0,
    deaths: 0,
    // The bomb: carried by the player at round start, dropped on death, planted at a
    // site, then either explodes or is defused. One bomb, one lifecycle.
    bomb: {
      state: 'carried', // carried | dropped | planted | exploded | defused
      carrier: 'player', // 'player' | bot id | null
      site: null, // 'A' | 'B' once planted
      x: 0,
      z: 0,
      plantProgress: 0, // 0..1 while someone holds the plant
      defuseProgress: 0, // 0..1 while a defender holds the defuse
      plantedBy: null,
    },
    roundWinner: null, // 0 | 1 once the round is decided
    roundReason: '', // 'elimination' | 'bomb' | 'defused' | 'time'
    matchWinner: null,
    elapsed: 0, // total live seconds, for the HUD clock and bot timers
    freeze: true, // no movement while the buy phase runs
    announcements: [], // { text, sub, at } centre-screen banners, newest last
    announceSeq: 0, // increments on every announcement, so the HUD never misses one
    feed: [], // kill feed entries { text, at, good }, newest last
    feedSeq: 0,
    spotted: new Map(), // enemy bot id -> elapsed time last seen (minimap + callouts)
    shotsHeard: [], // { x, z, at, team } gunfire, bots within earshot investigate
  };
}

export function resetMatch(state) {
  state.phase = 'buy';
  state.round = 1;
  state.score = [0, 0];
  state.money = ECONOMY.startMoney;
  state.lossStreak = 0;
  state.kills = 0;
  state.deaths = 0;
  state.matchWinner = null;
  state.roundWinner = null;
  state.roundReason = '';
  state.feed = [];
  state.announcements = [];
  state.spotted.clear();
  resetRound(state);
}

export function resetRound(state) {
  state.phase = 'buy';
  state.timer = MATCH.buyTime;
  state.freeze = true;
  state.roundWinner = null;
  state.roundReason = '';
  state.bomb.state = 'carried';
  state.bomb.carrier = 'player';
  state.bomb.site = null;
  state.bomb.plantProgress = 0;
  state.bomb.defuseProgress = 0;
  state.bomb.plantedBy = null;
  state.spotted.clear();
  state.shotsHeard = [];
}

export function announce(state, text, sub = '') {
  state.announcements.push({ text, sub, at: state.elapsed });
  state.announceSeq += 1;
  if (state.announcements.length > 4) state.announcements.shift();
}

export function feed(state, text, good) {
  state.feed.push({ text, good: !!good, at: state.elapsed });
  state.feedSeq += 1;
  if (state.feed.length > 5) state.feed.shift();
}
