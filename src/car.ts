import * as THREE from "three";
import type { Controls } from "./input";
import { buildBus } from "./vehicleModels";

// The vehicle you drive. It started as a car and is now a bus; the class kept
// its name, since everything here works for any vehicle.
//
// Units: 1 unit = 1 metre, speed is metres per second, angles are radians.
// These numbers are the "feel" of the bus: heavier than a car, so it picks up
// speed slowly, takes longer to stop and turns in a wider curve. Change them
// and see what happens.
const MAX_SPEED = 22; // about 80 km/h
const MAX_REVERSE = 5;
const ENGINE = 6; // acceleration, m/s²
const BRAKE = 18;
const HANDBRAKE = 26;
const DRAG = 3; // slows the bus when no key is pressed
const TURN_RATE = 1.25; // radians per second at full grip
const COLOUR = 0xe85d04; // orange, so you can tell it from the traffic buses

export class Car {
  /** The 3D object. Its position and rotation are what the player sees. */
  readonly mesh = new THREE.Group();
  /** Signed speed: positive = forward, negative = reverse. */
  speed = 0;
  /** Direction the car points, as an angle around the up (Y) axis. */
  heading = 0;

  /** Size on the ground, in metres. */
  readonly width: number;
  readonly length: number;

  private readonly frontWheels: THREE.Object3D[];

  /**
   * @param spawn where the car starts, and where R puts it back
   * @param mapHalfWidth,mapHalfDepth the edge of the map; it cannot leave it
   */
  constructor(
    private readonly spawn: { x: number; z: number; heading: number },
    private readonly mapHalfWidth: number,
    private readonly mapHalfDepth: number,
  ) {
    // The shape lives in vehicleModels.ts, shared with traffic. To drive a
    // car again, change buildBus(COLOUR) to buildCar(COLOUR): the size-based
    // code below (collisions, doors, camera) adapts by itself.
    const model = buildBus(COLOUR);
    this.mesh.add(model.group);
    this.frontWheels = model.frontWheels;
    this.width = model.width;
    this.length = model.length;
    this.toSpawn();
  }

  private toSpawn(): void {
    this.mesh.position.set(this.spawn.x, 0, this.spawn.z);
    this.speed = 0;
    this.heading = this.spawn.heading;
    this.mesh.rotation.y = this.heading;
  }

  /**
   * Move the car forward in time by `dt` seconds.
   * @param blocked answers "is there something solid at this spot?"
   */
  update(dt: number, c: Controls, blocked: (x: number, z: number) => boolean): void {
    if (c.reset) this.toSpawn();

    // --- Speed ---------------------------------------------------------
    // Pressing against the direction of travel brakes; otherwise it drives.
    if (c.throttle !== 0) {
      const braking = this.speed !== 0 && Math.sign(c.throttle) !== Math.sign(this.speed);
      this.speed += c.throttle * (braking ? BRAKE : ENGINE) * dt;
    } else {
      this.speed = towardsZero(this.speed, DRAG * dt);
    }
    if (c.handbrake) this.speed = towardsZero(this.speed, HANDBRAKE * dt);
    this.speed = THREE.MathUtils.clamp(this.speed, -MAX_REVERSE, MAX_SPEED);

    // --- Steering ------------------------------------------------------
    // A real car cannot turn while standing still, so the turn rate grows
    // with speed (up to 8 m/s). Multiplying by the sign of the speed makes
    // steering flip in reverse, like a real car.
    const grip = Math.min(Math.abs(this.speed) / 8, 1);
    const heading = this.heading + c.steer * TURN_RATE * grip * Math.sign(this.speed) * dt;

    // --- Position ------------------------------------------------------
    // heading 0 points along +Z. sin/cos turn the angle into a direction.
    const p = this.mesh.position;
    const dirX = Math.sin(heading);
    const dirZ = Math.cos(heading);
    const x = THREE.MathUtils.clamp(p.x + dirX * this.speed * dt, -this.mapHalfWidth, this.mapHalfWidth);
    const z = THREE.MathUtils.clamp(p.z + dirZ * this.speed * dt, -this.mapHalfDepth, this.mapHalfDepth);

    // --- Collision -----------------------------------------------------
    // Work out where it WOULD be, then test five points along its length,
    // from nose to tail. (A bus is long: testing only nose, middle and tail
    // would let a wall corner slip in between them.) If any point is inside
    // something solid, do not move or turn at all and bounce back a little.
    // Because we only ever accept a free spot, it can never end up stuck
    // inside a wall.
    const nose = this.length / 2;
    const crash = [nose, nose / 2, 0, -nose / 2, -nose].some((d) => blocked(x + dirX * d, z + dirZ * d));
    if (crash) {
      this.speed *= -0.3;
    } else {
      this.heading = heading;
      p.x = x;
      p.z = z;
    }

    this.mesh.rotation.y = this.heading;
    for (const w of this.frontWheels) w.rotation.y = c.steer * 0.45;
  }

  /**
   * Turn a spot given relative to the car ("1.9 m to its right") into a spot
   * in the world. `side` is metres to the car's left (negative = right),
   * `along` is metres towards its front (negative = behind).
   */
  spotBeside(side: number, along: number): { x: number; z: number } {
    const sin = Math.sin(this.heading);
    const cos = Math.cos(this.heading);
    const p = this.mesh.position;
    return { x: p.x + side * cos + along * sin, z: p.z - side * sin + along * cos };
  }

  /**
   * Places to stand after getting out, best first. In India the passenger
   * door of a bus is on the LEFT, the side next to the kerb.
   */
  doorSpots(): { x: number; z: number }[] {
    const beside = this.width / 2 + 0.9;
    return [
      this.spotBeside(beside, this.length / 4), // left, at the front door
      this.spotBeside(-beside, this.length / 4), // right
      this.spotBeside(0, -(this.length / 2 + 1)), // behind
    ];
  }

  /** Is this spot inside the body? Stops the player walking through it. */
  contains(x: number, z: number): boolean {
    // The reverse of spotBeside: world spot -> "how far to the side / along".
    const dx = x - this.mesh.position.x;
    const dz = z - this.mesh.position.z;
    const sin = Math.sin(this.heading);
    const cos = Math.cos(this.heading);
    const side = dx * cos - dz * sin;
    const along = dx * sin + dz * cos;
    return Math.abs(side) < this.width / 2 + 0.25 && Math.abs(along) < this.length / 2 + 0.25;
  }
}

/** Move `value` towards 0 by `amount`, without overshooting past 0. */
function towardsZero(value: number, amount: number): number {
  if (Math.abs(value) <= amount) return 0;
  return value - Math.sign(value) * amount;
}
