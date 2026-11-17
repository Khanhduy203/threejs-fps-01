// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. main.js owns the wiring — the round state machine, the
// player's trigger, the buy flow, the pause — and nothing else; every system
// lives in its own module.
// ?shot=start|play|buy|end with &seed=N stages a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createState, resetMatch, resetRound, announce, feed, MATCH, TEAMS, TEAM_NAME } from './state.js';
import { createWorld, SITES, SPAWNS } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons } from './weapons.js';
import { createBots } from './bots.js';
import { createCombat } from './combat.js';
import { createBomb } from './bomb.js';
import { createEconomy, SHOP } from './economy.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const STEP = 1 / 60;
const query = new URLSearchParams(window.location.search);
const shot = query.get('shot');
const seed = Number.parseInt(query.get('seed') ?? '1', 10) || 1;
const random = mulberry32(shot ? seed : (Date.now() % 2147483647) || 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 85);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const state = createState();
const world = createWorld(scene);
const audio = createAudio();
const player = createPlayer(world.colliders);
const weapons = createWeapons(camera);
const bots = createBots(scene, world, random);
const combat = createCombat(scene, world, random, audio);
const bomb = createBomb(scene, audio);
const economy = createEconomy(state, weapons, player);
const shootables = world.shootables.concat(bots.hitMeshes);
const body = player.state;

let shopOpen = false;
let paused = false;
let frozen = false;
let started = false;
let wasFiring = false;
let tremorTime = 0;
let tremorAmp = 0;
let mapClock = 0;
let seenAnnounce = 0;
let seenFeed = 0;
let accumulator = 0;
let lastTime = performance.now();

const rayDir = new THREE.Vector3();
const aimSpot = new THREE.Vector3();
const lookMove = { x: 0, y: 0 };
// The teammate panel rebuilds only when a health or alive flag actually
// changes; the comparison is six numbers, so the frame loop allocates
// nothing for it.
const mates = bots.list.filter((b) => b.team === TEAMS.STRIKE);
let lastHp0 = -1;
let lastHp1 = -1;
let lastHp2 = -1;
let lastLive0 = false;
let lastLive1 = false;
let lastLive2 = false;
let shopKey = '';

const hud = createHud({
  onPlay() {
    audio.unlock();
    audio.click();
    if (state.phase === 'menu' || state.phase === 'matchEnd') startMatch();
    else input.requestLock();
  },
  onBuy(id) {
    const result = economy.buy(id);
    if (result.ok) audio.buy();
    else audio.denied();
    hud.setBuyNote(result.reason);
    refreshShop();
    syncHud();
  },
  onDeploy() {
    audio.unlock();
    audio.click();
    closeShop();
    input.requestLock();
  },
});

const input = createInput(renderer.domElement, onLockChange);

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    paused = false;
    hud.hideOverlay();
  } else if (state.phase === 'live') {
    paused = true;
    hud.showOverlay('paused');
  } else if (state.phase === 'buy') {
    openShop();
  }
}

function openShop() {
  if (state.phase !== 'buy') return;
  // The menu is clicked with a free mouse: release the pointer lock first,
  // or it stays held over from the previous round and the menu cannot be used.
  input.releaseLock();
  shopOpen = true;
  hud.showBuy(true);
  refreshShop();
}

function closeShop() {
  shopOpen = false;
  hud.showBuy(false);
}

function refreshShop() {
  shopKey = `${state.money}|${weapons.state.grenades}|${body.armour}|${weapons.state.owned.length}`;
  hud.refreshBuy(
    state.money,
    weapons.state.owned.map((slot) => slot.def.id),
    weapons.state.grenades,
    body.armour,
  );
}

// ---- match / round flow -------------------------------------------------

const ROUND_END_COPY = {
  elimination: (won) => (won ? 'Enemy team eliminated' : 'Your team was eliminated'),
  bomb: () => 'The bomb exploded',
  defused: () => 'The bomb was defused',
  time: () => 'Time expired — the defence holds',
};

function startMatch() {
  resetMatch(state);
  startRound();
}

