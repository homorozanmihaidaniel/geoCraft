import * as THREE from 'three';
import { SOLID, MODEL, B } from './blocks.js';
import { getSurfaceY } from './car.js';
import { sfx } from './sound.js';

// Physics parameters
const GRAVITY = 26;
const AIR_DRAG = 0.99;
const GROUND_FRICTION = 0.65;
const RESTITUTION = 0.25;

// Build a driver texture (Steve with racing helmet & leather racing suit)
function createDriverTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  // Background base
  ctx.fillStyle = '#212121';
  ctx.fillRect(0, 0, 64, 64);

  // Helmet / Head (0,0 to 32,16)
  ctx.fillStyle = '#d32f2f'; // Racing red helmet
  ctx.fillRect(0, 0, 32, 16);
  ctx.fillStyle = '#ffffff'; // White racing stripes
  ctx.fillRect(6, 0, 4, 16);
  ctx.fillRect(22, 0, 4, 16);
  // Visor (dark reflective glass)
  ctx.fillStyle = '#111827';
  ctx.fillRect(8, 6, 16, 5);
  ctx.fillStyle = '#38bdf8'; // Visor specular glint
  ctx.fillRect(9, 7, 5, 2);

  // Torso / Racing Suit (16,16 to 40,32)
  ctx.fillStyle = '#b71c1c'; // Dark red jacket
  ctx.fillRect(16, 16, 24, 16);
  ctx.fillStyle = '#ffffff'; // Racing stripe across chest
  ctx.fillRect(26, 16, 4, 16);
  ctx.fillStyle = '#f59e0b'; // Gold sponsor logo / emblem
  ctx.fillRect(20, 20, 4, 3);
  ctx.fillStyle = '#1f2937'; // Black belt
  ctx.fillRect(16, 28, 24, 4);

  // Arms / Sleeves (40,16 to 56,32)
  ctx.fillStyle = '#d32f2f';
  ctx.fillRect(40, 16, 16, 16);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(46, 16, 4, 16);
  ctx.fillStyle = '#111827'; // Black leather racing gloves
  ctx.fillRect(40, 26, 16, 6);

  // Legs / Pants (0,16 to 16,32)
  ctx.fillStyle = '#1e293b'; // Dark blue-gray racing pants
  ctx.fillRect(0, 16, 16, 16);
  ctx.fillStyle = '#d32f2f'; // Red side piping
  ctx.fillRect(0, 16, 2, 16);
  ctx.fillRect(14, 16, 2, 16);
  ctx.fillStyle = '#0f172a'; // Black boots
  ctx.fillRect(0, 27, 16, 5);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let sharedDriverTex = null;
function getDriverTexture() {
  if (!sharedDriverTex) sharedDriverTex = createDriverTexture();
  return sharedDriverTex;
}

