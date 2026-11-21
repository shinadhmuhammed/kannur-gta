import * as THREE from "three";
import type { Controls } from "./input";

// The person you control when you are out of the car.

const WALK = 2.2; // metres per second, a relaxed walk
const RUN = 6; // holding Shift
const TURN_RATE = 2.8; // radians per second

export class Player {
  readonly mesh = new THREE.Group();
  /** Direction the player faces, same meaning as the car's heading. */
  heading = 0;
  /** Signed speed in m/s: positive = forward, negative = stepping back. */
  speed = 0;

  private readonly legs: THREE.Object3D[] = [];
  private readonly arms: THREE.Object3D[] = [];
  private stride = 0; // how far through the walking motion we are

  constructor() {
    this.buildModel();
    this.mesh.visible = false; // the game starts inside the car
  }

  /** Put the player at a spot, standing still. */
  placeAt(x: number, z: number, heading: number): void {
    this.mesh.position.set(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.mesh.rotation.y = heading;
  }

  /**
   * Move the player forward in time by `dt` seconds.
   * @param blocked answers "is there something solid at this spot?"
   */
  update(dt: number, c: Controls, blocked: (x: number, z: number) => boolean): void {
    // Same keys as the car: left/right turn, forward/back walk. Unlike the
    // car, a person can turn on the spot and stops at once.
    this.heading += c.steer * TURN_RATE * dt;
    const pace = c.run ? RUN : WALK;
    this.speed = c.throttle > 0 ? pace : c.throttle < 0 ? -WALK * 0.6 : 0;

    const p = this.mesh.position;
    const stepX = Math.sin(this.heading) * this.speed * dt;
    const stepZ = Math.cos(this.heading) * this.speed * dt;

    // --- Collision with sliding ---------------------------------------------
    // If the full step is blocked, try moving along only x, then only z.
    // That way walking into a wall at an angle slides you along it, instead
    // of stopping dead, which feels sticky.
    if (!blocked(p.x + stepX, p.z + stepZ)) {
      p.x += stepX;
      p.z += stepZ;
    } else if (!blocked(p.x + stepX, p.z)) {
      p.x += stepX;
    } else if (!blocked(p.x, p.z + stepZ)) {
      p.z += stepZ;
    }

    this.mesh.rotation.y = this.heading;
    this.animate(dt);
  }

  /** Swing the legs and arms while moving; ease back to standing when not. */
  private animate(dt: number): void {
    let swing: number;
    if (this.speed !== 0) {
      // The faster you go, the faster the stride. sin() swings back and forth.
      this.stride += Math.abs(this.speed) * dt * 3.2;
      swing = Math.sin(this.stride) * 0.7;
    } else {
      swing = this.legs[0].rotation.x * Math.exp(-12 * dt);
    }
    // Left leg forward goes with right arm forward, like real walking.
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.arms[0].rotation.x = -swing * 0.8;
    this.arms[1].rotation.x = swing * 0.8;
  }

  /** A blocky person about 1.75 m tall. Front faces +Z. */
  private buildModel(): void {
    const skin = new THREE.MeshStandardMaterial({ color: 0xa9714b, roughness: 0.8 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x1d6fb8, roughness: 0.8 });
    const trousers = new THREE.MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.9 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x15110e, roughness: 1 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.62, 0.26), shirt);
    torso.position.y = 1.13;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skin);
    head.position.y = 1.6;
    const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.28), hair);
    hairTop.position.y = 1.76;
    this.mesh.add(torso, head, hairTop);

    // A limb must swing from its top (hip or shoulder), not from its middle.
    // So each limb is a box hanging below an empty "pivot", and we rotate
    // the pivot.
    const limb = (x: number, top: number, length: number, thick: number, m: THREE.Material): THREE.Object3D => {
      const pivot = new THREE.Group();
      pivot.position.set(x, top, 0);
      const box = new THREE.Mesh(new THREE.BoxGeometry(thick, length, thick), m);
      box.position.y = -length / 2;
      pivot.add(box);
      this.mesh.add(pivot);
      return pivot;
    };
    this.legs.push(limb(0.13, 0.82, 0.82, 0.2, trousers), limb(-0.13, 0.82, 0.82, 0.2, trousers));
    this.arms.push(limb(0.32, 1.42, 0.6, 0.13, skin), limb(-0.32, 1.42, 0.6, 0.13, skin));

    this.mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
  }
}
