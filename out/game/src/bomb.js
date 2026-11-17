// The bomb: one device, one lifecycle. Carried by the player (or, if the
// player falls, by the teammate bot that picks it up), planted by holding E
// inside a site, then counting down to an explosion a WARDEN can stop only by
// holding E beside it. The beeps quicken as the timer runs out.
//
// The update is split by the bomb's own state — carried, dropped, planted —
// because each state has its own actors and its own end conditions, and a
// single function that tried to cover all three would re-check the state on
// every branch. The mesh is built from a parts table for the same reason:
// the device is a box, a lamp and an antenna, and the table says where each
// sits without a paragraph of constructor calls.
import * as THREE from 'three';
import { MATCH } from './state.js';
import { SITES } from './world.js';

// How fast a half-finished plant or defuse decays when the holder lets go:
// progress drains twice as fast as it builds, so a tap-and-run never plants.
const DECAY_RATE = 2;
// A WARDEN defuses by standing this close to the planted bomb.
const DEFUSE_RADIUS = 1.6;

// Blink/beep cadence by time left on the bomb timer: calm above 15 s,
// hurried above 8 s, frantic below it. The lamp toggles twice per interval,
// the beep sounds once.
const CADENCE = [
  { above: 15, interval: 1.0 },
  { above: 8, interval: 0.5 },
  { above: -Infinity, interval: 0.25 },
];

function cadenceFor(secondsLeft) {
  for (const band of CADENCE) {
    if (secondsLeft > band.above) return band.interval;
  }
  return CADENCE[CADENCE.length - 1].interval;
}

export function createBomb(scene, audio) {
  const group = new THREE.Group();

  // [geometry, material, x, y, z] — the body sits on the ground, the lamp
  // rides on top, the antenna leans off the back corner.
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2723, roughness: 0.5, metalness: 0.6 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  const steelMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
  const parts = [
    [new THREE.BoxGeometry(0.34, 0.2, 0.24), bodyMat, 0, 0.1, 0],
    [new THREE.SphereGeometry(0.045, 8, 8), lampMat, 0.1, 0.22, 0],
    [new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), steelMat, -0.12, 0.3, 0],
  ];
  for (const [geometry, material, x, y, z] of parts) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    if (material === bodyMat) mesh.castShadow = true;
    group.add(mesh);
  }
  // The blink drives the lamp's shared material directly, so no mesh
  // reference needs keeping after the build.
  group.visible = false;
  scene.add(group);

  // Timers for the planted bomb's blink and beep, in elapsed seconds, and
  // the lamp's current on/off state. All three reset with the round.
  let beepAt = 0;
  let blinkAt = 0;
  let lampOn = true;

  function placeAt(x, z) {
    group.visible = true;
    group.position.set(x, 0, z);
  }

  function setLamp(on) {
    lampMat.color.setHex(on ? 0xff3b30 : 0x551512);
  }

  // Who is planting, and where: the player holding E inside a site, or the
  // carrier bot standing in its target site. Returns the site being planted
  // in, or null when nobody is planting.
  function plantingSite(ctx) {
    const bomb = ctx.state.bomb;
    if (bomb.carrier === 'player') {
      if (!ctx.playerAlive || !ctx.plantHeld) return null;
      return ctx.world.siteAt(ctx.playerPos.x, ctx.playerPos.z);
    }
    if (!bomb.carrier) return null;
    const carrier = ctx.bots.find((b) => b.id === bomb.carrier);
    if (!carrier || !carrier.alive) return null;
    return ctx.world.siteAt(carrier.position.x, carrier.position.z);
  }

  function finishPlant(ctx, site) {
    const state = ctx.state;
    const bomb = state.bomb;
    bomb.plantProgress = 0;
    bomb.state = 'planted';
    bomb.site = site;
    const sitePos = site === 'A' ? SITES.A : SITES.B;
    bomb.x = sitePos.x;
    bomb.z = sitePos.z;
    // The bomb is in the ground now: nobody carries it, so the planter's
    // death can no longer drop it.
    if (bomb.carrier && bomb.carrier !== 'player') {
      const carrier = ctx.bots.find((b) => b.id === bomb.carrier);
      if (carrier) carrier.hasBomb = false;
    }
    bomb.carrier = null;
    state.timer = MATCH.bombTime;
    placeAt(bomb.x, bomb.z);
    audio.plant();
    ctx.onPlanted(site);
  }

  function updateCarried(dt, ctx) {
    const bomb = ctx.state.bomb;
    group.visible = false;
    const site = plantingSite(ctx);
    if (site) {
      if (bomb.carrier === 'player') bomb.planter = 'player';
      else bomb.planter = bomb.carrier;
      bomb.plantProgress += dt / MATCH.plantTime;
      if (bomb.plantProgress >= 1) finishPlant(ctx, site);
    } else {
      bomb.plantProgress = Math.max(0, bomb.plantProgress - dt * DECAY_RATE);
    }
  }

  // Blink and beep faster as the timer runs out.
  function updateSignals(state) {
    const interval = cadenceFor(state.timer);
    if (state.elapsed >= blinkAt) {
      lampOn = !lampOn;
      setLamp(lampOn);
      blinkAt = state.elapsed + interval / 2;
    }
    if (state.elapsed >= beepAt) {
      audio.beep(state.timer <= 8);
      beepAt = state.elapsed + interval;
    }
  }

  // A WARDEN standing at the bomb defuses it; the player is STRIKE, so only
  // bots defuse, and only while they stay put.
  function defuserNear(ctx) {
    const bomb = ctx.state.bomb;
    for (const bot of ctx.bots) {
      if (!bot.alive || bot.team !== 1) continue;
      const dx = bot.position.x - bomb.x;
      const dz = bot.position.z - bomb.z;
      if (dx * dx + dz * dz < DEFUSE_RADIUS * DEFUSE_RADIUS) return bot;
    }
    return null;
  }

  function updatePlanted(dt, ctx) {
    const state = ctx.state;
    const bomb = state.bomb;
    placeAt(bomb.x, bomb.z);
    updateSignals(state);
    const defuser = defuserNear(ctx);
    if (defuser) {
      bomb.defuser = defuser.id;
      bomb.defuseProgress += dt / MATCH.defuseTime;
      if (bomb.defuseProgress >= 1) {
        bomb.defuseProgress = 0;
        bomb.state = 'defused';
        group.visible = false;
        audio.defuse();
        ctx.onDefused();
      }
    } else {
      bomb.defuseProgress = Math.max(0, bomb.defuseProgress - dt * DECAY_RATE);
    }
  }

  return {
    group,
    reset() {
      group.visible = false;
      beepAt = 0;
      blinkAt = 0;
    },
    dropAt(x, z) {
      placeAt(x, z);
    },
    detonate() {
      group.visible = false;
    },
    update(dt, ctx) {
      const state = ctx.state;
      if (state.phase !== 'live') return;
      const bomb = state.bomb;
      if (bomb.state === 'carried') updateCarried(dt, ctx);
      else if (bomb.state === 'dropped') placeAt(bomb.x, bomb.z);
      else if (bomb.state === 'planted') updatePlanted(dt, ctx);
    },
  };
}
