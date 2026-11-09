import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { SOLID, MODEL, B } from './blocks.js';
import { sfx, setEngineSound } from './sound.js';
import { RagdollManager } from './ragdoll.js';

const GRAVITY = 25;
const MAX_SPEED = 25; // ~90 km/h
const TURBO_SPEED = 38; // ~137 km/h
const REVERSE_SPEED = -9.0; // ~32 km/h
const ACCEL = 17;
const TURBO_ACCEL = 28;
const BRAKE = 30;
const DRAG = 1.5;
const MAX_STEER = 0.52; // ~30 degrees at low speed
const STEER_SPEED = 3.6;
const STEP_HEIGHT = 1.28; // smooth step over 1-block terrain steps, curbs, stairs and slabs
const WHEEL_RADIUS = 0.358;

// Accurately compute ground solid surface height at (x, z), optionally relative to car's vertical position refY
export function getSurfaceY(world, x, z, refY = undefined) {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  const ch = world.chunkAt(bx, bz);
  const safeFallback = (refY !== undefined && !isNaN(refY)) ? refY : (world.topY ? world.topY(bx, bz) : 64);
  if (!ch) return safeFallback;

  let ty = 0;
  // If refY is provided, start searching downwards from slightly above the car's current height.
  // This ensures overhead tree canopies, bridges, overpasses, and awnings are ignored.
  if (refY !== undefined && !isNaN(refY)) {
    const startY = Math.min(ch.H - 1, Math.floor(refY + STEP_HEIGHT + 0.35));
    ty = startY;
    while (ty > 0) {
      const id = world.getBlock(bx, ty, bz);
      if (SOLID[id] && id !== B.LEAVES && id !== B.SAKURA && id !== B.CANOPY) break;
      ty--;
    }
  }

  // If no block found below refY or refY was not provided, scan from top of chunk downwards (skipping foliage)
  if (ty <= 0) {
    ty = ch.H - 1;
    while (ty > 0) {
      const id = world.getBlock(bx, ty, bz);
      if (SOLID[id] && id !== B.LEAVES && id !== B.SAKURA && id !== B.CANOPY) break;
      ty--;
    }
  }

  if (ty <= 0) return safeFallback;

  // Top surface of block ty is ty + 1
  let topSurface = ty + 1;
  const id = world.getBlock(bx, ty, bz);
  if (MODEL[id] !== null) {
    const boxes = world.boxesAt(bx, ty, bz, id);
    if (boxes && boxes.length) {
      let maxH = 0;
      for (const b of boxes) {
        if (b[4] > maxH) maxH = b[4];
      }
      topSurface = ty + maxH;
    }
  }

  // Smooth sub-meter terrain delta from laser scan or street elevation
  const delta = world.groundDelta ? world.groundDelta(x, topSurface, z) : 0;
  return topSurface + delta;
}

// -------------------------------------------------------------
// Realistic 3D Car GLTF Loader & Asset Management
// -------------------------------------------------------------
let gltfTemplate = null;
let isGltfLoading = false;
const gltfLoadCallbacks = [];

export function preloadCarModel(onLoaded = null) {
  if (gltfTemplate) {
    if (onLoaded) onLoaded(gltfTemplate);
    return;
  }
  if (onLoaded) gltfLoadCallbacks.push(onLoaded);
  if (isGltfLoading) return;
  isGltfLoading = true;

  try {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') + '/';
    const draco = new DRACOLoader();
    draco.setDecoderPath(`${base}draco/`);

    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    loader.load(
      `${base}models/car.glb`,
      (gltf) => {
        gltfTemplate = gltf.scene.children[0];
        isGltfLoading = false;
        for (const cb of gltfLoadCallbacks) {
          try {
            cb(gltfTemplate);
          } catch (e) {
            console.error(e);
          }
        }
        gltfLoadCallbacks.length = 0;
      },
      undefined,
      (err) => {
        console.warn('Realistic car model could not be loaded, using procedural fallback:', err);
        isGltfLoading = false;
      }
    );
  } catch (err) {
    console.warn('GLTF loading error:', err);
    isGltfLoading = false;
  }
}

// Immediately initiate background preloading
preloadCarModel();

// Helper to create a seated driver in the cockpit
function buildCockpitDriver() {
  const driver = new THREE.Group();
  driver.position.set(-0.35, 0.44, -0.15);

  const matHelmet = new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.3, metalness: 0.2 });
  const matVisor = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.1, metalness: 0.8 });
  const matSuit = new THREE.MeshStandardMaterial({ color: 0xb71c1c, roughness: 0.6 });
  const matGloves = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });

  // Helmet / Head
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), matHelmet);
  helmet.position.set(0, 0.52, 0);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.04), matVisor);
  visor.position.set(0, 0.52, -0.11);
  driver.add(helmet, visor);

  // Torso / Jacket
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.38, 0.2), matSuit);
  torso.position.set(0, 0.22, 0);
  driver.add(torso);

  // Arms reaching to steering wheel
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.32), matGloves);
  armL.position.set(-0.14, 0.26, -0.16);
  armL.rotation.x = 0.25;
  armL.rotation.y = 0.2;

  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.32), matGloves);
  armR.position.set(0.14, 0.26, -0.16);
  armR.rotation.x = 0.25;
  armR.rotation.y = -0.2;

  driver.add(armL, armR);
  return driver;
}

