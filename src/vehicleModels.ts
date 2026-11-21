import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// The shapes of the vehicles. The player's vehicles and the traffic both use
// these.
//
// Cars are real 3D models: .glb files in public/models/, from the free
// "Car Kit" by Kenney (www.kenney.nl, licence CC0 = public domain; see
// public/models/KENNEY-LICENSE.txt). That kit has no bus, motorbike or
// auto-rickshaw, so those three are still built here from boxes and cylinders.
//
// Every model has its front facing +Z and its wheels standing on y = 0.

export interface VehicleModel {
  group: THREE.Group;
  /** Front wheel pivots, so the driver's steering can turn them. */
  frontWheels: THREE.Object3D[];
  /** Size on the ground, in metres. Used for collisions and following gaps. */
  width: number;
  length: number;
}

// --- Car models loaded from files ------------------------------------------------

export const CAR_KINDS = [
  "sedan", "sedan-sports", "hatchback-sports", "suv", "suv-luxury",
  "taxi", "police", "van", "truck", "delivery", "ambulance",
] as const;
export type CarKind = (typeof CAR_KINDS)[number];

// The kit's cars are toy-sized (about 2.5 units long). This makes a sedan
// about 3.7 m long. They are also wider for their length than real cars;
// that chunky look is the kit's style.
const CAR_SCALE = 1.45;

const templates = new Map<CarKind, THREE.Group>();

/**
 * Download every car model once, at start-up. After this, buildCar() is
 * instant: it copies a model that is already in memory.
 */
export async function loadVehicleModels(): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    CAR_KINDS.map(async (kind) => {
      const gltf = await loader.loadAsync(`/models/${kind}.glb`);
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
      templates.set(kind, gltf.scene);
    }),
  );
}

export function buildCar(kind: CarKind): VehicleModel {
  const template = templates.get(kind);
  if (!template) throw new Error(`Car model "${kind}" is not loaded. Call loadVehicleModels() first.`);
  // clone() copies the objects (so each car can be moved on its own) but
  // shares the heavy parts, the triangles and the texture, between all copies.
  const car = template.clone(true);
  car.scale.setScalar(CAR_SCALE);
  const group = new THREE.Group();
  group.add(car);

  // Measure it: a box that just fits around the whole model.
  const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  // The kit names each part. The front wheels are the ones steering turns.
  const frontWheels = ["wheel-front-left", "wheel-front-right"]
    .map((name) => car.getObjectByName(name))
    .filter((wheel): wheel is THREE.Object3D => wheel !== undefined);
  return { group, frontWheels, width: size.x, length: size.z };
}

// --- Models built from boxes --------------------------------------------------------

// Materials are made once and shared by every vehicle. Making new ones per
// vehicle would waste memory for no visible difference.
const rubber = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
const glass = new THREE.MeshStandardMaterial({ color: 0x1b263b, roughness: 0.2 });
const metal = new THREE.MeshStandardMaterial({ color: 0x8d9399, roughness: 0.4, metalness: 0.6 });
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
function wheel(radius: number, x: number, z: number, thickness = radius * 0.8): THREE.Group {
  // A cylinder stands upright by default; rotate it to lie like a wheel.
  const shape = new THREE.CylinderGeometry(radius, radius, thickness, 14);
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

/**
 * A motorbike.
 * @param withRider adds a seated rider. Traffic bikes have one built in; on
 *   the bike you ride, your own character sits there instead.
 */
export function buildBike(colour: number, withRider: boolean): VehicleModel {
  const group = new THREE.Group();
  const body = paint(colour);
  const black = paint(0x1c1c1c);
  group.add(
    box(0.16, 0.22, 1.15, metal, 0, 0.5, 0), // frame
    box(0.3, 0.3, 0.4, black, 0, 0.48, 0.02), // engine
    box(0.34, 0.26, 0.5, body, 0, 0.82, 0.22), // fuel tank
    box(0.3, 0.1, 0.62, black, 0, 0.82, -0.32), // seat
    box(0.2, 0.16, 0.36, body, 0, 0.72, -0.72), // tail
    box(0.7, 0.05, 0.05, metal, 0, 1.08, 0.5), // handlebar
    box(0.08, 0.62, 0.08, metal, 0, 0.72, 0.62), // front fork
    box(0.16, 0.16, 0.1, paint(0xfff3b0), 0, 0.95, 0.72), // headlight
    box(0.06, 0.06, 0.7, metal, 0.14, 0.34, -0.5), // exhaust
  );
  const front = [wheel(0.32, 0, 0.72, 0.12)];
  group.add(...front, wheel(0.32, 0, -0.72, 0.14));

  if (withRider) {
    const shirt = paint([0x1d6fb8, 0xb23a48, 0x2f6e35, 0xe0e0e0][Math.floor(Math.random() * 4)]);
    const skin = paint(0xa9714b);
    const trousers = paint(0x2b2d33);
    const lean = (mesh: THREE.Mesh, angle: number): THREE.Mesh => {
      mesh.rotation.x = angle;
      return mesh;
    };
    group.add(
      lean(box(0.44, 0.6, 0.26, shirt, 0, 1.22, -0.2), 0.3), // body, bent forward
      box(0.28, 0.28, 0.3, black, 0, 1.66, -0.02), // helmet
      lean(box(0.12, 0.12, 0.55, skin, 0.27, 1.25, 0.2), 0.35), // arms to the bars
      lean(box(0.12, 0.12, 0.55, skin, -0.27, 1.25, 0.2), 0.35),
      lean(box(0.17, 0.17, 0.6, trousers, 0.2, 0.78, -0.02), -0.2), // thighs
      lean(box(0.17, 0.17, 0.6, trousers, -0.2, 0.78, -0.02), -0.2),
      box(0.15, 0.5, 0.15, trousers, 0.2, 0.48, 0.22), // lower legs
      box(0.15, 0.5, 0.15, trousers, -0.2, 0.48, 0.22),
    );
  }
  return finish(group, front, 0.7, 2.1);
}