function startRound() {
  resetRound(state);
  economy.restoreLoadout();
  const spawn = SPAWNS.strike[0];
  player.reset(spawn[0], spawn[1], 0);
  bots.resetRound(state.round);
  combat.reset();
  bomb.reset();
  tremorTime = 0;
  wasFiring = false;
  hud.setDead(false);
  closeShop();
  hud.hideOverlay();
  announce(state, `ROUND ${state.round}`, state.round === 1 ? 'Plant the bomb at A or B' : `First to ${MATCH.winsToTake} rounds`);
  if (!shot) openShop();
}

function startLive() {
  state.phase = 'live';
  state.timer = MATCH.roundTime;
  state.freeze = false;
  closeShop();
  hud.setHint('');
  if (!shot && !input.state.locked) {
    paused = true;
    hud.showOverlay('paused');
  }
}

function endRound(winner, reason) {
  if (state.phase !== 'live') return;
  state.phase = 'roundEnd';
  state.roundWinner = winner;
  state.roundReason = reason;
  state.score[winner] += 1;
  state.roundEndAt = state.elapsed + MATCH.roundEndPause;
  economy.roundReward(winner);
  economy.keepLoadout();
  if (!player.state.alive) weapons.dropToPistol();
  const won = winner === TEAMS.STRIKE;
  announce(state, `${TEAM_NAME[winner]} WINS THE ROUND`, ROUND_END_COPY[reason](won));
  if (won) audio.roundWin();
  else audio.roundLose();
}

function finishMatch() {
  state.phase = 'matchEnd';
  state.matchWinner = state.score[0] > state.score[1] ? 0 : 1;
  const won = state.matchWinner === TEAMS.STRIKE;
  input.releaseLock();
  hud.showOverlay('matchEnd', {
    title: won ? 'STRIKE TAKES DEPOT 9' : 'WARDEN HOLDS DEPOT 9',
    copy: `Final score ${state.score[0]}–${state.score[1]}. You scored ${state.kills} kills and fell ${state.deaths} times.`,
  });
}

function strikeAlive() {
  return (body.alive ? 1 : 0) + bots.aliveCount(TEAMS.STRIKE);
}

function wardenAlive() {
  return bots.aliveCount(TEAMS.WARDEN);
}

function checkRoundEnd() {
  if (state.phase !== 'live') return;
  const planted = state.bomb.state === 'planted';
  if (state.timer <= 0) {
    if (planted) {
      detonateBomb();
      endRound(TEAMS.STRIKE, 'bomb');
    } else {
      endRound(TEAMS.WARDEN, 'time');
    }
    return;
  }
  const s = strikeAlive();
  const w = wardenAlive();
  if (w === 0) {
    endRound(TEAMS.STRIKE, 'elimination');
    return;
  }
  // With the bomb planted and no attackers left, the round plays on: the
  // defence must still defuse before the timer runs out.
  if (s === 0 && !planted) endRound(TEAMS.WARDEN, 'elimination');
}

function detonateBomb() {
  state.bomb.state = 'exploded';
  bomb.detonate();
  aimSpot.set(state.bomb.x, 0.5, state.bomb.z);
  combat.explosion(aimSpot);
  const dist = Math.hypot(state.bomb.x - body.position.x, state.bomb.z - body.position.z);
  audio.explosion(dist);
  if (dist < 14) {
    tremorTime = 0.6;
    tremorAmp = 0.05 * (1 - dist / 14);
  }
}

// ---- damage and death ----------------------------------------------------

function dropBombAt(x, z) {
  state.bomb.state = 'dropped';
  state.bomb.carrier = null;
  state.bomb.x = x;
  state.bomb.z = z;
  bomb.dropAt(x, z);
}

function onPlayerDeath(killerName) {
  state.deaths += 1;
  feed(state, `${killerName} ▸ YOU`, false);
  if (state.bomb.state === 'carried' && state.bomb.carrier === 'player') {
    dropBombAt(body.position.x, body.position.z);
  }
  const spectator = bots.list.find((b) => b.team === TEAMS.STRIKE && b.alive);
  hud.setDead(true, spectator ? spectator.name : 'nobody');
}

