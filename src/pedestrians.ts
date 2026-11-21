import * as THREE from "three";
import { type PersonModel, randomPerson } from "./personModel";
import type { PlaceData } from "./places";
import type { RoadData } from "./roads";

// People on the streets: walkers along the road edges, and small groups
// waiting at the real bus stops from the map.
//
// Walkers work like traffic (see traffic.ts): each one slides along a road's
// line of points, but at walking pace and along the EDGE of the road instead
// of in a lane. They exist only near you; ones left behind are removed and
// new ones appear further ahead.

const MAX_WALKERS = 45;
const SPAWN_NEAR = 55; // metres from you: not closer, or you see them pop in
const SPAWN_FAR = 130;
const REMOVE_BEYOND = 170;
const CELL = 100; // size of the squares used to find road points near a spot
const SHOW_WAITING_WITHIN = 200;

interface Walker {
  model: PersonModel;
  road: number;
  segment: number; // between point `segment` and `segment + 1`
  along: number; // metres walked from the point it left
  direction: 1 | -1;
  side: 1 | -1; // which edge of the road: 1 = left of its direction
  pace: number; // metres per second
  stride: number; // how far through the walking motion it is
  aside: number; // extra step away from the road, to dodge a vehicle
  x: number;
  z: number;
  heading: number;
}

/** Something walkers step away from: a vehicle. */
interface Danger {
  x: number;
  z: number;
}

export class Pedestrians {
  readonly group = new THREE.Group();
  private readonly walkers: Walker[] = [];
  private readonly waiting: THREE.Group[] = [];
  private readonly roads: RoadData["roads"];
  private readonly junctions = new Map<string, [road: number, point: number][]>();
  private readonly cells = new Map<string, [road: number, point: number][]>();
  private readonly random = seededRandom(402);

  /** @param solid answers "is there a wall at this spot?" */
  constructor(roads: RoadData, places: PlaceData, private readonly solid: (x: number, z: number) => boolean) {
    this.roads = roads.roads;
    roads.roads.forEach((road, r) => {
      // Nobody walks along the highway or up private driveways.
      if (road.kind === "service" || road.kind.startsWith("trunk")) return;
      for (let i = 0; i < road.points.length / 2; i++) {
        const x = road.points[i * 2];
        const z = road.points[i * 2 + 1];
        push(this.junctions, `${x},${z}`, [r, i]);
        push(this.cells, `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`, [r, i]);
      }
    });

    // --- People waiting at bus stops -------------------------------------------
    // The map has the real bus stops. Stand two to four people at each.
    for (const stop of places.places) {
      if (stop.kind !== "bus_stop" && stop.kind !== "bus_station") continue;
      const crowd = new THREE.Group();
      const people = 2 + Math.floor(this.random() * 3);
      for (let i = 0; i < people; i++) {
        const person = randomPerson(this.random).group;
        // A loose line, each a little out of step and facing slightly
        // differently, so they do not look like soldiers.
        person.position.set((i - people / 2) * 0.9 + this.random() * 0.3, 0, this.random() * 0.8);
        person.rotation.y = (this.random() - 0.5) * 1.2;
        crowd.add(person);
      }
      crowd.position.set(stop.x, 0, stop.z);
      crowd.rotation.y = this.random() * Math.PI * 2;
      crowd.visible = false;
      this.waiting.push(crowd);
      this.group.add(crowd);
    }
  }

  /**
   * Move everyone forward in time by `dt` seconds.
   * @param focus where you are; people live around this spot
   * @param dangers vehicles to step away from
   */
  update(dt: number, focus: { x: number; z: number }, dangers: Danger[]): void {
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      if (Math.hypot(w.x - focus.x, w.z - focus.z) > REMOVE_BEYOND) {
        this.group.remove(w.model.group);
        this.walkers.splice(i, 1);
      }
    }
    // At the very start, fill the streets nearby so the town is not empty.
    const starting = this.walkers.length < MAX_WALKERS / 2;
    for (let tries = 0; tries < 4 && this.walkers.length < MAX_WALKERS; tries++) {
      this.trySpawn(focus, starting ? 12 : SPAWN_NEAR);
    }

    for (const w of this.walkers) this.walk(w, dt, dangers);

