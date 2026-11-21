import * as THREE from "three";

// Textures: small pictures that are wrapped over surfaces so they are not one
// flat colour. Flat colour is the main reason a 3D scene looks like a cartoon.
//
// None of these are image files. Each is painted by code onto a canvas when
// the game starts ("procedural" textures). That keeps the download small and
// means there is no picture whose licence we would have to worry about.
//
// How a texture mixes with a colour: the graphics card MULTIPLIES them. A
// white pixel leaves the surface colour as it is, a grey pixel darkens it,
// a black pixel makes it black. So these pictures are mostly near-white:
// they only add grain, dirt and detail, and one picture works for a cream
// wall and a blue wall alike.

const SIZE = 256; // pixels. Must be a power of two for the picture to repeat.

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

function newCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  return [canvas, canvas.getContext("2d")!];
}

/** Fine grain: every pixel a slightly different grey. */
function addGrain(c: CanvasRenderingContext2D, random: () => number, brightness: number, spread: number): void {
  const image = c.getImageData(0, 0, SIZE, SIZE);
  for (let i = 0; i < image.data.length; i += 4) {
    const shade = (random() - 0.5) * spread;
    for (let k = 0; k < 3; k++) image.data[i + k] = Math.max(0, Math.min(255, (image.data[i + k] * brightness) / 255 + shade));
  }
  c.putImageData(image, 0, 0);
}

/** Soft darker or lighter patches, like stains, wear and damp. */
function addBlotches(c: CanvasRenderingContext2D, random: () => number, count: number, darkness: number): void {
  for (let i = 0; i < count; i++) {
    const x = random() * SIZE, y = random() * SIZE, radius = 12 + random() * 50;
    const dark = random() < 0.7;
    // Draw each patch nine times, shifted by a whole picture, so a patch
    // that crosses one edge comes back in on the other. Then the picture
    // repeats with no visible seam.
    for (const ox of [-SIZE, 0, SIZE]) {
      for (const oy of [-SIZE, 0, SIZE]) {
        const fade = c.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, radius);
        fade.addColorStop(0, dark ? `rgba(0,0,0,${darkness})` : `rgba(255,255,255,${darkness})`);
        fade.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = fade;
        c.fillRect(x + ox - radius, y + oy - radius, radius * 2, radius * 2);
      }
    }
  }
}

function finish(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; // tile it endlessly
  texture.colorSpace = THREE.SRGBColorSpace; // canvas colours are screen colours
  // Keeps the picture sharp on surfaces seen at a flat angle, like a road
  // stretching away from you. Without it the road turns to mush.
  texture.anisotropy = 8;
  return texture;
}

/** Rough tarmac. */
export function asphaltTexture(): THREE.Texture {
  const [canvas, c] = newCanvas();
  const random = seededRandom(11);
  c.fillStyle = "#ececec";
  c.fillRect(0, 0, SIZE, SIZE);
  addBlotches(c, random, 26, 0.1);
  addGrain(c, random, 255, 46);
  return finish(canvas);
}

/** Bare earth and scrubby grass. */
export function groundTexture(): THREE.Texture {
  const [canvas, c] = newCanvas();
  const random = seededRandom(23);
  c.fillStyle = "#eeeeee";
  c.fillRect(0, 0, SIZE, SIZE);
  addBlotches(c, random, 60, 0.16);
  addGrain(c, random, 255, 34);
  return finish(canvas);
}

/** Weathered concrete, for flat roofs. */
export function concreteTexture(): THREE.Texture {
  const [canvas, c] = newCanvas();
  const random = seededRandom(37);
  c.fillStyle = "#f0f0f0";
  c.fillRect(0, 0, SIZE, SIZE);
  addBlotches(c, random, 40, 0.2); // monsoon stains
  addGrain(c, random, 255, 24);
  return finish(canvas);
}

/** Rows of clay roof tiles. */
export function tileTexture(): THREE.Texture {
  const [canvas, c] = newCanvas();
  const random = seededRandom(51);
  c.fillStyle = "#f2f2f2";
  c.fillRect(0, 0, SIZE, SIZE);
  const ROWS = 8, COLUMNS = 8;
  const h = SIZE / ROWS, w = SIZE / COLUMNS;
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      // Each tile a slightly different shade: old tiles weather unevenly.
      const shade = 205 + Math.floor(random() * 50);
      c.fillStyle = `rgb(${shade},${shade},${shade})`;
      c.fillRect(column * w, row * h, w - 1, h);
      // A rounded highlight down the middle makes it look curved.
      c.fillStyle = "rgba(255,255,255,0.18)";
      c.fillRect(column * w + w * 0.3, row * h, w * 0.3, h);
    }
    // The shadow where each row overlaps the one below.
    c.fillStyle = "rgba(0,0,0,0.38)";
    c.fillRect(0, row * h, SIZE, 3);
  }
  addGrain(c, random, 255, 20);
  return finish(canvas);
}

/**
 * One window's worth of wall: a square that is one window wide and one floor
 * tall. Repeated across a wall it gives rows of windows, one row per floor.
 */
export function wallTexture(): THREE.Texture {
  const [canvas, c] = newCanvas();
  const random = seededRandom(73);
  c.fillStyle = "#f4f4f4";
  c.fillRect(0, 0, SIZE, SIZE);
  addBlotches(c, random, 14, 0.07);

  // Canvas y runs downwards, so y = 0 is the TOP of the floor.
  const left = SIZE * 0.3, top = SIZE * 0.22, width = SIZE * 0.4, height = SIZE * 0.42;
  // The frame, a little lighter than the wall.
  c.fillStyle = "#ffffff";
  c.fillRect(left - 6, top - 6, width + 12, height + 12);
  // The glass: dark, with a paler streak of reflected sky.
  const glass = c.createLinearGradient(left, top, left + width, top + height);
  glass.addColorStop(0, "#2c3b4d");
  glass.addColorStop(0.5, "#4a5f77");
  glass.addColorStop(1, "#1d2733");
  c.fillStyle = glass;
  c.fillRect(left, top, width, height);
  // Bars: one down the middle, one across.
  c.fillStyle = "#e9e9e9";
  c.fillRect(left + width / 2 - 2, top, 4, height);
  c.fillRect(left, top + height * 0.38, width, 4);
  // The sunshade slab above the window (every Kerala house has one) and its shadow.
  c.fillStyle = "#ffffff";
  c.fillRect(left - 14, top - 16, width + 28, 8);
  c.fillStyle = "rgba(0,0,0,0.22)";
  c.fillRect(left - 14, top - 8, width + 28, 7);
  // Rain streaks running down from the sill.
  for (let i = 0; i < 5; i++) {
    c.fillStyle = `rgba(0,0,0,${0.03 + random() * 0.05})`;
    c.fillRect(left + random() * width, top + height + 6, 3 + random() * 5, 20 + random() * 30);
  }
  // A faint line where one floor's slab meets the next, and dirt near the ground.
  c.fillStyle = "rgba(0,0,0,0.1)";
  c.fillRect(0, 0, SIZE, 3);
  addGrain(c, random, 255, 14);
  return finish(canvas);
}
