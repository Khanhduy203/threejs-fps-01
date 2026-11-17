// The look plan, in one place. A dusk container depot: warm sand and rust
// under a cooling sky, with one cool team colour (STRIKE teal) and one hot
// team colour (WARDEN amber). The same names are the CSS custom properties in
// index.html, so a colour changed here and there stays in sync.
//
// The table is grouped by what each colour paints, then folded into a plain
// object. Grouping matters because the depot reads as three layers — the sky
// above, the ground and structures in the middle, the two teams on top —
// and a tweak should be findable in the layer it belongs to.

// Sky and atmosphere: the fog the depot fades into, and the low sun.
const SKY = [
  ['canvas', '#17130f'], // ground haze / sky fog
  ['sky', '#2b3542'], // dusk blue sky
  ['sun', '#ffd9a0'],
];

// Ground and structures: sand underfoot, rust on steel, dark walls.
const GROUND = [
  ['surface', '#241f19'], // walls, warehouse
  ['hairline', '#3a3128'], // crates, dark steel
  ['ink', '#efe6d4'], // sand, light concrete
  ['muted', '#9a8d76'], // dry grass, distant steel
  ['sand', '#c8a86a'],
  ['rust', '#a34d24'],
];

// The two teams. WARDEN amber is the same rust orange as the accent colour,
// named separately so team code never has to know that.
const TEAMS = [
  ['accent', '#e8862e'], // rust orange: WARDEN, containers
  ['strike', '#37b6a0'], // STRIKE teal
  ['warden', '#e8862e'], // WARDEN amber (same as accent, named for teams)
];

// Container paint: rust, teal, sand and slate blue, all weathered by the
// same sun, so no container ever looks freshly delivered.
const CONTAINERS = [
  ['containerA', '#a34d24'],
  ['containerB', '#2e7f72'],
  ['containerC', '#b39256'],
  ['containerD', '#5a6b7a'],
];

export const PALETTE = Object.fromEntries([
  ...SKY,
  ...GROUND,
  ...TEAMS,
  ...CONTAINERS,
]);
