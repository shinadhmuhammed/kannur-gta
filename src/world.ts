import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";

// The sky, the light, and the plain ground beyond the edge of the map.

export interface World {
  /** The sun. main.ts moves it along with the player so shadows stay sharp. */
  sun: THREE.DirectionalLight;
}

/** Where the sun sits compared to the thing it is lighting. */
export const SUN_OFFSET = new THREE.Vector3(70, 85, 45);

const HAZE = 0xc9d6de; // the pale colour of far-away things on a humid day

export function buildWorld(scene: THREE.Scene, renderer: THREE.WebGLRenderer, halfWidth: number, halfDepth: number): World {
  // --- How the picture is developed ------------------------------------------
  // "Tone mapping" squeezes very bright light into what a screen can show,
  // the way a camera does. Bright things roll off softly to white instead of
  // clipping, which is a big part of looking like a photo and not a drawing.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;

  // --- Sky ---------------------------------------------------------------------
  // A model of real daylight: blue overhead, paler and hazier at the horizon,
  // brightest around the sun. All it needs is where the sun is.
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  u.turbidity.value = 7; // haze in the air. Kerala is humid: fairly high.
  u.rayleigh.value = 1.1; // how blue the sky is
  u.mieCoefficient.value = 0.006;
  u.mieDirectionalG.value = 0.8; // size of the glow around the sun
  u.sunPosition.value.copy(SUN_OFFSET).normalize();
  scene.add(sky);

  // Light does not only come from the sun: the whole sky lights the scene
  // too, blue from above and warm from the horizon. This takes a picture of
  // the sky in every direction and uses it as that soft all-round light.
  // It is done now, while the sky is the only thing in the scene.
  const skyLight = new THREE.PMREMGenerator(renderer).fromScene(scene).texture;
  scene.environment = skyLight;
  // Kept low: too much of it washes every wall out to white and tints the
  // roads blue, and it drowns the shadows.
  scene.environmentIntensity = 0.22;
  // A little warm light bounced up from the ground, to balance the blue sky.
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x8a7a60, 0.35));

  // Fog fades far things into the haze colour, so roads do not just "end".
  scene.fog = new THREE.Fog(HAZE, 180, 850);

  // --- Sun -----------------------------------------------------------------------
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.6); // warm white
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 3; // blur, in shadow-picture pixels
  sun.shadow.bias = -0.0004; // stops surfaces from shadowing themselves in stripes
  // Shadows are only drawn inside this box around the sun's target. A small
  // box that follows the player gives sharp shadows; one box over the whole
  // 4 km map would be a blur.
  const s = sun.shadow.camera;
  s.left = -70; s.right = 70; s.top = 70; s.bottom = -70; s.far = 320;
  scene.add(sun, sun.target);

  // --- Ground beyond the map -------------------------------------------------------
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
