import { buildBox, buildCylinder, buildSphere } from '../engine/renderer/Mesh.js';
import { mat4FromTranslationYRotation } from '../engine/renderer/Camera.js';

/** Third-person player character controller */
export class CharacterController {
  constructor(renderer, physics, input, audio) {
    this.renderer = renderer;
    this.physics  = physics;
    this.input    = input;
    this.audio    = audio;

    // Physics body
    this.body = physics.createBody({
      x: 5, y: 1.0, z: 5,
      halfW: 0.3, halfH: 0.9, halfD: 0.3,
      mass: 80, restitution: 0.0, friction: 0.8,
    });
    this.body.tag = 'player';

    // Camera
    this.camYaw   = 0;
    this.camPitch = -0.3;
    this.camDist  = 5.5;
    this.camY     = 1.5;  // camera height offset

    // State
    this.speed   = 5;
    this.sprint  = 9;
    this.jumpV   = 8;
    this.inVehicle = null;
    this.animTime  = 0;

    // Meshes
    this._buildMeshes();

    // Footstep timer
    this._footTimer = 0;
  }

  _buildMeshes() {
    const r = this.renderer;
    const mat = r.getMaterial('npc');

    // Body parts
    this._torsoMesh = r.createMesh(...Object.values(buildBox(0.45, 0.55, 0.23)));
    this._headMesh  = r.createMesh(...Object.values(buildSphere(0.19, 8, 6)));
    this._lArmMesh  = r.createMesh(...Object.values(buildCylinder(0.08, 0.52, 6)));
    this._rArmMesh  = r.createMesh(...Object.values(buildCylinder(0.08, 0.52, 6)));
    this._lLegMesh  = r.createMesh(...Object.values(buildCylinder(0.09, 0.56, 6)));
    this._rLegMesh  = r.createMesh(...Object.values(buildCylinder(0.09, 0.56, 6)));
    this._skinMat   = mat;
    this._darkMat   = { ...mat, albedoTex: r.textures.makeColorTex(30,60,120), albedo:[1,1,1] };
  }

  update(dt) {
    if (this.inVehicle) {
      this._updateInVehicle(dt);
      return;
    }

    const b = this.body;
    this.animTime += dt;

    // Camera rotation
    if (this.input.pointerLocked) {
      this.camYaw   -= this.input.mouse.dx * 0.002;
      this.camPitch -= this.input.mouse.dy * 0.002;
      this.camPitch  = Math.max(-1.4, Math.min(0.5, this.camPitch));
    }

    // Camera zoom with scroll
    this.camDist -= this.input.mouseScrollDelta * 0.01;
    this.camDist   = Math.max(2, Math.min(12, this.camDist));

    // Movement
    const axis    = this.input.getAxis();
    const isSprint= this.input.isPressed('ShiftLeft') || this.input.isPressed('ShiftRight');
    const spd     = isSprint ? this.sprint : this.speed;
    const isMoving= Math.abs(axis.x) + Math.abs(axis.y) > 0.01;

    const camCos = Math.cos(this.camYaw);
    const camSin = Math.sin(this.camYaw);
    const fwd = [-camSin, 0, -camCos];
    const rgt = [ camCos, 0, -camSin];

    let moveX = (rgt[0]*axis.x + fwd[0]*axis.y) * spd;
    let moveZ = (rgt[2]*axis.x + fwd[2]*axis.y) * spd;

    b.vx = moveX;
    b.vz = moveZ;

    // Face direction of movement
    if (isMoving) {
      const targetRy = Math.atan2(moveX, moveZ);
      const diff = ((targetRy - b.ry) + Math.PI*3) % (Math.PI*2) - Math.PI;
      b.ry += diff * Math.min(1, dt * 12);
    }

    // Jump
    if (this.input.isDown('Space') && b.onGround) {
      b.vy = this.jumpV;
      this.audio.playSFX('jump', 0.5);
    }

    // Footsteps
    if (isMoving && b.onGround) {
      this._footTimer -= dt;
      if (this._footTimer <= 0) {
        this._footTimer = isSprint ? 0.28 : 0.45;
        this.audio.playSFX('footstep', 0.4, (Math.random()-0.5)*400);
      }
    }

    // Update camera position
    this._updateCamera();
  }

