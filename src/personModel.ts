import * as THREE from "three";

// The blocky person shape, used for you and for the people on the streets.

export interface PersonModel {
  group: THREE.Group;
  /** Hip and shoulder pivots, so the legs and arms can swing. */
  legs: THREE.Object3D[];
  arms: THREE.Object3D[];
}

export interface PersonLook {
  top: number; // colour of the shirt or blouse
  lower: number; // colour of the trousers, mundu or skirt
  /** A long skirt (saree or churidar) instead of two separate legs. */
  skirt?: boolean;
  longHair?: boolean;
  skin?: number;
}

// Shapes and materials are made once and shared by everyone. With dozens of
// people on screen, making new ones for each person would waste memory.
const shapes = new Map<string, THREE.BoxGeometry>();
function shape(w: number, h: number, d: number): THREE.BoxGeometry {
  const key = `${w},${h},${d}`;
  let geometry = shapes.get(key);
  if (!geometry) shapes.set(key, (geometry = new THREE.BoxGeometry(w, h, d)));
  return geometry;
}
const materials = new Map<number, THREE.MeshStandardMaterial>();
function material(colour: number): THREE.MeshStandardMaterial {
  let m = materials.get(colour);
  if (!m) materials.set(colour, (m = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85 })));
  return m;
}

/** A person about 1.75 m tall. Front faces +Z, feet on y = 0. */
export function buildPerson(look: PersonLook): PersonModel {
  const group = new THREE.Group();
  const skin = material(look.skin ?? 0xa9714b);
  const top = material(look.top);
  const lower = material(look.lower);
  const hair = material(0x15110e);

  const part = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): void => {
    const mesh = new THREE.Mesh(shape(w, h, d), m);
    mesh.position.set(x, y, z);
    group.add(mesh);
  };
  part(0.48, 0.62, 0.26, top, 0, 1.13, 0); // torso
  part(0.26, 0.28, 0.26, skin, 0, 1.6, 0); // head
  part(0.28, 0.08, 0.28, hair, 0, 1.76, 0); // hair on top
  if (look.longHair) part(0.26, 0.42, 0.07, hair, 0, 1.5, -0.15); // hair down the back
  if (look.skirt) part(0.5, 0.8, 0.34, lower, 0, 0.42, 0);

  // A limb must swing from its top (hip or shoulder), not from its middle.
  // So each limb is a box hanging below an empty "pivot", and we rotate the
  // pivot.
  const limb = (x: number, topY: number, length: number, thick: number, m: THREE.Material): THREE.Object3D => {
    const pivot = new THREE.Group();
    pivot.position.set(x, topY, 0);
    const box = new THREE.Mesh(shape(thick, length, thick), m);
    box.position.y = -length / 2;
    pivot.add(box);
    group.add(pivot);
    return pivot;
  };
  const legs = [limb(0.13, 0.82, 0.82, 0.2, lower), limb(-0.13, 0.82, 0.82, 0.2, lower)];
  const arms = [limb(0.32, 1.42, 0.6, 0.13, skin), limb(-0.32, 1.42, 0.6, 0.13, skin)];

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return { group, legs, arms };
}

const TOPS = [0x1d6fb8, 0xb23a48, 0x2f6e35, 0xe8e2d0, 0xf2c14e, 0x7b4ea3, 0x2a9d8f, 0xd9d9d9, 0xe07a5f];
const TROUSERS = [0x2b2d33, 0x3d405b, 0x5c4b3a, 0x1f2a44];
const SAREES = [0xc2185b, 0x6a1b9a, 0x00897b, 0xef6c00, 0x283593, 0xad1457, 0x2e7d32];
const SKINS = [0xa9714b, 0x8d5a3b, 0xc08a62, 0x7a4b30];

/** A random person as you would see on a Kannur street. */
export function randomPerson(random: () => number): PersonModel {
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)];
  const skin = pick(SKINS);
  const kind = random();
  if (kind < 0.38) {
    // A woman in a saree or churidar: one colour, long skirt, long hair.
    const colour = pick(SAREES);
    return buildPerson({ top: colour, lower: colour, skirt: true, longHair: true, skin });
  }
  if (kind < 0.62) {
    // A man in a white or cream mundu.
    return buildPerson({ top: pick(TOPS), lower: pick([0xf2efe6, 0xe9e2cf]), skirt: true, skin });
  }
  return buildPerson({ top: pick(TOPS), lower: pick(TROUSERS), skin });
}
