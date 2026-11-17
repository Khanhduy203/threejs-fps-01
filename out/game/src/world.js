// Depot 9 — a dusk container yard, 64 by 48 metres, drawn from data tables.
// Three lanes run south to north (West, Mid, East) from the STRIKE spawn to the
// WARDEN side, where sites A (west) and B (east) sit behind a cross corridor.
// Every solid is a collider for movement and a surface bullets stop on. The nav
// graph at the bottom is the bots' map; its edges were laid out so none of them
// crosses a wall (bots also free themselves if they ever snag). All collision is
// axis-aligned boxes, so each test is one Box3 overlap.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoints of the bot nav graph, as [x, z] pairs, south to north.
const WAYPOINTS = [
  [0, 21],
  [-8, 16],
  [8, 16],
  [-20, 14],
  [0, 12],
  [20, 14],
  [-22, 6],
  [-5, 8],
  [5, 8],
  [22, 6],
  [-24, -2],
  [0, 0],
  [24, -2],
  [-22, -6],
  [-8, -4],
  [8, -4],
  [22, -6],
  [-24, -14],
  [0, -12],
  [24, -14],
  [-16, -19],
  [0, -20],
  [16, -19],
  [-8, -16],
  [8, -16],
];
// Two-way links between waypoint indexes.
const LINKS = [
  [0, 1],
  [0, 2],
  [0, 4],
  [1, 3],
  [1, 4],
  [2, 4],
  [2, 5],
  [3, 6],
  [4, 7],
  [4, 8],
  [5, 9],
  [6, 10],
  [7, 11],
  [8, 11],
  [9, 12],
  [10, 13],
  [11, 14],
  [11, 15],
  [12, 16],
  [13, 17],
  [14, 13],
  [14, 18],
  [15, 16],
  [15, 18],
  [17, 20],
  [17, 23],
  [18, 23],
  [18, 24],
  [19, 22],
  [19, 24],
  [20, 23],
  [21, 23],
  [21, 24],
  [22, 24],
];
const NEIGHBOURS = WAYPOINTS.map(() => []);
for (const pair of LINKS) {
  NEIGHBOURS[pair[0]].push(pair[1]);
  NEIGHBOURS[pair[1]].push(pair[0]);
}

export const SITES = {
  A: { x: -24, z: -14, r: 5.5, node: 17 },
  B: { x: 24, z: -14, r: 5.5, node: 19 },
};

export const SPAWNS = {
  strike: [[0, 21], [-3, 21], [3, 21]],
  warden: [[0, -20], [-4, -20], [4, -20]],
};

export const HOLD_NODES = { A: 20, B: 22, MID: 18 };