    for (const crowd of this.waiting) {
      crowd.visible = Math.hypot(crowd.position.x - focus.x, crowd.position.z - focus.z) < SHOW_WAITING_WITHIN;
    }
  }

  get count(): number {
    return this.walkers.length;
  }

  get busStopCount(): number {
    return this.waiting.length;
  }

  // --- One walker, one frame ----------------------------------------------------

  private walk(w: Walker, dt: number, dangers: Danger[]): void {
    // --- Along the road ---------------------------------------------------------
    let step = w.pace * dt;
    for (let guard = 0; step > 0 && guard < 10; guard++) {
      const length = this.segmentLength(w);
      if (w.along + step < length) {
        w.along += step;
        break;
      }
      step -= length - w.along;
      this.nextSegment(w);
    }

    // --- Where on the road's edge that is ------------------------------------------
    const road = this.roads[w.road];
    const r = road.points;
    const a = w.direction === 1 ? w.segment : w.segment + 1; // point it left
    const b = w.direction === 1 ? w.segment + 1 : w.segment; // point it heads to
    const ax = r[a * 2], az = r[a * 2 + 1];
    let dx = r[b * 2] - ax;
    let dz = r[b * 2 + 1] - az;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;

    // If a vehicle is close, step further from the road until it has passed.
    const inDanger = dangers.some((d) => Math.hypot(d.x - w.x, d.z - w.z) < 6);
    w.aside += ((inDanger ? 1.6 : 0) - w.aside) * (1 - Math.exp(-5 * dt));

    // (dz, -dx) points to the left of the walking direction. Half the road's
    // width puts the walker on its edge; a little more keeps them off the tarmac.
    let out = (road.width / 2 + 0.6 + w.aside) * w.side;
    let targetX = ax + dx * w.along + dz * out;
    let targetZ = az + dz * w.along - dx * out;
    // Where a building stands right at the road's edge there is no room
    // beside the road, so walk just inside the edge of the tarmac instead.
    if (this.solid(targetX, targetZ)) {
      out = (road.width / 2 - 0.7) * w.side;
      targetX = ax + dx * w.along + dz * out;
      targetZ = az + dz * w.along - dx * out;
    }

    // Ease towards the spot, to round off sharp corners in the road's line.
    const ease = 1 - Math.exp(-4 * dt);
    w.x += (targetX - w.x) * ease;
    w.z += (targetZ - w.z) * ease;
    w.heading += shortestTurn(w.heading, Math.atan2(dx, dz)) * ease;

    const g = w.model.group;
    g.position.set(w.x, 0, w.z);
    g.rotation.y = w.heading;

    // --- Swing the legs and arms -----------------------------------------------------
    w.stride += w.pace * dt * 3.2;
    const swing = Math.sin(w.stride) * 0.55;
    w.model.legs[0].rotation.x = swing;
    w.model.legs[1].rotation.x = -swing;
    w.model.arms[0].rotation.x = -swing * 0.8;
    w.model.arms[1].rotation.x = swing * 0.8;
  }

  private segmentLength(w: Walker): number {
    const p = this.roads[w.road].points;
    const i = w.segment * 2;
    return Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
  }

  /** The walker reached the next point on its road. Decide where it goes. */
  private nextSegment(w: Walker): void {
    const p = this.roads[w.road].points;
    const last = p.length / 2 - 1;
    const reached = w.direction === 1 ? w.segment + 1 : w.segment;
    const atEnd = reached === 0 || reached === last;
    w.along = 0;

    const exits = (this.junctions.get(`${p[reached * 2]},${p[reached * 2 + 1]}`) ?? []).filter(([road]) => road !== w.road);
    if (exits.length > 0 && (atEnd || this.random() < 0.2)) {
      const [road, point] = exits[Math.floor(this.random() * exits.length)];
      this.enter(w, road, point);
    } else if (!atEnd) {
      w.segment += w.direction;
    } else {
      w.direction = w.direction === 1 ? -1 : 1; // dead end: turn around
    }
  }

  /** Put the walker on `road` at `point`. One-way rules are for vehicles only. */
  private enter(w: Walker, road: number, point: number): void {
    const last = this.roads[road].points.length / 2 - 1;
    const canGoForward = point < last;
    const canGoBack = point > 0;
    w.road = road;
    w.direction = canGoForward && (!canGoBack || this.random() < 0.5) ? 1 : -1;
    w.segment = w.direction === 1 ? point : point - 1;
    w.along = 0;
  }

  private trySpawn(focus: { x: number; z: number }, nearest: number): void {
    const angle = this.random() * Math.PI * 2;
    const distance = nearest + this.random() * (SPAWN_FAR - nearest);
    const x = focus.x + Math.cos(angle) * distance;
    const z = focus.z + Math.sin(angle) * distance;
    const here = this.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!here) return;
    const [road, point] = here[Math.floor(this.random() * here.length)];
    const p = this.roads[road].points;
    const px = p[point * 2];
    const pz = p[point * 2 + 1];
    if (Math.hypot(px - focus.x, pz - focus.z) < nearest) return;

    const model = randomPerson(this.random);
    const w: Walker = {
      model, road, segment: 0, along: 0, direction: 1,
      side: this.random() < 0.5 ? 1 : -1,
      pace: 1.0 + this.random() * 0.7, // a stroll to a brisk walk
      stride: this.random() * 6,
      aside: 0, x: px, z: pz, heading: 0,
    };
    this.enter(w, road, point);
    this.walkers.push(w);
    this.group.add(model.group);
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** The smallest turn (in radians, left or right) that takes `from` to `to`. */
function shortestTurn(from: number, to: number): number {
  let turn = (to - from) % (Math.PI * 2);
  if (turn > Math.PI) turn -= Math.PI * 2;
  if (turn < -Math.PI) turn += Math.PI * 2;
  return turn;
}

/** A small random-number generator that always gives the same sequence. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
