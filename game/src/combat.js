// Combat resolution: the player's raycast shots, the bots' analytic rays, the
// frag grenade, and the feedback that makes a hit feel like a hit (tracers,
// impact particles, explosion light). One shared ray-vs-body test decides what a
// bot bullet hits, so a bot can miss, graze a torso or land a headshot by geometry
// rather than by a dice roll.
import * as THREE from 'three';
import { BOT_DAMAGE } from './bots.js';

const GRENADE_FUSE = 2.2;
const GRENADE_RADIUS = 6.5;
const GRENADE_MAX_DAMAGE = 130;
const TRACER_LIFE = 0.09;
const MAX_TRACERS = 24;
const MAX_PARTICLES = 48;

function falloff(damage, distance, start) {
  if (distance <= start) return damage;
  const t = Math.min(1, (distance - start) / start);
  return damage * (1 - 0.5 * t);
}

// Slab test: does the ray hit the axis-aligned box? Returns the distance or -1.
function rayBox(origin, dir, min, max) {
  let tmin = 0;
  let tmax = Infinity;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const lo = [min.x, min.y, min.z];
  const hi = [max.x, max.y, max.z];
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return -1;
    } else {
      let t1 = (lo[i] - o[i]) / d[i];
      let t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

export function createCombat(scene, world, random, audio) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 120;
  const direction = new THREE.Vector3();
  const tmpMin = new THREE.Vector3();
  const tmpMax = new THREE.Vector3();
  const tmpPoint = new THREE.Vector3();

  // Tracer pool: lines reused, never allocated mid-frame.
  const tracers = [];
  const tracerMatPlayer = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9 });
  const tracerMatEnemy = new THREE.LineBasicMaterial({ color: 0xff9a5c, transparent: true, opacity: 0.9 });
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, tracerMatPlayer);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;

  function spawnTracer(from, to, enemy) {
    const tracer = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % MAX_TRACERS;
    const pos = tracer.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    tracer.line.material = enemy ? tracerMatEnemy : tracerMatPlayer;
    tracer.line.visible = true;
    tracer.life = TRACER_LIFE;
  }

  // Particle pool: small boxes with a velocity and a life, for impacts and blasts.
  const particles = [];
  const particleGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc46b });
  const dustMat = new THREE.MeshBasicMaterial({ color: 0xc8a86a });
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xff6a2e });
  for (let i = 0; i < MAX_PARTICLES; i += 1) {
    const mesh = new THREE.Mesh(particleGeo, sparkMat);
    mesh.visible = false;
    scene.add(mesh);
    particles.push({ mesh, velocity: new THREE.Vector3(), life: 0, maxLife: 1 });
  }
  let particleIndex = 0;

  function spawnParticles(point, count, material, speed, life, up = 2) {
    for (let i = 0; i < count; i += 1) {
      const p = particles[particleIndex];
      particleIndex = (particleIndex + 1) % MAX_PARTICLES;
      p.mesh.material = material;
      p.mesh.visible = true;
      p.mesh.position.copy(point);
      p.velocity.set((random() - 0.5) * speed, random() * up, (random() - 0.5) * speed);
      p.life = life * (0.6 + random() * 0.7);
      p.maxLife = p.life;
      p.mesh.scale.setScalar(1);
    }
  }

  const explosionLight = new THREE.PointLight(0xff8a3c, 0, 18, 1.6);
  scene.add(explosionLight);
  let explosionLightLife = 0;

  // A big blast at a point: the bomb's explosion (grenades use explodeGrenade).
  function explosion(point) {
    explosionLight.position.set(point.x, point.y + 0.5, point.z);
    explosionLight.intensity = 90;
    explosionLightLife = 0.6;
    spawnParticles(point, 26, emberMat, 9, 0.9, 6);
    spawnParticles(point, 14, dustMat, 5, 1.4, 4);
  }
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2a2723, roughness: 0.5, metalness: 0.6 });

  function throwGrenade(from, dir, owner, speed = 13) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.castShadow = true;
    mesh.position.copy(from);
    scene.add(mesh);
    grenades.push({
      mesh,
      position: mesh.position,
      velocity: new THREE.Vector3(dir.x * speed, dir.y * speed + 2.5, dir.z * speed),
      fuse: GRENADE_FUSE,
      owner, // 'player' | bot
      team: owner === 'player' ? 0 : owner.team,
      alive: true,
    });
    audio.grenadeThrow();
  }

  function explodeGrenade(grenade, ctx) {
    grenade.alive = false;
    scene.remove(grenade.mesh);
    const p = grenade.position;
    explosionLight.position.set(p.x, p.y + 0.5, p.z);
    explosionLight.intensity = 60;
    explosionLightLife = 0.35;
    spawnParticles(p, 22, emberMat, 7, 0.7, 5);
    spawnParticles(p, 10, dustMat, 4, 1.1, 3);
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
      if (dist > GRENADE_RADIUS) return;
      if (world.losBlocked(p.x, p.y, p.z, x, y, z)) return;
      const amount = Math.round(GRENADE_MAX_DAMAGE * (1 - (dist / GRENADE_RADIUS) * 0.85));
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
      const next = tmpPoint.copy(g.position).addScaledVector(g.velocity, dt);
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
      if (g.fuse <= 0) explodeGrenade(g, ctx);
    }
  }

  // The player's shot: a raycast against the world and the bots' hit meshes.
  // Returns the hit, if any, with the damage already falloff-scaled.
  function playerShoot(origin, dir, def, shootables) {
    raycaster.set(origin, dir);
    const hit = raycaster.intersectObjects(shootables, false)[0];
    if (!hit) {
      tmpPoint.copy(origin).addScaledVector(dir, 60);
      spawnTracer(origin, tmpPoint, false);
      return null;
    }
    spawnTracer(origin, hit.point, false);
    const bot = hit.object.userData.bot;
    if (bot && bot.alive) {
      const part = hit.object.userData.part;
      const amount = Math.round(falloff(def.damage, hit.distance, def.falloff) * (part === 'head' ? def.headMult : 1));
      spawnParticles(hit.point, 5, sparkMat, 3, 0.4);
      return { bot, part, amount, distance: hit.distance, point: hit.point.clone() };
    }
    spawnParticles(hit.point, 4, dustMat, 2.5, 0.5);
    return { wall: true, distance: hit.distance, point: hit.point.clone() };
  }

  // A bot's shot: an aim point with an error that grows with range and target
  // speed, then a ray against the target's body boxes. Returns the hit or null.
  function botShoot(bot, target, ctx) {
    const eye = tmpPoint.set(bot.position.x, bot.position.y + 1.5, bot.position.z);
    let aimX;
    let aimY;
    let aimZ;
    let targetSpeed = 0;
    let crouching = false;
    if (target.kind === 'player') {
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
    direction.set(aimX - eye.x, aimY - eye.y, aimZ - eye.z).normalize();
    if (world.losBlocked(eye.x, eye.y, eye.z, aimX, aimY, aimZ)) {
      spawnTracer(eye, direction.clone().multiplyScalar(Math.min(dist, 40)).add(eye), true);
      return null;
    }
    // Body boxes: torso and head, crouched or standing.
    const px = target.kind === 'player' ? ctx.playerPos.x : target.bot.position.x;
    const py = target.kind === 'player' ? ctx.playerPos.y : target.bot.position.y;
    const pz = target.kind === 'player' ? ctx.playerPos.z : target.bot.position.z;
    const torsoTop = crouching ? 0.95 : target.kind === 'player' ? 1.35 : 1.17;
    const torsoBottom = crouching ? 0.35 : 0.55;
    const headBottom = crouching ? 0.95 : 1.27;
    const headTop = crouching ? 1.18 : 1.57;
    tmpMin.set(px - 0.26, py + torsoBottom, pz - 0.18);
    tmpMax.set(px + 0.26, py + torsoTop, pz + 0.18);
    const torsoHit = rayBox(eye, direction, tmpMin, tmpMax);
    tmpMin.set(px - 0.16, py + headBottom, pz - 0.16);
    tmpMax.set(px + 0.16, py + headTop, pz + 0.16);
    const headHit = rayBox(eye, direction, tmpMin, tmpMax);
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
    const end = new THREE.Vector3().copy(eye).addScaledVector(direction, part ? hitDist : Math.min(dist + 8, 60));
    spawnTracer(eye, end, true);
    if (!part) return null;
    const amount = Math.round(falloff(BOT_DAMAGE, hitDist, 25) * (part === 'head' ? 2 : 1));
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
    if (explosionLightLife > 0) {
      explosionLightLife -= dt;
      explosionLight.intensity = Math.max(0, explosionLight.intensity - dt * 220);
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
    explosionLight.intensity = 0;
  }

  return {
    playerShoot,
    botShoot,
    throwGrenade,
    explosion,
    update,
    reset,
    spawnParticles,
  };
}
