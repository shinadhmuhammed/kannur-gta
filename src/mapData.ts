// Loads the map files that scripts/fetch-map.mjs saved in public/.
// Vite serves everything in public/ from the site root, so
// public/kannur-roads.json is fetched as "/kannur-roads.json".

export async function loadJson<T>(name: string): Promise<T> {
  const res = await fetch(`/${name}`);
  if (!res.ok) throw new Error(`Could not load ${name}. Run: npm run fetch-map`);
  return res.json() as Promise<T>;
}

/**
 * Is the point (x, z) inside the outline `p` (flat list [x0, z0, x1, z1, ...])?
 *
 * The classic trick: draw a line from the point straight out to the right and
 * count how many edges of the outline it crosses. Odd = inside, even = outside.
 */
export function pointInOutline(x: number, z: number, p: number[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1];
    const xj = p[j], zj = p[j + 1];
    // Does this edge pass the point's z level, and is the crossing to the right?
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
