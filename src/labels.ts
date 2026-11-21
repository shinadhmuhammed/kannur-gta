import * as THREE from "three";
import type { PlaceData } from "./places";

// Name boards that float above the important places: the railway station,
// bus stands, hospitals, schools, temples, mosques, churches, malls, cinemas,
// parks, beaches, the fort ... all with their real names from the map.
//
// Each board is a "sprite": a flat picture that always turns to face the
// camera. The picture is text drawn on a small canvas, exactly as you would
// draw text on a web page canvas, then used as a texture.

// Which map categories get a board, and the little picture shown before the name.
const ICONS: Record<string, string> = {
  station: "🚆", halt: "🚆", bus_station: "🚌",
  hospital: "🏥", police: "🚓",
  school: "🏫", college: "🎓", university: "🎓",
  cinema: "🎬", mall: "🛍️", marketplace: "🧺",
  museum: "🏛️", attraction: "⭐", fort: "🏰", lighthouse: "🗼",
  stadium: "🏟️", park: "🌳", beach: "🏖️",
};
const WORSHIP: Record<string, string> = { hindu: "🛕", muslim: "🕌", christian: "⛪" };

const SHOW_WITHIN = 320; // metres. Boards further away are hidden.
const HEIGHT = 10; // metres above the ground, clear of most roofs

export class Labels {
  readonly group = new THREE.Group();
  readonly count: number;

  constructor(data: PlaceData) {
    const shown: { name: string; x: number; z: number }[] = [];
    for (const place of data.places) {
      const icon = place.kind === "place_of_worship" ? (WORSHIP[place.religion] ?? "🛐") : ICONS[place.kind];
      if (!icon) continue;
      // A school drawn as five buildings has five entries with one name.
      // One board is enough.
      if (shown.some((s) => s.name === place.name && Math.hypot(s.x - place.x, s.z - place.z) < 150)) continue;
      shown.push(place);

      // The station is just called "Kannur" on the map. Say what it is.
      const isStation = place.kind === "station" || place.kind === "halt";
      const text = isStation && !/station/i.test(place.name) ? `${place.name} Railway Station` : place.name;
      const board = makeBoard(`${icon} ${text}`, isStation ? 1.6 : 1);
      board.position.set(place.x, isStation ? HEIGHT + 4 : HEIGHT, place.z);
      this.group.add(board);
    }
    this.count = shown.length;
  }

  /** Show only the boards near the player. Call a few times a second. */
  update(x: number, z: number): void {
    for (const board of this.group.children) {
      board.visible = Math.hypot(board.position.x - x, board.position.z - z) < SHOW_WITHIN;
    }
  }
}

function makeBoard(text: string, size: number): THREE.Sprite {
  const FONT = "600 40px system-ui, sans-serif";
  const PAD = 22;
  const canvas = document.createElement("canvas");
  const c = canvas.getContext("2d")!;
  // Measure first: the canvas must be made as wide as the text needs.
  c.font = FONT;
  canvas.width = Math.ceil(c.measureText(text).width) + PAD * 2;
  canvas.height = 72;
  // Changing a canvas's size wipes its settings, so set the font again.
  c.font = FONT;
  c.fillStyle = "rgba(18, 24, 38, 0.85)";
  c.beginPath();
  c.roundRect(0, 0, canvas.width, canvas.height, 16);
  c.fill();
  c.fillStyle = "#ffffff";
  c.textBaseline = "middle";
  c.fillText(text, PAD, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; // the canvas colours are normal screen colours
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  // Size in the world, in metres. Keep the picture's own shape.
  const height = 3.2 * size;
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1);
  sprite.visible = false;
  return sprite;
}