// Build the ultra-realistic 3D Ferrari sports car model
export function buildRealisticCar(bodyColor = 0xd32f2f) {
  if (!gltfTemplate) return null;

  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const carModel = gltfTemplate.clone(true);
  bodyGroup.add(carModel);

  // Customize materials for realism
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    metalness: 0.75,
    roughness: 0.2,
  });

  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xeeeeee,
    metalness: 0.9,
    roughness: 0.15,
  });

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x181a1d,
    roughness: 0.9,
    metalness: 0.05,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x90caf9,
    metalness: 0.1,
    roughness: 0.05,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });

  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    metalness: 0.6,
    roughness: 0.4,
  });

  const hlMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfffaea,
    emissiveIntensity: 0.9,
    roughness: 0.1,
  });

  const taillightMat = new THREE.MeshStandardMaterial({
    color: 0xd32f2f,
    emissive: 0x880000,
    emissiveIntensity: 0.6,
    roughness: 0.2,
  });

  // Assign materials to nodes
  const body = carModel.getObjectByName('body');
  if (body) body.material = bodyMat;

  const glass = carModel.getObjectByName('glass');
  if (glass) glass.material = glassMat;

  const trim = carModel.getObjectByName('trim');
  if (trim) trim.material = trimMat;

  const lights = carModel.getObjectByName('lights');
  if (lights) lights.material = hlMat;

  const lightsRed = carModel.getObjectByName('lights_red');
  if (lightsRed) lightsRed.material = taillightMat;

  ['rim_fl', 'rim_fr', 'rim_rl', 'rim_rr'].forEach((name) => {
    const rim = carModel.getObjectByName(name);
    if (rim) rim.material = rimMat;
  });

  // Wheels and Steering Pivots
  const wheelFL = carModel.getObjectByName('wheel_fl');
  const wheelFR = carModel.getObjectByName('wheel_fr');
  const wheelRL = carModel.getObjectByName('wheel_rl');
  const wheelRR = carModel.getObjectByName('wheel_rr');

  const steerFL = new THREE.Group();
  if (wheelFL) {
    steerFL.position.copy(wheelFL.position);
    wheelFL.position.set(0, 0, 0);
    carModel.add(steerFL);
    steerFL.add(wheelFL);
  }

  const steerFR = new THREE.Group();
  if (wheelFR) {
    steerFR.position.copy(wheelFR.position);
    wheelFR.position.set(0, 0, 0);
    carModel.add(steerFR);
    steerFR.add(wheelFR);
  }

  // Steering wheel pivot
  const steerWheel = carModel.getObjectByName('steering_wheel');
  let steerWheelPivot = null;
  if (steerWheel) {
    steerWheelPivot = new THREE.Group();
    steerWheelPivot.position.copy(steerWheel.position);
    steerWheel.position.set(0, 0, 0);
    carModel.add(steerWheelPivot);
    steerWheelPivot.add(steerWheel);
  }

  // Headlight volumetric light cones
  const lightBeams = new THREE.Group();
  const beamGeo = new THREE.ConeGeometry(2.4, 16, 12, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfff9c4,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  const beamL = new THREE.Mesh(beamGeo, beamMat);
  beamL.position.set(-0.65, 0.45, -8.6);
  beamL.rotation.x = Math.PI / 2;
  const beamR = new THREE.Mesh(beamGeo, beamMat);
  beamR.position.set(0.65, 0.45, -8.6);
  beamR.rotation.x = Math.PI / 2;
  lightBeams.add(beamL, beamR);
  carModel.add(lightBeams);

  // Cockpit seated 3D driver
  const cockpitDriver = buildCockpitDriver();
  cockpitDriver.visible = false;
  carModel.add(cockpitDriver);

  return {
    mesh: root,
    bodyGroup,
    carModel,
    steerFL,
    steerFR,
    wheelFL,
    wheelFR,
    wheelRL,
    wheelRR,
    steerWheelPivot,
    lightBeams,
    taillightMat,
    cockpitDriver,
    bodyMat,
    isRealistic: true,
  };
}

// Procedural fallback car mesh (used instantly if GLTF is still downloading)
export function buildProceduralCarMesh(bodyColor = 0xd32f2f) {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const mats = {
    body: new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.6, roughness: 0.3 }),
    bodyDark: new THREE.MeshStandardMaterial({ color: new THREE.Color(bodyColor).multiplyScalar(0.7), metalness: 0.6, roughness: 0.3 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9be2f7, transparent: true, opacity: 0.55 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x181a1d, roughness: 0.9 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xd0d0d0, metalness: 0.8, roughness: 0.2 }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xfffde7, emissive: 0xfffde7, emissiveIntensity: 0.8 }),
    beam: new THREE.MeshBasicMaterial({ color: 0xfff9c4, transparent: true, opacity: 0.16, depthWrite: false }),
    taillight: new THREE.MeshStandardMaterial({ color: 0xd32f2f, emissive: 0x880000, emissiveIntensity: 0.5 }),
  };

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.25, 4.2), mats.trim);
  chassis.position.set(0, 0.35, 0);
  bodyGroup.add(chassis);

  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.35, 1.6), mats.body);
  hood.position.set(0, 0.65, -1.1);
  bodyGroup.add(hood);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 1.8), mats.glass);
  cabin.position.set(0, 1.05, 0.2);
  bodyGroup.add(cabin);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.06, 1.4), mats.body);
  roof.position.set(0, 1.34, 0.2);
  bodyGroup.add(roof);

  const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.4, 0.9), mats.body);
  trunk.position.set(0, 0.68, 1.55);
  bodyGroup.add(trunk);

  // Wheels
  function makeWheel() {
    const g = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.28, 14), mats.tire);
    tire.rotation.z = Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.29, 8), mats.rim);
    rim.rotation.z = Math.PI / 2;
    g.add(tire, rim);
    return g;
  }

  const steerFL = new THREE.Group();
  steerFL.position.set(-0.88, WHEEL_RADIUS, -1.15);
  const wheelFL = makeWheel();
  steerFL.add(wheelFL);
  root.add(steerFL);

  const steerFR = new THREE.Group();
  steerFR.position.set(0.88, WHEEL_RADIUS, -1.15);
  const wheelFR = makeWheel();
  steerFR.add(wheelFR);
  root.add(steerFR);

  const steerRL = new THREE.Group();
  steerRL.position.set(-0.88, WHEEL_RADIUS, 1.35);
  const wheelRL = makeWheel();
  steerRL.add(wheelRL);
  root.add(steerRL);

  const steerRR = new THREE.Group();
  steerRR.position.set(0.88, WHEEL_RADIUS, 1.35);
  const wheelRR = makeWheel();
  steerRR.add(wheelRR);
  root.add(steerRR);

  const cockpitDriver = buildCockpitDriver();
  cockpitDriver.visible = false;
  bodyGroup.add(cockpitDriver);

  return {
    mesh: root,
    bodyGroup,
    steerFL,
    steerFR,
    wheelFL,
    wheelFR,
    wheelRL,
    wheelRR,
    steerWheelPivot: null,
    lightBeams: null,
    taillightMat: mats.taillight,
    cockpitDriver,
    bodyMat: mats.body,
    isRealistic: false,
  };
}

