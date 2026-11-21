import * as THREE from "three";
import type { BuildingData } from "./buildings";
import { groundTexture } from "./textures";

// The colour of the ground.
//
// In the real town centre you see no grass: buildings stand wall to wall and
// the bit of ground between them is paved or bare earth. Out in the housing
// areas there are gardens and trees. The map does not say which is which,
// so we work it out: where buildings cover a lot of the ground, the ground
// is drawn dusty grey-brown; where there are few, it is green.
//
// The ground is a grid of squares. Each corner gets a colour, and the
// graphics card blends smoothly between corners, so there are no hard edges.

const CELL = 30; // metres between grid corners
const GREEN = new THREE.Color(0x86a05f);
const TOWN = new THREE.Color(0xb3a186);

export class Ground {
  readonly mesh: THREE.Mesh;
  private readonly builtUp: Float32Array; // 0 = open land ... 1 = packed town
  private readonly columns: number;
  private readonly rows: number;
  private readonly left: number; // x of the grid's first column
  private readonly top: number; // z of the grid's first row

  constructor(data: BuildingData, halfWidth: number, halfDepth: number) {
    const MARGIN = 150;
    this.left = -halfWidth - MARGIN;
    this.top = -halfDepth - MARGIN;
    this.columns = Math.ceil(((halfWidth + MARGIN) * 2) / CELL) + 1;
    this.rows = Math.ceil(((halfDepth + MARGIN) * 2) / CELL) + 1;

    // --- How much of each square is covered by buildings ---------------------
    let cover: Float32Array = new Float32Array(this.columns * this.rows);
    for (const building of data.buildings) {
      const p = building.points;
      // Shoelace formula for the area, and the first corner as "where it is".
      let area = 0;
      for (let i = 0; i < p.length; i += 2) {
        const j = (i + 2) % p.length;
        area += p[i] * p[j + 1] - p[j] * p[i + 1];
      }
      const c = Math.round((p[0] - this.left) / CELL);
      const r = Math.round((p[1] - this.top) / CELL);
      if (c >= 0 && c < this.columns && r >= 0 && r < this.rows) {
        cover[r * this.columns + c] += Math.abs(area) / 2 / (CELL * CELL);
      }
    }
    // Blur it twice: each square becomes the average of itself and its eight
    // neighbours. One big building then no longer makes one odd grey square.
    for (let pass = 0; pass < 2; pass++) cover = this.blurred(cover);
    // Turn "share of ground covered" into 0..1: under 10 % covered is open
    // land, over 30 % is packed town, smooth in between.
    this.builtUp = cover.map((share) => THREE.MathUtils.clamp((share - 0.1) / 0.2, 0, 1));

    // --- The mesh ---------------------------------------------------------------
    const positions: number[] = [];
    const colours: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const colour = new THREE.Color();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.columns; c++) {
        positions.push(this.left + c * CELL, 0, this.top + r * CELL);
        colour.lerpColors(GREEN, TOWN, this.builtUp[r * this.columns + c]);
        colours.push(colour.r, colour.g, colour.b);
        // One texture picture per 14 metres of ground.
        uvs.push((this.left + c * CELL) / 14, (this.top + r * CELL) / 14);
        if (c < this.columns - 1 && r < this.rows - 1) {
          const a = r * this.columns + c; // this corner
          const b = a + this.columns; // the corner below it
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, map: groundTexture(), roughness: 1 }));
    this.mesh.receiveShadow = true;
  }

  /** How built-up is this spot? 0 = open land, 1 = packed town centre. */
  builtUpAt(x: number, z: number): number {
    const c = Math.round((x - this.left) / CELL);
    const r = Math.round((z - this.top) / CELL);
    if (c < 0 || c >= this.columns || r < 0 || r >= this.rows) return 0;
    return this.builtUp[r * this.columns + c];
  }

  private blurred(values: Float32Array): Float32Array {
    const out = new Float32Array(values.length);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.columns; c++) {
        let sum = 0, count = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.columns) continue;
            sum += values[rr * this.columns + cc];
            count++;
          }
        }
        out[r * this.columns + c] = sum / count;
      }
    }
    return out;
  }
}
