// Shot resolution: the player's raycast shots, the bots' analytic rays, the
// frag grenade, and the feedback that makes a hit feel like a hit (tracers,
// impact particles, explosion light). One shared ray-against-body test decides
// what a bot bullet hits, so a bot can miss, graze a torso or land a headshot
// by geometry rather than by a dice roll.
import * as THREE from 'three';
import { BOT_DAMAGE } from './bots.js';

const FUSE_SECONDS = 2.2;
const BLAST_RADIUS = 6.5;
const BLAST_DAMAGE = 130;
const TRACER_SECONDS = 0.09;
const TRACER_COUNT = 24;
const PARTICLE_COUNT = 48;

// Damage falls off past `start`: full up to the falloff range, then linearly
// down to half at twice that range, and flat after.
function scaledDamage(base, distance, start) {
  if (distance <= start) return base;
  const t = Math.min(1, (distance - start) / start);
  return base * (1 - 0.5 * t);
}

// Slab test: does the ray from `origin` along `dir` hit the axis-aligned box?
// Returns the distance along the ray, or -1 for a miss.
function rayVsBox(origin, dir, min, max) {
  const starts = [origin.x, origin.y, origin.z];
  const steps = [dir.x, dir.y, dir.z];
  const lows = [min.x, min.y, min.z];
  const highs = [max.x, max.y, max.z];
  let near = 0;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(steps[axis]) < 1e-9) {
      if (starts[axis] < lows[axis] || starts[axis] > highs[axis]) return -1;
      continue;
    }
    let t0 = (lows[axis] - starts[axis]) / steps[axis];
    let t1 = (highs[axis] - starts[axis]) / steps[axis];
    if (t0 > t1) {
      const swap = t0;
      t0 = t1;
      t1 = swap;
    }
    if (t0 > near) near = t0;
    if (t1 < far) far = t1;
    if (near > far) return -1;
  }
  return near;
}

