import * as THREE from "three";

/**
 * Collects flat strips ("ribbons") that follow lines of points, and turns
 * them all into ONE mesh. Roads, lane markings, streams and railway tracks
 * are all ribbons.
 *
 * Why one mesh? Every separate mesh is a separate "draw call" to the graphics
 * card, and draw calls are what make a 3D game slow, not triangles. 1,246
 * roads as 1,246 meshes would stutter; as a handful of meshes it is nothing.
 *
 * Points are always a flat list [x0, z0, x1, z1, ...] in metres.
 */
export class RibbonBuilder {
  private positions: number[] = [];
  private indices: number[] = [];

  /**
   * A strip of the given width that follows the line.
   * @param offset shifts the strip sideways: positive = to the left of the
   *   direction the points run in. Used for lane and edge lines.
   */
  addRibbon(points: number[], width: number, y: number, offset = 0): void {
    const half = width / 2;
    const count = points.length / 2;
    const first = this.positions.length / 3;

    for (let i = 0; i < count; i++) {
      // Direction of the line at this point: from the previous point to the
      // next one (at the two ends there is only one neighbour).
      const prev = Math.max(i - 1, 0);
      const next = Math.min(i + 1, count - 1);
      let dx = points[next * 2] - points[prev * 2];
      let dz = points[next * 2 + 1] - points[prev * 2 + 1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      // (dz, -dx) is the direction turned 90 degrees: it points sideways,
      // to the left. Step half a width each way to get the two edges.
      const x = points[i * 2] + dz * offset;
      const z = points[i * 2 + 1] - dx * offset;
      this.positions.push(x + dz * half, y, z - dx * half, x - dz * half, y, z + dx * half);
    }

    // Join each pair of edge points to the next pair with two triangles.
    for (let i = 0; i < count - 1; i++) {
      const a = first + i * 2; // edge point on one side
      const b = a + 1; // the point across from it
      this.indices.push(a, b, a + 2, b, b + 2, a + 2);
    }
  }

  /**
   * A broken line: `dash` metres painted, `gap` metres empty, repeated.
   * Used for lane markings and railway sleepers.
   */
  addDashes(points: number[], width: number, y: number, offset: number, dash: number, gap: number): void {
    let phase = 0; // how far we are into the current dash + gap cycle
    for (let i = 0; i + 3 < points.length; i += 2) {
      const ax = points[i], az = points[i + 1];
      const dx = points[i + 2] - ax;
      const dz = points[i + 3] - az;
      const length = Math.hypot(dx, dz);
      if (length === 0) continue;
      const ux = dx / length, uz = dz / length;
      for (let t = 0; t < length; ) {
        const painting = phase < dash;
        const step = Math.min((painting ? dash : dash + gap) - phase, length - t);
        if (painting) {
          this.addRibbon([ax + ux * t, az + uz * t, ax + ux * (t + step), az + uz * (t + step)], width, y, offset);
        }
        t += step;
        phase = (phase + step) % (dash + gap);
      }
    }
  }

  /** A filled circle. Put at road ends so junctions have no notches. */
  addDisc(x: number, z: number, radius: number, y: number): void {
    const STEPS = 10;
    const centre = this.positions.length / 3;
    this.positions.push(x, y, z);
    for (let k = 0; k < STEPS; k++) {
      const angle = (k / STEPS) * Math.PI * 2;
      this.positions.push(x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius);
    }
    for (let k = 0; k < STEPS; k++) {
      this.indices.push(centre, centre + 1 + ((k + 1) % STEPS), centre + 1 + k);
    }
  }

  /**
   * @param layer bigger = drawn on top. Ground, sea, shoulders, roads and
   *   paint are all at nearly the same height, and far away the graphics
   *   card cannot tell which is on top, so they flicker ("z-fighting").
   *   polygonOffset tells it: "treat this one as slightly closer".
   */
  build(colour: number, layer: number): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals(); // tells the light which way the surface faces
    const mesh = new THREE.Mesh(geometry, flatMaterial(colour, layer));
    mesh.receiveShadow = true;
    return mesh;
  }
}

/** A material for things lying flat on the ground. See `build` for `layer`. */
export function flatMaterial(colour: number, layer: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: colour, roughness: 1 });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -layer;
  material.polygonOffsetUnits = -layer;
  return material;
}
