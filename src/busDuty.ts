import * as THREE from "three";
import type { PlaceData } from "./places";
import type { RoadData } from "./roads";

// Bus duty: the first real "game" in the game.
//
// You drive the bus round a loop of REAL Kannur bus stops (from the map).
// At each stop, passengers who wanted that stop get off and the people
// waiting get on and pay their fare. Each leg has a time allowance, like a
// timetable. At the end you get a summary: passengers carried, money
// collected and how many stops you reached on time.
//
// This file is only the rules. It never touches the keyboard, the bus or the
// screen directly: main.ts tells it where the bus is and asks it what to show.
// Keeping rules apart from drawing is what makes them easy to test and change.

const STOPS_ON_ROUTE = 6;
const MIN_ROAD_WIDTH = 6; // metres. The bus needs a road at least this wide.
const ARRIVE_WITHIN = 13; // metres from the stop's spot on the road
const STOPPED_BELOW = 0.6; // m/s. Passengers only move when the bus is still.
const SECONDS_PER_PERSON = 0.55; // how long each person takes at the door
const SEATS = 40;
const MIN_FARE = 10; // rupees, for one stop
const FARE_PER_EXTRA_STOP = 3;
// The timetable assumes this average speed, plus a little slack per leg.
const TIMETABLE_SPEED = 5.5; // m/s, about 20 km/h: town traffic
const SLACK = 18; // seconds

export interface Stop {
  name: string;
  x: number; // the spot ON THE ROAD nearest the stop: where the bus pulls up
  z: number;
}

type Phase = "off" | "driving" | "atStop" | "finished";

/** What the screen should show. main.ts turns this into HTML. */
export interface DutyView {
  lines: string[]; // the panel at the top; empty = hide it
  target: Stop | null; // where to draw the marker; null = nowhere
}

export class BusDuty {
  /** The tall glowing marker at the next stop. */
  readonly beacon = new THREE.Group();
  readonly route: Stop[];

  private phase: Phase = "off";
  private next = 0; // which stop we are heading for (index into route)
  private timeLeft = 0; // seconds until the timetable says we should arrive
  private doorTimer = 0;
  private toAlight = 0; // people still getting off at this stop
  private toBoard = 0; // people still getting on
  private boardedHere = 0;
  private alightedHere = 0;
  /** One entry per passenger on board: the stop number they want. */
  private passengers: number[] = [];
  // The running totals for the summary.
  private carried = 0;
  private earned = 0;
  private onTime = 0;
  private leftBehind = 0;

