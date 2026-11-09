// Guided missile system with realistic aerodynamic flight physics,
// rotational inertia (persistent roll rates like real aircraft),
// smooth camera tracking (lag & slerp), and massive block-destroying explosions.
import * as THREE from 'three';
import { B, SOLID, BLASTPROOF } from './blocks.js';
import { sfx, setRocketSound } from './sound.js';

export class MissileManager {
  constructor(scene, world, fx, cars = null) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.cars = cars;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.activeMissile = null;
    this.hudEl = null;
    this.launchOrigin = null;
    this.justDetonated = false;

    // Aerodynamic flight dynamics state
    this.pitchVel = 0;       // Current pitch angular rate (rad/s)
    this.yawVel = 0;         // Current yaw angular rate (rad/s)
    this.rollVel = 0;        // Persistent roll rate with rotational inertia (rad/s)
    this.targetPitchRate = 0;// Target rate demanded by controls
    this.targetYawRate = 0;  // Target rate demanded by controls

    // Camera smoothing state (silky smooth delayed camera lag)
    this.camQuat = new THREE.Quaternion();
    this.camPos = new THREE.Vector3();

    // Preallocated vectors for 6DOF quaternion rotation
    this._localX = new THREE.Vector3(1, 0, 0);  // Wing pitch axis
    this._localY = new THREE.Vector3(0, 1, 0);  // Dorsal yaw axis
    this._localZ = new THREE.Vector3(0, 0, -1); // Fuselage forward roll axis
    this._tmpQuat = new THREE.Quaternion();
    this._forward = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._right = new THREE.Vector3();