// Represent an active ragdoll thrown from the car
export class Ragdoll {
  constructor(scene, world, fx, startPos, startVel, startYaw = 0) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.active = true;
    this.settled = false;
    this.settleTimer = 0;
    this.age = 0;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    const tex = getDriverTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.6,
      metalness: 0.15,
    });

    // 3D Visual limb meshes
    this.meshHead = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), mat);
    this.meshTorso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.46, 0.22), mat);
    this.meshArmL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.14), mat);
    this.meshArmR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.14), mat);
    this.meshLegL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.46, 0.15), mat);
    this.meshLegR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.46, 0.15), mat);

    this.group.add(
      this.meshHead,
      this.meshTorso,
      this.meshArmL,
      this.meshArmR,
      this.meshLegL,
      this.meshLegR
    );

    // Initial orientation vectors
    const fwdX = -Math.sin(startYaw);
    const fwdZ = -Math.cos(startYaw);
    const rightX = Math.cos(startYaw);
    const rightZ = -Math.sin(startYaw);

    const sx = startPos.x;
    const sy = startPos.y;
    const sz = startPos.z;

    // Build particle nodes
    // Node indices:
    // 0: Head
    // 1: Neck / Chest Top
    // 2: Pelvis / Hips
    // 3: Shoulder L
    // 4: Hand L
    // 5: Shoulder R
    // 6: Hand R
    // 7: Hip L
    // 8: Foot L
    // 9: Hip R
    // 10: Foot R
    this.nodes = [
      { x: sx + fwdX * 0.1, y: sy + 0.65, z: sz + fwdZ * 0.1, radius: 0.16 }, // 0 Head
      { x: sx, y: sy + 0.40, z: sz, radius: 0.14 }, // 1 Neck
      { x: sx - fwdX * 0.05, y: sy - 0.08, z: sz - fwdZ * 0.05, radius: 0.15 }, // 2 Pelvis
      { x: sx - rightX * 0.22, y: sy + 0.38, z: sz - rightZ * 0.22, radius: 0.10 }, // 3 Shoulder L
      { x: sx - rightX * 0.26 + fwdX * 0.35, y: sy + 0.22, z: sz - rightZ * 0.26 + fwdZ * 0.35, radius: 0.09 }, // 4 Hand L
      { x: sx + rightX * 0.22, y: sy + 0.38, z: sz + rightZ * 0.22, radius: 0.10 }, // 5 Shoulder R
      { x: sx + rightX * 0.26 + fwdX * 0.35, y: sy + 0.22, z: sz + rightZ * 0.26 + fwdZ * 0.35, radius: 0.09 }, // 6 Hand R
      { x: sx - rightX * 0.14, y: sy - 0.12, z: sz - rightZ * 0.14, radius: 0.11 }, // 7 Hip L
      { x: sx - rightX * 0.16 + fwdX * 0.1, y: sy - 0.58, z: sz - rightZ * 0.16 + fwdZ * 0.1, radius: 0.10 }, // 8 Foot L
      { x: sx + rightX * 0.14, y: sy - 0.12, z: sz + rightZ * 0.14, radius: 0.11 }, // 9 Hip R
      { x: sx + rightX * 0.16 + fwdX * 0.1, y: sy - 0.58, z: sz + rightZ * 0.16 + fwdZ * 0.1, radius: 0.10 }, // 10 Foot R
    ];

    // Seed previous positions from start velocity + spin impulses
    const dt0 = 0.016;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      // Add slight limb flail spread
      const spreadX = (Math.random() - 0.5) * 1.8;
      const spreadY = (Math.random() - 0.3) * 1.5;
      const spreadZ = (Math.random() - 0.5) * 1.8;
      const nvx = startVel.x + spreadX;
      const nvy = startVel.y + spreadY;
      const nvz = startVel.z + spreadZ;

      n.oldX = n.x - nvx * dt0;
      n.oldY = n.y - nvy * dt0;
      n.oldZ = n.z - nvz * dt0;
    }

    // Connect stick constraints with resting lengths
    this.sticks = [
      this.createStick(0, 1), // Head to Neck
      this.createStick(1, 2), // Spine (Neck to Pelvis)
      this.createStick(1, 3), // Neck to Shoulder L
      this.createStick(1, 5), // Neck to Shoulder R
      this.createStick(3, 4), // Arm L
      this.createStick(5, 6), // Arm R
      this.createStick(2, 7), // Pelvis to Hip L
      this.createStick(2, 9), // Pelvis to Hip R
      this.createStick(7, 8), // Leg L
      this.createStick(9, 10), // Leg R
      // Stability cross braces (maintains humanoid silhouette)
      this.createStick(3, 5), // Clavicles (Shoulder L to Shoulder R)
      this.createStick(7, 9), // Hips span
      this.createStick(3, 9), // Diagonal brace
      this.createStick(5, 7), // Diagonal brace
      this.createStick(1, 7), // Spine brace
      this.createStick(1, 9), // Spine brace
    ];
  }

  createStick(p1, p2) {
    const n1 = this.nodes[p1];
    const n2 = this.nodes[p2];
    const dist = Math.hypot(n1.x - n2.x, n1.y - n2.y, n1.z - n2.z);
    return { p1, p2, length: dist };
  }

  isSolid(x, y, z) {
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const id = this.world.getBlock(bx, by, bz);
    if (!SOLID[id] || id === B.LEAVES || id === B.SAKURA || id === B.CANOPY) return false;
    if (MODEL[id] === null) return true;
    for (const b of this.world.boxesAt(bx, by, bz, id)) {
      if (
        x >= bx + b[0] &&
        x <= bx + b[3] &&
        y >= by + b[1] &&
        y <= by + b[4] &&
        z >= bz + b[2] &&
        z <= bz + b[5]
      ) {
        return true;
      }
    }
    return false;
  }

  update(dt) {
    if (!this.active) return;
    this.age += dt;

    // Sub-stepping for maximum stability and anti-tunneling
    const subSteps = 4;
    const dtSub = Math.min(0.04, dt) / subSteps;
    const dt2 = dtSub * dtSub;

    let totalSpeed = 0;

    for (let s = 0; s < subSteps; s++) {
      // 1. Verlet Integration
      for (let i = 0; i < this.nodes.length; i++) {
        const n = this.nodes[i];
        const vx = (n.x - n.oldX) * AIR_DRAG;
        const vy = (n.y - n.oldY) * AIR_DRAG - GRAVITY * dt2;
        const vz = (n.z - n.oldZ) * AIR_DRAG;

        n.oldX = n.x;
        n.oldY = n.y;
        n.oldZ = n.z;

        n.x += vx;
        n.y += vy;
        n.z += vz;

        // Ground collision & bouncing
        const gy = getSurfaceY(this.world, n.x, n.z, n.y) + n.radius;
        if (n.y < gy) {
          const penetration = gy - n.y;
          n.y = gy;

          // Velocity relative to ground
          const currVy = (n.y - n.oldY);
          n.oldY = n.y + currVy * RESTITUTION;

          // Ground friction
          n.oldX = n.x - (n.x - n.oldX) * GROUND_FRICTION;
          n.oldZ = n.z - (n.z - n.oldZ) * GROUND_FRICTION;

          if (penetration > 0.08 && Math.random() < 0.25) {
            sfx.ragdollHit();
            if (this.fx) {
              this.fx.burst(n.x, n.y, n.z, [0.65, 0.65, 0.68], 3, 1.4, 0.1, 0.5);
            }
          }
        }

        // Wall obstacle collision
        if (this.isSolid(n.x, n.y, n.z)) {
          n.x = n.oldX;
          n.z = n.oldZ;
        }

        totalSpeed += Math.hypot(n.x - n.oldX, n.y - n.oldY, n.z - n.oldZ) / dtSub;
      }

      // 2. Satisfy distance constraints
      for (let iter = 0; iter < 4; iter++) {
        for (let j = 0; j < this.sticks.length; j++) {
          const st = this.sticks[j];
          const n1 = this.nodes[st.p1];
          const n2 = this.nodes[st.p2];

          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dz = n2.z - n1.z;
          const d = Math.hypot(dx, dy, dz) || 0.0001;
          const diff = (d - st.length) / d;

          const factor = 0.5;
          n1.x += dx * factor * diff;
          n1.y += dy * factor * diff;
          n1.z += dz * factor * diff;

          n2.x -= dx * factor * diff;
          n2.y -= dy * factor * diff;
          n2.z -= dz * factor * diff;
        }
      }
    }

    const avgSpeed = totalSpeed / (this.nodes.length * subSteps);
    if (avgSpeed < 0.4) {
      this.settleTimer += dt;
      if (this.settleTimer > 1.2) {
        this.settled = true;
      }
    } else {
      this.settleTimer = 0;
    }

    // 3. Update 3D Visual Limb Meshes
    this.updateVisuals();
  }

  orientBone(mesh, p1, p2) {
    const mx = (p1.x + p2.x) * 0.5;
    const my = (p1.y + p2.y) * 0.5;
    const mz = (p1.z + p2.z) * 0.5;
    mesh.position.set(mx, my, mz);

    const dir = new THREE.Vector3(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z).normalize();
    const up = new THREE.Vector3(0, -1, 0); // default mesh points downwards
    mesh.quaternion.setFromUnitVectors(up, dir);
  }

  updateVisuals() {
    const n = this.nodes;

    // Head
    this.meshHead.position.set(n[0].x, n[0].y, n[0].z);
    const headUp = new THREE.Vector3(n[0].x - n[1].x, n[0].y - n[1].y, n[0].z - n[1].z).normalize();
    this.meshHead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), headUp);

    // Torso (oriented between Neck and Pelvis, facing forward)
    const torsoMidX = (n[1].x + n[2].x) * 0.5;
    const torsoMidY = (n[1].y + n[2].y) * 0.5;
    const torsoMidZ = (n[1].z + n[2].z) * 0.5;
    this.meshTorso.position.set(torsoMidX, torsoMidY, torsoMidZ);

    const spineDir = new THREE.Vector3(n[1].x - n[2].x, n[1].y - n[2].y, n[1].z - n[2].z).normalize();
    const shoulderDir = new THREE.Vector3(n[5].x - n[3].x, n[5].y - n[3].y, n[5].z - n[3].z).normalize();
    const chestForward = new THREE.Vector3().crossVectors(shoulderDir, spineDir).normalize();
    const chestRight = new THREE.Vector3().crossVectors(spineDir, chestForward).normalize();

    const m = new THREE.Matrix4().makeBasis(chestRight, spineDir, chestForward);
    this.meshTorso.quaternion.setFromRotationMatrix(m);

    // Limbs
    this.orientBone(this.meshArmL, n[3], n[4]);
    this.orientBone(this.meshArmR, n[5], n[6]);
    this.orientBone(this.meshLegL, n[7], n[8]);
    this.orientBone(this.meshLegR, n[9], n[10]);
  }

  getCenter() {
    const n = this.nodes;
    return new THREE.Vector3(
      (n[0].x + n[2].x) * 0.5,
      (n[0].y + n[2].y) * 0.5,
      (n[0].z + n[2].z) * 0.5
    );
  }

  destroy() {
    this.active = false;
    if (this.group && this.group.parent) {
      this.group.parent.remove(this.group);
    }
  }
}

