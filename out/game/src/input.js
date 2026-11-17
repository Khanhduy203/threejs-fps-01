// Keyboard and mouse, and the pointer lock that turns the mouse into look.
// Plain browser APIs only. Besides the held-key set it tracks edge presses
// (pressedThisFrame), so a single tap of R, B, G, E or a number key fires
// exactly once even at 60 Hz: the frame loop reads the presses, then calls
// endFrame() to clear them before the next frame.
//
// The listeners are registered from one table — [target, event, handler] —
// instead of a dozen separate addEventListener calls, so the full wiring is
// visible in one place and nothing is registered twice by accident.

const MOUSE_FIRE = 0; // left button: hold to fire
const MOUSE_AIM = 2; // right button: hold to aim down sights

export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  const state = {
    keys,
    pressed,
    locked: false,
    firing: false, // left button held
    aiming: false, // right button held (aim down sights)
    lookX: 0,
    lookY: 0,
    wheel: 0, // -1 / +1, consumed by the weapon switch
  };

  // A key going down is an edge press only the first time: holding the key
  // must not re-fire R or G every frame. Space is swallowed so the page
  // never scrolls when the player jumps.
  function onKey(event, down) {
    if (down) {
      if (!keys.has(event.code)) pressed.add(event.code);
      keys.add(event.code);
    } else {
      keys.delete(event.code);
    }
    if (event.code === 'Space') event.preventDefault();
  }

  // Losing the window (or the pointer lock) releases everything: a key held
  // across an alt-tab must not still be held when the player comes back.
  function releaseAll() {
    keys.clear();
    pressed.clear();
    state.firing = false;
    state.aiming = false;
  }

  function onMouseMove(event) {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  }

  // Mouse buttons only count while locked: a click on the menu must never
  // fire the gun, and a click that locks the pointer must not also shoot.
  function onMouseDown(event) {
    if (!state.locked) return;
    if (event.button === MOUSE_FIRE) state.firing = true;
    if (event.button === MOUSE_AIM) state.aiming = true;
  }

  function onMouseUp(event) {
    if (event.button === MOUSE_FIRE) state.firing = false;
    if (event.button === MOUSE_AIM) state.aiming = false;
  }

  function onWheel(event) {
    if (!state.locked) return;
    state.wheel += event.deltaY > 0 ? 1 : -1;
  }

  // The context menu is suppressed while locked, so a right-click aim never
  // pops the browser menu over the game.
  function onContextMenu(event) {
    if (state.locked) event.preventDefault();
  }

  function onLockChanged() {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) releaseAll();
    onLockChange(state.locked);
  }

  const wiring = [
    [window, 'keydown', (event) => onKey(event, true)],
    [window, 'keyup', (event) => onKey(event, false)],
    [window, 'blur', releaseAll],
    [window, 'mousemove', onMouseMove],
    [window, 'mousedown', onMouseDown],
    [window, 'mouseup', onMouseUp],
    [window, 'wheel', onWheel],
    [window, 'contextmenu', onContextMenu],
    [document, 'pointerlockchange', onLockChanged],
  ];
  for (const [target, event, handler] of wiring) target.addEventListener(event, handler);

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook(target) {
      // Writes into the caller's object: the frame loop runs 60 times a
      // second, so it allocates nothing here.
      target.x = state.lookX;
      target.y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
    },
    // Called once per rendered frame after the simulation has read the presses.
    endFrame() {
      pressed.clear();
      state.wheel = 0;
    },
  };
}