// -------------------------------------------------------------
// Flying Wreckage & Disassembled Car Parts
// -------------------------------------------------------------
export class DebrisPiece {
  constructor(mesh, world, fx, vel, angVel, radius = 0.35) {
    this.mesh = mesh;
    this.world = world;
    this.fx = fx;
    this.vx = vel.x;
    this.vy = vel.y;
    this.vz = vel.z;
    this.angVx = angVel.x;
    this.angVy = angVel.y;
    this.angVz = angVel.z;
    this.radius = radius;
    this.age = 0;
    this.bounces = 0;
    this.settled = false;
    this.smokeTimer = 0;
  }

  update(dt) {
    this.age += dt;

    if (this.settled) {
      // Occasional rising smoke from burning wreckage
      if (this.age < 16) {
        this.smokeTimer += dt;
        if (this.smokeTimer > 0.45) {
          this.smokeTimer = 0;
          if (this.fx) {
            this.fx.burst(
              this.mesh.position.x,
              this.mesh.position.y + 0.25,
              this.mesh.position.z,
              [0.32, 0.32, 0.35],
              1,
              0.5,
              0.2,
              2.0,
              1.4
            );
          }
        }
      }
      return;
    }

    // Gravity
    this.vy -= 24 * dt;

    // Movement
    this.mesh.position.x += this.vx * dt;
    this.mesh.position.y += this.vy * dt;
    this.mesh.position.z += this.vz * dt;

    // 3D Tumbling Rotation
    this.mesh.rotation.x += this.angVx * dt;
    this.mesh.rotation.y += this.angVy * dt;
    this.mesh.rotation.z += this.angVz * dt;

    // Air resistance
    this.vx *= Math.exp(-0.35 * dt);
    this.vz *= Math.exp(-0.35 * dt);
    this.angVx *= Math.exp(-0.5 * dt);
    this.angVy *= Math.exp(-0.5 * dt);
    this.angVz *= Math.exp(-0.5 * dt);

    // Fiery smoke trail while flying
    this.smokeTimer += dt;
    if (this.smokeTimer > 0.07 && this.age < 3.0 && this.fx) {
      this.smokeTimer = 0;
      this.fx.burst(
        this.mesh.position.x,
        this.mesh.position.y,
        this.mesh.position.z,
        [1.0, 0.5, 0.1],
        1,
        1.5,
        0.14,
        0.5
      );
      this.fx.burst(
        this.mesh.position.x,
        this.mesh.position.y,
        this.mesh.position.z,
        [0.2, 0.2, 0.22],
        1,
        0.8,
        0.22,
        1.4,
        0.9
      );
    }

    // Ground collision
    const gy = getSurfaceY(this.world, this.mesh.position.x, this.mesh.position.z, this.mesh.position.y) + this.radius;
    if (this.mesh.position.y < gy) {
      this.mesh.position.y = gy;
      this.bounces++;

      // Restitution bounce
      if (this.vy < 0) {
        this.vy = -this.vy * 0.44;
      }

      // Ground friction
      this.vx *= 0.72;
      this.vz *= 0.72;
      this.angVx *= 0.65;
      this.angVz *= 0.65;

      // Sparks & impact thud on bounce
      if (Math.abs(this.vy) > 1.4 || Math.hypot(this.vx, this.vz) > 2.0) {
        if (this.fx) this.fx.sparks(this.mesh.position.x, gy, this.mesh.position.z);
        if (Math.random() < 0.35) sfx.thud();
      }

      // Settle condition
      if (Math.hypot(this.vx, this.vy, this.vz) < 0.5 && Math.abs(this.vy) < 0.6) {
        this.settled = true;
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        this.angVx = 0;
        this.angVy = 0;
        this.angVz = 0;
      }
    }
  }

  destroy() {
    if (this.mesh && this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
  }
}

// -------------------------------------------------------------
// Car Entity with Full 3D Rotation (Pitch, Roll, Yaw) and Physics
// -------------------------------------------------------------
export class Car {
  constructor(x, y, z, yaw = 0, color = 0xd32f2f, manager = null) {
    this.manager = manager;
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;

    // Full 3D orientation & angular velocities (Pitch X, Yaw Y, Roll Z)
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.angVx = 0;
    this.angVy = 0;
    this.angVz = 0;

    this.speed = 0;
    this.steerAngle = 0;
    this.wheelRotation = 0;
    this.onGround = true;
    this.isTumbling = false;
    this.isFlipped = false;
    this.destroyed = false;
    this.smokeTimer = 0;
    this.crashCooldown = 0;
    this.color = color;
    this.active = false; // player driving

    // Build realistic car mesh or procedural fallback
    const realistic = buildRealisticCar(color);
    const built = realistic || buildProceduralCarMesh(color);
    this.applyBuiltMesh(built);

    // If gltf is still downloading, upgrade smoothly once ready
    if (!this.isRealistic) {
      preloadCarModel(() => {
        this.upgradeToRealisticMesh();
      });
    }

    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }

  applyBuiltMesh(built) {
    this.mesh = built.mesh;
    this.bodyGroup = built.bodyGroup;
    this.steerFL = built.steerFL;
    this.steerFR = built.steerFR;
    this.wheelFL = built.wheelFL;
    this.wheelFR = built.wheelFR;
    this.wheelRL = built.wheelRL;
    this.wheelRR = built.wheelRR;
    this.steerWheelPivot = built.steerWheelPivot;
    this.lightBeams = built.lightBeams;
    this.taillightMat = built.taillightMat;
    this.cockpitDriver = built.cockpitDriver;
    this.bodyMat = built.bodyMat;
    this.isRealistic = built.isRealistic;
  }

  upgradeToRealisticMesh() {
    if (this.isRealistic) return;
    const parent = this.mesh.parent;
    if (parent) parent.remove(this.mesh);

    const realistic = buildRealisticCar(this.color);
    if (!realistic) return;

    this.applyBuiltMesh(realistic);
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');

    if (parent) parent.add(this.mesh);
    if (this.cockpitDriver) this.cockpitDriver.visible = this.active;
  }

  setDriverVisible(visible) {
    if (this.cockpitDriver) {
      this.cockpitDriver.visible = visible;
    }
  }