function onBotDeath(bot, killer, part) {
  const killerName = killer === 'player' ? 'YOU' : killer.name;
  const good = bot.team === TEAMS.WARDEN;
  const suffix = part === 'head' ? ' · HEADSHOT' : part === 'blast' ? ' · FRAG' : '';
  feed(state, `${killerName} ▸ ${bot.name}${suffix}`, good);
  if (killer === 'player') {
    state.kills += 1;
    economy.killReward();
  }
  // Only a carried bomb drops; a planted bomb stays in the ground.
  if (state.bomb.state === 'carried' && (bot.hasBomb || state.bomb.carrier === bot.id)) {
    bot.hasBomb = false;
    dropBombAt(bot.position.x, bot.position.z);
  }
}

// One damage entry point for grenades and bot bullets alike.
function damageTarget(target, amount, part, attacker) {
  if (target === 'player') {
    if (!body.alive) return;
    if (shot) return; // staged frames keep the player standing
    player.damage(amount);
    audio.hurt();
    const from = attacker === 'player' ? null : attacker.position;
    if (from) {
      const angle = Math.atan2(-(from.x - body.position.x), -(from.z - body.position.z)) - body.yaw;
      hud.damageFrom(angle);
    } else {
      hud.damageFrom(0);
    }
    if (!body.alive) onPlayerDeath(attacker === 'player' ? 'YOUR GRENADE' : attacker.name);
    return;
  }
  const killed = bots.damage(target, amount);
  if (attacker && attacker !== 'player') bots.alert(target, attacker.position.x, attacker.position.z);
  if (killed) onBotDeath(target, attacker, part);
}

// ---- shooting -------------------------------------------------------------

function shootBot(bot, target) {
  const result = combat.botShoot(bot, target, botCtx);
  const dist = Math.hypot(bot.position.x - body.position.x, bot.position.z - body.position.z);
  audio.shot('rifle', dist);
  state.shotsHeard.push({ x: bot.position.x, z: bot.position.z, at: state.elapsed, team: bot.team });
  if (!result) return;
  if (result.target.kind === 'player') {
    damageTarget('player', result.amount, result.part, bot);
  } else {
    damageTarget(result.target.bot, result.amount, result.part, bot);
  }
}

const botCtx = {
  get playerPos() {
    return body.position;
  },
  get playerAlive() {
    return body.alive;
  },
  get playerCrouching() {
    return body.crouching;
  },
  get playerSpeed() {
    return player.groundSpeed();
  },
  get elapsed() {
    return state.elapsed;
  },
  get freeze() {
    return state.freeze;
  },
  state,
  shootBot,
  onBombPickup(bot) {
    feed(state, `${bot.name} picked up the bomb`, true);
  },
};

const combatCtx = {
  get playerPos() {
    return body.position;
  },
  get playerAlive() {
    return body.alive;
  },
  get bots() {
    return bots.list;
  },
  damageTarget,
  onExplosion(point, playerDist) {
    if (playerDist < 10) {
      tremorTime = 0.4;
      tremorAmp = 0.04 * (1 - playerDist / 10);
    }
  },
};

function shoot(spread) {
  const def = weapons.currentDef();
  if (!weapons.takeRound()) return false;
  camera.getWorldDirection(rayDir);
  rayDir.x += (random() * 2 - 1) * spread;
  rayDir.y += (random() * 2 - 1) * spread;
  rayDir.z += (random() * 2 - 1) * spread;
  rayDir.normalize();
  scene.updateMatrixWorld(true);
  const hit = combat.playerShoot(camera.position, rayDir, def, shootables);
  weapons.pullTrigger();
  player.recoil(def.recoil * (0.8 + random() * 0.4), (random() * 2 - 1) * def.recoil * 0.6);
  audio.shot(def.kind, 0);
  state.shotsHeard.push({ x: body.position.x, z: body.position.z, at: state.elapsed, team: TEAMS.STRIKE });
  if (hit && hit.bot) {
    const killed = bots.damage(hit.bot, hit.amount);
    bots.alert(hit.bot, body.position.x, body.position.z);
    state.spotted.set(hit.bot.id, state.elapsed);
    audio.hit(killed);
    hud.hitMarker(killed);
    if (killed) onBotDeath(hit.bot, 'player', hit.part);
  }
  return true;
}

// ---- fixed-step simulation --------------------------------------------------

function stepBuy(dt) {
  state.timer -= dt;
  bots.update(dt, botCtx);
  weapons.step(dt, 0, false);
  if (state.timer <= 0) startLive();
}