// Manager that handles active ragdolls, camera transitions, and recovery
export class RagdollManager {
  constructor(scene, world, fx) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.activeRagdoll = null;
    this.camFollowPos = new THREE.Vector3();
    this.recovering = false;

    // Red impact screen flash overlay
    this.crashOverlay = document.createElement('div');
    this.crashOverlay.id = 'crash-flash';
    this.crashOverlay.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;transition:opacity 0.6s ease;opacity:0;background:radial-gradient(ellipse at center, rgba(239,68,68,0) 40%, rgba(220,38,38,0.7) 100%);box-shadow:inset 0 0 100px rgba(185,28,28,0.8);';
    document.body.appendChild(this.crashOverlay);

    // Crash stand-up notification prompt
    this.crashPrompt = document.createElement('div');
    this.crashPrompt.id = 'crash-prompt';
    this.crashPrompt.style.cssText =
      'position:fixed;bottom:120px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,0.85);backdrop-filter:blur(8px);color:#f8fafc;padding:12px 24px;border-radius:12px;font-family:sans-serif;font-size:16px;font-weight:600;box-shadow:0 8px 30px rgba(0,0,0,0.5);border:2px solid #ef4444;pointer-events:none;opacity:0;transition:opacity 0.3s ease;z-index:9999;display:flex;align-items:center;gap:10px;';
    this.crashPrompt.innerHTML =
      '<span style="font-size:22px;">💥</span> <span>MAȘINA A EXPLODAT! Apasă <kbd style="background:#ef4444;color:white;padding:2px 8px;border-radius:6px;box-shadow:0 2px 0 #b91c1c;">SPACE</kbd> sau <kbd style="background:#ef4444;color:white;padding:2px 8px;border-radius:6px;box-shadow:0 2px 0 #b91c1c;">F</kbd> pentru a te ridica</span>';
    document.body.appendChild(this.crashPrompt);
  }

  triggerCrash(startPos, startVel, startYaw = 0) {
    if (this.activeRagdoll) {
      this.activeRagdoll.destroy();
    }

    this.activeRagdoll = new Ragdoll(
      this.scene,
      this.world,
      this.fx,
      startPos,
      startVel,
      startYaw
    );

    this.camFollowPos.copy(this.activeRagdoll.getCenter());
    this.recovering = false;

    // Flash screen red
    this.crashOverlay.style.opacity = '1';
    setTimeout(() => {
      this.crashOverlay.style.opacity = '0';
    }, 600);

    // Show stand-up banner after 0.8s
    setTimeout(() => {
      if (this.activeRagdoll) {
        this.crashPrompt.style.opacity = '1';
      }
    }, 800);
  }

  recover(player) {
    if (!this.activeRagdoll) return;
    const center = this.activeRagdoll.getCenter();
    const groundY = getSurfaceY(this.world, center.x, center.z, center.y);

    // Place player at ragdoll position
    player.x = center.x;
    player.y = Math.max(center.y, groundY);
    player.z = center.z;
    player.vx = 0;
    player.vy = 2.0; // little hop when standing up
    player.vz = 0;

    this.activeRagdoll.destroy();
    this.activeRagdoll = null;
    this.crashPrompt.style.opacity = '0';
    sfx.step();
  }

  update(dt, player, camera, keys) {
    if (!this.activeRagdoll) return;

    this.activeRagdoll.update(dt);

    // Check for player input to stand up
    if (
      this.activeRagdoll.age > 0.8 &&
      (keys.has('Space') || keys.has('KeyF') || this.activeRagdoll.age > 4.5)
    ) {
      this.recover(player);
      return;
    }

    // Dynamic third-person ragdoll chase camera
    const center = this.activeRagdoll.getCenter();
    this.camFollowPos.lerp(center, Math.min(1, dt * 8.0));

    const camOffset = new THREE.Vector3(0, 2.2, 3.8);
    camera.position.set(
      this.camFollowPos.x + camOffset.x,
      this.camFollowPos.y + camOffset.y,
      this.camFollowPos.z + camOffset.z
    );
    camera.lookAt(this.camFollowPos.x, this.camFollowPos.y + 0.2, this.camFollowPos.z);
    camera.updateMatrixWorld();
  }
}
