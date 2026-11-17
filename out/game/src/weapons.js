// The armoury: four hitscan weapons plus the frag grenade. Each definition
// owns its damage, headshot multiplier, magazine, fire rate, reload, spread
// and falloff; this module owns the view models, the bloom that punishes
// spraying, and the loadout (what the player owns this round, and which gun
// is in hand).
//
// The definitions are rows in one table, not four separate literals, so the
// shape of a weapon is declared once and every gun fills the same columns —
// a missing column is a visible gap in the row, not a silent undefined. The
// view models are built the same way: each gun is a list of boxes, and the
// table says what each box is, so the silhouettes stay comparable at a
// glance. Nothing here changes a number: the table carries the exact stats
// the game has always shipped with.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// [id, name, kind, price, damage, headMult, mag, reserve, gap, reload, auto,
//  spreadStill, spreadMove, adsSpread, recoil, falloff, zoom]
// adsSpread is null for every gun but the sniper: only the sniper is scoped,
// and only the scoped spread is a fixed number instead of a fraction of the
// hipfire spread.
const WEAPON_ROWS = [
  ['pistol', 'P9 Sidearm', 'pistol', 0, 34, 4, 12, 48, 0.22, 1.6, false, 0.004, 0.02, null, 0.011, 18, 1],
  ['smg', 'VK-9 Ripper', 'smg', 1200, 26, 4, 30, 120, 0.075, 2.0, true, 0.006, 0.03, null, 0.007, 14, 1],
  ['rifle', 'AR-77 Carbine', 'rifle', 2700, 36, 4, 30, 90, 0.1, 2.2, true, 0.003, 0.026, null, 0.01, 24, 1.5],
  ['sniper', 'LANCE-50', 'sniper', 4500, 110, 4, 5, 15, 1.4, 3.2, false, 0.02, 0.05, 0.0005, 0.05, 60, 2.6],
];

const WEAPON_FIELDS = [
  'id', 'name', 'kind', 'price', 'damage', 'headMult', 'mag', 'reserve',
  'gap', 'reload', 'auto', 'spreadStill', 'spreadMove', 'adsSpread',
  'recoil', 'falloff', 'zoom',
];

function weaponFromRow(row) {
  const def = {};
  for (let i = 0; i < WEAPON_FIELDS.length; i += 1) def[WEAPON_FIELDS[i]] = row[i];
  return def;
}

export const WEAPONS = {};
for (const row of WEAPON_ROWS) WEAPONS[row[0]] = weaponFromRow(row);
export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'sniper'];

const MUZZLE_TIME = 0.06;
const BLOOM_PER_SHOT = 0.004;
const BLOOM_CAP = 0.03;
const BLOOM_DECAY = 0.09; // per second, so a burst needs a pause to settle
const KICK_PER_SHOT = 0.055;
const KICK_RECOVER = 14; // per second, back toward zero
const SWITCH_DELAY = 0.25; // a switch costs a beat
const MODEL_HOME = { x: 0.24, y: -0.2, z: -0.42 };
const MODEL_AIM = { x: 0, y: -0.185, z: -0.42 };
const FLASH_SPOT = { x: 0.24, y: -0.18, z: -0.95 };
const LIGHT_SPOT = { x: 0.24, y: -0.16, z: -0.6 };

// One boxy view model per gun, each with its own silhouette: the pistol is
// short, the SMG has a fat magazine, the rifle a long barrel, the sniper a
// scope and a bipod-less heavy barrel. Each part is [w, h, d, x, y, z, mat],
// with mat 0 = body, 1 = grip, 2 = dark steel.
const MODEL_PARTS = {
  pistol: [
    [0.07, 0.09, 0.24, 0, 0, -0.1, 0],
    [0.06, 0.14, 0.07, 0, -0.1, 0.04, 1],
    [0.03, 0.03, 0.06, 0, 0.055, -0.16, 2],
  ],
  smg: [
    [0.08, 0.1, 0.4, 0, 0, -0.12, 0],
    [0.05, 0.05, 0.2, 0, 0.02, -0.36, 1],
    [0.06, 0.18, 0.09, 0, -0.12, -0.12, 1],
    [0.07, 0.08, 0.14, 0, -0.01, 0.16, 1],
  ],
  rifle: [
    [0.09, 0.1, 0.44, 0, 0, -0.1, 0],
    [0.045, 0.045, 0.34, 0, 0.025, -0.44, 1],
    [0.075, 0.08, 0.22, 0, -0.02, 0.28, 1],
    [0.06, 0.14, 0.08, 0, -0.11, -0.02, 1],
    [0.04, 0.05, 0.12, 0, 0.075, -0.12, 2],
  ],
  sniper: [
    [0.1, 0.11, 0.5, 0, 0, -0.12, 2],
    [0.04, 0.04, 0.5, 0, 0.03, -0.56, 0],
    [0.05, 0.06, 0.22, 0, 0.1, -0.14, 1],
    [0.08, 0.09, 0.24, 0, -0.02, 0.3, 1],
    [0.06, 0.12, 0.07, 0, -0.1, 0.02, 1],
  ],
};