  // Flip car back onto wheels
  flipUpright() {
    this.pitch = 0;
    this.roll = 0;
    this.angVx = 0;
    this.angVy = 0;
    this.angVz = 0;
    this.vx = 0;
    this.vz = 0;
    this.vy = 4.2; // spring hop
    this.isTumbling = false;
    this.isFlipped = false;
    this.onGround = false;
    sfx.flipCar();
  }

  // Disassemble into 3D physical debris and explode
  disassembleAndExplode(world, fx) {
    if (this.destroyed) return true;
    this.destroyed = true;

    const crashSpeed = Math.max(12.0, Math.abs(this.speed));
    const scene = (this.manager && this.manager.group) || this.mesh.parent || (this.manager && this.manager.scene);

    // 1. Audio: Massive explosion boom + crunch
    sfx.boom(0);
    sfx.carCrash();

    // 2. Visual Fireball & Particle Explosions
    if (fx) {
      if (fx.flashMesh) {
        const flash = fx.flashMesh(this.x, this.y + 0.8, this.z);
        fx.flashes.push({ mesh: flash, age: 0, power: 5.5 });
      }
      // Fiery explosion blast
      fx.burst(this.x, this.y + 0.8, this.z, [1.0, 0.55, 0.12], 65, 18.0, 0.28, 0.95);
      // Bright flying sparks
      fx.burst(this.x, this.y + 1.0, this.z, [1.0, 0.88, 0.3], 50, 16.0, 0.08, 0.65);
      // Heavy billowing black/gray smoke
      fx.burst(this.x, this.y + 0.8, this.z, [0.14, 0.14, 0.16], 60, 5.5, 0.7, 3.5, 3.0);
      // Shattered flying glass
      fx.burst(this.x, this.y + 1.1, this.z, [0.85, 0.95, 1.0], 40, 9.5, 0.12, 1.6);
    }

    // 3. Eject Driver into Ragdoll FIRST (so driver is thrown through the explosion)
    if (this.manager && this.active) {
      this.manager.onCarCrash(this, crashSpeed);
    }

    // 4. Detach physical 3D car pieces and create flying debris
    const fwdX = -Math.sin(this.yaw);
    const fwdZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    this.mesh.updateMatrixWorld(true);
    const debrisList = [];

    const detachPart = (obj, blastDir, extraSpeed = 0, radius = 0.35) => {
      if (!obj || !scene) return;
      scene.attach(obj);
      const blastPower = 8.0 + Math.random() * 8.0 + extraSpeed;
      const vel = new THREE.Vector3(
        fwdX * (crashSpeed * 0.35) + blastDir.x * blastPower + (Math.random() - 0.5) * 3.5,
        5.5 + Math.random() * 7.5,
        fwdZ * (crashSpeed * 0.35) + blastDir.z * blastPower + (Math.random() - 0.5) * 3.5
      );
      const angVel = new THREE.Vector3(
        (Math.random() - 0.5) * 16.0,
        (Math.random() - 0.5) * 16.0,
        (Math.random() - 0.5) * 16.0
      );
      const piece = new DebrisPiece(obj, world, fx, vel, angVel, radius);
      debrisList.push(piece);
    };

    if (this.isRealistic) {
      // 1. Front Left Wheel
      if (this.steerFL) {
        detachPart(this.steerFL, new THREE.Vector3(-rightX * 1.3 - fwdX * 0.4, 0.6, -rightZ * 1.3 - fwdZ * 0.4).normalize(), 2, 0.36);
      }
      // 2. Front Right Wheel
      if (this.steerFR) {
        detachPart(this.steerFR, new THREE.Vector3(rightX * 1.3 - fwdX * 0.4, 0.6, rightZ * 1.3 - fwdZ * 0.4).normalize(), 2, 0.36);
      }
      // 3. Rear Left Wheel
      if (this.wheelRL) {
        detachPart(this.wheelRL, new THREE.Vector3(-rightX * 1.3 + fwdX * 0.4, 0.6, -rightZ * 1.3 + fwdZ * 0.4).normalize(), 2, 0.36);
      }
      // 4. Rear Right Wheel
      if (this.wheelRR) {
        detachPart(this.wheelRR, new THREE.Vector3(rightX * 1.3 + fwdX * 0.4, 0.6, rightZ * 1.3 + fwdZ * 0.4).normalize(), 2, 0.36);
      }
      // 5. Steering Wheel
      if (this.steerWheelPivot) {
        detachPart(this.steerWheelPivot, new THREE.Vector3(0, 1, 0), 4, 0.2);
      }
      // 6. Bumpers / Trim
      const trim = this.mesh.getObjectByName('trim');
      if (trim) {
        detachPart(trim, new THREE.Vector3(fwdX * 1.3, 0.7, fwdZ * 1.3).normalize(), 3, 0.45);
      }
      // 7. Grills
      const grills = this.mesh.getObjectByName('grills');
      if (grills) {
        detachPart(grills, new THREE.Vector3(fwdX * 1.5, 0.5, fwdZ * 1.5).normalize(), 4, 0.25);
      }
      // 8. Main Body / Scorched Chassis
      const body = this.mesh.getObjectByName('body');
      if (body) {
        if (body.material) {
          body.material = body.material.clone();
          body.material.color.setHex(0x151515);
          body.material.roughness = 0.95;
          body.material.metalness = 0.1;
        }
        detachPart(body, new THREE.Vector3(0, 0.9, 0), 1, 0.65);
      }
    } else {
      // Procedural car pieces
      if (this.steerFL) detachPart(this.steerFL, new THREE.Vector3(-rightX, 0.6, -rightZ), 2, 0.36);
      if (this.steerFR) detachPart(this.steerFR, new THREE.Vector3(rightX, 0.6, rightZ), 2, 0.36);
      if (this.wheelRL) detachPart(this.wheelRL, new THREE.Vector3(-rightX, 0.6, -rightZ), 2, 0.36);
      if (this.wheelRR) detachPart(this.wheelRR, new THREE.Vector3(rightX, 0.6, rightZ), 2, 0.36);
      if (this.bodyGroup) detachPart(this.bodyGroup, new THREE.Vector3(0, 1, 0), 2, 0.6);
    }

    // Add charred burning scrap metal pieces
    const scrapGeo = new THREE.BoxGeometry(0.35, 0.12, 0.25);
    const scrapMat = new THREE.MeshStandardMaterial({ color: 0x242426, roughness: 0.8, metalness: 0.4 });
    for (let k = 0; k < 6; k++) {
      const scrap = new THREE.Mesh(scrapGeo, scrapMat);
      scrap.position.set(
        this.x + (Math.random() - 0.5) * 1.6,
        this.y + 0.35 + Math.random() * 0.6,
        this.z + (Math.random() - 0.5) * 1.6
      );
      scene.add(scrap);
      const angle = (k / 6) * Math.PI * 2;
      const bDir = new THREE.Vector3(Math.cos(angle), 0.7 + Math.random() * 0.5, Math.sin(angle)).normalize();
      detachPart(scrap, bDir, 3, 0.2);
    }

    // Register debris with manager
    if (this.manager) {
      this.manager.addDebris(debrisList);
      this.manager.removeCar(this);
    }

    // Destroy root car object
    this.destroy();
    return true;
  }

