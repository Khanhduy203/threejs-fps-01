// The bomb: one device, one lifecycle. Carried by the player (or, if the player
// falls, by the teammate bot that picks it up), planted by holding E inside a
// site, then counting down to an explosion a WARDEN can stop only by holding E
// beside it. The beeps quicken as the timer runs out.
import * as THREE from 'three';
import { MATCH } from './state.js';
import { SITES } from './world.js';

export function createBomb(scene, audio) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.2, 0.24),
    new THREE.MeshStandardMaterial({ color: 0x2a2723, roughness: 0.5, metalness: 0.6 }),
  );
  body.position.y = 0.1;
  body.castShadow = true;
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), lampMat);
  lamp.position.set(0.1, 0.22, 0);
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6),
    new THREE.MeshBasicMaterial({ color: 0x888888 }),
  );
  antenna.position.set(-0.12, 0.3, 0);
  group.add(body, lamp, antenna);
  group.visible = false;
  scene.add(group);

  let beepAt = 0;
  let blinkAt = 0;
  let lampOn = true;

  function setVisibleAt(x, z) {
    group.visible = true;
    group.position.set(x, 0, z);
  }

  return {
    group,
    reset() {
      group.visible = false;
      beepAt = 0;
      blinkAt = 0;
    },
    dropAt(x, z) {
      setVisibleAt(x, z);
    },
    detonate() {
      group.visible = false;
    },
    update(dt, ctx) {
      const state = ctx.state;
      const bomb = state.bomb;
      if (state.phase !== 'live') return;
      if (bomb.state === 'carried') {
        group.visible = false;
        // Who is planting: the player holding E in a site, or the carrier bot
        // standing in its target site.
        let planting = false;
        let site = null;
        if (bomb.carrier === 'player' && ctx.playerAlive && ctx.plantHeld) {
          site = ctx.world.siteAt(ctx.playerPos.x, ctx.playerPos.z);
          planting = site !== null;
          if (planting) bomb.planter = 'player';
        } else if (bomb.carrier !== 'player' && bomb.carrier) {
          const carrier = ctx.bots.find((b) => b.id === bomb.carrier);
          if (carrier && carrier.alive) {
            site = ctx.world.siteAt(carrier.position.x, carrier.position.z);
            planting = site !== null;
            if (planting) bomb.planter = carrier.id;
          }
        }
        if (planting) {
          bomb.plantProgress += dt / MATCH.plantTime;
          if (bomb.plantProgress >= 1) {
            bomb.plantProgress = 0;
            bomb.state = 'planted';
            bomb.site = site;
            bomb.x = site === 'A' ? SITES.A.x : SITES.B.x;
            bomb.z = site === 'A' ? SITES.A.z : SITES.B.z;
            state.timer = MATCH.bombTime;
            setVisibleAt(bomb.x, bomb.z);
            audio.plant();
            ctx.onPlanted(site);
          }
        } else {
          bomb.plantProgress = Math.max(0, bomb.plantProgress - dt * 2);
        }
        return;
      }
      if (bomb.state === 'dropped') {
        setVisibleAt(bomb.x, bomb.z);
        return;
      }
      if (bomb.state === 'planted') {
        setVisibleAt(bomb.x, bomb.z);
        // Blink and beep faster as the timer runs out.
        const interval = state.timer > 15 ? 1.0 : state.timer > 8 ? 0.5 : 0.25;
        if (state.elapsed >= blinkAt) {
          lampOn = !lampOn;
          lampMat.color.setHex(lampOn ? 0xff3b30 : 0x551512);
          blinkAt = state.elapsed + interval / 2;
        }
        if (state.elapsed >= beepAt) {
          audio.beep(state.timer <= 8);
          beepAt = state.elapsed + interval;
        }
        // A WARDEN standing at the bomb defuses it; the player is STRIKE, so
        // only bots defuse, and only while they stay put.
        let defusing = false;
        for (const bot of ctx.bots) {
          if (!bot.alive || bot.team !== 1) continue;
          const dx = bot.position.x - bomb.x;
          const dz = bot.position.z - bomb.z;
          if (dx * dx + dz * dz < 1.6 * 1.6) {
            defusing = true;
            bomb.defuser = bot.id;
            break;
          }
        }
        if (defusing) {
          bomb.defuseProgress += dt / MATCH.defuseTime;
          if (bomb.defuseProgress >= 1) {
            bomb.defuseProgress = 0;
            bomb.state = 'defused';
            group.visible = false;
            audio.defuse();
            ctx.onDefused();
          }
        } else {
          bomb.defuseProgress = Math.max(0, bomb.defuseProgress - dt * 2);
        }
      }
    },
  };
}