  constructor(roads: RoadData, places: PlaceData, startX: number, startZ: number, private readonly random = Math.random) {
    this.route = chooseRoute(roads, places, startX, startZ);

    // A see-through yellow pillar you can spot from far away, and a ring on
    // the ground showing how close you need to stop.
    const glow = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 40, 20, 1, true), glow);
    pillar.position.y = 20;
    const ring = new THREE.Mesh(new THREE.RingGeometry(ARRIVE_WITHIN - 0.6, ARRIVE_WITHIN, 40), glow.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.2;
    this.beacon.add(pillar, ring);
    this.beacon.visible = false;
  }

  get active(): boolean {
    return this.phase === "driving" || this.phase === "atStop";
  }

  /** B was pressed while in the bus: start a duty, or clear the summary. */
  toggle(): void {
    if (this.phase === "off" && this.route.length >= 2) this.start();
    else if (this.phase === "finished") this.phase = "off";
    else if (this.active) this.finish(); // give up early: show what you did
  }

  private start(): void {
    this.phase = "driving";
    this.next = 0;
    this.passengers = [];
    this.carried = this.earned = this.onTime = this.leftBehind = 0;
    this.timeLeft = 40; // time to reach the first stop from wherever you are
  }

  /**
   * Move the duty forward in time by `dt` seconds.
   * @param inBus false while you are on foot or in another vehicle
   * @param onArrive called once when the bus pulls up at a stop
   */
  update(dt: number, busX: number, busZ: number, busSpeed: number, inBus: boolean, onArrive: (stop: Stop) => void): void {
    if (!this.active) {
      this.beacon.visible = false;
      return;
    }
    const stop = this.route[this.next];
    this.beacon.visible = true;
    this.beacon.position.set(stop.x, 0, stop.z);
    this.timeLeft -= dt; // the clock runs even while you are stopped

    const atTheStop = inBus && Math.hypot(busX - stop.x, busZ - stop.z) < ARRIVE_WITHIN;
    const still = Math.abs(busSpeed) < STOPPED_BELOW;

    if (this.phase === "driving") {
      if (atTheStop && still) this.arrive(onArrive);
      return;
    }

    // --- At a stop: one person through the door at a time -------------------------
    if (!atTheStop) {
      // You drove off while people were still getting on. They are left behind.
      this.leftBehind += this.toBoard;
      this.depart();
      return;
    }
    if (!still) return; // rolling: nobody steps on or off a moving bus
    this.doorTimer -= dt;
    if (this.doorTimer > 0) return;
    this.doorTimer = SECONDS_PER_PERSON;
    if (this.toAlight > 0) {
      // Getting off comes first, as at a real bus door.
      this.toAlight--;
      this.alightedHere++;
      this.passengers.splice(this.passengers.indexOf(this.next), 1);
    } else if (this.toBoard > 0) {
      this.toBoard--;
      this.boardedHere++;
      this.board();
    } else {
      this.depart();
    }
  }

  private arrive(onArrive: (stop: Stop) => void): void {
    this.phase = "atStop";
    if (this.timeLeft >= 0) this.onTime++;
    const last = this.next === this.route.length - 1;
    this.toAlight = this.passengers.filter((wanted) => wanted === this.next).length;
    // Between 1 and 6 people waiting, but nobody boards at the last stop,
    // and never more than there are free seats once people have got off.
    const waiting = last ? 0 : 1 + Math.floor(this.random() * 6);
    const freeSeats = SEATS - (this.passengers.length - this.toAlight);
    this.toBoard = Math.min(waiting, freeSeats);
    this.leftBehind += waiting - this.toBoard;
    this.boardedHere = this.alightedHere = 0;
    this.doorTimer = 0.8; // a moment for the doors to open
    onArrive(this.route[this.next]);
  }

  /** One person gets on: they pick a later stop and pay for the distance. */
  private board(): void {
    const stopsAhead = this.route.length - 1 - this.next;
    const ride = 1 + Math.floor(this.random() * stopsAhead); // how many stops they travel
    this.passengers.push(this.next + ride);
    this.carried++;
    this.earned += MIN_FARE + FARE_PER_EXTRA_STOP * (ride - 1);
  }

  private depart(): void {
    this.toBoard = this.toAlight = 0;
    if (this.next === this.route.length - 1) {
      this.finish();
      return;
    }
    const from = this.route[this.next];
    this.next++;
    const to = this.route[this.next];
    // Straight-line distance is shorter than the road, so allow 40 % more.
    const metres = Math.hypot(to.x - from.x, to.z - from.z) * 1.4;
    this.timeLeft = metres / TIMETABLE_SPEED + SLACK;
    this.phase = "driving";
  }

  private finish(): void {
    this.phase = "finished";
    this.beacon.visible = false;
  }

  /** What to show right now. */
  view(busX: number, busZ: number): DutyView {
    if (this.phase === "off") return { lines: [], target: null };
    if (this.phase === "finished") {
      return {
        lines: [
          "Duty finished",
          `Passengers carried: ${this.carried}`,
          `Fares collected: ₹${this.earned}`,
          `Stops reached on time: ${this.onTime} of ${this.route.length}`,
          ...(this.leftBehind > 0 ? [`Left behind: ${this.leftBehind}`] : []),
          "Press B to close",
        ],
        target: null,
      };
    }
    const stop = this.route[this.next];
    const metres = Math.round(Math.hypot(busX - stop.x, busZ - stop.z));
    const clock = this.timeLeft >= 0 ? `${Math.ceil(this.timeLeft)} s left` : `late by ${Math.ceil(-this.timeLeft)} s`;
    const status =
      this.phase === "atStop"
        ? this.toAlight > 0
          ? `Getting off: ${this.toAlight} more`
          : this.toBoard > 0
            ? `Getting on: ${this.toBoard} more`
            : "Doors closing"
        : `${metres} m  ·  ${clock}`;
    return {
      lines: [
        `Stop ${this.next + 1} of ${this.route.length}: ${stop.name}`,
        status,
        `On board: ${this.passengers.length}/${SEATS}  ·  ₹${this.earned}`,
      ],
      target: stop,
    };
  }
}

/**
 * Pick a loop of real bus stops the bus can actually reach.
 *
 * Bus stops on the map are points beside the road, sometimes on lanes too
 * narrow for our bus. So each stop is moved to the nearest spot on a road
 * that is wide enough, and dropped if no such road is close. Then, starting
 * from the stop nearest the bus, we keep hopping to the nearest stop not yet
 * used ("nearest neighbour"), which gives a sensible round trip.
 */
function chooseRoute(roads: RoadData, places: PlaceData, startX: number, startZ: number): Stop[] {
  const wide = roads.roads.filter((road) => road.width >= MIN_ROAD_WIDTH);
  const onRoad = (x: number, z: number): { x: number; z: number; distance: number } => {
    let best = { x, z, distance: Infinity };
    for (const road of wide) {
      const p = road.points;
      for (let i = 0; i < p.length; i += 2) {
        const distance = Math.hypot(p[i] - x, p[i + 1] - z);
        if (distance < best.distance) best = { x: p[i], z: p[i + 1], distance };
      }
    }
    return best;
  };

  const stops: Stop[] = [];
  for (const place of places.places) {
    if (place.kind !== "bus_stop" && place.kind !== "bus_station") continue;
    const spot = onRoad(place.x, place.z);
    if (spot.distance > 45) continue; // no wide road near this stop
    // Two map entries for the same stop (one each side of the road): keep one.
    if (stops.some((s) => Math.hypot(s.x - spot.x, s.z - spot.z) < 120)) continue;
    // Map names are typed by volunteers, often all in lower case
    // ("plaza"). Start each word with a capital for the display.
    const name = place.name.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
    stops.push({ name, x: spot.x, z: spot.z });
  }

  const route: Stop[] = [];
  let x = startX, z = startZ;
  while (route.length < STOPS_ON_ROUTE && stops.length > 0) {
    let nearest = 0;
    for (let i = 1; i < stops.length; i++) {
      if (Math.hypot(stops[i].x - x, stops[i].z - z) < Math.hypot(stops[nearest].x - x, stops[nearest].z - z)) nearest = i;
    }
    const [stop] = stops.splice(nearest, 1);
    route.push(stop);
    x = stop.x;
    z = stop.z;
  }
  // End where you began, like a town circular service.
  if (route.length >= 2) route.push({ ...route[0], name: `${route[0].name} (terminus)` });
  return route;
}
