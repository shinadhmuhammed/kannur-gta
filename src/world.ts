import * as THREE from "three";

// The parts of the world that are not roads: sky, light and the ground.

export interface World {
  /** The sun. main.ts moves it along with the car so shadows stay sharp. */
  sun: THREE.DirectionalLight;
}

/** Where the sun sits compared to the thing it is lighting. */
export const SUN_OFFSET = new THREE.Vector3(60, 100, 40);

export function buildWorld(scene: THREE.Scene, halfWidth: number, halfDepth: number): World {
  scene.background = new THREE.Color(0x9fd3f0);
  // Fog fades far things into the sky colour, so roads do not just "end".
  scene.fog = new THREE.Fog(0x9fd3f0, 200, 800);

  // Two lights: a soft one from the sky so shadows are not black,
  // and a "sun" that gives direction and casts shadows.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556b2f, 1.1));
  const sun = new THREE.DirectionalLight(0xfff2cc, 2.2);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Shadows are only drawn inside this box around the sun's target. A small
  // box that follows the car gives sharp shadows; one box over the whole
  // 4 km map would be a blur.
  const s = sun.shadow.camera;
  s.left = -60; s.right = 60; s.top = 60; s.bottom = -60; s.far = 300;
  scene.add(sun, sun.target);

  // The ground is a bit bigger than the map so the edge hides in the fog.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(halfWidth * 2 + 1600, halfDepth * 2 + 1600),
    new THREE.MeshStandardMaterial({ color: 0x86a05f, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2; // a plane is vertical by default; lay it flat
  // This plain green sheet is only what you see beyond the edge of the map.
  // Inside the map, ground.ts draws a coloured ground just above it.
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  return { sun };
}
