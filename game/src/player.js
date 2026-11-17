// The player: acceleration, friction, gravity, crouch and jump, resolved as a
// box against the world's colliders one axis at a time, so a wall never
// swallows the player. It also owns health and armour: armour absorbs half of
// every hit until it runs out. Movement speed feeds weapon spread, so
// stopping to aim pays.
//
// The step is staged — stance, then horizontal wish, then vertical, then the
// three axis resolutions in order — because each stage only needs the result
// of the one before it, and a bug in one stage cannot silently move the
// player in another. The numbers live in one TUNING table at the top, so a
// feel change is a value change, never a hunt through the step.
import * as THREE from 'three';

const TUNING = {
  radius: 0.34,
  standHeight: 1.72,
  crouchHeight: 1.12,
  standEye: 1.6,
  crouchEye: 1.02,
  walkSpeed: 5.2,
  crouchSpeed: 2.4,
  adsSpeed: 3.2,
  groundAccel: 42,
  airAccel: 9,
  friction: 9,
  gravity: 20,
  jumpSpeed: 6.2,
  maxFall: 30,
  lookSensitivity: 0.0022,
  pitchLimit: 1.45,
  eyeLerp: 12,
  // lift keeps the feet and the crown out of the horizontal tests, so
  // standing on the floor is not read as walking into a wall.
  wallLift: 0.04,
  standLift: 0.02,
};

// Keys that crouch, and the two movement axes, as tables instead of inline
// literals — the step reads them, and a remap would touch one line each.
const CROUCH_KEYS = ['ControlLeft', 'ControlRight', 'KeyC'];
const MOVE_KEYS = {
  forward: ['KeyW', 'KeyS'],
  strafe: ['KeyD', 'KeyA'],
};

