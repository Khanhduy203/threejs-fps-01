// The armoury: four hitscan weapons plus the frag grenade. Each definition owns its
// damage, headshot multiplier, magazine, fire rate, reload, spread and falloff;
// this module owns the view models, the bloom that punishes spraying, and the
// loadout (what the player owns this round, and which gun is in hand).
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: { id: 'pistol', name: 'P9 Sidearm', kind: 'pistol', price: 0, damage: 34, headMult: 4, mag: 12, reserve: 48, gap: 0.22, reload: 1.6, auto: false, spreadStill: 0.004, spreadMove: 0.02, recoil: 0.011, falloff: 18, zoom: 1 },
  smg: { id: 'smg', name: 'VK-9 Ripper', kind: 'smg', price: 1200, damage: 26, headMult: 4, mag: 30, reserve: 120, gap: 0.075, reload: 2.0, auto: true, spreadStill: 0.006, spreadMove: 0.03, recoil: 0.007, falloff: 14, zoom: 1 },
  rifle: { id: 'rifle', name: 'AR-77 Carbine', kind: 'rifle', price: 2700, damage: 36, headMult: 4, mag: 30, reserve: 90, gap: 0.1, reload: 2.2, auto: true, spreadStill: 0.003, spreadMove: 0.026, recoil: 0.01, falloff: 24, zoom: 1.5 },
  sniper: { id: 'sniper', name: 'LANCE-50', kind: 'sniper', price: 4500, damage: 110, headMult: 4, mag: 5, reserve: 15, gap: 1.4, reload: 3.2, auto: false, spreadStill: 0.02, spreadMove: 0.05, adsSpread: 0.0005, recoil: 0.05, falloff: 60, zoom: 2.6 },
};
export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'sniper'];

const MUZZLE_TIME = 0.06;
const BLOOM_PER_SHOT = 0.004;
const BLOOM_DECAY = 0.09; // per second, so a burst needs a pause to settle

