import { buildBox, buildCylinder } from '../engine/renderer/Mesh.js';
import { mat4FromTranslationYRotation } from '../engine/renderer/Camera.js';
import { VehicleBody } from '../engine/physics/PhysicsWorld.js';

/** Vehicle rendering + control */
export class VehicleController {
  constructor(renderer, physics, audio, x = 0, y = 1, z = 0, ry = 0) {
    this.renderer = renderer;
    this.physics  = physics;
    this.audio    = audio;

    this.body = new VehicleBody(physics);
    this.body.x = x; this.body.y = y; this.body.z = z; this.body.ry = ry;
    this.body.tag = 'vehicle';

    // Car color (random per vehicle)
    const colors = [[0.7,0.1,0.1],[0.1,0.2,0.7],[0.1,0.6,0.2],[0.7,0.6,0.1],[0.8,0.8,0.8],[0.05,0.05,0.05]];
    this.carColor = colors[Math.floor(Math.random()*colors.length)];

    this._buildMeshes();
    this._engineTimer = 0;
  }

  _buildMeshes() {
    const r = this.renderer;
    const mat = r.getMaterial('car');

    // Chassis: main body
    this._bodyMesh   = r.createMesh(...Object.values(buildBox(2.0, 0.6, 4.5, 1)));
    // Cabin
    this._cabinMesh  = r.createMesh(...Object.values(buildBox(1.7, 0.6, 2.3, 1)));
    // Wheels (4)
    this._wheelMesh  = r.createMesh(...Object.values(buildCylinder(0.38, 0.28, 10, 1)));

    // Materials
    const bColor = this.carColor;
    this._bodyMat = { ...mat, albedo: bColor, albedoTex: r.textures.get('white') };
    this._glassMat = { albedoTex: r.textures.makeColorTex(30,50,80,200), roughness:0.05, metallic:0, emissive:0, uvScale:1, albedo:[0.3,0.4,0.5] };
    this._wheelMat = { albedoTex: r.textures.makeColorTex(15,15,15), roughness:0.9, metallic:0, emissive:0, uvScale:1, albedo:[1,1,1] };
    this._headlightMat = { albedoTex: r.textures.makeColorTex(255,255,200), roughness:0.1, metallic:0, emissive:4.0, uvScale:1, albedo:[1,1,1] };
    this._taillightMat = { albedoTex: r.textures.makeColorTex(200,20,20), roughness:0.1, metallic:0, emissive:3.0, uvScale:1, albedo:[1,1,1] };

    // Simple headlight mesh
    this._headMesh = r.createMesh(...Object.values(buildBox(0.3, 0.15, 0.1, 1)));
    this._tailMesh = r.createMesh(...Object.values(buildBox(0.4, 0.15, 0.08, 1)));
  }

  update(dt, input) {
    const b = this.body;
    if (!b.occupied) {
      // AI movement for parked/idle cars (slight random drift)
      return;
    }

    // Input handling
    const axis = input.getAxis();
    b.throttle = axis.y; // W/S
    b.steer    = -axis.x; // A/D
    b.brake    = input.isPressed('Space') ? 1.0 : 0.0;

    b.update(dt);

    // Engine sounds
    this._engineTimer -= dt;
    if (this._engineTimer <= 0 && this.audio) {
      this._engineTimer = 0.08;
      const rpm = 0.3 + Math.abs(b.throttle) * 0.7 + b.getSpeedKmh() / 200;
      this.audio.playSFX('engine_idle', 0.2 * rpm, (rpm-1)*800);
    }

    // Update HUD
    const spdEl = document.getElementById('spd');
    if (spdEl) spdEl.textContent = Math.round(b.getSpeedKmh());
    const gearEl = document.getElementById('gear');
    if (gearEl) gearEl.textContent = b.throttle >= 0 ? 'D' : 'R';

    // Add headlight glow
    const c = Math.cos(b.ry), s = Math.sin(b.ry);
    this.renderer.addLight(b.x+s*2.2, b.y+0.5, b.z+c*2.2, 1.0,0.9,0.7, 35);
    this.renderer.addLight(b.x-s*0.5+0.8*c, b.y+0.5, b.z-c*0.5-0.8*s, 1.0,0.9,0.7, 35);
  }

  updateNPC(dt, targetX, targetZ) {
    const b = this.body;
    const dx = targetX - b.x, dz = targetZ - b.z;
    const dist = Math.sqrt(dx*dx+dz*dz);
    if (dist < 3) { b.throttle=0; b.brake=1; b.steer=0; }
    else {
      const targetAngle = Math.atan2(dx, dz);
      let diff = ((targetAngle - b.ry) + Math.PI*3) % (Math.PI*2) - Math.PI;
      b.steer = Math.max(-1, Math.min(1, diff * 1.5));
      b.throttle = 0.4;
      b.brake = 0;
    }
    b.update(dt);
  }

  draw() {
    const b = this.body;
    const r = this.renderer;
    const c = Math.cos(b.ry), s = Math.sin(b.ry);

    // Transform local offset to world coords
    const m = (lx,ly,lz,ry_,sx=1,sy=1,sz=1) => {
      const out = new Float32Array(16);
      const wx = b.x + c*lx + s*lz;
      const wz = b.z - s*lx + c*lz;
      mat4FromTranslationYRotation(out, wx, b.y+ly, wz, b.ry+ry_, sx, sy, sz);
      return out;
    };

    // Main body
    r.addDrawCall(this._bodyMesh,  m(0, 0.3, 0, 0), this._bodyMat);
    // Cabin
    r.addDrawCall(this._cabinMesh, m(0, 0.85, -0.1, 0), this._glassMat);

    // Wheels
    const ws = b.wheels;
    const wAngleFL = ws[0].angle, wAngleFR = ws[1].angle;
    for (let i=0;i<4;i++){
      const w = b.wheels[i];
      const lx = w.localX, lz = w.localZ;
      const wRy = (i<2) ? w.angle : 0;
      // Wheel spin via pitch rotation (simplified: just render with spin)
      r.addDrawCall(this._wheelMesh, m(lx,-0.15,lz, Math.PI/2), this._wheelMat);
    }

    // Headlights
    r.addDrawCall(this._headMesh, m(-0.65, 0.3, 2.25, 0), this._headlightMat);
    r.addDrawCall(this._headMesh, m( 0.65, 0.3, 2.25, 0), this._headlightMat);
    // Taillights
    r.addDrawCall(this._tailMesh, m(-0.65, 0.3,-2.25,0), this._taillightMat);
    r.addDrawCall(this._tailMesh, m( 0.65, 0.3,-2.25,0), this._taillightMat);
  }

  get position() { return this.body; }
}
