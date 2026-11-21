import * as THREE from "three";
import { RibbonBuilder } from "./ribbon";

// Turns the saved OpenStreetMap roads (public/kannur-roads.json, made by
// scripts/fetch-map.mjs) into 3D road surfaces, and answers two questions
// for the rest of the game: "where should the car start?" and "which road is
// at this spot?".

interface Road {
  kind: string; // OpenStreetMap road class: trunk, secondary, residential, ...
  width: number; // metres
  lanes: number; // 0 when the map does not say
  name: string; // "" when the map has no name for it
  oneWay: boolean; // may only be driven from the first point to the last
  surface: string; // asphalt, concrete, paving_stones, unpaved, dirt or ""
  points: number[]; // flat list [x0, z0, x1, z1, ...] in metres
}

interface Path {
  kind: string; // footway, path, steps, pedestrian, track, cycleway
  points: number[];
}

export interface RoadData {
  credit: string;
  halfWidth: number; // the map covers x from -halfWidth to +halfWidth
  halfDepth: number; // and z from -halfDepth to +halfDepth
  roads: Road[];
  paths: Path[];
}

export interface Spawn {
  x: number;
  z: number;
  heading: number;
}

const MAIN_KINDS = new Set(["trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"]);

// Colours. Kerala's soil is red laterite, so road edges and dirt tracks are
// that rusty brown, not grey.
const LATERITE = 0xa4673f;
const ASPHALT_MAIN = 0x3b3e46;
const ASPHALT_SMALL = 0x54575e;
const CONCRETE = 0x8f908c;
const PAVERS = 0x9c9087; // interlocking paving stones
const FOOTPATH = 0xb8a88e;
const PAINT = 0xf2f2f2;

function surfaceColour(road: Road): number {
  switch (road.surface) {
    case "concrete": return CONCRETE;
    case "paving_stones": return PAVERS;
    case "unpaved":
    case "dirt": return LATERITE;
    default: return MAIN_KINDS.has(road.kind) ? ASPHALT_MAIN : ASPHALT_SMALL;
  }
}

export class Roads {
  readonly group = new THREE.Group();

  constructor(private readonly data: RoadData) {
    const shoulders = new RibbonBuilder();
    const footpaths = new RibbonBuilder();
    const paint = new RibbonBuilder();
    // One builder (so one mesh) per surface colour.
    const surfaces = new Map<number, RibbonBuilder>();

    for (const road of data.roads) {
      const p = road.points;
      const isMain = MAIN_KINDS.has(road.kind);
      const isLink = road.kind.endsWith("_link");

      // --- The road surface ------------------------------------------------
      const colour = surfaceColour(road);
      let builder = surfaces.get(colour);
      if (!builder) surfaces.set(colour, (builder = new RibbonBuilder()));
      // Wider roads sit a few millimetres above narrower ones, so where two
      // cross, the bigger road is the one you see.
      const y = 0.03 + road.width * 0.003;
      builder.addRibbon(p, road.width, y);
      builder.addDisc(p[0], p[1], road.width / 2, y);
      builder.addDisc(p[p.length - 2], p[p.length - 1], road.width / 2, y);

      // --- The red earth along its edges -----------------------------------
      if (road.kind !== "service") shoulders.addRibbon(p, road.width + 1.4, 0.015);

      // --- Painted lines -----------------------------------------------------
      // Only on the bigger roads, as in the real town; lanes have none.
      if (isLink || road.width < 6) continue;
      // Roads on the map end where they meet other roads. Stopping the paint
      // a few metres short of each end keeps lines out of the junctions.
      const q = trimmed(p, 7);
      if (q.length < 4) continue;
      const LINE = 0.15;
      if (isMain) {
        // A solid line near each edge.
        paint.addRibbon(q, LINE, 0.1, road.width / 2 - 0.35);
        paint.addRibbon(q, LINE, 0.1, -(road.width / 2 - 0.35));
      }
      if (road.oneWay) {
        // One half of a divided road: dashes between its lanes.
        if (road.lanes !== 1) paint.addDashes(q, LINE, 0.1, 0, 3, 4.5);
      } else if (road.lanes >= 4) {
        // Four lanes, two each way: solid middle, dashes between lanes.
        paint.addRibbon(q, LINE, 0.1);
        paint.addDashes(q, LINE, 0.1, road.width / 4, 3, 4.5);
        paint.addDashes(q, LINE, 0.1, -road.width / 4, 3, 4.5);
      } else {
        // Ordinary two-way road: a dashed line down the middle.
        paint.addDashes(q, LINE, 0.1, 0, 3, 4.5);
      }
    }

    for (const path of data.paths) {
      const p = path.points;
      footpaths.addRibbon(p, path.kind === "track" ? 3 : 2, 0.02);
    }

    this.group.add(shoulders.build(LATERITE, 4), footpaths.build(FOOTPATH, 5));
    for (const [colour, builder] of surfaces) {
      this.group.add(builder.build(colour, colour === ASPHALT_MAIN ? 7 : 6));
    }
    this.group.add(paint.build(PAINT, 8));
  }

  /** Start on the big road closest to the middle of the map, facing along it. */
  findSpawn(): Spawn {
    let best: Spawn = { x: 0, z: 0, heading: 0 };
    let bestDist = Infinity;
    for (const road of this.data.roads) {
      if (!MAIN_KINDS.has(road.kind)) continue;
      const p = road.points;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const dist = Math.hypot(p[i], p[i + 1]);
        if (dist < bestDist) {
          bestDist = dist;
          // atan2 turns a direction (dx, dz) back into an angle, the opposite
          // of the sin/cos in car.ts.
          best = { x: p[i], z: p[i + 1], heading: Math.atan2(p[i + 2] - p[i], p[i + 3] - p[i + 1]) };
        }
      }
    }
    return best;
  }

  /**
   * The name of the road under this spot, or "" if it is off-road or the road
   * has no name on the map. Checks every road piece, which is fine a few
   * times a second; a bigger map would need a grid to look only nearby.
   */
  nameAt(x: number, z: number): string {
    let name = "";
    let bestDist = Infinity;
    for (const road of this.data.roads) {
      const p = road.points;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const dist = distanceToSegment(x, z, p[i], p[i + 1], p[i + 2], p[i + 3]);
        if (dist < bestDist && dist <= road.width / 2 + 1) {
          bestDist = dist;
          name = road.name;
        }
      }
    }
    return name;
  }
}

/** The same line with `cut` metres removed from each end ([] if too short). */
function trimmed(points: number[], cut: number): number[] {
  const fromStart = (p: number[]): number[] => {
    let left = cut;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i + 2] - p[i];
      const dz = p[i + 3] - p[i + 1];
      const length = Math.hypot(dx, dz);
      if (length > left) {
        // The cut ends inside this piece: start from that spot.
        const t = left / length;
        return [p[i] + dx * t, p[i + 1] + dz * t, ...p.slice(i + 2)];
      }
      left -= length;
    }
    return [];
  };
  // Cutting the end is cutting the start of the reversed line.
  const reverse = (p: number[]): number[] => {
    const out: number[] = [];
    for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
    return out;
  };
  return reverse(fromStart(reverse(fromStart(points))));
}

/** Shortest distance from point (px, pz) to the line piece from A to B. */
function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const lengthSq = abx * abx + abz * abz;
  // t = how far along A->B the closest point is (0 = at A, 1 = at B).
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / lengthSq));
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}