// Placement tables: [width, height, depth, x, y, z, palette key].
// The ground slab and the two site aprons stay off the minimap, or the map
// would render as one solid rectangle.
const SLABS = [
  [64.4, 0.4, 48.4, 0, -0.2, 0, 'sand'],
  [12, 0.1, 10, -24, 0.03, -14, 'surface'],
  [12, 0.1, 10, 24, 0.03, -14, 'surface'],
];
const FENCES = [
  [0.6, 5, 48.4, -32.2, 2.5, 0],
  [0.6, 5, 48.4, 32.2, 2.5, 0],
  [64.4, 5, 0.6, 0, 2.5, -24.2],
  [64.4, 5, 0.6, 0, 2.5, 24.2],
];
// Lane dividers: two long walls splitting the yard into West / Mid / East.
// Each has one gap (z -2..-6) so the mid connector reaches the outer lanes.
const DIVIDERS = [];
for (const side of [-1, 1]) {
  DIVIDERS.push([0.6, 4, 6, side * 13, 2, 1]);
  DIVIDERS.push([0.6, 4, 6, side * 13, 2, -9]);
}
// Containers: [x, z, longAxisIsZ, palette key]. A container is 6 x 2.6 x 2.4 m.
// Each lane gets staggered blocks so no lane is one long sightline.
const CONTAINERS = [
  [-25, 8, false, 'containerA'],
  [-26, -2, true, 'containerB'],
  [-18, -8, false, 'containerC'],
  [25, 8, false, 'containerB'],
  [26, -2, true, 'containerA'],
  [18, -8, false, 'containerD'],
  [-20, 18, false, 'containerD'],
  [20, 18, false, 'containerA'],
  [-11, -9, true, 'containerC'],
  [11, -9, true, 'containerB'],
  [-27, -13, true, 'containerA'],
  [-20, -21, false, 'containerD'],
  [27, -13, true, 'containerB'],
  [20, -21, false, 'containerC'],
  [0, 8, false, 'containerB'],
  [6, -22, false, 'containerD'],
  [0, -16, false, 'containerA'],
];
// Second-storey boxes stacked on the two site containers.
const STACKS = [
  [2.4, 2.6, 6, -27, 3.9, -13, 'containerC'],
  [2.4, 2.6, 6, 27, 3.9, -13, 'containerA'],
];
// Crates: [x, z, edge] — 1.1 m crouch cover, scattered so every route has a stop.
const CRATES = [
  [-28, 14, 1.1],
  [-16, 16, 1.1],
  [-14, 2, 1.1],
  [-28, -6, 1.1],
  [-20, -11, 1.1],
  [28, 14, 1.1],
  [16, 16, 1.1],
  [14, 2, 1.1],
  [28, -6, 1.1],
  [20, -11, 1.1],
  [-2, 16, 1.1],
  [2, 16, 1.1],
  [-9, 0, 1.1],
  [9, 0, 1.1],
  [0, -4, 1.1],
  [-24, -19, 1.1],
  [24, -19, 1.1],
  [-12, -20, 1.1],
  [12, -20, 1.1],
  [-30, -16, 1.6],
  [30, -16, 1.6],
];
// Barrels in two clusters, cylinders whose Box3 is the collider.
const BARRELS = [
  [-10, 18],
  [-9, 18.9],
  [10, 18],
  [9.2, 18.8],
  [-30, 4],
  [-29, 4.8],
  [30, 4],
  [29.1, 4.9],
];
const TOWER_LEGS = [
  [-2, -22.5],
  [2, -22.5],
  [-2, -20.5],
  [2, -20.5],
];
const LAMPS = [
  [-10, 12],
  [10, 12],
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mats = {};
  for (const key of Object.keys(PALETTE)) {
    mats[key] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[key]),
      roughness: key === 'accent' || key === 'ink' ? 0.55 : 0.92,
      metalness: 0.04,
    });
  }
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2723, roughness: 0.6, metalness: 0.5 });

  const colliders = [];
  const shootables = [];
  const minimapWalls = []; // [x, z, w, d] rectangles the HUD minimap draws

  function addBox(w, h, d, x, y, z, matKey, solid = true, onMap = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[matKey]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
      if (onMap) minimapWalls.push([x, z, w, d]);
    }
    return mesh;
  }

  for (const spec of SLABS) addBox(spec[0], spec[1], spec[2], spec[3], spec[4], spec[5], spec[6], true, false);
  for (const spec of FENCES) addBox(spec[0], spec[1], spec[2], spec[3], spec[4], spec[5], 'surface');
  for (const spec of DIVIDERS) addBox(spec[0], spec[1], spec[2], spec[3], spec[4], spec[5], 'surface');
  for (const [x, z, alongZ, colour] of CONTAINERS) {
    addBox(alongZ ? 2.4 : 6, 2.6, alongZ ? 6 : 2.4, x, 1.3, z, colour);
  }
  for (const spec of STACKS) addBox(spec[0], spec[1], spec[2], spec[3], spec[4], spec[5], spec[6]);
  for (const [x, z, edge] of CRATES) addBox(edge, edge, edge, x, edge / 2, z, 'hairline');
  for (const [x, z] of BARRELS) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 12), steel);
    drum.position.set(x, 0.55, z);
    drum.castShadow = true;
    drum.receiveShadow = true;
    group.add(drum);
    colliders.push(new THREE.Box3().setFromObject(drum));
    shootables.push(drum);
  }

  // A low platform at mid: jump up for a sightline over the crates.
  addBox(4, 0.5, 2.5, 0, 0.25, 3, 'surface');

  // Watchtower at the north fence: legs and a cabin, visual only, no access.
  for (const [lx, lz] of TOWER_LEGS) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.4, 0.3), steel);
    leg.position.set(lx, 2.2, lz);
    leg.castShadow = true;
    group.add(leg);
  }
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(5, 2, 3), mats.surface);
  cabin.position.set(0, 5.4, -21.5);
  cabin.castShadow = true;
  group.add(cabin);

  // Site letters painted on the aprons: canvas textures, drawn at load, no files.
  function paintLetter(letter, x, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx2d = canvas.getContext('2d');
    ctx2d.clearRect(0, 0, 256, 256);
    ctx2d.strokeStyle = PALETTE.accent;
    ctx2d.lineWidth = 10;
    ctx2d.strokeRect(14, 14, 228, 228);
    ctx2d.fillStyle = PALETTE.accent;
    ctx2d.font = 'bold 150px system-ui, sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText(letter, 128, 138);
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(x, 0.1, z);
    group.add(decal);
  }
  paintLetter('A', SITES.A.x, SITES.A.z);
  paintLetter('B', SITES.B.x, SITES.B.z);

  // Light: a low warm sun from the west, a cool dusk sky, and two lamp posts.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.sky), new THREE.Color(PALETTE.sand), 0.85);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.sun), 2.4);
  sun.position.set(-26, 18, 12);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -38;
  sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.sky), 0.5);
  fill.position.set(18, 12, -14);
  scene.add(fill);
  for (const [lx, lz] of LAMPS) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 5.4, 8), steel);
    pole.position.set(lx, 2.7, lz);
    pole.castShadow = true;
    group.add(pole);
    colliders.push(new THREE.Box3(new THREE.Vector3(lx - 0.2, 0, lz - 0.2), new THREE.Vector3(lx + 0.2, 5.4, lz + 0.2)));
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.sun) }),
    );
    bulb.position.set(lx, 5.5, lz);
    group.add(bulb);
    const glow = new THREE.PointLight(new THREE.Color(PALETTE.sun), 14, 16, 1.8);
    glow.position.set(lx, 5.3, lz);
    scene.add(glow);
  }

  // Segment against one box, slab method: the overlap interval of the segment
  // parameter t in [0, 1] must survive all three axes. Bots use it for line of
  // sight; grenades use it for blast cover.
  function segmentHits(ax, ay, az, bx, by, bz, box3) {
    const starts = [ax, ay, az];
    const deltas = [bx - ax, by - ay, bz - az];
    const lows = [box3.min.x, box3.min.y, box3.min.z];
    const highs = [box3.max.x, box3.max.y, box3.max.z];
    let lo = 0;
    let hi = 1;
    for (let axis = 0; axis < 3; axis += 1) {
      const d = deltas[axis];
      if (Math.abs(d) < 1e-9) {
        if (starts[axis] < lows[axis] || starts[axis] > highs[axis]) return false;
        continue;
      }
      let t0 = (lows[axis] - starts[axis]) / d;
      let t1 = (highs[axis] - starts[axis]) / d;
      if (t0 > t1) {
        const swap = t0;
        t0 = t1;
        t1 = swap;
      }
      if (t0 > lo) lo = t0;
      if (t1 < hi) hi = t1;
      if (lo > hi) return false;
    }
    return true;
  }

  function losBlocked(ax, ay, az, bx, by, bz) {
    for (const box of colliders) {
      if (segmentHits(ax, ay, az, bx, by, bz, box)) return true;
    }
    return false;
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestSq = Infinity;
    for (let i = 0; i < WAYPOINTS.length; i += 1) {
      const dx = WAYPOINTS[i][0] - x;
      const dz = WAYPOINTS[i][1] - z;
      const sq = dx * dx + dz * dz;
      if (sq < bestSq) {
        bestSq = sq;
        best = i;
      }
    }
    return best;
  }

  // Dijkstra over the 25-node graph; returns the waypoint list from start to
  // goal. The graph is tiny, so the unsettled node with the smallest distance
  // is picked by a plain scan each round.
  function findPath(fromIndex, toIndex) {
    if (fromIndex === toIndex) return [fromIndex];
    const dist = new Array(WAYPOINTS.length).fill(Infinity);
    const prev = new Array(WAYPOINTS.length).fill(-1);
    const settled = new Set();
    dist[fromIndex] = 0;
    for (let round = 0; round < WAYPOINTS.length; round += 1) {
      let current = -1;
      let currentDist = Infinity;
      for (let i = 0; i < WAYPOINTS.length; i += 1) {
        if (!settled.has(i) && dist[i] < currentDist) {
          currentDist = dist[i];
          current = i;
        }
      }
      if (current === -1 || current === toIndex) break;
      settled.add(current);
      for (const next of NEIGHBOURS[current]) {
        const dx = WAYPOINTS[next][0] - WAYPOINTS[current][0];
        const dz = WAYPOINTS[next][1] - WAYPOINTS[current][1];
        const via = dist[current] + Math.hypot(dx, dz);
        if (via < dist[next]) {
          dist[next] = via;
          prev[next] = current;
        }
      }
    }
    if (prev[toIndex] === -1) return [toIndex];
    const path = [];
    let node = toIndex;
    while (node !== -1) {
      path.unshift(node);
      node = prev[node];
    }
    return path;
  }

  function isInSite(x, z, site) {
    const s = SITES[site];
    return Math.abs(x - s.x) <= s.r && Math.abs(z - s.z) <= s.r;
  }

  function siteAt(x, z) {
    if (isInSite(x, z, 'A')) return 'A';
    if (isInSite(x, z, 'B')) return 'B';
    return null;
  }

  return {
    colliders,
    shootables,
    minimapWalls,
    losBlocked,
    nearestNode,
    findPath,
    isInSite,
    siteAt,
    nodes: WAYPOINTS,
    group,
  };
}