  collides(world, x, y, z, halfW = 0.8, height = 1.25) {
    const x0 = Math.floor(x - halfW), x1 = Math.floor(x + halfW);
    const y0 = Math.floor(y + 0.35), y1 = Math.floor(y + height);
    const z0 = Math.floor(z - halfW), z1 = Math.floor(z + halfW);

    for (let by = y0; by <= y1; by++) {
      for (let bz = z0; bz <= z1; bz++) {
        for (let bx = x0; bx <= x1; bx++) {
          const id = world.getBlock(bx, by, bz);
          if (!SOLID[id]) continue;
          if (id === B.LEAVES || id === B.SAKURA || id === B.CANOPY) continue;
          if (MODEL[id] === null) return true;
          for (const b of world.boxesAt(bx, by, bz, id)) {
            if (
              x + halfW <= bx + b[0] ||
              x - halfW >= bx + b[3] ||
              y + height <= by + b[1] ||
              y + 0.35 >= by + b[4] ||
              z + halfW <= bz + b[2] ||
              z - halfW >= bz + b[5]
            )
              continue;
            return true;
          }
        }
      }
    }
    return false;
  }

  update(dt, keys, world, fx, isDriving) {
    this.active = isDriving;
    if (this.crashCooldown > 0) this.crashCooldown -= dt;
    this.setDriverVisible(isDriving);

    // Driving input
    let throttle = 0;
    let steerInput = 0;
    let handbrake = false;
    let turbo = false;

    if (isDriving) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) throttle += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) throttle -= 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) steerInput += 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) steerInput -= 1;
      handbrake = keys.has('Space');
      turbo = keys.has('ShiftLeft') || keys.has('ShiftRight');

      // Manual flip upright
      if (this.isFlipped && (keys.has('KeyR') || keys.has('Space'))) {
        this.flipUpright();
      }
    }

    // Horn
    if (isDriving && (keys.has('KeyH') || keys.has('KeyB'))) {
      if (!this.hornPressed) {
        this.hornPressed = true;
        sfx.horn();
      }
    } else {
      this.hornPressed = false;
    }

    // ---------------------------------------------------------
    // CASE A: Tumbling / Rollover Airborne Physics (3D Rotation)
    // ---------------------------------------------------------
    if (this.isTumbling) {
      // Free 3D angular rotation
      this.pitch += this.angVx * dt;
      this.yaw += this.angVy * dt;
      this.roll += this.angVz * dt;

      // Angular drag
      this.angVx *= Math.exp(-0.85 * dt);
      this.angVy *= Math.exp(-0.55 * dt);
      this.angVz *= Math.exp(-0.85 * dt);

      // Ballistic motion
      this.vy -= GRAVITY * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.z += this.vz * dt;

      this.vx *= Math.exp(-0.45 * dt);
      this.vz *= Math.exp(-0.45 * dt);

      // Check 6 3D bounding probes against ground
      const rotEuler = new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ');
      const probes = [
        new THREE.Vector3(0, 0.35, -2.1), // Front bumper
        new THREE.Vector3(0, 0.35, 2.1), // Rear bumper
        new THREE.Vector3(-0.9, 0.6, 0), // Flank L
        new THREE.Vector3(0.9, 0.6, 0), // Flank R
        new THREE.Vector3(0, 1.25, -0.4), // Roof Front
        new THREE.Vector3(0, 1.25, 0.8), // Roof Rear
      ];

      for (const p of probes) {
        const offset = p.clone().applyEuler(rotEuler);
        const wx = this.x + offset.x;
        const wy = this.y + offset.y;
        const wz = this.z + offset.z;
        const gy = getSurfaceY(world, wx, wz, wy);

        if (wy < gy) {
          if (Math.abs(this.vy) > 13 || Math.hypot(this.vx, this.vz) > 14) {
            this.disassembleAndExplode(world, fx);
            return true;
          }
          this.y += (gy - wy) * 0.7;
          if (this.vy < 0) {
            this.vy = -this.vy * 0.35;
            if (Math.abs(this.vy) < 0.6) this.vy = 0;
          }
          this.vx *= 0.82;
          this.vz *= 0.82;

          // Impact torque
          this.angVx += (Math.random() - 0.5) * 2.5;
          this.angVz += (Math.random() - 0.5) * 2.5;

          if (fx && Math.random() < 0.4) {
            fx.sparks(wx, gy + 0.1, wz);
            sfx.thud();
          }
        }
      }

      // Check if tumbling has settled
      const linSpeed = Math.hypot(this.vx, this.vy, this.vz);
      const rotSpeed = Math.hypot(this.angVx, this.angVy, this.angVz);

      if (linSpeed < 0.5 && rotSpeed < 0.4) {
        const upNormal = new THREE.Vector3(0, 1, 0).applyEuler(rotEuler);
        if (upNormal.y > 0.55) {
          // Settled upright on wheels!
          this.isTumbling = false;
          this.onGround = true;
          this.isFlipped = false;
          this.pitch = 0;
          this.roll = 0;
          this.angVx = 0;
          this.angVy = 0;
          this.angVz = 0;
          this.vx = 0;
          this.vy = 0;
          this.vz = 0;
        } else {
          // Settled flipped on roof or side
          this.isFlipped = true;
        }
      }

      // Apply 3D matrix transform
      this.mesh.position.set(this.x, this.y, this.z);
      this.mesh.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
      return false;
    }

    // ---------------------------------------------------------
    // CASE B: Standard Ground / Air Driving Physics
    // ---------------------------------------------------------
    const maxFwd = turbo ? TURBO_SPEED : MAX_SPEED;
    const accelRate = turbo ? TURBO_ACCEL : ACCEL;

    if (!this.isFlipped) {
      if (throttle > 0) {
        if (this.speed >= 0) {
          this.speed = Math.min(maxFwd, this.speed + accelRate * dt);
        } else {
          this.speed += BRAKE * dt;
        }
      } else if (throttle < 0) {
        if (this.speed > 0) {
          this.speed = Math.max(0, this.speed - BRAKE * dt);
        } else {
          this.speed = Math.max(REVERSE_SPEED, this.speed - accelRate * 0.6 * dt);
        }
      } else {
        this.speed *= Math.exp(-DRAG * dt);
        if (Math.abs(this.speed) < 0.04) this.speed = 0;
      }

      if (handbrake) {
        this.speed *= Math.exp(-BRAKE * 0.8 * dt);
        if (Math.abs(this.speed) > 5 && isDriving) {
          sfx.skid();
        }
      }
    } else {
      this.speed *= Math.exp(-4.0 * dt);
    }

    // Taillights
    if (this.taillightMat) {
      if (throttle < 0 || handbrake) {
        this.taillightMat.color.setHex(0xff1744);
        if (this.taillightMat.emissiveIntensity !== undefined) {
          this.taillightMat.emissiveIntensity = 1.2;
        }
      } else {
        this.taillightMat.color.setHex(0xd32f2f);
        if (this.taillightMat.emissiveIntensity !== undefined) {
          this.taillightMat.emissiveIntensity = 0.5;
        }
      }
    }

    // Speed-sensitive steering
    const absSpeed = Math.abs(this.speed);
    const speedFactor = 1 / (1 + absSpeed * 0.085);
    const currentMaxSteer = MAX_STEER * (0.16 + 0.84 * speedFactor);
    const currentSteerSpeed = STEER_SPEED * (0.35 + 0.65 * speedFactor);

    if (steerInput !== 0 && !this.isFlipped) {
      this.steerAngle += steerInput * currentSteerSpeed * dt;
      this.steerAngle = Math.max(-currentMaxSteer, Math.min(currentMaxSteer, this.steerAngle));
    } else {
      const returnRate = 6.0 + absSpeed * 0.18;
      this.steerAngle *= Math.exp(-returnRate * dt);
      if (Math.abs(this.steerAngle) < 0.003) this.steerAngle = 0;
    }
    this.steerAngle = Math.max(-currentMaxSteer, Math.min(currentMaxSteer, this.steerAngle));

    // Turning rate
    const turnFactor = Math.sin(this.steerAngle);
    let turnRate = (this.speed / 2.8) * turnFactor;

    if (absSpeed > 2.0) {
      const maxLateralGrip = handbrake ? 28.0 : 14.0;
      const maxTurnRate = maxLateralGrip / absSpeed;
      if (Math.abs(turnRate) > maxTurnRate) {
        turnRate = Math.sign(turnRate) * maxTurnRate;
      }
    }

    this.yaw += turnRate * dt;

    // 3D forward direction
    const fwdX = -Math.sin(this.yaw);
    const fwdZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    this.vx = fwdX * this.speed;
    this.vz = fwdZ * this.speed;

    if (Math.abs(this.speed) > 0.05) {
      const nx = this.x + this.vx * dt;
      const nz = this.z + this.vz * dt;

      // Check along bumper
      const fwdBumper = this.speed >= 0 ? 2.1 : -2.1;
      const pts = [
        [nx + fwdX * fwdBumper, nz + fwdZ * fwdBumper],
        [nx + fwdX * fwdBumper + rightX * 0.75, nz + fwdZ * fwdBumper + rightZ * 0.75],
        [nx + fwdX * fwdBumper - rightX * 0.75, nz + fwdZ * fwdBumper - rightZ * 0.75],
      ];

      let maxBumperGround = this.y;
      let wallBlocked = false;

      for (const [px, pz] of pts) {
        const gy = getSurfaceY(world, px, pz, this.y);
        if (gy > maxBumperGround) maxBumperGround = gy;
        if (this.collides(world, px, this.y + STEP_HEIGHT, pz, 0.35, 1.2)) {
          wallBlocked = true;
          break;
        }
      }

      const stepUp = maxBumperGround - this.y;

      // Obstacle collision detection
      if (wallBlocked || stepUp > STEP_HEIGHT) {
        const impactSpeed = Math.abs(this.speed);
        // CRASH CONDITION: High speed impact triggers explosion & disassembly!
        if (impactSpeed > 8.5) {
          this.disassembleAndExplode(world, fx);
          return true;
        } else {
          // Low speed bounce
          if (impactSpeed > 2.5) sfx.hit();
          this.speed = -this.speed * 0.2;
        }
      } else {
        this.x = nx;
        this.z = nz;
      }
    }

    // 4-Wheel terrain height sampling for full 3D pitch and roll
    const pFL = [this.x - rightX * 0.85 + fwdX * 1.15, this.z - rightZ * 0.85 + fwdZ * 1.15];
    const pFR = [this.x + rightX * 0.85 + fwdX * 1.15, this.z + rightZ * 0.85 + fwdZ * 1.15];
    const pRL = [this.x - rightX * 0.85 - fwdX * 1.3, this.z - rightZ * 0.85 - fwdZ * 1.3];
    const pRR = [this.x + rightX * 0.85 - fwdX * 1.3, this.z + rightZ * 0.85 - fwdZ * 1.3];

    const yFL = getSurfaceY(world, pFL[0], pFL[1], this.y);
    const yFR = getSurfaceY(world, pFR[0], pFR[1], this.y);
    const yRL = getSurfaceY(world, pRL[0], pRL[1], this.y);
    const yRR = getSurfaceY(world, pRR[0], pRR[1], this.y);

    const frontY = (yFL + yFR) * 0.5;
    const rearY = (yRL + yRR) * 0.5;
    const leftY = (yFL + yRL) * 0.5;
    const rightY = (yFR + yRR) * 0.5;

    const groundY = Math.max((frontY + rearY) * 0.5, getSurfaceY(world, this.x, this.z, this.y));

    // Space jump
    if (isDriving && keys.has('Space') && this.onGround && (throttle > 0 || Math.abs(this.speed) > 1)) {
      this.vy = 7.5;
      this.onGround = false;
      sfx.step();
    }

    // Vertical height & suspension
    if (this.y < groundY) {
      const climbSpeed = Math.max(14.0, Math.abs(this.speed) * 4.0);
      this.y += Math.min(groundY - this.y, climbSpeed * dt);
      if (Math.abs(groundY - this.y) < 0.05) this.y = groundY;
      this.vy = 0;
      this.onGround = true;
    } else if (this.y > groundY + 0.18) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= groundY) {
        this.y = groundY;
        this.vy = 0;
        this.onGround = true;
      } else {
        this.onGround = false;
      }
    } else {
      this.y = groundY;
      this.vy = 0;
      this.onGround = true;
    }

    // Visual Wheel animations
    const rollDelta = (this.speed * dt) / WHEEL_RADIUS;
    this.wheelRotation -= rollDelta;

    if (this.wheelFL && this.wheelFR && this.wheelRL && this.wheelRR) {
      const initialWheelRotX = this.isRealistic ? -Math.PI / 2 : 0;
      this.wheelFL.rotation.x = initialWheelRotX + this.wheelRotation;
      this.wheelFR.rotation.x = initialWheelRotX + this.wheelRotation;
      this.wheelRL.rotation.x = initialWheelRotX + this.wheelRotation;
      this.wheelRR.rotation.x = initialWheelRotX + this.wheelRotation;
    }

    if (this.steerFL) this.steerFL.rotation.y = this.steerAngle;
    if (this.steerFR) this.steerFR.rotation.y = this.steerAngle;
    if (this.steerWheelPivot) {
      this.steerWheelPivot.rotation.z = -this.steerAngle * 2.2;
    }

    // Dynamic 3D orientation (Pitch along terrain slope & acceleration; Roll along terrain bank & turn lean)
    if (this.onGround) {
      const terrainSlopePitch = Math.atan2(rearY - frontY, 2.45);
      const terrainBankRoll = Math.atan2(rightY - leftY, 1.7);
      const accelPitch = (throttle * -0.018 * (Math.abs(this.speed) / MAX_SPEED));
      const turnRoll = -turnRate * (Math.abs(this.speed) / MAX_SPEED) * 0.12;

      const targetPitch = terrainSlopePitch + accelPitch;
      const targetRoll = terrainBankRoll + turnRoll;

      this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 10);
      this.roll += (targetRoll - this.roll) * Math.min(1, dt * 10);
    } else {
      // Airborne pitch/roll inertia
      this.pitch *= Math.exp(-1.5 * dt);
      this.roll *= Math.exp(-1.5 * dt);
    }

    // Apply 3D transforms
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');

    // Smoke & exhaust particles
    this.smokeTimer += dt;
    if (fx && this.smokeTimer > (turbo ? 0.04 : 0.09) && Math.abs(this.speed) > 0.4) {
      this.smokeTimer = 0;
      const ex1x = this.x + rightX * (-0.4) - fwdX * (-2.1);
      const ex1z = this.z + rightZ * (-0.4) - fwdZ * (-2.1);
      const ex2x = this.x + rightX * (0.4) - fwdX * (-2.1);
      const ex2z = this.z + rightZ * (0.4) - fwdZ * (-2.1);

      const pColor = turbo ? [1.0, 0.45, 0.1] : [0.75, 0.75, 0.78];
      const pCount = turbo ? 2 : 1;
      const pSpeed = turbo ? 3.0 : 1.2;
      const pSize = turbo ? 0.2 : 0.12;

      fx.burst(ex1x, this.y + 0.35, ex1z, pColor, pCount, pSpeed, pSize, 0.5, 0.8);
      fx.burst(ex2x, this.y + 0.35, ex2z, pColor, pCount, pSpeed, pSize, 0.5, 0.8);
    }

    // Engine Audio
    if (isDriving) {
      const speedRatio = Math.min(1, Math.abs(this.speed) / MAX_SPEED);
      setEngineSound(true, speedRatio, throttle > 0 || turbo);
    }

    return false;
  }

  destroy() {
    if (this.mesh && this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
  }
}