  _updateCamera() {
    const b = this.body;
    const cx = b.x + Math.sin(this.camYaw) * Math.cos(this.camPitch) * this.camDist;
    const cy = b.y + this.camY - Math.sin(this.camPitch) * this.camDist;
    const cz = b.z + Math.cos(this.camYaw) * Math.cos(this.camPitch) * this.camDist;
    this.renderer.camera.lookAt(
      [cx, cy, cz],
      [b.x, b.y + this.camY, b.z],
      [0, 1, 0]
    );
  }

  _updateInVehicle(dt) {
    const v = this.inVehicle;
    // Camera follow vehicle
    if (this.input.pointerLocked) {
      this.camYaw   -= this.input.mouse.dx * 0.002;
      this.camPitch -= this.input.mouse.dy * 0.002;
      this.camPitch  = Math.max(-0.8, Math.min(0.3, this.camPitch));
    }
    const yaw = v.ry + this.camYaw;
    const cx = v.x + Math.sin(yaw) * Math.cos(this.camPitch) * this.camDist;
    const cy = v.y + 1.8 - Math.sin(this.camPitch) * this.camDist;
    const cz = v.z + Math.cos(yaw) * Math.cos(this.camPitch) * this.camDist;
    this.renderer.camera.lookAt([cx,cy,cz],[v.x,v.y+1.2,v.z],[0,1,0]);

    // Sync player position to vehicle
    this.body.x = v.x; this.body.y = v.y; this.body.z = v.z;
  }

  /** Draw the character (procedural animation) */
  draw() {
    if (this.inVehicle) return;

    const b = this.body;
    const r = this.renderer;
    const t = this.animTime;
    const isMoving = Math.abs(b.vx) + Math.abs(b.vz) > 0.5;
    const walkCycle = isMoving ? t * (Math.abs(b.vx)+Math.abs(b.vz)) * 0.4 : 0;

    const bCos = Math.cos(b.ry), bSin = Math.sin(b.ry);
    const m = (dx,dy,dz,ry,sx=1,sy=1,sz=1) => {
      const out = new Float32Array(16);
      const wx = b.x + bCos*dx + bSin*dz;
      const wz = b.z - bSin*dx + bCos*dz;
      mat4FromTranslationYRotation(out, wx, b.y+dy, wz, b.ry+ry, sx, sy, sz);
      return out;
    };

    // Torso
    r.addDrawCall(this._torsoMesh, m(0,1.1,0,0), this._darkMat);
    // Head
    r.addDrawCall(this._headMesh,  m(0,1.8,0,0), this._skinMat);
    // Arms
    const armSwing = isMoving ? Math.sin(walkCycle)*0.4 : 0;
    r.addDrawCall(this._lArmMesh, m(-0.3,1.1,0, armSwing), this._darkMat);
    r.addDrawCall(this._rArmMesh, m( 0.3,1.1,0,-armSwing), this._darkMat);
    // Legs
    const legSwing = isMoving ? Math.sin(walkCycle)*0.35 : 0;
    r.addDrawCall(this._lLegMesh, m(-0.15,0.55,0, legSwing), this._darkMat);
    r.addDrawCall(this._rLegMesh, m( 0.15,0.55,0,-legSwing), this._darkMat);
  }

  get position() { return this.body; }

  enterVehicle(vehicle) {
    this.inVehicle = vehicle;
    vehicle.occupied = true;
    this.camYaw = 0;
    this.audio.playSFX('car_enter', 0.7);
    document.getElementById('vhud').style.display = 'block';
    document.getElementById('ctrl').style.display = 'none';
  }

  exitVehicle() {
    if (!this.inVehicle) return;
    const v = this.inVehicle;
    this.body.x = v.x + Math.sin(v.ry+Math.PI/2)*2.5;
    this.body.z = v.z + Math.cos(v.ry+Math.PI/2)*2.5;
    this.body.y = v.y + 0.5;
    this.body.vx = 0; this.body.vy = 0; this.body.vz = 0;
    v.occupied = false;
    this.inVehicle = null;
    document.getElementById('vhud').style.display = 'none';
    document.getElementById('ctrl').style.display = 'block';
  }
}
