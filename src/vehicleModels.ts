import * as THREE from "three";

// The shapes of the vehicles: a car, an auto-rickshaw and a bus, all made of
// boxes and cylinders. The player's car and the traffic both use these.
// Every model has its front facing +Z and its wheels standing on y = 0.

export interface VehicleModel {
  group: THREE.Group;
  /** Front wheel pivots, so the driver's steering can turn them. */
  frontWheels: THREE.Object3D[];
  /** Size on the ground, in metres. Used for collisions and following gaps. */
  width: number;
  length: number;
}

// Materials and wheel shapes are made once and shared by every vehicle.
// Making new ones per vehicle would waste memory for no visible difference.
const rubber = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
const glass = new THREE.MeshStandardMaterial({ color: 0x1b263b, roughness: 0.2 });
const paints = new Map<number, THREE.MeshStandardMaterial>();
function paint(colour: number): THREE.MeshStandardMaterial {
  let material = paints.get(colour);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5 });
    paints.set(colour, material);
  }
  return material;
}

function box(w: number, h: number, l: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), material);
  mesh.position.set(x, y, z);
  return mesh;
}

/** A wheel inside a pivot. The pivot is what turns left/right when steering. */
function wheel(radius: number, x: number, z: number): THREE.Group {
  // A cylinder stands upright by default; rotate it to lie like a wheel.
  const shape = new THREE.CylinderGeometry(radius, radius, radius * 0.8, 14);
  shape.rotateZ(Math.PI / 2);
  const pivot = new THREE.Group();
  pivot.position.set(x, radius, z);
  pivot.add(new THREE.Mesh(shape, rubber));
  return pivot;
}

function finish(group: THREE.Group, frontWheels: THREE.Object3D[], width: number, length: number): VehicleModel {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return { group, frontWheels, width, length };
}

export function buildCar(colour: number): VehicleModel {
  const group = new THREE.Group();
  group.add(box(1.8, 0.6, 4.2, paint(colour), 0, 0.65, 0), box(1.6, 0.6, 2.1, glass, 0, 1.25, -0.2));
  const front = [wheel(0.36, -0.95, 1.35), wheel(0.36, 0.95, 1.35)];
  group.add(...front, wheel(0.36, -0.95, -1.35), wheel(0.36, 0.95, -1.35));
  return finish(group, front, 1.8, 4.2);
}

/** The three-wheeled taxi you see everywhere in Kerala: black body, yellow top. */
export function buildAuto(): VehicleModel {
  const black = paint(0x1c1c1c);
  const yellow = paint(0xf2c200);
  const group = new THREE.Group();
  group.add(
    box(1.3, 0.55, 2.0, black, 0, 0.6, -0.3), // passenger tub
    box(1.3, 0.75, 2.0, yellow, 0, 1.3, -0.3), // canopy
    box(0.9, 0.8, 0.7, yellow, 0, 0.75, 1.0), // narrow nose
    box(0.8, 0.45, 0.05, glass, 0, 1.35, 0.72), // windscreen
  );
  const front = [wheel(0.25, 0, 1.2)]; // one wheel at the front
  group.add(...front, wheel(0.25, -0.6, -1.0), wheel(0.25, 0.6, -1.0));
  return finish(group, front, 1.3, 2.8);
}

export function buildBus(colour: number): VehicleModel {
  const group = new THREE.Group();
  group.add(
    box(2.5, 2.4, 9.0, paint(colour), 0, 1.7, 0),
    box(2.54, 0.8, 8.2, glass, 0, 2.2, 0), // window strip, a hair wider than the body
    box(2.2, 0.9, 0.05, glass, 0, 2.1, 4.5), // windscreen
    box(2.0, 0.7, 0.05, glass, 0, 2.2, -4.5), // rear window
    box(0.3, 0.2, 0.05, paint(0xb00020), -0.95, 1.0, -4.5), // tail lights
    box(0.3, 0.2, 0.05, paint(0xb00020), 0.95, 1.0, -4.5),
  );
  const front = [wheel(0.5, -1.1, 3.0), wheel(0.5, 1.1, 3.0)];
  group.add(...front, wheel(0.5, -1.1, -2.8), wheel(0.5, 1.1, -2.8));
  return finish(group, front, 2.5, 9.0);
}
