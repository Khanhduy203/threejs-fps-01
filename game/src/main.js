// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. main.js owns the wiring — the round state machine, the player's trigger,
// the buy flow, the pause — and nothing else; every system lives in its own module.
// ?shot=start|play|buy|end with &seed=N stages a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createState, resetMatch, resetRound, announce, feed, MATCH, TEAMS, TEAM_NAME } from './state.js';
import { createWorld, SITES, SPAWNS } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPONS } from './weapons.js';
import { createBots } from './bots.js';
import { createCombat } from './combat.js';
import { createBomb } from './bomb.js';
import { createEconomy, SHOP } from './economy.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
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

let buyMenuOpen = false;
let paused = false;
let frozen = false;
let started = false;
let prevFiring = false;
let shakeTime = 0;
let shakeMag = 0;
let mapTimer = 0;
let lastAnnounceSeq = 0;
let lastFeedSeq = 0;
let accumulator = 0;
let lastTime = performance.now();

const direction = new THREE.Vector3();
const aimPoint = new THREE.Vector3();

const hud = createHud({
  onPlay() {
    audio.unlock();
    if (state.phase === 'menu' || state.phase === 'matchEnd') startMatch();
    else input.requestLock();
  },
  onBuy(id) {
    const result = economy.buy(id);
    if (result.ok) audio.buy();
    else audio.denied();
    hud.setBuyNote(result.reason);
    refreshBuyMenu();
    syncHud();
  },
  onDeploy() {
    audio.unlock();
    closeBuyMenu();
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
    openBuyMenu();
  }
}

function openBuyMenu() {
  if (state.phase !== 'buy') return;
  buyMenuOpen = true;
  hud.showBuy(true);
  refreshBuyMenu();
}

function closeBuyMenu() {
  buyMenuOpen = false;
  hud.showBuy(false);
}

function refreshBuyMenu() {
  hud.refreshBuy(
    state.money,
    weapons.state.owned.map((slot) => slot.def.id),
    weapons.state.grenades,
    body.armour,
  );
}

// ---- match / round flow -------------------------------------------------

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
  shakeTime = 0;
  prevFiring = false;
  hud.setDead(false);
  closeBuyMenu();
  hud.hideOverlay();
  announce(state, `ROUND ${state.round}`, state.round === 1 ? 'Plant the bomb at A or B' : `First to ${MATCH.winsToTake} rounds`);
  if (!shot) openBuyMenu();
}

function startLive() {
  state.phase = 'live';
  state.timer = MATCH.roundTime;
  state.freeze = false;
  closeBuyMenu();
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
  const reasonText = {
    elimination: won ? 'Enemy team eliminated' : 'Your team was eliminated',
    bomb: 'The bomb exploded',
    defused: 'The bomb was defused',
    time: 'Time expired — the defence holds',
  }[reason];
  announce(state, `${TEAM_NAME[winner]} WINS THE ROUND`, reasonText);
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
  aimPoint.set(state.bomb.x, 0.5, state.bomb.z);
  combat.explosion(aimPoint);
  const dist = Math.hypot(state.bomb.x - body.position.x, state.bomb.z - body.position.z);
  audio.explosion(dist);
  if (dist < 14) {
    shakeTime = 0.6;
    shakeMag = 0.05 * (1 - dist / 14);
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
  if (bot.hasBomb || (state.bomb.state === 'carried' && state.bomb.carrier === bot.id)) {
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
      shakeTime = 0.4;
      shakeMag = 0.04 * (1 - playerDist / 10);
    }
  },
};

