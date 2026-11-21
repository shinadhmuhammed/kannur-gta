import * as THREE from "three";

/**
 * Collects corner points and triangles, then turns them into one mesh.
 * Buildings use three of these: walls, tiled roofs and flat roofs, because
 * each needs a different texture, and one mesh can only have one.
 *
 * Every corner point ("vertex") carries four things:
 *   position  where it is
 *   normal    which way the surface faces there, for lighting
 *   colour    multiplied with the texture, so each building has its own paint
 *   uv        which spot of the texture picture goes on this corner
 */
export class MeshPart {
  private positions: number[] = [];
  private normals: number[] = [];
  private colours: number[] = [];
  private uvs: number[] = [];
  private indices: number[] = [];

  /** Add one corner point and return its number. */
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, colour: THREE.Color, u: number, v: number): number {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.colours.push(colour.r, colour.g, colour.b);
    this.uvs.push(u, v);
    return this.positions.length / 3 - 1;
  }

  /** Add one triangle, by the numbers of its three corners. */
  triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  build(texture: THREE.Texture, roughness: number): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colours, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, map: texture, roughness }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}
