// Depot 9: an original dusk container yard, 64 x 48 m. Three south-north lanes
// (West, Mid, East) run from the STRIKE spawn to the WARDEN side, where sites A
// (west) and B (east) sit behind a cross-corridor. Every box is a collider for
// movement and a surface bullets stop on; the nav graph below is the bots' map,
// and every edge was placed so it never crosses a wall (bots also unstick
// themselves if they ever snag). Axis-aligned boxes only, so collision is one
// Box3 test each.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Nav graph: [x, z] nodes, then bidirectional edges by index.
const NODES = [
  [0, 21], [-8, 16], [8, 16], [-20, 14], [0, 12], [20, 14],
  [-22, 6], [-5, 8], [5, 8], [22, 6], [-24, -2], [0, 0],
  [24, -2], [-22, -6], [-8, -4], [8, -4], [22, -6], [-24, -14],
  [0, -12], [24, -14], [-16, -19], [0, -20], [16, -19], [-8, -16], [8, -16],
];
const EDGES = [
  [0, 1], [0, 2], [0, 4], [1, 3], [1, 4], [2, 4], [2, 5], [3, 6], [4, 7],
  [4, 8], [5, 9], [6, 10], [7, 11], [8, 11], [9, 12], [10, 13], [11, 14],
  [11, 15], [12, 16], [13, 17], [14, 13], [14, 18], [15, 16], [15, 18],
  [17, 20], [17, 23], [18, 23], [18, 24], [19, 22], [19, 24], [20, 23],
  [21, 23], [21, 24], [22, 24],
];
const ADJACENT = NODES.map(() => []);
for (const [a, b] of EDGES) {
  ADJACENT[a].push(b);
  ADJACENT[b].push(a);
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

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.04,
    });
  }
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2a2723, roughness: 0.6, metalness: 0.5 });

  const colliders = [];
  const shootables = [];
  const minimapWalls = []; // [x, z, w, d] rectangles for the HUD minimap

  function box(width, height, depth, x, y, z, material, collide = true, onMap = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
      if (onMap) minimapWalls.push([x, z, width, depth]);
    }
    return mesh;
  }

  // Ground: packed sand with a darker concrete apron at each site. The ground
  // and aprons stay off the minimap, or the map would be one solid rectangle.
  box(64.4, 0.4, 48.4, 0, -0.2, 0, 'sand', true, false);
  box(12, 0.1, 10, SITES.A.x, 0.03, SITES.A.z, 'surface', true, false);
  box(12, 0.1, 10, SITES.B.x, 0.03, SITES.B.z, 'surface', true, false);

  // Perimeter walls, 5 m, open to the dusk sky.
  box(0.6, 5, 48.4, -32.2, 2.5, 0, 'surface');
  box(0.6, 5, 48.4, 32.2, 2.5, 0, 'surface');
  box(64.4, 5, 0.6, 0, 2.5, -24.2, 'surface');
  box(64.4, 5, 0.6, 0, 2.5, 24.2, 'surface');

  // Lane walls: two long walls split the yard into West / Mid / East, each with
  // one gap (z -2..-6) so the mid connector can reach the outer lanes.
  for (const side of [-1, 1]) {
    box(0.6, 4, 6, side * 13, 2, 1, 'surface'); // z -2..+4
    box(0.6, 4, 6, side * 13, 2, -9, 'surface'); // z -12..-6
  }

  // Containers: 6 x 2.6 x 2.4 m boxes, the yard's main cover. Each lane gets
  // staggered blocks so no lane is one long sightline.
  function container(x, z, alongZ, color) {
    const w = alongZ ? 2.4 : 6;
    const d = alongZ ? 6 : 2.4;
    return box(w, 2.6, d, x, 1.3, z, color);
  }
  container(-25, 8, false, 'containerA');
  container(-26, -2, true, 'containerB');
  container(-18, -8, false, 'containerC');
  container(25, 8, false, 'containerB');
  container(26, -2, true, 'containerA');
  container(18, -8, false, 'containerD');
  container(-20, 18, false, 'containerD');
  container(20, 18, false, 'containerA');
  container(-11, -9, true, 'containerC');
  container(11, -9, true, 'containerB');
  // Site stacks: two-high containers the defenders play around.
  container(-27, -13, true, 'containerA');
  box(2.4, 2.6, 6, -27, 3.9, -13, 'containerC');
  container(-20, -21, false, 'containerD');
  container(27, -13, true, 'containerB');
  box(2.4, 2.6, 6, 27, 3.9, -13, 'containerA');
  container(20, -21, false, 'containerC');
  // A tall container across mid at z=8: it breaks the sightline from the
  // defender mid hold all the way to the attacker spawn, so nobody spawn-camps
  // down the middle — attackers are covered until they pass it.
  container(0, 8, false, 'containerB');
  container(6, -22, false, 'containerD');
  container(0, -16, false, 'containerA');

  // Crates: 1.1 m, crouch cover, scattered so every route has a stop.
  function crate(x, z, size = 1.1) {
    box(size, size, size, x, size / 2, z, 'hairline');
  }
  crate(-28, 14); crate(-16, 16); crate(-14, 2); crate(-28, -6); crate(-20, -11);
  crate(28, 14); crate(16, 16); crate(14, 2); crate(28, -6); crate(20, -11);
  crate(-2, 16); crate(2, 16); crate(-9, 0); crate(9, 0); crate(0, -4);
  crate(-24, -19); crate(24, -19); crate(-12, -20); crate(12, -20);
  crate(-30, -16, 1.6); crate(30, -16, 1.6);

  // Barrels: cylinders approximated by their Box3, in two clusters.
  function barrel(x, z) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 12), darkMetal);
    mesh.position.set(x, 0.55, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
  }
  barrel(-10, 18); barrel(-9, 18.9); barrel(10, 18); barrel(9.2, 18.8);
  barrel(-30, 4); barrel(-29, 4.8); barrel(30, 4); barrel(29.1, 4.9);

  // A low platform at mid: jump up for a sightline over the crates.
  box(4, 0.5, 2.5, 0, 0.25, 3, 'surface');

  // Watchtower at the north fence: legs and a cabin, visual only, no access.
  for (const [lx, lz] of [[-2, -22.5], [2, -22.5], [-2, -20.5], [2, -20.5]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.4, 0.3), darkMetal);
    leg.position.set(lx, 2.2, lz);
    leg.castShadow = true;
    group.add(leg);
  }
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(5, 2, 3), materials.surface);
  cabin.position.set(0, 5.4, -21.5);
  cabin.castShadow = true;
  group.add(cabin);

  // Site letters painted on the aprons: canvas textures, drawn at load, no files.
  function siteLetter(letter, x, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.strokeStyle = PALETTE.accent;
    g.lineWidth = 10;
    g.strokeRect(14, 14, 228, 228);
    g.fillStyle = PALETTE.accent;
    g.font = 'bold 150px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, 128, 138);
    const texture = new THREE.CanvasTexture(canvas);
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(x, 0.1, z);
    group.add(decal);
  }
  siteLetter('A', SITES.A.x, SITES.A.z);
  siteLetter('B', SITES.B.x, SITES.B.z);

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
  for (const [lx, lz] of [[-10, 12], [10, 12]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 5.4, 8), darkMetal);
    pole.position.set(lx, 2.7, lz);
    pole.castShadow = true;
    group.add(pole);
    colliders.push(new THREE.Box3(new THREE.Vector3(lx - 0.2, 0, lz - 0.2), new THREE.Vector3(lx + 0.2, 5.4, lz + 0.2)));
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.sun) }),
    );
    lamp.position.set(lx, 5.5, lz);
    group.add(lamp);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.sun), 14, 16, 1.8);
    light.position.set(lx, 5.3, lz);
    scene.add(light);
  }

  // Segment vs Box3, slab method: true when the segment touches any collider.
  // Bots use it for line of sight; grenades use it for blast cover.
  function segmentHitsBox(ax, ay, az, bx, by, bz, box3) {
    let tmin = 0;
    let tmax = 1;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const axes = [[ax, dx, box3.min.x, box3.max.x], [ay, dy, box3.min.y, box3.max.y], [az, dz, box3.min.z, box3.max.z]];
    for (const [origin, delta, lo, hi] of axes) {
      if (Math.abs(delta) < 1e-9) {
        if (origin < lo || origin > hi) return false;
      } else {
        let t1 = (lo - origin) / delta;
        let t2 = (hi - origin) / delta;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return false;
      }
    }
    return true;
  }

  function losBlocked(ax, ay, az, bx, by, bz) {
    for (const collider of colliders) {
      if (segmentHitsBox(ax, ay, az, bx, by, bz, collider)) return true;
    }
    return false;
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < NODES.length; i += 1) {
      const dx = NODES[i][0] - x;
      const dz = NODES[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  // Dijkstra over the 25-node graph; returns the node list from start to goal.
  function findPath(fromIndex, toIndex) {
    if (fromIndex === toIndex) return [fromIndex];
    const dist = new Array(NODES.length).fill(Infinity);
    const prev = new Array(NODES.length).fill(-1);
    const done = new Array(NODES.length).fill(false);
    dist[fromIndex] = 0;
    for (let iter = 0; iter < NODES.length; iter += 1) {
      let current = -1;
      let best = Infinity;
      for (let i = 0; i < NODES.length; i += 1) {
        if (!done[i] && dist[i] < best) {
          best = dist[i];
          current = i;
        }
      }
      if (current === -1) break;
      if (current === toIndex) break;
      done[current] = true;
      for (const next of ADJACENT[current]) {
        const dx = NODES[next][0] - NODES[current][0];
        const dz = NODES[next][1] - NODES[current][1];
        const nd = dist[current] + Math.hypot(dx, dz);
        if (nd < dist[next]) {
          dist[next] = nd;
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
    nodes: NODES,
    group,
  };
}
