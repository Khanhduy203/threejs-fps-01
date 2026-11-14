// Every sound is synthesized with WebAudio: no audio files, no network, nothing to
// download. Gunfire is shaped noise plus a low thump; the bomb beeps, the explosion
// is a long noise burst under a falling sine. The context starts on the first click,
// as browsers require, and distant shots play quieter by distance.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
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
    master.gain.value = 0.4;
    master.connect(ctx.destination);
    const length = ctx.sampleRate * 1;
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function noise(duration, filterFreq, gainValue, when = 0) {
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

  // Volume falls with distance: 1 at the muzzle, ~0.08 at 40 m.
  function distanceGain(distance) {
    if (distance == null) return 1;
    return Math.max(0.06, 1 / (1 + distance * 0.16));
  }

  return {
    unlock() {
      ensure();
    },
    shot(kind, distance) {
      if (!ensure()) return;
      const g = distanceGain(distance);
      if (kind === 'sniper') {
        noise(0.28, 900, 0.9 * g);
        tone(90, 0.25, 0.7 * g, 'sine', 40);
      } else if (kind === 'rifle') {
        noise(0.14, 1600, 0.7 * g);
        tone(140, 0.1, 0.5 * g, 'sine', 60);
      } else if (kind === 'smg') {
        noise(0.09, 2200, 0.5 * g);
        tone(180, 0.07, 0.35 * g, 'sine', 80);
      } else {
        noise(0.12, 1400, 0.6 * g);
        tone(120, 0.09, 0.45 * g, 'sine', 55);
      }
    },
    dryFire() {
      if (!ensure()) return;
      tone(900, 0.05, 0.2, 'square');
    },
    reload() {
      if (!ensure()) return;
      tone(500, 0.06, 0.25, 'square');
      tone(700, 0.06, 0.25, 'square', null, 0.18);
      tone(420, 0.08, 0.3, 'square', null, 0.4);
    },
    hit(kill) {
      if (!ensure()) return;
      tone(kill ? 1400 : 1000, 0.07, 0.3, 'sine');
      if (kill) tone(1800, 0.12, 0.25, 'sine', null, 0.07);
    },
    hurt() {
      if (!ensure()) return;
      tone(160, 0.15, 0.4, 'sawtooth', 70);
    },
    grenadeThrow() {
      if (!ensure()) return;
      noise(0.15, 800, 0.25);
    },
    explosion(distance) {
      if (!ensure()) return;
      const g = distanceGain(distance);
      noise(1.4, 300, 1.0 * g);
      tone(70, 1.1, 0.9 * g, 'sine', 28);
    },
    beep(urgent) {
      if (!ensure()) return;
      tone(urgent ? 1500 : 1100, 0.09, 0.35, 'square');
    },
    plant() {
      if (!ensure()) return;
      tone(600, 0.1, 0.3, 'square');
      tone(900, 0.12, 0.3, 'square', null, 0.12);
    },
    defuse() {
      if (!ensure()) return;
      tone(900, 0.1, 0.3, 'square');
      tone(600, 0.14, 0.3, 'square', null, 0.12);
    },
    buy() {
      if (!ensure()) return;
      tone(880, 0.07, 0.25, 'sine');
      tone(1320, 0.1, 0.25, 'sine', null, 0.07);
    },
    denied() {
      if (!ensure()) return;
      tone(220, 0.14, 0.3, 'square', 160);
    },
    roundWin() {
      if (!ensure()) return;
      tone(523, 0.14, 0.3, 'sine');
      tone(659, 0.14, 0.3, 'sine', null, 0.14);
      tone(784, 0.22, 0.3, 'sine', null, 0.28);
    },
    roundLose() {
      if (!ensure()) return;
      tone(392, 0.16, 0.3, 'sine');
      tone(311, 0.24, 0.3, 'sine', null, 0.16);
    },
    click() {
      if (!ensure()) return;
      tone(700, 0.05, 0.2, 'sine');
    },
  };
}
