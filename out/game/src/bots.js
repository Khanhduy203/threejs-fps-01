// The bots: two STRIKE teammates and three WARDEN defenders. Each bot is a
// small state machine walking a nav-graph path: it rushes a route, holds a
// position and scans, engages what it sees, investigates gunfire it hears,
// and plays the objective (plant, defuse, pick up a dropped bomb). Vision is
// a cone plus a line-of-sight test against the world; shooting is a real ray
// with an aim error that grows with distance and target speed, so cover and
// movement matter.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { TEAMS } from './state.js';
import { SITES, SPAWNS, HOLD_NODES } from './world.js';

const WALK_SPEED = 4.3;
const DODGE_SPEED = 2.3;
const EYE = 1.5;
const TORSO_Y = 1.15;
const SIGHT_RANGE = 46;
const CONE_HALF = 1.05; // ~120 degree vision cone
const HEARING_RANGE = 26;
const SHOT_GAP = 0.13;

const CALLSIGNS = {
  strike: ['JUNO', 'REYES'],
  warden: ['KOVAC', 'MIRA', 'DRAKE'],
};

function assembleBot(scene, team) {
  const teamColour = team === TEAMS.STRIKE ? PALETTE.strike : PALETTE.warden;
  const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColour), roughness: 0.6, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.7 });
  const group = new THREE.Group();
  const piece = (geo, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const legL = piece(new THREE.BoxGeometry(0.16, 0.55, 0.2), dark, -0.12, 0.28, 0);
  const legR = piece(new THREE.BoxGeometry(0.16, 0.55, 0.2), dark, 0.12, 0.28, 0);
  const torso = piece(new THREE.BoxGeometry(0.52, 0.62, 0.3), cloth, 0, 0.86, 0);
  const head = piece(new THREE.SphereGeometry(0.15, 14, 10), skin, 0, 1.42, 0);
  piece(new THREE.BoxGeometry(0.34, 0.12, 0.34), dark, 0, 1.52, 0);
  piece(new THREE.BoxGeometry(0.07, 0.1, 0.6), dark, 0.14, 1.02, -0.32);
  const ring = new THREE.Mesh(
    new THREE.CircleGeometry(0.46, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(teamColour), transparent: true, opacity: 0.4, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);
  group.traverse((mesh) => {
    if (mesh.isMesh && mesh !== ring) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  scene.add(group);
  return { group, legL, legR, torso, head, ring };
}

export function createBots(scene, world, random) {
  const list = [];
  const hitMeshes = [];
  let plan = { site: 'A' };

  function makeBot(id, name, team, spawnIndex) {
    const mesh = assembleBot(scene, team);
    const bot = {
      id,
      name,
      team,
      spawnIndex,
      group: mesh.group,
      legL: mesh.legL,
      legR: mesh.legR,
      torso: mesh.torso,
      head: mesh.head,
      position: mesh.group.position,
      yaw: team === TEAMS.STRIKE ? 0 : Math.PI,
      health: 100,
      alive: true,
      fall: 0,
      mode: 'spawn',
      path: [],
      pathIndex: 0,
      holdNode: -1,
      holdYaw: 0,
      target: null, // the reused targetDesc below while an enemy is visible
      targetDesc: { kind: null, bot: null },
      targetPos: new THREE.Vector3(),
      reaction: 0,
      burstLeft: 0,
      nextShotAt: 0,
      burstPauseUntil: 0,
      strafeDir: 1,
      strafeUntil: 0,
      strafeAnchor: null, // where the fight started; strafing never drifts far from it
      perceiveAt: random() * 0.1,
      modeAt: random() * 0.25,
      walkPhase: random() * 6,
      moving: false,
      investigate: null, // { x, z }
      stuckSince: 0,
      lastX: 0,
      lastZ: 0,
      unstickUntil: 0,
      unstickDir: 1,
      hasBomb: false,
      scanPhase: random() * 6,
    };
    mesh.torso.userData.bot = bot;
    mesh.torso.userData.part = 'torso';
    mesh.head.userData.bot = bot;
    mesh.head.userData.part = 'head';
    hitMeshes.push(mesh.torso, mesh.head);
    list.push(bot);
    return bot;
  }

  for (let i = 0; i < 2; i += 1) makeBot(`s${i}`, CALLSIGNS.strike[i], TEAMS.STRIKE, i + 1);
  for (let i = 0; i < 3; i += 1) makeBot(`w${i}`, CALLSIGNS.warden[i], TEAMS.WARDEN, i);

  function aliveCount(team) {
    let n = 0;
    for (const bot of list) if (bot.team === team && bot.alive) n += 1;
    return n;
  }

  function setPath(bot, fromX, fromZ, toNode, viaNode = -1) {
    const from = world.nearestNode(fromX, fromZ);
    let nodes;
    if (viaNode >= 0 && viaNode !== from && viaNode !== toNode) {
      nodes = world.findPath(from, viaNode).concat(world.findPath(viaNode, toNode).slice(1));
    } else {
      nodes = world.findPath(from, toNode);
    }
    bot.path = nodes.map((index) => world.nodes[index]);
    bot.pathIndex = 0;
  }

  function pathDone(bot) {
    return bot.path.length === 0 || bot.pathIndex >= bot.path.length;
  }

  function resetRound(round) {
    plan.site = random() < 0.55 ? 'A' : 'B';
    const siteNode = SITES[plan.site].node;
    for (const bot of list) {
      const spawn = SPAWNS[bot.team === TEAMS.STRIKE ? 'strike' : 'warden'][bot.spawnIndex];
      bot.position.set(spawn[0], 0, spawn[1]);
      bot.group.rotation.set(0, 0, 0);
      bot.yaw = bot.team === TEAMS.STRIKE ? 0 : Math.PI;
      bot.group.rotation.y = bot.yaw;
      bot.health = 100;
      bot.alive = true;
      bot.fall = 0;
      bot.mode = 'spawn';
      bot.path = [];
      bot.pathIndex = 0;
      bot.target = null;
      bot.reaction = 0;
      bot.burstLeft = 0;
      bot.investigate = null;
      bot.hasBomb = false;
      bot.moving = false;
      bot.group.visible = true;
      if (bot.team === TEAMS.STRIKE) {
        // One bot takes the direct lane to the site, the other goes through mid
        // so the push does not arrive as one clump.
        const via = bot.id === 's0' ? (plan.site === 'A' ? 3 : 5) : 11;
        setPath(bot, spawn[0], spawn[1], siteNode, via);
        bot.mode = 'move';
      } else {
        const holds = [HOLD_NODES.A, HOLD_NODES.B, HOLD_NODES.MID];
        bot.holdNode = holds[bot.spawnIndex];
        bot.holdYaw = Math.PI + (bot.spawnIndex === 0 ? 0.5 : bot.spawnIndex === 1 ? -0.5 : 0);
        setPath(bot, spawn[0], spawn[1], bot.holdNode);
        bot.mode = 'move';
      }
    }
  }

  function canSee(bot, x, y, z) {
    const dx = x - bot.position.x;
    const dy = y - (bot.position.y + EYE);
    const dz = z - bot.position.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > SIGHT_RANGE) return 0;
    const angle = Math.atan2(-dx, -dz);
    let diff = angle - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > CONE_HALF) return 0;
    if (world.losBlocked(bot.position.x, bot.position.y + EYE, bot.position.z, x, y, z)) return 0;
    return dist;
  }

  // Nearest visible enemy wins; the player counts like any other enemy.
  // The target descriptor is reused, never reallocated: perception runs ten
  // times a second per bot.
  function perceive(bot, ctx) {
    let bestKind = null;
    let bestBot = null;
    let bestDist = Infinity;
    if (ctx.playerAlive) {
      const p = ctx.playerPos;
      const chestY = p.y + (ctx.playerCrouching ? 0.7 : TORSO_Y);
      const d = canSee(bot, p.x, chestY, p.z);
      if (d > 0 && d < bestDist) {
        bestDist = d;
        bestKind = 'player';
        bestBot = null;
      }
    }
    for (const other of list) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      const d = canSee(bot, other.position.x, other.position.y + TORSO_Y, other.position.z);
      if (d > 0 && d < bestDist) {
        bestDist = d;
        bestKind = 'bot';
        bestBot = other;
      }
    }
    if (bestKind) {
      const pos = bestKind === 'player' ? ctx.playerPos : bestBot.position;
      const isNew = !bot.target || bot.target.kind !== bestKind || bot.target.bot !== bestBot;
      if (isNew) bot.reaction = 0.35 + random() * 0.3;
      bot.targetDesc.kind = bestKind;
      bot.targetDesc.bot = bestBot;
      bot.target = bot.targetDesc;
      bot.targetPos.set(pos.x, pos.y, pos.z);
      if (bestKind === 'bot') ctx.state.spotted.set(bestBot.id, ctx.elapsed);
      bot.investigate = null;
    } else if (bot.target) {
      // Lost sight: go and check the last place the target was seen.
      bot.target = null;
      bot.investigate = { x: bot.targetPos.x, z: bot.targetPos.z };
    }
    // Hearing: a recent enemy shot nearby, with no target, is worth a look.
    if (!bot.target && !bot.investigate) {
      for (const shot of ctx.state.shotsHeard) {
        if (shot.team === bot.team || ctx.elapsed - shot.at > 1.5) continue;
        const dx = shot.x - bot.position.x;
        const dz = shot.z - bot.position.z;
        if (dx * dx + dz * dz < HEARING_RANGE * HEARING_RANGE) {
          bot.investigate = { x: shot.x, z: shot.z };
          break;
        }
      }
    }
  }

  // Objective play once the bomb is planted: defenders retake and defuse,
  // attackers guard the site from nearby cover.
  function decidePlanted(bot, ctx, bomb) {
    if (bot.team === TEAMS.WARDEN) {
      const d = Math.hypot(bomb.x - bot.position.x, bomb.z - bot.position.z);
      bot.mode = d < 1.6 ? 'defuse' : 'retake';
      if (bot.mode === 'retake' && pathDone(bot)) {
        setPath(bot, bot.position.x, bot.position.z, SITES[bomb.site].node);
      }
    } else if (pathDone(bot)) {
      setPath(bot, bot.position.x, bot.position.z, SITES[bomb.site].node);
      bot.mode = 'move';
    } else {
      bot.mode = 'move';
    }
  }

  // A STRIKE bot with no target and no bomb walks its lane, then holds the
  // site's edge; a WARDEN walks to its hold node and stays there. Either one
  // breaks off to investigate a sound, then returns to its post.
  function decideIdle(bot, ctx, homeNode) {
    if (bot.mode === 'move' && pathDone(bot)) {
      bot.mode = 'hold';
      bot.yaw = bot.holdYaw;
    } else if (bot.mode === 'hold' && bot.investigate) {
      setPath(bot, bot.position.x, bot.position.z, world.nearestNode(bot.investigate.x, bot.investigate.z));
      bot.mode = 'move';
    } else if (bot.mode === 'move' && bot.investigate && pathDone(bot)) {
      bot.investigate = null;
      setPath(bot, bot.position.x, bot.position.z, homeNode);
    }
  }

  function decideMode(bot, ctx) {
    const bomb = ctx.state.bomb;
    if (bot.target) {
      // Entering a fight anchors the strafe: the dodge stays local, so a
      // holding bot never drifts sideways into a sightline it should not have
      // (down mid, around the container, to the attacker spawn).
      if (bot.mode !== 'engage') bot.strafeAnchor = { x: bot.position.x, z: bot.position.z };
      bot.mode = 'engage';
      return;
    }
    bot.strafeAnchor = null;
    if (bomb.state === 'planted') {
      decidePlanted(bot, ctx, bomb);
      return;
    }
    if (bomb.state === 'dropped' && bot.team === TEAMS.STRIKE) {
      const d = Math.hypot(bomb.x - bot.position.x, bomb.z - bot.position.z);
      if (d < 1.4) {
        bot.hasBomb = true;
        bomb.state = 'carried';
        bomb.carrier = bot.id;
        ctx.onBombPickup(bot);
      } else {
        bot.mode = 'pickup';
        if (pathDone(bot)) {
          setPath(bot, bot.position.x, bot.position.z, world.nearestNode(bomb.x, bomb.z));
        }
        return;
      }
    }
    if (bot.hasBomb) {
      const site = plan.site;
      if (world.isInSite(bot.position.x, bot.position.z, site)) {
        bot.mode = 'plant';
      } else {
        bot.mode = 'move';
        if (pathDone(bot)) {
          setPath(bot, bot.position.x, bot.position.z, SITES[site].node);
        }
      }
      return;
    }
    if (bot.team === TEAMS.WARDEN) {
      decideIdle(bot, ctx, bot.holdNode);
      return;
    }
    // STRIKE without the bomb: push to the site, then hold its edge.
    if (bot.mode === 'move' && pathDone(bot)) {
      bot.mode = 'hold';
      bot.holdYaw = 0;
    } else {
      decideIdle(bot, ctx, SITES[plan.site].node);
    }
  }

  function faceToward(bot, x, z, dt, rate = 6) {
    const targetYaw = Math.atan2(-(x - bot.position.x), -(z - bot.position.z));
    let diff = targetYaw - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
  }

  function walkPath(bot, dt, speed, now) {
    if (pathDone(bot)) {
      bot.moving = false;
      return;
    }
    const [wx, wz] = bot.path[bot.pathIndex];
    const dx = wx - bot.position.x;
    const dz = wz - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.7) {
      bot.pathIndex += 1;
      return;
    }
    let mx = dx / dist;
    let mz = dz / dist;
    if (now < bot.unstickUntil) {
      // Sidestep perpendicular while unsticking.
      const px = -mz * bot.unstickDir;
      const pz = mx * bot.unstickDir;
      mx = (mx + px) * 0.7071;
      mz = (mz + pz) * 0.7071;
    }
    bot.position.x += mx * speed * dt;
    bot.position.z += mz * speed * dt;
    faceToward(bot, wx, wz, dt, 8);
    bot.moving = true;
    // Stuck check: barely moved in the last 1.2 s while trying to walk.
    const moved = Math.hypot(bot.position.x - bot.lastX, bot.position.z - bot.lastZ);
    if (moved < 0.05) {
      if (bot.stuckSince === 0) bot.stuckSince = now;
      else if (now - bot.stuckSince > 1.2) {
        bot.unstickUntil = now + 0.7;
        bot.unstickDir = random() < 0.5 ? -1 : 1;
        bot.stuckSince = 0;
        if (random() < 0.4) bot.pathIndex += 1; // skip the snagging waypoint
      }
    } else {
      bot.stuckSince = 0;
    }
    bot.lastX = bot.position.x;
    bot.lastZ = bot.position.z;
  }

  // A fight: face the target, strafe sideways around the anchor, and fire in
  // bursts once the reaction time has run out.
  function fight(bot, dt, ctx) {
    faceToward(bot, bot.targetPos.x, bot.targetPos.z, dt, 7);
    if (ctx.elapsed >= bot.strafeUntil) {
      bot.strafeDir = random() < 0.5 ? -1 : 1;
      bot.strafeUntil = ctx.elapsed + 0.5 + random() * 0.5;
    }
    const dx = bot.targetPos.x - bot.position.x;
    const dz = bot.targetPos.z - bot.position.z;
    const len = Math.hypot(dx, dz) || 1;
    if (bot.strafeAnchor) {
      const ax = bot.position.x - bot.strafeAnchor.x;
      const az = bot.position.z - bot.strafeAnchor.z;
      if (ax * ax + az * az > 4.8) {
        const px = (-dz / len) * bot.strafeDir;
        const pz = (dx / len) * bot.strafeDir;
        if (px * ax + pz * az > 0) bot.strafeDir *= -1;
      }
    }
    const px = (-dz / len) * bot.strafeDir;
    const pz = (dx / len) * bot.strafeDir;
    const nx = bot.position.x + px * DODGE_SPEED * dt;
    const nz = bot.position.z + pz * DODGE_SPEED * dt;
    if (!world.losBlocked(bot.position.x, 0.5, bot.position.z, nx, 0.5, nz)) {
      bot.position.x = nx;
      bot.position.z = nz;
    }
    bot.moving = true;
    bot.reaction = Math.max(0, bot.reaction - dt);
    if (bot.reaction === 0 && ctx.elapsed >= bot.burstPauseUntil) {
      if (bot.burstLeft === 0) bot.burstLeft = 3 + Math.floor(random() * 3);
      if (ctx.elapsed >= bot.nextShotAt) {
        bot.nextShotAt = ctx.elapsed + SHOT_GAP;
        bot.burstLeft -= 1;
        if (bot.burstLeft === 0) bot.burstPauseUntil = ctx.elapsed + 0.45 + random() * 0.4;
        ctx.shootBot(bot, bot.target);
      }
    }
  }

  function update(dt, ctx) {
    for (const bot of list) {
      if (!bot.alive) {
        if (bot.fall < 1) {
          bot.fall = Math.min(1, bot.fall + dt / 0.4);
          bot.group.rotation.x = -bot.fall * 1.5;
          bot.group.position.y = -bot.fall * 0.12;
        }
        continue;
      }
      bot.moving = false;
      if (ctx.elapsed >= bot.perceiveAt) {
        perceive(bot, ctx);
        bot.perceiveAt = ctx.elapsed + 0.1;
      }
      if (ctx.elapsed >= bot.modeAt) {
        decideMode(bot, ctx);
        bot.modeAt = ctx.elapsed + 0.25;
      }
      if (ctx.freeze) {
        bot.group.rotation.y = bot.yaw;
        continue;
      }
      if (bot.mode === 'engage' && bot.target) {
        fight(bot, dt, ctx);
      } else if (bot.mode === 'move' || bot.mode === 'retake' || bot.mode === 'pickup') {
        walkPath(bot, dt, WALK_SPEED, ctx.elapsed);
      } else if (bot.mode === 'hold') {
        // Scan: slow sweep around the hold facing, so the vision cone covers
        // the approach instead of staring at one lane.
        bot.scanPhase += dt * 0.5;
        bot.yaw = bot.holdYaw + Math.sin(bot.scanPhase) * 0.7;
      }
      // Walk cycle: legs swing while moving, settle when still.
      if (bot.moving) {
        bot.walkPhase += dt * 9;
        bot.legL.rotation.x = Math.sin(bot.walkPhase) * 0.55;
        bot.legR.rotation.x = -Math.sin(bot.walkPhase) * 0.55;
      } else {
        bot.legL.rotation.x *= 0.8;
        bot.legR.rotation.x *= 0.8;
      }
      bot.group.rotation.y = bot.yaw;
    }
  }

  function damage(bot, amount) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.fall = 0;
    bot.target = null;
    bot.mode = 'dead';
    return true;
  }

  // A hit from somewhere the bot cannot see: go and look.
  function alert(bot, x, z) {
    if (!bot.alive) return;
    if (!bot.target) bot.investigate = { x, z };
  }

  return {
    list,
    hitMeshes,
    resetRound,
    update,
    damage,
    alert,
    aliveCount,
  };
}

export const BOT_DAMAGE = 24;
