import * as THREE from "three";
import { Car } from "./car";
import { Ground } from "./ground";
import { type Controls, readControls } from "./input";
import { Buildings, type BuildingData } from "./buildings";
import { Labels } from "./labels";
import { Land, type LandData } from "./land";
import { loadJson } from "./mapData";
import { Minimap } from "./minimap";
import { type PlaceData, Places } from "./places";
import { Player } from "./player";
import { Roads, type RoadData } from "./roads";
import { Traffic } from "./traffic";
import { Trees } from "./trees";
import { SUN_OFFSET, buildWorld } from "./world";

// --- Setup: renderer (draws), scene (holds objects), camera (the eye) -----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 900);

// The map is four files, so they have to be loaded before anything can be
// built. Promise.all downloads them at the same time instead of one by one.
// (`await` at the top of a module is allowed; the rest of the file waits.)
const [roadData, buildingData, landData, placeData] = await Promise.all([
  loadJson<RoadData>("kannur-roads.json"),
  loadJson<BuildingData>("kannur-buildings.json"),
  loadJson<LandData>("kannur-land.json"),
  loadJson<PlaceData>("kannur-places.json"),
]);
const world = buildWorld(scene, roadData.halfWidth, roadData.halfDepth);
const land = new Land(landData);
const roads = new Roads(roadData);
const buildings = new Buildings(buildingData);
const traffic = new Traffic(roadData);
const places = new Places(placeData);
const labels = new Labels(placeData);
const ground = new Ground(buildingData, roadData.halfWidth, roadData.halfDepth);
const trees = new Trees(roadData, landData.rails, buildings, land, ground);
scene.add(ground.mesh, labels.group, trees.group);
const minimap = new Minimap(document.querySelector<HTMLCanvasElement>("#minimap")!, roadData, landData, buildingData);
scene.add(land.group, roads.group, buildings.mesh, traffic.group);

// What the car cannot drive through.
const blocked = (x: number, z: number) => buildings.hits(x, z) || land.inWater(x, z) || traffic.hits(x, z);

const car = new Car(roads.findSpawn(), roadData.halfWidth, roadData.halfDepth);
const player = new Player();
scene.add(car.mesh, player.mesh);

// --- In the car or on foot ---------------------------------------------------
// The whole game is in one of two "modes". Each frame, the mode decides who
// gets the keyboard, who the camera follows and what E does.
let onFoot = false;

// What the car gets while nobody is driving it: nothing pressed, handbrake on.
const PARKED: Controls = { throttle: 0, steer: 0, handbrake: true, reset: false, run: false, enter: false };

// The player cannot walk through the world or through the parked car.
const blockedOnFoot = (x: number, z: number) => blocked(x, z) || car.contains(x, z);

const EXIT_SPEED = 3; // m/s. You cannot jump out of a moving bus (yet).
const DOOR_REACH = car.length / 2 + 2; // metres from its middle. How close you must be to get in.

const nearCar = () => player.mesh.position.distanceTo(car.mesh.position) < DOOR_REACH;

function getOut(): void {
  // Try each door spot in turn. A spot is no good if a wall is there.
  for (const spot of car.doorSpots()) {
    if (blocked(spot.x, spot.z)) continue;
    player.placeAt(spot.x, spot.z, car.heading);
    player.mesh.visible = true;
    onFoot = true;
    return;
  }
}

function getIn(): void {
  player.mesh.visible = false;
  onFoot = false;
}

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// --- Follow camera ---------------------------------------------------------
// The camera wants to sit behind and above whoever you control. Each frame it
// moves only part of the way there, which gives a smooth, slightly lagging
// chase view, and a smooth glide when you get in or out of the car.
const wanted = new THREE.Vector3();
const lookAt = new THREE.Vector3();