export function createPlayer(colliders) {
  const player = {
    position: new THREE.Vector3(0, 0, 21),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: TUNING.standEye,
    onGround: true,
    crouching: false,
    height: TUNING.standHeight,
    health: 100,
    armour: 0,
    alive: true,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  // The player's box at (x, y, z) with the given height, trimmed by `lift`
  // at the feet and the crown. Returns the first collider it touches.
  function hitCollider(x, y, z, height, lift) {
    probe.min.set(x - TUNING.radius, y + lift, z - TUNING.radius);
    probe.max.set(x + TUNING.radius, y + height - lift, z + TUNING.radius);
    for (const collider of colliders) {
      if (probe.intersectsBox(collider)) return collider;
    }
    return null;
  }

  function look(dx, dy, sensitivity = TUNING.lookSensitivity) {
    player.yaw -= dx * sensitivity;
    const limit = TUNING.pitchLimit;
    player.pitch = Math.max(-limit, Math.min(limit, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(TUNING.pitchLimit, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  function wantsCrouch(keys) {
    return CROUCH_KEYS.some((code) => keys.has(code));
  }

  // Standing up needs headroom: if a low ceiling blocks the full height, the
  // player stays crouched instead of clipping into the ceiling.
  function updateStance(dt, keys) {
    const crouching = wantsCrouch(keys);
    if (crouching && !player.crouching) {
      player.crouching = true;
      player.height = TUNING.crouchHeight;
    } else if (!crouching && player.crouching) {
      const blocked = hitCollider(
        player.position.x, player.position.y, player.position.z,
        TUNING.standHeight, TUNING.standLift,
      );
      if (!blocked) {
        player.crouching = false;
        player.height = TUNING.standHeight;
      }
    }
    const eyeTarget = player.crouching ? TUNING.crouchEye : TUNING.standEye;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * TUNING.eyeLerp);
  }

  // The wished direction from the held keys, rotated by the yaw: W is
  // forward, S back, D right, A left, and a diagonal is normalised so it is
  // no faster than a straight run.
  function wishDirection(keys) {
    const forward = (keys.has(MOVE_KEYS.forward[0]) ? 1 : 0) - (keys.has(MOVE_KEYS.forward[1]) ? 1 : 0);
    const strafe = (keys.has(MOVE_KEYS.strafe[0]) ? 1 : 0) - (keys.has(MOVE_KEYS.strafe[1]) ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }
    return wish;
  }

  function moveSpeed(aiming) {
    if (player.crouching) return TUNING.crouchSpeed;
    if (aiming) return TUNING.adsSpeed;
    return TUNING.walkSpeed;
  }

  function applyHorizontal(dt, keys, aiming) {
    const direction = wishDirection(keys);
    const speed = moveSpeed(aiming);
    const accel = player.onGround ? TUNING.groundAccel : TUNING.airAccel;
    const blend = Math.min(1, (accel * dt) / speed);
    player.velocity.x += (direction.x * speed - player.velocity.x) * blend;
    player.velocity.z += (direction.z * speed - player.velocity.z) * blend;
    // Idle on the ground: friction bleeds the leftover velocity instead of
    // letting the player glide to a stop.
    if (player.onGround && !direction.lengthSq()) {
      const damp = Math.max(0, 1 - TUNING.friction * dt);
      player.velocity.x *= damp;
      player.velocity.z *= damp;
    }
  }

  function applyVertical(dt, keys) {
    if (keys.has('Space') && player.onGround) {
      player.velocity.y = TUNING.jumpSpeed;
      player.onGround = false;
    }
    player.velocity.y -= TUNING.gravity * dt;
  }

  // Each horizontal axis moves on its own and is tested on its own: hitting
  // a wall on X still lets the player slide along Z, and a blocked axis
  // zeroes that velocity component instead of bouncing the player back.
  function resolveHorizontal(dt) {
    const lift = TUNING.wallLift;
    const nextX = player.position.x + player.velocity.x * dt;
    if (!hitCollider(nextX, player.position.y, player.position.z, player.height, lift)) {
      player.position.x = nextX;
    } else {
      player.velocity.x = 0;
    }
    const nextZ = player.position.z + player.velocity.z * dt;
    if (!hitCollider(player.position.x, player.position.y, nextZ, player.height, lift)) {
      player.position.z = nextZ;
    } else {
      player.velocity.z = 0;
    }
  }

  // Vertical resolution: landing on a collider puts the feet on its top and
  // grounds the player; hitting a ceiling from below puts the crown under
  // it. The floor at y = 0 is the last resort, so a fall can never go below
  // the map.
  function resolveVertical(dt) {
    player.position.y += player.velocity.y * dt;
    player.onGround = false;
    const hit = hitCollider(player.position.x, player.position.y, player.position.z, player.height, 0);
    if (hit && player.velocity.y <= 0) {
      player.position.y = hit.max.y;
      player.velocity.y = 0;
      player.onGround = true;
    } else if (hit) {
      player.position.y = hit.min.y - player.height;
      player.velocity.y = 0;
    }
    if (player.position.y < 0) {
      player.position.y = 0;
      player.velocity.y = 0;
      player.onGround = true;
    }
    player.velocity.y = Math.max(-TUNING.maxFall, player.velocity.y);
  }

  function step(dt, keys, aiming) {
    if (!player.alive) return;
    updateStance(dt, keys);
    applyHorizontal(dt, keys, aiming);
    applyVertical(dt, keys);
    resolveHorizontal(dt);
    resolveVertical(dt);
  }

  // Armour absorbs half the damage and loses that many points; the rest is
  // health. The absorbed half is rounded up, so armour always takes at least
  // its share of an odd hit. Returns the health damage actually dealt.
  function damage(amount) {
    if (!player.alive) return 0;
    let remaining = amount;
    if (player.armour > 0) {
      const absorbed = Math.min(player.armour, Math.ceil(amount / 2));
      player.armour -= absorbed;
      remaining = amount - absorbed;
    }
    player.health = Math.max(0, player.health - remaining);
    if (player.health <= 0) player.alive = false;
    return remaining;
  }

  function reset(x, z, yaw) {
    player.position.set(x, 0, z);
    player.velocity.set(0, 0, 0);
    player.yaw = yaw;
    player.pitch = 0;
    player.eye = TUNING.standEye;
    player.height = TUNING.standHeight;
    player.crouching = false;
    player.onGround = true;
    player.health = 100;
    player.alive = true;
    // Armour is bought per round and kept only while the player survives; the
    // economy module restores it on a survived round, otherwise it stays 0.
    player.armour = 0;
  }

  return {
    state: player,
    step,
    look,
    recoil,
    damage,
    reset,
    groundSpeed() {
      return Math.hypot(player.velocity.x, player.velocity.z);
    },
  };
}
