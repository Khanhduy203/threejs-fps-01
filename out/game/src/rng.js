// Gameplay randomness comes from one seeded generator, so a screenshot run
// launched with ?seed=N replays the same spread, bot choices and routes frame
// for frame. Ordinary play seeds from the wall clock instead, which is why two
// casual matches never feel alike.
//
// The generator below is the mulberry32 recurrence: a 32-bit state advanced by
// a golden-ratio step, then scrambled by two multiply-xorshift rounds. The
// arithmetic is the classic form — the point of keeping it is that its output
// stream is well distributed and cheap, not that the constants are magic.
// A different seed must give a visibly different stream, and the same seed
// must give the same stream every time, on every machine.

const GOLDEN_STEP = 0x6d2b79f5;
const UNIT = 4294967296; // 2^32, maps the raw word onto [0, 1)

// One avalanche pass over a 32-bit word: xor-shift, multiply, xor-shift,
// multiply, xor-shift. Each stage spreads a single changed input bit across
// the whole word, which is what makes consecutive outputs look unrelated.
function avalanche(word) {
  const first = Math.imul(word ^ (word >>> 15), 1 | word);
  const second = (first + Math.imul(first ^ (first >>> 7), 61 | first)) ^ first;
  return (second ^ (second >>> 14)) >>> 0;
}

export function mulberry32(initial) {
  // The seed is forced into a signed 32-bit word up front, so a float, a
  // negative number or a value past 2^31 all land on a defined state.
  let state = initial | 0;
  return function random() {
    state = (state + GOLDEN_STEP) | 0;
    return avalanche(state) / UNIT;
  };
}

// Uniformly pick one entry. The modulo guards the edge case where random()
// returns exactly 1 (it never does for mulberry32, but a caller may pass a
// different generator), so the index can never run past the last element.
export function pick(random, array) {
  const slot = Math.floor(random() * array.length);
  return array[slot % array.length];
}

// A uniform float in [min, max). Written as an affine map so the endpoints
// are exact: range(r, 0, 1) is r itself, range(r, a, a) is always a.
export function range(random, min, max) {
  return min + (max - min) * random();
}

// A uniform integer in [min, max] inclusive, for counts and table indices.
export function int(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

// True with the given probability, for coin-flip bot decisions.
export function chance(random, probability) {
  return random() < probability;
}