function stepRoundEnd(dt) {
  combat.update(dt, combatCtx);
  if (state.elapsed < state.roundEndAt) return;
  const decided = state.score[0] >= MATCH.winsToTake || state.score[1] >= MATCH.winsToTake || state.round >= MATCH.maxRounds;
  if (decided) finishMatch();
  else {
    state.round += 1;
    startRound();
  }
}

function stepLive(dt) {
  state.timer -= dt;
  const aiming = input.state.aiming && body.alive;
  player.step(dt, input.state.keys, aiming);
  weapons.step(dt, player.groundSpeed(), aiming);
  bots.update(dt, botCtx);
  bomb.update(dt, {
    state,
    world,
    bots: bots.list,
    playerPos: body.position,
    playerAlive: body.alive,
    plantHeld: input.state.keys.has('KeyE') && body.alive,
    onPlanted(site) {
      announce(state, `BOMB PLANTED — SITE ${site}`, 'Guard it until it blows');
    },
    onDefused() {
      endRound(TEAMS.WARDEN, 'defused');
    },
  });
  // The player picks the dropped bomb up by walking over it.
  if (state.bomb.state === 'dropped' && body.alive) {
    const dx = state.bomb.x - body.position.x;
    const dz = state.bomb.z - body.position.z;
    if (dx * dx + dz * dz < 1.4 * 1.4) {
      state.bomb.state = 'carried';
      state.bomb.carrier = 'player';
      feed(state, 'You picked up the bomb', true);
    }
  }
  combat.update(dt, combatCtx);
  checkRoundEnd();
}

function step(dt) {
  if (state.phase === 'buy' || state.phase === 'live' || state.phase === 'roundEnd') {
    state.elapsed += dt;
  }
  // Gunfire older than 2 s is forgotten; bots only chase fresh sound.
  while (state.shotsHeard.length > 0 && state.elapsed - state.shotsHeard[0].at > 2) state.shotsHeard.shift();

  switch (state.phase) {
    case 'buy':
      stepBuy(dt);
      break;
    case 'roundEnd':
      stepRoundEnd(dt);
      break;
    case 'live':
      stepLive(dt);
      break;
    default:
      break;
  }
}

// ---- per-frame input and HUD -------------------------------------------------

function buyByKey(index) {
  const result = economy.buy(SHOP[index].id);
  if (result.ok) audio.buy();
  else audio.denied();
  hud.setBuyNote(result.reason);
  refreshShop();
}

function handleKeys() {
  const pressed = input.state.pressed;
  if (pressed.has('KeyR') && state.phase === 'live' && body.alive) {
    if (weapons.reload()) audio.reload();
  }
  if (pressed.has('KeyG') && state.phase === 'live' && body.alive && weapons.state.grenades > 0) {
    weapons.state.grenades -= 1;
    camera.getWorldDirection(rayDir);
    aimSpot.copy(camera.position).addScaledVector(rayDir, 0.6);
    combat.throwGrenade(aimSpot, rayDir, 'player');
  }
  if (pressed.has('KeyB') && state.phase === 'buy') {
    if (shopOpen) {
      closeShop();
      input.requestLock();
    } else {
      input.releaseLock();
      openShop();
    }
  }
  if (pressed.has('Enter') && shopOpen) {
    closeShop();
    input.requestLock();
  }
  for (let i = 0; i < 6; i += 1) {
    if (!pressed.has(`Digit${i + 1}`)) continue;
    if (shopOpen && state.phase === 'buy') {
      buyByKey(i);
    } else if (i < 4 && state.phase !== 'menu' && state.phase !== 'matchEnd') {
      weapons.switchTo(i);
    }
  }
  if (input.state.wheel !== 0 && !shopOpen) weapons.cycle(input.state.wheel > 0 ? 1 : -1);
}

function handleFiring() {
  if (state.phase !== 'live' || !body.alive || !input.state.locked || paused) {
    wasFiring = input.state.firing;
    return;
  }
  const def = weapons.currentDef();
  const wantFire = input.state.firing && (def.auto || !wasFiring);
  wasFiring = input.state.firing;
  if (!wantFire) return;
  if (weapons.ready()) {
    const aiming = input.state.aiming;
    shoot(weapons.spread(player.groundSpeed(), aiming, body.crouching, body.onGround));
  } else if (weapons.currentSlot().mag === 0 && weapons.state.reloadLeft === 0) {
    audio.dryFire();
  }
}