export function createCombat(scene, world, random, audio) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 120;
  const aimDir = new THREE.Vector3();
  const boxMin = new THREE.Vector3();
  const boxMax = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  const endPoint = new THREE.Vector3();

  // Tracer pool: lines reused, never allocated mid-frame.
  const tracers = [];
  const friendlyMat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9 });
  const hostileMat = new THREE.LineBasicMaterial({ color: 0xff9a5c, transparent: true, opacity: 0.9 });
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, friendlyMat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerCursor = 0;

  function drawTracer(from, to, hostile) {
    const slot = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % TRACER_COUNT;
    const attr = slot.line.geometry.attributes.position;
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
    slot.line.material = hostile ? hostileMat : friendlyMat;
    slot.line.visible = true;
    slot.life = TRACER_SECONDS;
  }

  // Particle pool: small boxes with a velocity and a life, for impacts and blasts.
  const particles = [];
  const chipGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc46b });
  const dustMat = new THREE.MeshBasicMaterial({ color: 0xc8a86a });
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xff6a2e });
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    const mesh = new THREE.Mesh(chipGeo, sparkMat);
    mesh.visible = false;
    scene.add(mesh);
    particles.push({ mesh, velocity: new THREE.Vector3(), life: 0, maxLife: 1 });
  }
  let particleCursor = 0;

  function burst(point, count, material, speed, life, up = 2) {
    for (let i = 0; i < count; i += 1) {
      const slot = particles[particleCursor];
      particleCursor = (particleCursor + 1) % PARTICLE_COUNT;
      slot.mesh.material = material;
      slot.mesh.visible = true;
      slot.mesh.position.copy(point);
      slot.velocity.set((random() - 0.5) * speed, random() * up, (random() - 0.5) * speed);
      slot.life = life * (0.6 + random() * 0.7);
      slot.maxLife = slot.life;
      slot.mesh.scale.setScalar(1);
    }
  }

  const blastLight = new THREE.PointLight(0xff8a3c, 0, 18, 1.6);
  scene.add(blastLight);
  let blastLightLeft = 0;

  // A big blast at a point: the bomb's explosion (grenades use detonateGrenade).
  function explosion(point) {
    blastLight.position.set(point.x, point.y + 0.5, point.z);
    blastLight.intensity = 90;
    blastLightLeft = 0.6;
    burst(point, 26, emberMat, 9, 0.9, 6);
    burst(point, 14, dustMat, 5, 1.4, 4);
  }

  const grenades = [];
  const shellGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x2a2723, roughness: 0.5, metalness: 0.6 });

  function throwGrenade(from, dir, owner, speed = 13) {
    const mesh = new THREE.Mesh(shellGeo, shellMat);
    mesh.castShadow = true;
    mesh.position.copy(from);
    scene.add(mesh);
    grenades.push({
      mesh,
      position: mesh.position,
      velocity: new THREE.Vector3(dir.x * speed, dir.y * speed + 2.5, dir.z * speed),
      fuse: FUSE_SECONDS,
      owner, // 'player' | bot
      team: owner === 'player' ? 0 : owner.team,
      alive: true,
    });
    audio.grenadeThrow();
  }

  function detonateGrenade(grenade, ctx) {
    grenade.alive = false;
    scene.remove(grenade.mesh);
    const p = grenade.position;
    blastLight.position.set(p.x, p.y + 0.5, p.z);
    blastLight.intensity = 60;
    blastLightLeft = 0.35;
    burst(p, 22, emberMat, 7, 0.7, 5);
    burst(p, 10, dustMat, 4, 1.1, 3);
    const playerDist = Math.hypot(p.x - ctx.playerPos.x, p.z - ctx.playerPos.z);
    audio.explosion(playerDist);
    ctx.onExplosion(p, playerDist);
    // Damage: full at the centre, fading to the edge; a wall between the blast
    // and the target blocks it entirely.
    function blastAt(x, y, z, team, target) {
      if (team === grenade.team && target !== grenade.owner) return; // no friendly fire
      const dx = x - p.x;
      const dy = y - p.y;
      const dz = z - p.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > BLAST_RADIUS) return;
      if (world.losBlocked(p.x, p.y, p.z, x, y, z)) return;
      const amount = Math.round(BLAST_DAMAGE * (1 - (dist / BLAST_RADIUS) * 0.85));
      ctx.damageTarget(target, amount, 'blast', grenade.owner);
    }
    if (ctx.playerAlive) blastAt(ctx.playerPos.x, ctx.playerPos.y + 1, ctx.playerPos.z, 0, 'player');
    for (const bot of ctx.bots) {
      if (bot.alive) blastAt(bot.position.x, bot.position.y + 1, bot.position.z, bot.team, bot);
    }
  }

  function stepGrenades(dt, ctx) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      if (!g.alive) {
        grenades.splice(i, 1);
        continue;
      }
      g.fuse -= dt;
      g.velocity.y -= 20 * dt;
      const next = scratch.copy(g.position).addScaledVector(g.velocity, dt);
      // Collide against the world: on a hit, reflect the shallowest axis.
      let bounced = false;
      for (const box of world.colliders) {
        if (next.x > box.min.x - 0.09 && next.x < box.max.x + 0.09 && next.y > box.min.y - 0.09 && next.y < box.max.y + 0.09 && next.z > box.min.z - 0.09 && next.z < box.max.z + 0.09) {
          const penX = Math.min(next.x - (box.min.x - 0.09), (box.max.x + 0.09) - next.x);
          const penY = Math.min(next.y - (box.min.y - 0.09), (box.max.y + 0.09) - next.y);
          const penZ = Math.min(next.z - (box.min.z - 0.09), (box.max.z + 0.09) - next.z);
          if (penY <= penX && penY <= penZ) {
            g.velocity.y = Math.abs(g.velocity.y) < 1.2 ? 0 : -g.velocity.y * 0.4;
            g.velocity.x *= 0.7;
            g.velocity.z *= 0.7;
            next.y = g.velocity.y === 0 ? box.max.y + 0.09 : next.y;
          } else if (penX <= penZ) {
            g.velocity.x = -g.velocity.x * 0.45;
          } else {
            g.velocity.z = -g.velocity.z * 0.45;
          }
          bounced = true;
          break;
        }
      }
      if (!bounced && next.y < 0.09) {
        next.y = 0.09;
        g.velocity.y = Math.abs(g.velocity.y) < 1.2 ? 0 : -g.velocity.y * 0.4;
        g.velocity.x *= 0.7;
        g.velocity.z *= 0.7;
      }
      g.position.copy(next);
      g.mesh.rotation.x += dt * 9;
      if (g.fuse <= 0) detonateGrenade(g, ctx);
    }
  }

  // The player's shot: a raycast against the world and the bots' hit meshes.
  // Returns the hit, if any, with the damage already falloff-scaled.
  function playerShoot(origin, dir, def, shootables) {
    raycaster.set(origin, dir);
    // The nearest hit wins, but a fallen bot's corpse never stops a bullet.
    const hits = raycaster.intersectObjects(shootables, false);
    let hit = null;
    for (const candidate of hits) {
      const candidateBot = candidate.object.userData.bot;
      if (candidateBot && !candidateBot.alive) continue;
      hit = candidate;
      break;
    }
    if (!hit) {
      scratch.copy(origin).addScaledVector(dir, 60);
      drawTracer(origin, scratch, false);
      return null;
    }
    drawTracer(origin, hit.point, false);
    const bot = hit.object.userData.bot;
    if (bot && bot.alive) {
      const part = hit.object.userData.part;
      const amount = Math.round(scaledDamage(def.damage, hit.distance, def.falloff) * (part === 'head' ? def.headMult : 1));
      burst(hit.point, 5, sparkMat, 3, 0.4);
      return { bot, part, amount, distance: hit.distance };
    }
    burst(hit.point, 4, dustMat, 2.5, 0.5);
    return { wall: true, distance: hit.distance };
  }

  // Body boxes for the analytic bot shot: torso and head, crouched or standing.
  function bodyBoxes(isPlayer, crouching) {
    const torsoTop = crouching ? 0.95 : isPlayer ? 1.35 : 1.17;
    const torsoBottom = crouching ? 0.35 : 0.55;
    const headBottom = crouching ? 0.95 : 1.27;
    const headTop = crouching ? 1.18 : 1.57;
    return { torsoTop, torsoBottom, headBottom, headTop };
  }

  // A bot's shot: an aim point with an error that grows with range and target
  // speed, then a ray against the target's body boxes. Returns the hit or null.
  function botShoot(bot, target, ctx) {
    const eye = scratch.set(bot.position.x, bot.position.y + 1.5, bot.position.z);
    const isPlayer = target.kind === 'player';
    let aimX;
    let aimY;
    let aimZ;
    let targetSpeed = 0;
    let crouching = false;
    if (isPlayer) {
      aimX = ctx.playerPos.x;
      aimZ = ctx.playerPos.z;
      crouching = ctx.playerCrouching;
      aimY = ctx.playerPos.y + (crouching ? 0.7 : 1.15);
      targetSpeed = ctx.playerSpeed;
    } else {
      aimX = target.bot.position.x;
      aimY = target.bot.position.y + 1.15;
      aimZ = target.bot.position.z;
      targetSpeed = target.bot.moving ? 4.3 : 0;
    }
    const dist = Math.hypot(aimX - eye.x, aimY - eye.y, aimZ - eye.z);
    const error = 0.22 + dist * 0.014 + targetSpeed * 0.07;
    aimX += (random() - 0.5) * 2 * error;
    aimY += (random() - 0.5) * 2 * error * 0.7;
    aimZ += (random() - 0.5) * 2 * error;
    aimDir.set(aimX - eye.x, aimY - eye.y, aimZ - eye.z).normalize();
    if (world.losBlocked(eye.x, eye.y, eye.z, aimX, aimY, aimZ)) {
      endPoint.copy(eye).addScaledVector(aimDir, Math.min(dist, 40));
      drawTracer(eye, endPoint, true);
      return null;
    }
    const px = isPlayer ? ctx.playerPos.x : target.bot.position.x;
    const py = isPlayer ? ctx.playerPos.y : target.bot.position.y;
    const pz = isPlayer ? ctx.playerPos.z : target.bot.position.z;
    const boxes = bodyBoxes(isPlayer, crouching);
    boxMin.set(px - 0.26, py + boxes.torsoBottom, pz - 0.18);
    boxMax.set(px + 0.26, py + boxes.torsoTop, pz + 0.18);
    const torsoHit = rayVsBox(eye, aimDir, boxMin, boxMax);
    boxMin.set(px - 0.16, py + boxes.headBottom, pz - 0.16);
    boxMax.set(px + 0.16, py + boxes.headTop, pz + 0.16);
    const headHit = rayVsBox(eye, aimDir, boxMin, boxMax);
    let part = null;
    let hitDist = Infinity;
    if (headHit >= 0 && headHit < hitDist) {
      part = 'head';
      hitDist = headHit;
    }
    if (torsoHit >= 0 && torsoHit < hitDist) {
      part = 'torso';
      hitDist = torsoHit;
    }
    const end = endPoint.copy(eye).addScaledVector(aimDir, part ? hitDist : Math.min(dist + 8, 60));
    drawTracer(eye, end, true);
    if (!part) return null;
    const amount = Math.round(scaledDamage(BOT_DAMAGE, hitDist, 25) * (part === 'head' ? 2 : 1));
    return { part, amount, distance: hitDist, target };
  }

  function update(dt, ctx) {
    stepGrenades(dt, ctx);
    for (const tracer of tracers) {
      if (tracer.life > 0) {
        tracer.life -= dt;
        if (tracer.life <= 0) tracer.line.visible = false;
      }
    }
    for (const p of particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      p.velocity.y -= 9 * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.scale.setScalar(Math.max(0.2, p.life / p.maxLife));
    }
    if (blastLightLeft > 0) {
      blastLightLeft -= dt;
      blastLight.intensity = Math.max(0, blastLight.intensity - dt * 220);
    }
  }

  function reset() {
    for (const g of grenades) scene.remove(g.mesh);
    grenades.length = 0;
    for (const tracer of tracers) tracer.line.visible = false;
    for (const p of particles) {
      p.mesh.visible = false;
      p.life = 0;
    }
    blastLight.intensity = 0;
  }

  return {
    playerShoot,
    botShoot,
    throwGrenade,
    explosion,
    update,
    reset,
    activeGrenades() {
      return grenades.length;
    },
  };
}