function shoot(spread) {
  const def = weapons.currentDef();
  if (!weapons.takeRound()) return false;
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  const hit = combat.playerShoot(camera.position, direction, def, shootables);
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

function step(dt) {
  if (state.phase === 'buy' || state.phase === 'live' || state.phase === 'roundEnd') {
    state.elapsed += dt;
  }
  // Gunfire older than 2 s is forgotten; bots only chase fresh sound.
  while (state.shotsHeard.length > 0 && state.elapsed - state.shotsHeard[0].at > 2) state.shotsHeard.shift();

  if (state.phase === 'buy') {
    state.timer -= dt;
    bots.update(dt, botCtx);
    weapons.step(dt, 0, false);
    if (state.timer <= 0) startLive();
    return;
  }
  if (state.phase === 'roundEnd') {
    combat.update(dt, combatCtx);
    if (state.elapsed >= state.roundEndAt) {
      const decided = state.score[0] >= MATCH.winsToTake || state.score[1] >= MATCH.winsToTake || state.round >= MATCH.maxRounds;
      if (decided) finishMatch();
      else {
        state.round += 1;
        startRound();
      }
    }
    return;
  }
  if (state.phase !== 'live') return;

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

// ---- per-frame input and HUD -------------------------------------------------

function handleKeys() {
  const pressed = input.state.pressed;
  if (pressed.has('KeyR') && state.phase === 'live' && body.alive) {
    if (weapons.reload()) audio.reload();
  }
  if (pressed.has('KeyG') && state.phase === 'live' && body.alive && weapons.state.grenades > 0) {
    weapons.state.grenades -= 1;
    camera.getWorldDirection(direction);
    aimPoint.copy(camera.position).addScaledVector(direction, 0.6);
    combat.throwGrenade(aimPoint, direction, 'player');
  }
  if (pressed.has('KeyB') && state.phase === 'buy') {
    if (buyMenuOpen) {
      closeBuyMenu();
      input.requestLock();
    } else {
      input.releaseLock();
      openBuyMenu();
    }
  }
  if (pressed.has('Enter') && buyMenuOpen) {
    closeBuyMenu();
    input.requestLock();
  }
  for (let i = 0; i < 6; i += 1) {
    if (!pressed.has(`Digit${i + 1}`)) continue;
    if (buyMenuOpen && state.phase === 'buy') {
      const result = economy.buy(SHOP[i].id);
      if (result.ok) audio.buy();
      else audio.denied();
      hud.setBuyNote(result.reason);
      refreshBuyMenu();
    } else if (i < 4 && state.phase !== 'menu' && state.phase !== 'matchEnd') {
      weapons.switchTo(i);
    }
  }
  if (input.state.wheel !== 0 && !buyMenuOpen) weapons.cycle(input.state.wheel > 0 ? 1 : -1);
}

function handleFiring() {
  if (state.phase !== 'live' || !body.alive || !input.state.locked || paused) {
    prevFiring = input.state.firing;
    return;
  }
  const def = weapons.currentDef();
  const wantFire = input.state.firing && (def.auto || !prevFiring);
  prevFiring = input.state.firing;
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
  if (shakeTime > 0) {
    shakeTime -= 1 / 60;
    shakeX = (random() - 0.5) * shakeMag;
    shakeY = (random() - 0.5) * shakeMag;
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
  hud.setTeammates([
    { name: 'YOU', health: body.health, alive: body.alive },
    ...bots.list.filter((b) => b.team === TEAMS.STRIKE).map((b) => ({ name: b.name, health: b.health, alive: b.alive })),
  ]);
  const bombText =
    state.bomb.state === 'planted'
      ? `BOMB PLANTED — SITE ${state.bomb.site}`
      : state.bomb.state === 'dropped'
        ? 'BOMB DROPPED'
        : state.bomb.carrier === 'player'
          ? 'YOU CARRY THE BOMB'
          : state.bomb.carrier
            ? `${(bots.list.find((b) => b.id === state.bomb.carrier) || {}).name || 'TEAMMATE'} CARRIES THE BOMB`
            : '';
  hud.setBombStatus(bombText);
  if (state.phase === 'buy') hud.setHint('Buy phase — B for shop · Deploy when ready');
  else if (state.phase === 'live' && body.alive && state.bomb.state === 'carried' && state.bomb.carrier === 'player') {
    const site = world.siteAt(body.position.x, body.position.z);
    hud.setHint(site ? `Hold E to plant at site ${site}` : 'Carry the bomb to site A or B');
  } else if (state.phase === 'live' && state.bomb.state === 'planted') {
    hud.setHint('Bomb planted — guard the site');
  } else if (state.phase === 'live' && !body.alive) hud.setHint('');
  else if (state.phase === 'live') hud.setHint('');
  const aiming = input.state.aiming && body.alive;
  const spreadPx = weapons.spread(player.groundSpeed(), aiming, body.crouching, body.onGround) * 900;
  hud.setCrosshair(spreadPx, aiming, weapons.currentDef().id === 'sniper');
  if (state.feedSeq !== lastFeedSeq) {
    lastFeedSeq = state.feedSeq;
    hud.renderFeed(state.feed);
  }
  if (state.announceSeq !== lastAnnounceSeq) {
    lastAnnounceSeq = state.announceSeq;
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
  if (buyMenuOpen) refreshBuyMenu();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    const aiming = input.state.aiming && body.alive;
    const sensitivity = aiming ? (weapons.currentDef().id === 'sniper' ? 0.35 : 0.6) : 1;
    if (input.state.locked) player.look(look.x * sensitivity, look.y * sensitivity);
    handleKeys();
    handleFiring();
    if (!paused) {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 5) {
        step(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (accumulator > FIXED_STEP * 5) accumulator = 0;
    }
    syncCamera();
    syncHud();
    mapTimer += dt;
    if (mapTimer > 0.1) {
      mapTimer = 0;
      hud.drawMinimap(world, body, bots.list, state);
    }
    input.endFrame();
  }
  renderer.render(scene, camera);
}

// ---- deterministic screenshot staging -----------------------------------------

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
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

function runShot(name) {
  hud.hideOverlay();
  if (name === 'start') {
    // Menu over the yard: the player looks down mid from the spawn ridge.
    body.position.set(-6, 0, 18);
    body.yaw = -0.25;
    body.pitch = -0.02;
    bots.resetRound(1);
    settle(10);
    hud.showOverlay('start');
  } else if (name === 'buy') {
    startMatch();
    settle(5);
    openBuyMenu();
    body.yaw = 0;
  } else if (name === 'end') {
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
    aimPoint.set(SITES.A.x, 1.2, SITES.A.z);
    aimAt(aimPoint);
    finishMatch();
  } else {
    // 'play': mid-round, rifle in hand, an enemy in the sights.
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
    body.position.set(0, 0, 10);
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
      aimPoint.set(enemy.position.x, enemy.position.y + 1.1, enemy.position.z);
      aimAt(aimPoint);
      shoot(0);
      settle(2);
    }
    feed(state, 'YOU ▸ MIRA · HEADSHOT', true);
    feed(state, 'JUNO ▸ DRAKE', true);
  }
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
window.__sandline = { state, player, bots, weapons, world };
if (shot) runShot(shot);
else requestAnimationFrame(frame);
