import * as THREE from "three";
import type { Buildings } from "./buildings";
import type { Ground } from "./ground";
import type { Land } from "./land";
import type { RoadData } from "./roads";

// Coconut palms and leafy trees in the open ground between buildings.
//
// IMPORTANT: these are NOT from the map. OpenStreetMap has almost no trees
// for Kannur (2 in the whole area). The positions are made up: a tree is
// planted wherever there is no road, building, railway or water. They are
// here because a Kannur without coconut trees does not look like Kannur.
//
// There are thousands of trees, so they use "instancing": the graphics card
// is given ONE trunk shape and ONE crown shape, plus a list of where to draw
// each copy. That is 4 draw calls for all trees instead of thousands.

const SPACING = 15; // metres between planting spots, before the random shake
const KEEP = 0.6; // plant on this share of the free spots, to leave gaps
const CELL = 4; // metres. Size of the squares used to mark "road is here".

export class Trees {
  readonly group = new THREE.Group();
  readonly count: number;

  constructor(roads: RoadData, rails: number[][], buildings: Buildings, land: Land, ground: Ground) {
    // --- Mark every square that a road, footpath or railway touches ---------
    const taken = new Set<number>();
    const key = (x: number, z: number) => Math.floor(x / CELL) * 100000 + Math.floor(z / CELL);
    const markLine = (p: number[], halfWidth: number): void => {
      for (let i = 0; i + 3 < p.length; i += 2) {
        const dx = p[i + 2] - p[i];
        const dz = p[i + 3] - p[i + 1];
        const steps = Math.ceil(Math.hypot(dx, dz) / 2);
        // Walk along the piece 2 m at a time, marking a blob around each step.
        for (let s = 0; s <= steps; s++) {
          const x = p[i] + (dx * s) / steps;
          const z = p[i + 1] + (dz * s) / steps;
          for (let ox = -halfWidth; ox <= halfWidth; ox += CELL) {
            for (let oz = -halfWidth; oz <= halfWidth; oz += CELL) taken.add(key(x + ox, z + oz));
          }
        }
      }
    };
    for (const road of roads.roads) markLine(road.points, road.width / 2 + 3);
    for (const path of roads.paths) markLine(path.points, 3);
    for (const line of rails) markLine(line, 5);

    // --- Choose the spots ------------------------------------------------------
    // A fixed "seed" makes the random numbers the same on every run, so the
    // trees do not jump around each time you reload.
    const random = seededRandom(1498);
    const palms: THREE.Matrix4[] = [];
    const leafy: THREE.Matrix4[] = [];
    const spot = new THREE.Object3D(); // a helper to build position+turn+size
    for (let gx = -roads.halfWidth; gx < roads.halfWidth; gx += SPACING) {
      for (let gz = -roads.halfDepth; gz < roads.halfDepth; gz += SPACING) {
        const x = gx + random() * SPACING;
        const z = gz + random() * SPACING;
        const size = 0.8 + random() * 0.5;
        const isPalm = random() < 0.65;
        const turn = random() * Math.PI * 2;
        // Far fewer trees in the packed town centre than in the housing areas.
        if (random() > KEEP * (1 - 0.9 * ground.builtUpAt(x, z))) continue;
        if (taken.has(key(x, z)) || land.inWater(x, z)) continue;
        // A tree needs room: check a few points around the trunk too.
        const R = 3;
        if (buildings.hits(x, z) || buildings.hits(x + R, z) || buildings.hits(x - R, z) || buildings.hits(x, z + R) || buildings.hits(x, z - R)) continue;

        spot.position.set(x, 0, z);
        spot.rotation.y = turn;
        spot.scale.setScalar(size);
        spot.updateMatrix();
        (isPalm ? palms : leafy).push(spot.matrix.clone());
      }
    }
    this.count = palms.length + leafy.length;

    // --- Shapes ------------------------------------------------------------------
    // Shapes are moved up so their base is at y = 0, the foot of the tree.
    const palmTrunk = new THREE.CylinderGeometry(0.16, 0.26, 9, 6).translate(0, 4.5, 0);
    // A ball squashed flat and wide is a good enough crown of palm leaves.
    const palmCrown = new THREE.IcosahedronGeometry(3, 0).scale(1, 0.32, 1).translate(0, 9.2, 0);
    const leafyTrunk = new THREE.CylinderGeometry(0.3, 0.4, 3.5, 6).translate(0, 1.75, 0);
    const leafyCrown = new THREE.IcosahedronGeometry(3.2, 0).scale(1, 0.85, 1).translate(0, 5.6, 0);

    const bark = new THREE.MeshStandardMaterial({ color: 0x7a644c, roughness: 1 });
    const palmGreen = new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 1, flatShading: true });
    const leafGreen = new THREE.MeshStandardMaterial({ color: 0x2f6e35, roughness: 1, flatShading: true });

    this.group.add(
      instanced(palmTrunk, bark, palms),
      instanced(palmCrown, palmGreen, palms),
      instanced(leafyTrunk, bark, leafy),
      instanced(leafyCrown, leafGreen, leafy),
    );
  }
}

/** One mesh that draws `shape` once for every entry in `places`. */
function instanced(shape: THREE.BufferGeometry, material: THREE.Material, places: THREE.Matrix4[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(shape, material, places.length);
  places.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
  mesh.castShadow = true;
  // Three.js skips drawing things that are off screen, judging by the size of
  // ONE copy at the origin. Our copies are spread over the whole town, so
  // that check would wrongly hide them all. Turn it off.
  mesh.frustumCulled = false;
  return mesh;
}

/** A small random-number generator that always gives the same sequence. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