// -------------------------------------------------------------
// Car Manager with Ragdoll and Full 3D Camera System
// -------------------------------------------------------------
export class CarManager {
  constructor(scene, world, fx) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.cars = [];
    this.debris = [];
    this.activeCar = null;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Integrated Ragdoll Manager for crashes
    this.ragdollManager = new RagdollManager(scene, world, fx);

    // Enhanced lighting for standard & physical car materials
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.4);
    const dirLight = new THREE.DirectionalLight(0xfffaed, 2.0);
    dirLight.position.set(25, 45, 25);
    this.group.add(hemiLight, dirLight);

    // Camera settings
    this.camMode = 'CHASE'; // 'CHASE' or 'COCKPIT'
    this.camYaw = 0;
    this.camDist = 6.4;
    this.camHeight = 2.4;

    this.carHud = document.getElementById('car-hud');
    this.speedVal = document.getElementById('car-speed-val');
    this.speedUnit = document.getElementById('car-speed-unit');
    this.enterPrompt = document.getElementById('car-enter-prompt');
  }

  get isRagdolling() {
    return !!(this.ragdollManager && this.ragdollManager.activeRagdoll);
  }

  addDebris(list) {
    if (list && list.length) {
      this.debris.push(...list);
      // Limit total active debris for smooth framerate
      while (this.debris.length > 36) {
        const old = this.debris.shift();
        old.destroy();
      }
    }
  }

  removeCar(car) {
    const idx = this.cars.indexOf(car);
    if (idx !== -1) {
      this.cars.splice(idx, 1);
    }
    if (this.activeCar === car) {
      this.activeCar = null;
      setEngineSound(false);
      if (this.carHud) this.carHud.classList.add('hidden');
    }
  }

  spawnCar(x, y, z, yaw = 0, color = 0xd32f2f) {
    const groundY = getSurfaceY(this.world, x, z, y);
    const actualY = (y === undefined || isNaN(y) || y < groundY - 0.2) ? groundY : y;
    const car = new Car(x, actualY, z, yaw, color, this);
    this.group.add(car.mesh);
    this.cars.push(car);
    return car;
  }

  nearestCar(x, z, maxDist = 4.0) {
    let nearest = null;
    let minDist = maxDist;
    for (const car of this.cars) {
      const dist = Math.hypot(car.x - x, car.z - z);
      if (dist < minDist) {
        minDist = dist;
        nearest = car;
      }
    }
    return nearest;
  }

  hasFlippedNear(x, z, maxDist = 5.0) {
    for (const car of this.cars) {
      if (car.isFlipped && Math.hypot(car.x - x, car.z - z) < maxDist) {
        return true;
      }
    }
    return false;
  }

  flipCar(player) {
    let car = this.activeCar;
    if (!car) {
      car = this.nearestCar(player.x, player.z, 5.0);
    }
    if (car && car.isFlipped) {
      car.flipUpright();
      return true;
    }
    return false;
  }

  enterCar(car, player) {
    if (!car) return;
    this.activeCar = car;
    car.active = true;
    car.setDriverVisible(true);
    this.camYaw = car.yaw;
    sfx.carDoor();
    if (this.carHud) this.carHud.classList.remove('hidden');
    if (this.enterPrompt) this.enterPrompt.classList.add('hidden');
  }

  exitCar(player, isCrash = false) {
    if (!this.activeCar) return;
    const car = this.activeCar;
    car.active = false;
    car.setDriverVisible(false);
    this.activeCar = null;

    if (!isCrash) {
      // Normal exit: place player beside the driver door
      const exitX = car.x + Math.cos(car.yaw) * (-1.4);
      const exitZ = car.z - Math.sin(car.yaw) * (-1.4);
      player.x = exitX;
      player.z = exitZ;
      player.y = car.y + 0.2;
      player.vx = 0;
      player.vz = 0;
      sfx.carDoor();
    }

    setEngineSound(false);
    if (this.carHud) this.carHud.classList.add('hidden');
  }

  onCarCrash(car, crashSpeed) {
    // Eject driver into Ragdoll!
    const fwdX = -Math.sin(car.yaw);
    const fwdZ = -Math.cos(car.yaw);

    const startPos = new THREE.Vector3(
      car.x + fwdX * 0.8,
      car.y + 1.25,
      car.z + fwdZ * 0.8
    );

    const launchSpeed = Math.max(12.0, crashSpeed * 1.15);
    const startVel = new THREE.Vector3(
      fwdX * launchSpeed + (Math.random() - 0.5) * 3.0,
      5.8 + crashSpeed * 0.16,
      fwdZ * launchSpeed + (Math.random() - 0.5) * 3.0
    );

    this.exitCar(null, true);
    this.ragdollManager.triggerCrash(startPos, startVel, car.yaw);
  }

  toggleCamera() {
    this.camMode = this.camMode === 'CHASE' ? 'COCKPIT' : 'CHASE';
  }

  update(dt, keys, player, camera, roamRef) {
    // Check if player pressed F to enter/exit
    const near = this.nearestCar(player.x, player.z, 3.8);

    if (!this.activeCar && !this.isRagdolling) {
      if (near) {
        if (this.enterPrompt) {
          if (near.isFlipped) {
            this.enterPrompt.textContent = 'Apasă [R] pentru a răsturna mașina pe roți';
          } else {
            this.enterPrompt.textContent = 'Apasă [F] pentru a conduce mașina';
          }
          this.enterPrompt.classList.remove('hidden');
        }
      } else {
        if (this.enterPrompt) this.enterPrompt.classList.add('hidden');
      }
    }

    // Update active wreckage pieces
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const p = this.debris[i];
      p.update(dt);
      if (p.age > 40 || p.mesh.position.y < -20) {
        p.destroy();
        this.debris.splice(i, 1);
      }
    }

    // Update all cars and remove destroyed ones
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      const isDriving = car === this.activeCar;
      const destroyed = car.update(dt, keys, this.world, this.fx, isDriving);
      if (destroyed || car.destroyed) {
        this.cars.splice(i, 1);
      }
    }

    // Update Ragdoll if active
    if (this.isRagdolling) {
      this.ragdollManager.update(dt, player, camera, keys);
      return;
    }

    // Driving camera & player synchronization
    if (this.activeCar) {
      const car = this.activeCar;

      player.x = car.x;
      player.y = car.y;
      player.z = car.z;
      player.vx = car.vx;
      player.vy = car.vy;
      player.vz = car.vz;

      // Full 3D Chase Camera
      if (this.camMode === 'CHASE') {
        const turnDiff = Math.atan2(Math.sin(car.yaw - this.camYaw), Math.cos(car.yaw - this.camYaw));
        this.camYaw += turnDiff * Math.min(1, dt * 7.5);

        const lookYaw = this.camYaw + (player.yaw - car.yaw) * 0.35;
        const camX = car.x + Math.sin(lookYaw) * this.camDist;
        const camY = car.y + this.camHeight + player.pitch * 0.8;
        const camZ = car.z + Math.cos(lookYaw) * this.camDist;

        camera.position.set(camX, camY, camZ);
        camera.lookAt(car.x, car.y + 0.9, car.z);
      } else {
        // Cockpit Camera (rolls and pitches with the 3D car cockpit!)
        const seatLocal = new THREE.Vector3(-0.35, 0.95, -0.15);
        seatLocal.applyEuler(new THREE.Euler(car.pitch, car.yaw, car.roll, 'YXZ'));

        camera.position.set(car.x + seatLocal.x, car.y + seatLocal.y, car.z + seatLocal.z);
        camera.rotation.set(player.pitch + car.pitch, player.yaw, car.roll, 'YXZ');
      }

      camera.updateMatrixWorld();

      // Speedometer & HUD
      if (this.speedVal) {
        if (car.isFlipped) {
          this.speedVal.textContent = 'RĂSTURNAT';
          if (this.speedUnit) this.speedUnit.textContent = 'Apasă [R] pentru a repune pe roți';
        } else {
          const kmh = Math.round(Math.abs(car.speed) * 3.6);
          this.speedVal.textContent = kmh;
          if (this.speedUnit) {
            const isTurbo = keys.has('ShiftLeft') || keys.has('ShiftRight');
            this.speedUnit.textContent = isTurbo ? 'KM/H [TURBO]' : 'KM/H';
          }
        }
      }
    }
  }
}
