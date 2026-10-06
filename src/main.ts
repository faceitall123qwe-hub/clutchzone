import * as THREE from "three";
import { moveAxis } from "./input";
import { startLoop } from "./loop";

// Units: 1 = 1 metre, Y is up.
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);
scene.fog = new THREE.Fog(0x0e1116, 30, 80);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a2018, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(8, 15, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25 });
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ color: 0x3b4a3a }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
scene.add(new THREE.GridHelper(100, 50, 0x55664f, 0x445240));

const player = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.4, 1, 6, 16),
  new THREE.MeshStandardMaterial({ color: 0xe8b04a }),
);
player.position.y = 0.9;
player.castShadow = true;
scene.add(player);

const SPEED = 6; // m/s
const CAMERA_OFFSET = new THREE.Vector3(0, 7, 10);
// Logic state advances in fixed ticks; the mesh is drawn between the last two ticks.
const pos = player.position.clone();
const prev = pos.clone();

startLoop(
  (dt) => {
    prev.copy(pos);
    const { x, y } = moveAxis();
    pos.x += x * SPEED * dt;
    pos.z -= y * SPEED * dt;
    if (x || y) player.rotation.y = Math.atan2(x, y);
  },
  (alpha) => {
    player.position.lerpVectors(prev, pos, alpha);
    camera.position.copy(player.position).add(CAMERA_OFFSET);
    camera.lookAt(player.position);
    renderer.render(scene, camera);
  },
);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
