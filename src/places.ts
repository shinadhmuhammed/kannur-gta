// Named places from the map: shops, banks, schools, temples, mosques, bus
// stops, the fort ... The game shows the nearest one, so you can tell where
// in Kannur you are.

interface Place {
  name: string;
  kind: string; // the map's own category: bank, school, place_of_worship, ...
  religion: string; // hindu, muslim, christian or "" (for places of worship)
  x: number;
  z: number;
}

export interface PlaceData {
  places: Place[];
}

export class Places {
  constructor(private readonly data: PlaceData) {}

  /** The closest named place within `reach` metres, or null if none. */
  nearest(x: number, z: number, reach: number): { name: string; distance: number } | null {
    let best: Place | null = null;
    let bestDist = reach;
    for (const place of this.data.places) {
      const dist = Math.hypot(place.x - x, place.z - z);
      if (dist < bestDist) {
        bestDist = dist;
        best = place;
      }
    }
    return best && { name: best.name, distance: bestDist };
  }
}