    this.buildHud();
  }

  buildHud() {
    let el = document.getElementById('missile-hud');
    if (!el) {
      el = document.createElement('div');
      el.id = 'missile-hud';
      el.className = 'missile-hud hidden';
      el.innerHTML = `
        <div class="mhud-scanlines"></div>
        <div class="mhud-vignette"></div>
        <div class="mhud-header">
          <span class="mhud-rec"><span class="mhud-rec-dot"></span> GUIDED MISSILE - FLIGHT SYSTEM 6DOF</span>
          <span class="mhud-battery">SIGNAL: 100% [████]</span>
        </div>
        <div class="mhud-crosshair-wrap">
          <div class="mhud-box"></div>
          <div class="mhud-reticle">+</div>
        </div>
        <div class="mhud-telemetry-left">
          <div class="mhud-stat"><small>VITEZĂ</small><b id="mhud-spd">150</b> <span class="mhud-unit">KM/H</span></div>
          <div class="mhud-stat"><small>ROLL</small><b id="mhud-roll">0</b> <span class="mhud-unit">°</span></div>
          <div class="mhud-stat"><small>ROTAȚIE INERȚIALĂ</small><b id="mhud-rot-spd">0</b> <span class="mhud-unit">°/S</span></div>
          <div id="mhud-boost-badge" class="mhud-badge hidden">BOOST ACTIV</div>
        </div>
        <div class="mhud-telemetry-right">
          <div class="mhud-stat"><small>ALTITUDINE</small><b id="mhud-alt">120</b> <span class="mhud-unit">M</span></div>
          <div class="mhud-stat"><small>DISTANȚĂ SOL</small><b id="mhud-dist">45</b> <span class="mhud-unit">M</span></div>
        </div>
        <div id="mhud-impact-warning" class="mhud-warning hidden">⚠ IMPACT IMINENT ⚠</div>
        <div class="mhud-footer">
          <span>[A / D] Rotație Inerțială &nbsp;•&nbsp; [Mouse] Avion Smooth &nbsp;•&nbsp; [W / Space] Boost &nbsp;•&nbsp; [S] Frână &nbsp;•&nbsp; [R] Stop Rotație &nbsp;•&nbsp; [Click / X / E] Detonare &nbsp;•&nbsp; [Esc] Anulare</span>
        </div>
      `;
      document.body.appendChild(el);
    }
    this.hudEl = el;

    // Inject styles
    if (!document.getElementById('missile-hud-styles')) {
      const style = document.createElement('style');
      style.id = 'missile-hud-styles';
      style.textContent = `
        .missile-hud {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 120;
          font-family: 'Consolas', 'Monaco', monospace;
          color: #00ff66;
          text-shadow: 0 0 6px rgba(0, 255, 102, 0.8);
          overflow: hidden;
          user-select: none;
        }
        .missile-hud.hidden { display: none !important; }
        .mhud-scanlines {
          position: absolute;
          inset: 0;
          background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.03), rgba(0, 255, 0, 0.01), rgba(0, 255, 0, 0.03));
          background-size: 100% 4px, 6px 100%;
          opacity: 0.8;
          pointer-events: none;
        }
        .mhud-vignette {
          position: absolute;
          inset: 0;
          box-shadow: inset 0 0 100px rgba(0, 30, 10, 0.85);
          pointer-events: none;
        }
        .mhud-header {
          position: absolute;
          top: 24px;
          left: 32px;
          right: 32px;
          display: flex;
          justify-content: space-between;
          font-size: 14px;
          font-weight: bold;
          letter-spacing: 2px;
        }
        .mhud-rec-dot {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #ff3333;
          box-shadow: 0 0 8px #ff3333;
          margin-right: 6px;
          animation: mhud-blink 1s infinite alternate;
        }
        @keyframes mhud-blink {
          0% { opacity: 0.2; }
          100% { opacity: 1; }
        }
        .mhud-crosshair-wrap {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .mhud-box {
          width: 80px;
          height: 80px;
          border: 2px solid rgba(0, 255, 102, 0.65);
          position: relative;
        }
        .mhud-box::before, .mhud-box::after {
          content: '';
          position: absolute;
          background: #00ff66;
        }
        .mhud-box::before { width: 100%; height: 2px; top: 50%; left: 0; transform: translateY(-50%); opacity: 0.4; }
        .mhud-box::after { height: 100%; width: 2px; left: 50%; top: 0; transform: translateX(-50%); opacity: 0.4; }
        .mhud-reticle {
          position: absolute;
          font-size: 26px;
          font-weight: bold;
          color: #00ff66;
        }
        .mhud-telemetry-left {
          position: absolute;
          left: 32px;
          top: 42%;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .mhud-telemetry-right {
          position: absolute;
          right: 32px;
          top: 42%;
          display: flex;
          flex-direction: column;
          gap: 10px;
          text-align: right;
        }
        .mhud-stat small {
          display: block;
          font-size: 11px;
          opacity: 0.75;
          letter-spacing: 1px;
        }
        .mhud-stat b {
          font-size: 26px;
          letter-spacing: 2px;
        }
        .mhud-unit {
          font-size: 13px;
          opacity: 0.8;
        }
        .mhud-badge {
          display: inline-block;
          background: rgba(255, 150, 0, 0.25);
          border: 1px solid #ff9900;
          color: #ffaa00;
          padding: 4px 10px;
          font-size: 12px;
          font-weight: bold;
          border-radius: 4px;
          letter-spacing: 1px;
          text-shadow: 0 0 8px #ff9900;
        }
        .mhud-warning {
          position: absolute;
          top: 25%;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(255, 0, 0, 0.3);
          border: 2px solid #ff2222;
          color: #ff2222;
          padding: 8px 24px;
          font-size: 20px;
          font-weight: bold;
          letter-spacing: 3px;
          text-shadow: 0 0 10px #ff0000;
          animation: mhud-flash 0.3s infinite alternate;
        }
        @keyframes mhud-flash {
          0% { transform: translateX(-50%) scale(0.95); opacity: 0.6; }
          100% { transform: translateX(-50%) scale(1.05); opacity: 1; }
        }
        .mhud-footer {
          position: absolute;
          bottom: 24px;
          left: 0;
          right: 0;
          text-align: center;
          font-size: 13px;
          letter-spacing: 1px;
          opacity: 0.9;
        }
      `;
      document.head.appendChild(style);
    }
  }

  // Create procedural 3D cruise missile
  createMissileMesh() {
    const group = new THREE.Group();

    // Materials
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x374151,
      roughness: 0.35,
      metalness: 0.65,
    });
    const noseMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      roughness: 0.3,
      metalness: 0.5,
    });
    const finMat = new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      roughness: 0.4,
      metalness: 0.7,
    });
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
    });

    // Fuselage cylinder (pointing along -Z by default)
    const bodyGeom = new THREE.CylinderGeometry(0.22, 0.25, 2.2, 16);
    bodyGeom.rotateX(Math.PI / 2);
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    group.add(body);

    // Aerodynamic nose cone (front: negative Z)
    const noseGeom = new THREE.ConeGeometry(0.22, 0.7, 16);
    noseGeom.rotateX(-Math.PI / 2);
    const nose = new THREE.Mesh(noseGeom, noseMat);
    nose.position.z = -1.45;
    group.add(nose);

    // Wings (horizontal delta wings)
    const wingGeom = new THREE.BoxGeometry(1.4, 0.03, 0.5);
    const wings = new THREE.Mesh(wingGeom, finMat);
    wings.position.z = -0.1;
    group.add(wings);

    // Canards (small front fins)
    const canardGeom = new THREE.BoxGeometry(0.7, 0.025, 0.25);
    const canards = new THREE.Mesh(canardGeom, finMat);
    canards.position.z = -1.0;
    group.add(canards);

    // Tail fins (cross shape at the back)
    const tailHGeom = new THREE.BoxGeometry(0.85, 0.03, 0.35);
    const tailH = new THREE.Mesh(tailHGeom, finMat);
    tailH.position.z = 0.95;
    group.add(tailH);

    const tailVGeom = new THREE.BoxGeometry(0.03, 0.85, 0.35);
    const tailV = new THREE.Mesh(tailVGeom, finMat);
    tailV.position.z = 0.95;
    group.add(tailV);

    // Rear engine nozzle
    const nozzleGeom = new THREE.CylinderGeometry(0.18, 0.22, 0.2, 14);
    nozzleGeom.rotateX(Math.PI / 2);
    const nozzle = new THREE.Mesh(nozzleGeom, finMat);
    nozzle.position.z = 1.15;
    group.add(nozzle);

    // Rocket thruster exhaust flame
    const flameGeom = new THREE.ConeGeometry(0.18, 0.9, 10);
    flameGeom.rotateX(Math.PI / 2);
    const flame = new THREE.Mesh(flameGeom, flameMat);
    flame.position.z = 1.7;
    group.add(flame);
    group.userData.flame = flame;

    return group;
  }

  // Launch a new guided missile from the player's position
  launch(player, camera) {
    if (this.activeMissile) return false;

    // Save exact player launch origin so the player can return 100% safely
    this.launchOrigin = {
      x: player.x,
      y: player.y,
      z: player.z,
      yaw: player.yaw,
      pitch: player.pitch,
      eye: player.eye,
    };

    // Orient missile to camera direction using camera quaternion
    const startQuat = camera.quaternion.clone();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(startQuat);

    // Spawn 2.0m in front of player eye
    const startX = camera.position.x + forward.x * 2.0;
    const startY = camera.position.y + forward.y * 2.0;
    const startZ = camera.position.z + forward.z * 2.0;

    const mesh = this.createMissileMesh();
    this.group.add(mesh);

    const missile = {
      x: startX,
      y: startY,
      z: startZ,
      quaternion: startQuat,
      speed: 40.0, // base speed in m/s (~144 km/h)
      mesh,
      cameraMode: 'FIRST_PERSON', // default: FIRST PERSON
      age: 0,
      detonated: false,
      detonating: false,
      detonationTimer: 0,
      trailTimer: 0,
      origin: { ...this.launchOrigin },
    };

    this.activeMissile = missile;
    this.justDetonated = false;

    // Reset angular velocities for clean launch
    this.pitchVel = 0;
    this.yawVel = 0;
    this.rollVel = 0;
    this.targetPitchRate = 0;
    this.targetYawRate = 0;
    this.camQuat.copy(startQuat);
    this.camPos.set(startX, startY, startZ);

    // Show HUD
    if (this.hudEl) this.hudEl.classList.remove('hidden');

    // Audio effects
    if (sfx.rocketLaunch) sfx.rocketLaunch();
    else sfx.bow();
    setRocketSound(true, false);

    return true;
  }

  // Smooth aerodynamic steering with mouse (lag & momentum, non-abrupt)
  steer(dx, dy) {
    if (!this.activeMissile || this.activeMissile.detonating) return;

    // Mouse drives aerodynamic target rates smoothly
    // dy > 0 (push forward) -> pitch down (-X); dy < 0 (pull back) -> pitch up (+X)
    const PITCH_POWER = 0.045;
    const YAW_POWER = 0.042;
    const ROLL_NUDGE = 0.015; // subtle bank roll torque from mouse

    this.targetPitchRate += -dy * PITCH_POWER;
    this.targetYawRate += -dx * YAW_POWER;

    // Clamp maximum control demands to realistic aerodynamic limits
    const MAX_RATE = 2.4; // rad/s (~137 deg/s)
    this.targetPitchRate = THREE.MathUtils.clamp(this.targetPitchRate, -MAX_RATE, MAX_RATE);
    this.targetYawRate = THREE.MathUtils.clamp(this.targetYawRate, -MAX_RATE, MAX_RATE);

    // Subtle bank roll torque from mouse turn
    this.rollVel += dx * ROLL_NUDGE;
    this.rollVel = THREE.MathUtils.clamp(this.rollVel, -6.5, 6.5);
  }

  toggleCamera() {
    if (!this.activeMissile) return;
    this.activeMissile.cameraMode = this.activeMissile.cameraMode === 'FIRST_PERSON' ? 'CHASE' : 'FIRST_PERSON';
    if (this.hudEl) {
      if (this.activeMissile.cameraMode === 'FIRST_PERSON') this.hudEl.classList.remove('hidden');
      else this.hudEl.classList.add('hidden');
    }
  }

  detonate(power = 12.0) {
    if (!this.activeMissile || this.activeMissile.detonating) return;
    const m = this.activeMissile;
    this.explodeAt(m.x, m.y, m.z, power);
  }

  explodeAt(hitX, hitY, hitZ, power = 12.0) {
    if (!this.activeMissile) return;
    const m = this.activeMissile;
    m.detonating = true;
    m.detonated = true;
    this.justDetonated = true;
    m.detonationTimer = 0.45; // 0.45s cinematic explosion view before teleporting back to player
    m.mesh.visible = false;

    setRocketSound(false);
    if (this.hudEl) this.hudEl.classList.add('hidden');

    // 1. Core massive block explosion (radius ~12 blocks = hundreds of blocks destroyed)
    this.fx.explode(hitX, hitY, hitZ, power);

    // 2. Extra glowing fireball flash & high-intensity burst
    if (this.fx.flashMesh) {
      const flash = this.fx.flashMesh(hitX, hitY, hitZ);
      this.fx.flashes.push({ mesh: flash, age: 0, power: 16.0 });
    }

    // 3. Huge explosive debris & fiery bursts
    this.fx.burst(hitX, hitY, hitZ, [1.0, 0.55, 0.12], 130, 28.0, 0.35, 1.4);
    this.fx.burst(hitX, hitY + 0.5, hitZ, [1.0, 0.9, 0.25], 90, 24.0, 0.12, 0.85);
    this.fx.burst(hitX, hitY + 0.8, hitZ, [0.12, 0.12, 0.14], 120, 8.5, 0.85, 4.2, 3.5);

    // 4. Loud explosion boom + ground hit
    sfx.boom(0);
    if (sfx.carCrash) sfx.carCrash();

    // 5. Demolish any cars within blast radius
    if (this.cars && this.cars.cars) {
      for (const car of [...this.cars.cars]) {
        if (!car.destroyed && Math.hypot(car.x - hitX, car.y - hitY, car.z - hitZ) < power + 4.0) {
          car.disassembleAndExplode(this.world, this.fx);
        }
      }
    }
  }

  // Teleport player & camera safely back to the original launch spot
  teleportBack(player, camera, world) {
    if (!this.launchOrigin) return;
    const orig = this.launchOrigin;

    if (this.activeMissile && this.activeMissile.mesh) {
      this.group.remove(this.activeMissile.mesh);
    }
    this.activeMissile = null;
    this.pitchVel = 0;
    this.yawVel = 0;
    this.rollVel = 0;
    setRocketSound(false);
    if (this.hudEl) this.hudEl.classList.add('hidden');

    // Restore player coordinates and zero velocities
    player.x = orig.x;
    player.y = orig.y;
    player.z = orig.z;
    player.yaw = orig.yaw;
    player.pitch = orig.pitch;
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;

    const groundY = world ? world.groundDelta(player.x, player.y, player.z) : 0;
    camera.position.set(player.x, player.eyeY + groundY, player.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(player.pitch, player.yaw, 0);
    camera.updateMatrixWorld();

    setTimeout(() => {
      this.justDetonated = false;
    }, 800);
  }

  update(dt, keys, world, fx, sfx, camera, player, shakeRef) {
    if (!this.activeMissile) return false;
    const m = this.activeMissile;

    // Handle explosion cinematic lingering, then teleport safely back
    if (m.detonating) {
      m.detonationTimer -= dt;
      if (m.detonationTimer <= 0) {
        this.teleportBack(player, camera, world);
        return false;
      }
      return true;
    }

    m.age += dt;

    // 1. Roll Control with Persistent Rotational Inertia:
    // [D] accelerates clockwise roll, [A] accelerates counter-clockwise roll
    // When released, this.rollVel PERSISTS from inertia until counter-steered!
    const ROLL_ACCEL = 5.4; // rad/s²
    if (keys.has('KeyD') || keys.has('ArrowRight')) {
      this.rollVel += ROLL_ACCEL * dt;
    }
    if (keys.has('KeyA') || keys.has('ArrowLeft')) {
      this.rollVel -= ROLL_ACCEL * dt;
    }
    // Emergency roll stop / wing level with [KeyR]:
    if (keys.has('KeyR')) {
      this.rollVel = 0;
    }
    this.rollVel = THREE.MathUtils.clamp(this.rollVel, -6.5, 6.5);

    // 2. Smooth Aerodynamic Pitch & Yaw Dynamics (Inertia Lag, Non-Abrupt):
    const pitchLag = 1.0 - Math.exp(-dt * 5.2);
    this.pitchVel += (this.targetPitchRate - this.pitchVel) * pitchLag;

    const yawLag = 1.0 - Math.exp(-dt * 4.8);
    this.yawVel += (this.targetYawRate - this.yawVel) * yawLag;

    // Centering decay on control demands when mouse stops
    this.targetPitchRate *= Math.exp(-dt * 5.0);
    this.targetYawRate *= Math.exp(-dt * 5.0);

    // Keyboard pitch / yaw backup (Arrow keys & Q)
    if (keys.has('ArrowUp')) this.pitchVel -= 2.2 * dt;
    if (keys.has('ArrowDown')) this.pitchVel += 2.2 * dt;
    if (keys.has('KeyQ')) this.yawVel += 2.2 * dt;

    // 3. Apply angular velocities to vehicle orientation quaternion in local space:
    if (Math.abs(this.pitchVel) > 0.00001) {
      this._tmpQuat.setFromAxisAngle(this._localX, this.pitchVel * dt);
      m.quaternion.multiply(this._tmpQuat);
    }
    if (Math.abs(this.yawVel) > 0.00001) {
      this._tmpQuat.setFromAxisAngle(this._localY, this.yawVel * dt);
      m.quaternion.multiply(this._tmpQuat);
    }
    if (Math.abs(this.rollVel) > 0.00001) {
      this._tmpQuat.setFromAxisAngle(this._localZ, this.rollVel * dt);
      m.quaternion.multiply(this._tmpQuat);
    }
    m.quaternion.normalize();

    // 4. Speed / Thrust management
    const isBoost = keys.has('KeyW') || keys.has('Space');
    const isBrake = keys.has('KeyS');

    const targetSpeed = isBoost ? 78.0 : isBrake ? 20.0 : 42.0;
    m.speed += (targetSpeed - m.speed) * Math.min(1.0, dt * 4.5);

    setRocketSound(true, isBoost);

    // Scale engine flame
    if (m.mesh.userData.flame) {
      const flame = m.mesh.userData.flame;
      const fScale = (m.speed / 42.0) * (0.85 + Math.random() * 0.35);
      flame.scale.set(1.0, 1.0, fScale);
      flame.visible = m.speed > 10;
    }

    // Forward direction from 6DOF quaternion
    this._forward.set(0, 0, -1).applyQuaternion(m.quaternion);
    const vx = this._forward.x * m.speed;
    const vy = this._forward.y * m.speed;
    const vz = this._forward.z * m.speed;

    const stepDist = m.speed * dt;

    // Exhaust smoke trail
    m.trailTimer += dt;
    if (m.trailTimer > 0.022) {
      m.trailTimer = 0;
      const tailOffset = 1.35;
      const tx = m.x - this._forward.x * tailOffset;
      const ty = m.y - this._forward.y * tailOffset;
      const tz = m.z - this._forward.z * tailOffset;
      // White/gray smoke cloud
      fx.burst(tx, ty, tz, [0.85, 0.85, 0.88], 2, 2.5, 0.22, 0.55);
      // Fiery sparks
      if (isBoost || Math.random() < 0.45) {
        fx.burst(tx, ty, tz, [1.0, 0.65, 0.15], 3, 5.5, 0.1, 0.25);
      }
    }

    // Step-by-step collision check along ray (no tunneling)
    const numSubSteps = Math.max(3, Math.ceil(stepDist / 0.4));
    let hit = false;
    let hitX = m.x, hitY = m.y, hitZ = m.z;

    for (let s = 1; s <= numSubSteps; s++) {
      const frac = s / numSubSteps;
      const cx = m.x + vx * dt * frac;
      const cy = m.y + vy * dt * frac;
      const cz = m.z + vz * dt * frac;

      const bx = Math.floor(cx);
      const by = Math.floor(cy);
      const bz = Math.floor(cz);

      // Check world block
      const blockId = world.getBlock(bx, by, bz);
      if (blockId !== 0 && blockId !== B.WATER && blockId !== B.LAVA) {
        hit = true;
        hitX = cx;
        hitY = cy;
        hitZ = cz;
        break;
      }

      // Check ground floor height
      const gy = world.topY(bx, bz);
      if (cy <= gy) {
        hit = true;
        hitX = cx;
        hitY = cy;
        hitZ = cz;
        break;
      }
    }

    if (hit) {
      this.explodeAt(hitX, hitY, hitZ, 12.0);
      return true;
    }

    // Advance position
    m.x += vx * dt;
    m.y += vy * dt;
    m.z += vz * dt;

    // Update 3D mesh transform using full 6DOF quaternion
    m.mesh.position.set(m.x, m.y, m.z);
    m.mesh.quaternion.copy(m.quaternion);

    // Distance to ground below
    const groundBelow = world.topY(Math.floor(m.x), Math.floor(m.z));
    const distToGround = Math.max(0, m.y - groundBelow);

    // Compute live Roll angle for HUD
    this._up.set(0, 1, 0).applyQuaternion(m.quaternion);
    this._right.set(1, 0, 0).applyQuaternion(m.quaternion);
    const rollDeg = Math.round(-Math.atan2(this._right.y, this._up.y) * (180 / Math.PI));
    const rotSpeedDeg = Math.round(this.rollVel * (180 / Math.PI));

    // Update HUD telemetry
    if (this.hudEl && !this.hudEl.classList.contains('hidden')) {
      const spdEl = document.getElementById('mhud-spd');
      const altEl = document.getElementById('mhud-alt');
      const distEl = document.getElementById('mhud-dist');
      const rollEl = document.getElementById('mhud-roll');
      const rotSpdEl = document.getElementById('mhud-rot-spd');
      const boostBadge = document.getElementById('mhud-boost-badge');
      const warningEl = document.getElementById('mhud-impact-warning');

      if (spdEl) spdEl.textContent = Math.round(m.speed * 3.6);
      if (altEl) altEl.textContent = Math.round(m.y);
      if (distEl) distEl.textContent = Math.round(distToGround);
      if (rollEl) rollEl.textContent = (rollDeg >= 0 ? '+' : '') + rollDeg;
      if (rotSpdEl) rotSpdEl.textContent = (rotSpeedDeg >= 0 ? '+' : '') + rotSpeedDeg;

      if (boostBadge) {
        if (isBoost) boostBadge.classList.remove('hidden');
        else boostBadge.classList.add('hidden');
      }

      if (warningEl) {
        if (distToGround < 12.0 || (this._forward.y < -0.35 && distToGround < 25.0)) warningEl.classList.remove('hidden');
        else warningEl.classList.add('hidden');
      }
    }

    // 5. Smooth Camera Placement with Aerodynamic Lag & Slerp
    if (m.cameraMode === 'FIRST_PERSON') {
      m.mesh.visible = false;
      const noseOffset = new THREE.Vector3(0, 0, -1.45).applyQuaternion(m.quaternion);
      const targetCamPos = new THREE.Vector3(m.x + noseOffset.x, m.y + noseOffset.y, m.z + noseOffset.z);

      // Smooth position lag
      this.camPos.lerp(targetCamPos, Math.min(1.0, dt * 18.0));
      camera.position.copy(this.camPos);

      // Smooth orientation lag (slerp)
      this.camQuat.slerp(m.quaternion, Math.min(1.0, dt * 12.0));
      camera.quaternion.copy(this.camQuat);
    } else {
      m.mesh.visible = true;
      const chaseOffset = new THREE.Vector3(0, 0.9, 4.6).applyQuaternion(m.quaternion);
      const targetCamPos = new THREE.Vector3(m.x + chaseOffset.x, m.y + chaseOffset.y, m.z + chaseOffset.z);

      this.camPos.lerp(targetCamPos, Math.min(1.0, dt * 12.0));
      camera.position.copy(this.camPos);

      this.camQuat.slerp(m.quaternion, Math.min(1.0, dt * 9.0));
      camera.quaternion.copy(this.camQuat);
    }
    camera.updateMatrixWorld();

    return true;
  }
}