export function createWeapons(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.4 });

  // One boxy view model per gun, each with its own silhouette: the pistol is
  // short, the SMG has a fat magazine, the rifle a long barrel, the sniper a
  // scope and a bipod-less heavy barrel.
  function buildModel(id) {
    const model = new THREE.Group();
    const add = (w, h, d, x, y, z, mat) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      model.add(mesh);
      return mesh;
    };
    if (id === 'pistol') {
      add(0.07, 0.09, 0.24, 0, 0, -0.1, bodyMat);
      add(0.06, 0.14, 0.07, 0, -0.1, 0.04, grip);
      add(0.03, 0.03, 0.06, 0, 0.055, -0.16, dark);
    } else if (id === 'smg') {
      add(0.08, 0.1, 0.4, 0, 0, -0.12, bodyMat);
      add(0.05, 0.05, 0.2, 0, 0.02, -0.36, grip);
      add(0.06, 0.18, 0.09, 0, -0.12, -0.12, grip);
      add(0.07, 0.08, 0.14, 0, -0.01, 0.16, grip);
    } else if (id === 'rifle') {
      add(0.09, 0.1, 0.44, 0, 0, -0.1, bodyMat);
      add(0.045, 0.045, 0.34, 0, 0.025, -0.44, grip);
      add(0.075, 0.08, 0.22, 0, -0.02, 0.28, grip);
      add(0.06, 0.14, 0.08, 0, -0.11, -0.02, grip);
      add(0.04, 0.05, 0.12, 0, 0.075, -0.12, dark);
    } else {
      add(0.1, 0.11, 0.5, 0, 0, -0.12, dark);
      add(0.04, 0.04, 0.5, 0, 0.03, -0.56, bodyMat);
      add(0.05, 0.06, 0.22, 0, 0.1, -0.14, grip);
      add(0.08, 0.09, 0.24, 0, -0.02, 0.3, grip);
      add(0.06, 0.12, 0.07, 0, -0.1, 0.02, grip);
    }
    model.position.set(0.24, -0.2, -0.42);
    model.visible = false;
    camera.add(model);
    return model;
  }

  const models = {};
  for (const id of WEAPON_ORDER) models[id] = buildModel(id);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = {
    owned: [{ def: WEAPONS.pistol, mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve }],
    current: 0,
    cooldown: 0,
    reloadLeft: 0,
    reloadTotal: 0,
    flash: 0,
    kick: 0,
    bloom: 0,
    grenades: 0,
    bobTime: 0,
  };

  function currentSlot() {
    return state.owned[state.current];
  }

  function step(dt, speed, aiming) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bloom = Math.max(0, state.bloom - BLOOM_DECAY * dt);
    const model = models[currentSlot().def.id];
    // Walk bob, scaled by speed; aiming pulls the gun to the centre and stills it.
    state.bobTime += dt * (2 + speed * 1.6);
    const bob = Math.min(1, speed / 5.2) * (aiming ? 0.15 : 1);
    const targetX = aiming ? 0 : 0.24;
    const targetY = aiming ? -0.185 : -0.2;
    model.position.x += (targetX - model.position.x) * Math.min(1, dt * 12);
    model.position.y = targetY + Math.sin(state.bobTime * 2) * 0.006 * bob;
    model.position.z = -0.42 + state.kick + Math.cos(state.bobTime) * 0.004 * bob;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const progress = 1 - state.reloadLeft / state.reloadTotal;
      model.rotation.x = -0.55 * Math.sin(progress * Math.PI);
      if (state.reloadLeft === 0) {
        const slot = currentSlot();
        const need = slot.def.mag - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
  }

  function showCurrent() {
    for (const id of WEAPON_ORDER) models[id].visible = false;
    models[currentSlot().def.id].visible = true;
    state.reloadLeft = 0;
    state.cooldown = Math.max(state.cooldown, 0.25); // a switch costs a beat
  }
  showCurrent();

  return {
    state,
    step,
    currentDef() {
      return currentSlot().def;
    },
    currentSlot,
    ready() {
      const slot = currentSlot();
      return slot.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = currentSlot().def.gap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.055;
      state.bloom = Math.min(0.03, state.bloom + BLOOM_PER_SHOT);
    },
    takeRound() {
      const slot = currentSlot();
      if (slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    reload() {
      const slot = currentSlot();
      if (state.reloadLeft > 0 || slot.mag === slot.def.mag || slot.reserve === 0) return false;
      state.reloadLeft = slot.def.reload;
      state.reloadTotal = slot.def.reload;
      return true;
    },
    // Spread: still < crouched < moving < airborne, bloom on top; aiming down
    // sights tightens it, and the sniper is only accurate scoped.
    spread(speed, aiming, crouching, onGround) {
      const def = currentSlot().def;
      let base = def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove;
      if (crouching) base *= 0.7;
      if (!onGround) base += 0.03;
      if (aiming) base = def.adsSpread ?? base * 0.45;
      return base + state.bloom;
    },
    switchTo(index) {
      if (index < 0 || index >= state.owned.length || index === state.current) return false;
      state.current = index;
      showCurrent();
      return true;
    },
    cycle(direction) {
      if (state.owned.length < 2) return;
      state.current = (state.current + direction + state.owned.length) % state.owned.length;
      showCurrent();
    },
    owns(id) {
      return state.owned.some((slot) => slot.def.id === id);
    },
    buy(id) {
      const def = WEAPONS[id];
      const existing = state.owned.find((slot) => slot.def.id === id);
      if (existing) {
        existing.reserve = def.reserve;
        existing.mag = def.mag;
        return true;
      }
      state.owned.push({ def, mag: def.mag, reserve: def.reserve });
      state.current = state.owned.length - 1;
      showCurrent();
      return true;
    },
    refillAmmo() {
      for (const slot of state.owned) {
        slot.reserve = slot.def.reserve;
        slot.mag = slot.def.mag;
      }
    },
    // Death drops everything but the sidearm; surviving a round keeps the loadout.
    dropToPistol() {
      const pistol = state.owned.find((slot) => slot.def.id === 'pistol');
      state.owned = [pistol ?? { def: WEAPONS.pistol, mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve }];
      state.current = 0;
      state.grenades = 0;
      showCurrent();
    },
    resetRound(kept) {
      // kept: the loadout carried over from a survived round, or null for pistol only.
      if (kept && kept.length > 0) {
        state.owned = kept.map((slot) => ({ def: slot.def, mag: slot.mag, reserve: slot.reserve }));
      } else {
        state.owned = [{ def: WEAPONS.pistol, mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve }];
      }
      state.current = state.owned.length - 1;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
      showCurrent();
    },
    snapshotLoadout() {
      return state.owned.map((slot) => ({ def: slot.def, mag: slot.mag, reserve: slot.reserve }));
    },
  };
}