export function createWeapons(camera) {
  const mats = [
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 }),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 }),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.4 }),
  ];

  function buildModel(id) {
    const model = new THREE.Group();
    for (const [w, h, d, x, y, z, mat] of MODEL_PARTS[id]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat]);
      mesh.position.set(x, y, z);
      model.add(mesh);
    }
    model.position.set(MODEL_HOME.x, MODEL_HOME.y, MODEL_HOME.z);
    model.visible = false;
    camera.add(model);
    return model;
  }

  const models = {};
  for (const id of WEAPON_ORDER) models[id] = buildModel(id);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(FLASH_SPOT.x, FLASH_SPOT.y, FLASH_SPOT.z);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(LIGHT_SPOT.x, LIGHT_SPOT.y, LIGHT_SPOT.z);
  camera.add(flashLight);

  function freshSlot(def) {
    return { def, mag: def.mag, reserve: def.reserve };
  }

  const state = {
    owned: [freshSlot(WEAPONS.pistol)],
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

  function currentModel() {
    return models[currentSlot().def.id];
  }

  // Timers and bloom decay every frame, whether or not the player fires.
  function decayTimers(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * KICK_RECOVER);
    state.bloom = Math.max(0, state.bloom - BLOOM_DECAY * dt);
  }

  // Walk bob, scaled by speed; aiming pulls the gun to the centre and
  // stills it. The model's X eases toward its hip or aim slot, while Y and
  // Z bob on the walk cycle and ride the recoil kick.
  function poseModel(dt, speed, aiming) {
    const model = currentModel();
    state.bobTime += dt * (2 + speed * 1.6);
    const bob = Math.min(1, speed / 5.2) * (aiming ? 0.15 : 1);
    const home = aiming ? MODEL_AIM : MODEL_HOME;
    model.position.x += (home.x - model.position.x) * Math.min(1, dt * 12);
    model.position.y = home.y + Math.sin(state.bobTime * 2) * 0.006 * bob;
    model.position.z = home.z + state.kick + Math.cos(state.bobTime) * 0.004 * bob;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
  }

  // A reload tilts the gun down and back up over the reload, and tops the
  // magazine up from reserve the moment the timer reaches zero.
  function advanceReload(dt) {
    if (state.reloadLeft <= 0) return;
    state.reloadLeft = Math.max(0, state.reloadLeft - dt);
    const progress = 1 - state.reloadLeft / state.reloadTotal;
    currentModel().rotation.x = -0.55 * Math.sin(progress * Math.PI);
    if (state.reloadLeft === 0) {
      const slot = currentSlot();
      const need = slot.def.mag - slot.mag;
      const take = Math.min(need, slot.reserve);
      slot.mag += take;
      slot.reserve -= take;
    }
  }

  function step(dt, speed, aiming) {
    decayTimers(dt);
    poseModel(dt, speed, aiming);
    advanceReload(dt);
  }

  function showCurrent() {
    for (const id of WEAPON_ORDER) models[id].visible = false;
    currentModel().visible = true;
    state.reloadLeft = 0;
    state.cooldown = Math.max(state.cooldown, SWITCH_DELAY); // a switch costs a beat
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
      state.kick = KICK_PER_SHOT;
      state.bloom = Math.min(BLOOM_CAP, state.bloom + BLOOM_PER_SHOT);
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
    // Spread: still < crouched < moving < airborne, bloom on top; aiming
    // down sights tightens it, and the sniper is only accurate scoped.
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
      state.owned.push(freshSlot(def));
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
      state.owned = [pistol ?? freshSlot(WEAPONS.pistol)];
      state.current = 0;
      state.grenades = 0;
      showCurrent();
    },
    resetRound(kept) {
      // kept: the loadout carried over from a survived round, or null for pistol only.
      if (kept && kept.length > 0) {
        state.owned = kept.map((slot) => freshSlot(slot.def));
        // A kept slot's ammo is its own: restore the counts, not the full mag.
        kept.forEach((slot, i) => {
          state.owned[i].mag = slot.mag;
          state.owned[i].reserve = slot.reserve;
        });
      } else {
        state.owned = [freshSlot(WEAPONS.pistol)];
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
