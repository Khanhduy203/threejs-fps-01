// Every sound is synthesized with WebAudio: no audio files, no network,
// nothing to download. Gunfire is shaped noise plus a low thump; the bomb
// beeps, the explosion is a long noise burst under a falling sine. The context
// starts on the first click, as browsers require, and distant shots play
// quieter by distance.
//
// The module has two layers. The bottom layer is two primitives — a filtered
// noise burst and a pitched tone with an optional slide — plus the shared
// white-noise buffer they both draw on. The top layer is a table of recipes:
// each named effect is a list of steps, and playing an effect is scheduling
// its steps. A new sound is a new row in the table, not a new function, and
// the numbers that shape a sound live beside its name instead of buried in
// control flow.

const MASTER_GAIN = 0.4;

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let unlocked = false; // set on the first user gesture; until then no context exists

  // Builds the context on first use, and resumes it if the browser parked it
  // while the tab was in the background. Returns false while locked or when
  // the browser refuses a context, so every effect can bail out the same way.
  function ensure() {
    if (!unlocked) return false;
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return false;
    }
    master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
    const length = ctx.sampleRate * 1;
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  }

  // One noise burst through a lowpass filter, fading exponentially to
  // silence. `when` delays the start, so a recipe can stagger its steps.
  function burst(duration, filterFreq, gainValue, when = 0) {
    if (!ctx) return;
    const start = ctx.currentTime + when;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(start);
    source.stop(start + duration + 0.05);
  }

  // One oscillator tone, optionally sliding down to another pitch. The gain
  // envelope is the same exponential fade as the noise burst, so tones and
  // bursts decay together inside a recipe.
  function tone(freq, duration, gainValue, type = 'sine', slideTo = null, when = 0) {
    if (!ctx) return;
    const start = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  // A step is [kind, ...args]: 'noise' steps call burst, 'tone' steps call
  // tone, and the step's own gain is scaled by the effect's distance gain.
  function playSteps(steps, gainScale) {
    for (const step of steps) {
      const [kind, ...args] = step;
      if (kind === 'noise') {
        const [duration, filterFreq, gainValue, when = 0] = args;
        burst(duration, filterFreq, gainValue * gainScale, when);
      } else {
        const [freq, duration, gainValue, type = 'sine', slideTo = null, when = 0] = args;
        tone(freq, duration, gainValue * gainScale, type, slideTo, when);
      }
    }
  }

  // Volume falls with distance: 1 at the muzzle, ~0.08 at 40 m. A null
  // distance means the sound is the player's own, played at full volume.
  function distanceGain(distance) {
    if (distance == null) return 1;
    return Math.max(0.06, 1 / (1 + distance * 0.16));
  }

  // Gunfire, one recipe per weapon kind: a sharp noise crack sized to the
  // calibre, under a low thump that slides down. The fallback row covers
  // the pistol and any kind a caller passes by mistake.
  const SHOTS = {
    sniper: [
      ['noise', 0.28, 900, 0.9],
      ['tone', 90, 0.25, 0.7, 'sine', 40],
    ],
    rifle: [
      ['noise', 0.14, 1600, 0.7],
      ['tone', 140, 0.1, 0.5, 'sine', 60],
    ],
    smg: [
      ['noise', 0.09, 2200, 0.5],
      ['tone', 180, 0.07, 0.35, 'sine', 80],
    ],
    other: [
      ['noise', 0.12, 1400, 0.6],
      ['tone', 120, 0.09, 0.45, 'sine', 55],
    ],
  };

  // Short UI and feedback sounds, as plain step lists. Where a sound is two
  // notes, the second step carries its delay in `when`.
  const EFFECTS = {
    dryFire: [['tone', 900, 0.05, 0.2, 'square']],
    reload: [
      ['tone', 500, 0.06, 0.25, 'square'],
      ['tone', 700, 0.06, 0.25, 'square', null, 0.18],
      ['tone', 420, 0.08, 0.3, 'square', null, 0.4],
    ],
    hurt: [['tone', 160, 0.15, 0.4, 'sawtooth', 70]],
    grenadeThrow: [['noise', 0.15, 800, 0.25]],
    plant: [
      ['tone', 600, 0.1, 0.3, 'square'],
      ['tone', 900, 0.12, 0.3, 'square', null, 0.12],
    ],
    defuse: [
      ['tone', 900, 0.1, 0.3, 'square'],
      ['tone', 600, 0.14, 0.3, 'square', null, 0.12],
    ],
    buy: [
      ['tone', 880, 0.07, 0.25, 'sine'],
      ['tone', 1320, 0.1, 0.25, 'sine', null, 0.07],
    ],
    denied: [['tone', 220, 0.14, 0.3, 'square', 160]],
    roundWin: [
      ['tone', 523, 0.14, 0.3, 'sine'],
      ['tone', 659, 0.14, 0.3, 'sine', null, 0.14],
      ['tone', 784, 0.22, 0.3, 'sine', null, 0.28],
    ],
    roundLose: [
      ['tone', 392, 0.16, 0.3, 'sine'],
      ['tone', 311, 0.24, 0.3, 'sine', null, 0.16],
    ],
    click: [['tone', 700, 0.05, 0.2, 'sine']],
  };

  // The hit marker is a single ping that rises a fifth on a kill.
  function hitSteps(kill) {
    const steps = [['tone', kill ? 1400 : 1000, 0.07, 0.3, 'sine']];
    if (kill) steps.push(['tone', 1800, 0.12, 0.25, 'sine', null, 0.07]);
    return steps;
  }

  // The bomb's beep is one square blip, higher and therefore more urgent
  // as the timer runs down.
  function beepSteps(urgent) {
    return [['tone', urgent ? 1500 : 1100, 0.09, 0.35, 'square']];
  }

  // The explosion is a long low noise wash under a sine that falls from
  // 70 Hz to 28 Hz, scaled by distance like any other distant sound.
  function explosionSteps() {
    return [
      ['noise', 1.4, 300, 1.0],
      ['tone', 70, 1.1, 0.9, 'sine', 28],
    ];
  }

  function play(name, gainScale = 1) {
    if (!ensure()) return;
    playSteps(EFFECTS[name], gainScale);
  }

  return {
    unlock() {
      unlocked = true;
      ensure();
    },
    shot(kind, distance) {
      if (!ensure()) return;
      playSteps(SHOTS[kind] ?? SHOTS.other, distanceGain(distance));
    },
    dryFire() {
      play('dryFire');
    },
    reload() {
      play('reload');
    },
    hit(kill) {
      if (!ensure()) return;
      playSteps(hitSteps(kill), 1);
    },
    hurt() {
      play('hurt');
    },
    grenadeThrow() {
      play('grenadeThrow');
    },
    explosion(distance) {
      if (!ensure()) return;
      playSteps(explosionSteps(), distanceGain(distance));
    },
    beep(urgent) {
      if (!ensure()) return;
      playSteps(beepSteps(urgent), 1);
    },
    plant() {
      play('plant');
    },
    defuse() {
      play('defuse');
    },
    buy() {
      play('buy');
    },
    denied() {
      play('denied');
    },
    roundWin() {
      play('roundWin');
    },
    roundLose() {
      play('roundLose');
    },
    click() {
      play('click');
    },
  };
}
