import * as THREE from "three";
import { pointInOutline } from "./mapData";

// Builds every building in the map as a simple box-like shape: the outline
// from OpenStreetMap pushed straight up to the building's height, with a tiled
// sloping roof on houses and a flat roof on bigger buildings. All 12,000+
// buildings go into ONE mesh (see the note in ribbon.ts on
// why), and each gets its colour through "vertex colours".

interface Building {
  height: number; // metres
  points: number[]; // outline, flat list [x0, z0, x1, z1, ...]
}

export interface BuildingData {
  buildings: Building[];
}

// Wall paints you see around Kannur: whites, creams, light blue, pink, yellow.
const WALLS = [0xf2ead8, 0xe8d9b5, 0xf6f1e7, 0xd5e3ec, 0xf0d0b8, 0xe3e8c9, 0xf3dd8c];
const TILE_ROOF = 0xb5523b; // Mangalore clay tiles, for houses
const CONCRETE_ROOF = 0x9d9c96; // for big buildings
const BIG = 250; // m². Larger than this counts as a big building.

// For collisions we must find the buildings near the car quickly. Checking
// all 12,000 every frame is wasteful, so the map is cut into square cells and
// each cell remembers which buildings touch it. Then we only check one cell.
const CELL = 40; // metres
const cellKey = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;

export class Buildings {
  readonly mesh: THREE.Mesh;
  private readonly cells = new Map<string, Building[]>();

  constructor(data: BuildingData) {
    const positions: number[] = [];
    const normals: number[] = [];
    const colours: number[] = [];
    const indices: number[] = [];
    const colour = new THREE.Color();

    /** Add one corner point and return its number. */
    const vertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
      positions.push(x, y, z);
      normals.push(nx, ny, nz); // which way the surface faces, for lighting
      colours.push(colour.r, colour.g, colour.b);
      return positions.length / 3 - 1;
    };

    data.buildings.forEach((building, n) => {
      const h = building.height;
      const area = signedArea(building.points);
      // Outlines come drawn in either direction. Make them all go the same
      // way round, so "outside" is always on the same side of each wall.
      const p = area > 0 ? building.points : reversed(building.points);
      const count = p.length / 2;

      // --- Walls: one rectangle per edge of the outline --------------------
      colour.setHex(WALLS[n % WALLS.length]);
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        const x1 = p[i * 2], z1 = p[i * 2 + 1];
        const x2 = p[j * 2], z2 = p[j * 2 + 1];
        const len = Math.hypot(x2 - x1, z2 - z1) || 1;
        const nx = (z2 - z1) / len; // the edge turned 90 degrees = facing out
        const nz = -(x2 - x1) / len;
        const a = vertex(x1, 0, z1, nx, 0, nz); // bottom corners
        const b = vertex(x2, 0, z2, nx, 0, nz);
        const c = vertex(x2, h, z2, nx, 0, nz); // top corners
        const d = vertex(x1, h, z1, nx, 0, nz);
        indices.push(a, c, b, a, d, c); // two triangles make the rectangle
      }

      // --- Roof ---------------------------------------------------------------
      const corners: THREE.Vector2[] = [];
      let midX = 0, midZ = 0;
      for (let i = 0; i < count; i++) {
        corners.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
        midX += p[i * 2] / count;
        midZ += p[i * 2 + 1] / count;
      }
      const isHouse = Math.abs(area) <= BIG && count <= 8 && pointInOutline(midX, midZ, p);

      if (isHouse) {
        // A sloping tiled roof, as on Kerala houses: every wall top rises to
        // one peak above the middle of the house.
        colour.setHex(TILE_ROOF);
        const peak = h + Math.min(2.4, Math.sqrt(Math.abs(area)) * 0.2);
        for (let i = 0; i < count; i++) {
          const a = corners[i], b = corners[(i + 1) % count];
          // The slope faces partly up and partly outwards. The "normal" is
          // the arrow sticking straight out of the surface; the cross product
          // of two edges of the triangle gives it.
          const ux = b.x - a.x, uz = b.y - a.y;
          const vx = midX - a.x, vy = peak - h, vz = midZ - a.y;
          let nx = -uz * vy, ny = uz * vx - ux * vz, nz = ux * vy;
          const flip = ny < 0; // make sure the roof faces the sky
          if (flip) { nx = -nx; ny = -ny; nz = -nz; }
          const len = Math.hypot(nx, ny, nz) || 1;
          const va = vertex(a.x, h, a.y, nx / len, ny / len, nz / len);
          const vb = vertex(b.x, h, b.y, nx / len, ny / len, nz / len);
          const top = vertex(midX, peak, midZ, nx / len, ny / len, nz / len);
          if (flip) indices.push(va, vb, top);
          else indices.push(va, top, vb);
        }
      } else {
        // A flat concrete roof: the outline itself, cut into triangles.
        colour.setHex(CONCRETE_ROOF);
        const first = positions.length / 3;
        for (const corner of corners) vertex(corner.x, h, corner.y, 0, 1, 0);
        for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(corners, [])) {
          // A triangle is only visible from the side where its corners go
          // anticlockwise. Make sure every roof triangle faces up.
          const a = corners[i], b = corners[j], c = corners[k];
          const facesUp = (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y) > 0;
          indices.push(first + i, first + (facesUp ? j : k), first + (facesUp ? k : j));
        }
      }

      this.addToCells(building);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
    geometry.setIndex(indices);
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  /** Is this spot inside a building? */
  hits(x: number, z: number): boolean {
    const nearby = this.cells.get(cellKey(x, z));
    return nearby !== undefined && nearby.some((b) => pointInOutline(x, z, b.points));
  }

  /** Remember the building in every cell its outline's bounding box touches. */
  private addToCells(building: Building): void {
    const p = building.points;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
      minZ = Math.min(minZ, p[i + 1]); maxZ = Math.max(maxZ, p[i + 1]);
    }
    for (let x = Math.floor(minX / CELL); x <= Math.floor(maxX / CELL); x++) {
      for (let z = Math.floor(minZ / CELL); z <= Math.floor(maxZ / CELL); z++) {
        const key = `${x},${z}`;
        const list = this.cells.get(key);
        if (list) list.push(building);
        else this.cells.set(key, [building]);
      }
    }
  }
}

/** Shoelace formula. The sign tells which way round the outline is drawn. */
function signedArea(p: number[]): number {
  let sum = 0;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    sum += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return sum / 2;
}

/** The same outline, drawn the other way round. */
function reversed(p: number[]): number[] {
  const out: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
}