function syncCamera() {
  let shakeX = 0;
  let shakeY = 0;
  if (tremorTime > 0) {
    tremorTime -= 1 / 60;
    shakeX = (random() - 0.5) * tremorAmp;
    shakeY = (random() - 0.5) * tremorAmp;
  }
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch + shakeX, body.yaw + shakeY, 0, 'YXZ');
  const aiming = input.state.aiming && body.alive && (state.phase === 'live' || state.phase === 'buy');
  const def = weapons.currentDef();
  const targetFov = aiming && def.zoom > 1 ? 74 / def.zoom : 74;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * 0.25;
    camera.updateProjectionMatrix();
  }
}

function hintFor() {
  if (state.phase === 'buy') return 'Buy phase — B for shop · Deploy when ready';
  if (state.phase !== 'live') return '';
  if (body.alive && state.bomb.state === 'carried' && state.bomb.carrier === 'player') {
    const site = world.siteAt(body.position.x, body.position.z);
    return site ? `Hold E to plant at site ${site}` : 'Carry the bomb to site A or B';
  }
  if (state.bomb.state === 'planted') return 'Bomb planted — guard the site';
  return '';
}

function bombLine() {
  if (state.bomb.state === 'planted') return `BOMB PLANTED — SITE ${state.bomb.site}`;
  if (state.bomb.state === 'dropped') return 'BOMB DROPPED';
  if (state.bomb.carrier === 'player') return 'YOU CARRY THE BOMB';
  if (state.bomb.carrier) {
    const carrier = bots.list.find((b) => b.id === state.bomb.carrier);
    return `${carrier ? carrier.name : 'TEAMMATE'} CARRIES THE BOMB`;
  }
  return '';
}

function syncHud() {
  hud.setVisible(state.phase !== 'menu' && state.phase !== 'matchEnd');
  const slot = weapons.currentSlot();
  hud.setHealth(body.health, body.armour);
  hud.setAmmo(slot.mag, slot.reserve, slot.def.name, weapons.state.reloadLeft > 0);
  hud.setMoney(state.money);
  hud.setGrenades(weapons.state.grenades);
  if (state.phase === 'buy') hud.setTimer(state.timer, 'BUY');
  else hud.setTimer(state.timer, state.bomb.state === 'planted' ? 'BOMB' : 'ROUND');
  hud.setScore(state.score[0], state.score[1], state.round, MATCH.maxRounds);
  hud.setPips(strikeAlive(), wardenAlive());
  const h0 = Math.ceil(body.health);
  const h1 = Math.ceil(mates[0].health);
  const h2 = Math.ceil(mates[1].health);
  if (h0 !== lastHp0 || h1 !== lastHp1 || h2 !== lastHp2 || body.alive !== lastLive0 || mates[0].alive !== lastLive1 || mates[1].alive !== lastLive2) {
    lastHp0 = h0;
    lastHp1 = h1;
    lastHp2 = h2;
    lastLive0 = body.alive;
    lastLive1 = mates[0].alive;
    lastLive2 = mates[1].alive;
    hud.setTeammates([
      { name: 'YOU', health: body.health, alive: body.alive },
      { name: mates[0].name, health: mates[0].health, alive: mates[0].alive },
      { name: mates[1].name, health: mates[1].health, alive: mates[1].alive },
    ]);
  }
  hud.setBombStatus(bombLine());
  hud.setHint(hintFor());
  const aiming = input.state.aiming && body.alive;
  const spreadPx = weapons.spread(player.groundSpeed(), aiming, body.crouching, body.onGround) * 900;
  hud.setCrosshair(spreadPx, aiming, weapons.currentDef().id === 'sniper');
  if (state.feedSeq !== seenFeed) {
    seenFeed = state.feedSeq;
    hud.renderFeed(state.feed);
  }
  if (state.announceSeq !== seenAnnounce) {
    seenAnnounce = state.announceSeq;
    const latest = state.announcements[state.announcements.length - 1];
    if (latest) hud.announce(latest.text, latest.sub);
  }
  if (state.bomb.plantProgress > 0) {
    hud.setProgress(state.bomb.planter === 'player' ? 'PLANTING THE BOMB' : 'TEAMMATE PLANTING', state.bomb.plantProgress);
  } else if (state.bomb.defuseProgress > 0) {
    hud.setProgress('WARDEN DEFUSING THE BOMB', state.bomb.defuseProgress);
  } else {
    hud.setProgress('', 0);
  }
  if (shopOpen) {
    const key = `${state.money}|${weapons.state.grenades}|${body.armour}|${weapons.state.owned.length}`;
    if (key !== shopKey) refreshShop();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    input.takeLook(lookMove);
    const aiming = input.state.aiming && body.alive;
    const sensitivity = aiming ? (weapons.currentDef().id === 'sniper' ? 0.35 : 0.6) : 1;
    if (input.state.locked) player.look(lookMove.x * sensitivity, lookMove.y * sensitivity);
    handleKeys();
    handleFiring();
    if (!paused) {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= STEP && steps < 5) {
        step(STEP);
        accumulator -= STEP;
        steps += 1;
      }
      if (accumulator > STEP * 5) accumulator = 0;
    }
    syncCamera();
    syncHud();
    mapClock += dt;
    if (mapClock > 0.1) {
      mapClock = 0;
      hud.drawMinimap(world, body, bots.list, state);
    }
    input.endFrame();
  }
  renderer.render(scene, camera);
}

