import * as THREE from "three";
import type { Controls } from "./input";
import { buildPerson } from "./personModel";

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

  private readonly legs: THREE.Object3D[];
  private readonly arms: THREE.Object3D[];
  private stride = 0; // how far through the walking motion we are

  constructor() {
    // The shape lives in personModel.ts, shared with the people on the streets.
    const model = buildPerson({ top: 0x1d6fb8, lower: 0x2b2d33 });
    this.mesh.add(model.group);
    this.legs = model.legs;
    this.arms = model.arms;
    this.mesh.visible = false; // the game starts inside the bus
  }

  /** Put the player at a spot, standing still. */
  placeAt(x: number, z: number, heading: number): void {
    this.mesh.position.set(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.mesh.rotation.set(0, heading, 0);
    for (const limb of [...this.legs, ...this.arms]) limb.rotation.x = 0;
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

  /**
   * Sit on a bike: follow it, lean with it, knees bent and hands on the bars.
   * Called every frame while riding, instead of update().
   */
  rideOn(x: number, z: number, heading: number, lean: number): void {
    this.mesh.position.set(x, -0.12, z); // a little lower: sitting, not standing
    this.heading = heading;
    this.speed = 0;
    // YXZ = turn to face the heading first, then tip over sideways.
    this.mesh.rotation.set(0, heading, -lean, "YXZ");
    for (const leg of this.legs) leg.rotation.x = -1.1;
    for (const arm of this.arms) arm.rotation.x = -1.0;
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
}