function updateCamera(dt: number, snap = false): void {
  const target = onFoot ? player : car;
  // On foot the camera is closer and lower, since a person is much smaller.
  // In a vehicle it scales with the vehicle's length, so a bus fits in view.
  const back = onFoot ? 4.5 : 4 + car.length * 1.3;
  const up = onFoot ? 2.6 : 2.5 + car.length * 0.5;
  const p = target.mesh.position;
  // If a building is where the camera wants to be, move the camera closer
  // until it is in the open. Otherwise you would be looking at the inside of
  // a roof. (The height comes down with it, to keep the same viewing angle.)
  let reach = back;
  const behind = (d: number) => [p.x - Math.sin(target.heading) * d, p.z - Math.cos(target.heading) * d] as const;
  while (reach > 3 && buildings.hits(...behind(reach))) reach -= 1;
  const [camX, camZ] = behind(reach);
  wanted.set(camX, Math.max(2.2, (up * reach) / back), camZ);
  // 1 - e^(-k·dt) gives the same smoothness at 30 fps and at 144 fps.
  camera.position.lerp(wanted, snap ? 1 : 1 - Math.exp(-5 * dt));
  lookAt.set(p.x, onFoot ? 1.4 : 2, p.z);
  camera.lookAt(lookAt);
}
updateCamera(0, true);

// --- Game loop -------------------------------------------------------------
// The browser calls `frame` before every screen refresh (usually 60 times a
// second). Each call: read input -> update the world -> draw.
const speedLabel = document.getElementById("speed")!;
const roadLabel = document.getElementById("road")!;
const hintLabel = document.getElementById("hint")!;
const placeLabel = document.getElementById("place")!;
document.getElementById("credit")!.textContent = roadData.credit;
let last = performance.now();
let roadCheckIn = 0; // seconds until we next look up the road name

function frame(now: number): void {
  // dt = seconds since the previous frame. Everything is multiplied by dt so
  // the car drives at the same speed on a slow and a fast computer. The cap
  // stops a huge jump after the tab was in the background.
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  const controls = readControls();

  // E switches mode, when that is possible right now.
  const canGetOut = !onFoot && Math.abs(car.speed) < EXIT_SPEED;
  const canGetIn = onFoot && nearCar();
  if (controls.enter && canGetOut) getOut();
  else if (controls.enter && canGetIn) getIn();

  // The keyboard goes to the player on foot, otherwise to the car.
  if (onFoot) {
    car.update(dt, PARKED, blocked);
    player.update(dt, controls, blockedOnFoot);
  } else {
    car.update(dt, controls, blocked);
  }
  const active = onFoot ? player : car;
  const spot = active.mesh.position;
  // Traffic lives around you, and stops for the car and for you on foot.
  const carObstacle = { x: car.mesh.position.x, z: car.mesh.position.z, radius: car.length / 2 };
  traffic.update(dt, spot, onFoot ? [carObstacle, { x: spot.x, z: spot.z, radius: 0.4 }] : [carObstacle]);
  updateCamera(dt);

  speedLabel.textContent = String(Math.round(Math.abs(active.speed) * 3.6)); // m/s -> km/h
  hintLabel.textContent = onFoot && nearCar() ? "E  get in" : "";

  // Keep the sun (and its small shadow box) centred on you.
  world.sun.target.position.copy(spot);
  world.sun.position.copy(spot).add(SUN_OFFSET);

  // The road name changes slowly, so look it up 4 times a second, not 60.
  roadCheckIn -= dt;
  if (roadCheckIn <= 0) {
    roadCheckIn = 0.25;
    roadLabel.textContent = roads.nameAt(spot.x, spot.z);
    const near = places.nearest(spot.x, spot.z, 60);
    placeLabel.textContent = near ? `Near ${near.name}` : "";
    labels.update(spot.x, spot.z);
  }
  minimap.update(spot.x, spot.z, active.heading);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Lets you inspect things from the browser console while learning: `car.speed`
Object.assign(window, { car, player, roads, buildings, land, traffic, places, labels, trees });