// ---- deterministic screenshot staging -----------------------------------------

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(STEP);
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    syncHud();
    hud.drawMinimap(world, body, bots.list, state);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

const SHOTS = {
  // Menu over the yard: the player looks down mid from the spawn ridge.
  start() {
    body.position.set(-6, 0, 18);
    body.yaw = -0.25;
    body.pitch = -0.02;
    bots.resetRound(1);
    settle(10);
    hud.showOverlay('start');
  },
  buy() {
    startMatch();
    settle(5);
    openShop();
    body.yaw = 0;
  },
  end() {
    startMatch();
    state.score = [5, 3];
    state.kills = 11;
    state.deaths = 6;
    state.round = 9;
    state.phase = 'live';
    state.timer = 12;
    state.bomb.state = 'planted';
    state.bomb.site = 'A';
    state.bomb.x = SITES.A.x;
    state.bomb.z = SITES.A.z;
    bomb.dropAt(SITES.A.x, SITES.A.z);
    body.position.set(-13, 0, -3);
    settle(20);
    aimSpot.set(SITES.A.x, 1.2, SITES.A.z);
    aimAt(aimSpot);
    finishMatch();
  },
  // Mid-round, rifle in hand, an enemy in the sights.
  play() {
    startMatch();
    state.score = [2, 1];
    state.round = 4;
    state.kills = 3;
    state.money = 3200;
    announce(state, 'ROUND 4', 'First to 5 rounds');
    state.phase = 'live';
    state.timer = 82;
    state.freeze = false;
    weapons.buy('rifle');
    weapons.state.grenades = 1;
    body.position.set(0, 0, 5);
    body.yaw = 0;
    settle(360);
    const enemy = bots.list
      .filter((b) => b.team === TEAMS.WARDEN && b.alive)
      .sort((a, b) => {
        const da = Math.hypot(a.position.x - body.position.x, a.position.z - body.position.z);
        const db = Math.hypot(b.position.x - body.position.x, b.position.z - body.position.z);
        return da - db;
      })[0];
    if (enemy) {
      aimSpot.set(enemy.position.x, enemy.position.y + 1.1, enemy.position.z);
      aimAt(aimSpot);
      shoot(0);
      settle(2);
    }
    feed(state, 'YOU ▸ MIRA · HEADSHOT', true);
    feed(state, 'JUNO ▸ DRAKE', true);
  },
};

function runShot(name) {
  hud.hideOverlay();
  SHOTS[name]();
  syncCamera();
  syncHud();
  hud.drawMinimap(world, body, bots.list, state);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Menu idle: bots stand at their spawns behind the start overlay.
bots.resetRound(1);
syncCamera();
syncHud();
// A read hook for automated playtests (and curious players): the live match
// state, the player and the bots. The game never reads it back.
window.__sandline = { state, player, bots, weapons, combat, world };
if (shot) runShot(shot);
else requestAnimationFrame(frame);
