import { buildBox, buildCylinder, buildSphere } from '../engine/renderer/Mesh.js';
import { mat4FromTranslationYRotation } from '../engine/renderer/Camera.js';

/** NPC (pedestrian) AI controller */
export class NPCController {
  constructor(renderer, physics, x, z) {
    this.renderer = renderer;
    this.physics  = physics;

    this.body = physics.createBody({
      x, y: 0.9, z,
      halfW: 0.2, halfH: 0.9, halfD: 0.2,
      mass: 70, restitution: 0, friction: 0.85,
    });
    this.body.tag = 'npc';

    // NPC state
    this.state     = 'walk'; // 'walk', 'idle', 'wait'
    this.targetX   = x + (Math.random()-0.5)*30;
    this.targetZ   = z + (Math.random()-0.5)*30;
    this.speed     = 1.2 + Math.random()*0.8;
    this.animTime  = Math.random()*6.28;
    this.idleTimer = 0;
    this.walkTimer = 3 + Math.random()*5;

    this._buildMeshes();
  }

  _buildMeshes() {
    const r = this.renderer;
    // Randomize NPC appearance
    const skinR = 160+Math.floor(Math.random()*80), skinG = 110+Math.floor(Math.random()*60), skinB = 80+Math.floor(Math.random()*40);
    const clothR = Math.floor(Math.random()*150), clothG = Math.floor(Math.random()*150), clothB = Math.floor(Math.random()*200);

    const skinTex  = r.textures.makeColorTex(skinR, skinG, skinB);
    const clothTex = r.textures.makeColorTex(clothR, clothG, clothB);

    this._skinMat  = { albedoTex: skinTex,  roughness:0.9, metallic:0, emissive:0, uvScale:1, albedo:[1,1,1] };
    this._clothMat = { albedoTex: clothTex, roughness:0.9, metallic:0, emissive:0, uvScale:1, albedo:[1,1,1] };

    // Shared meshes (cached by renderer)
    this._torsoMesh = r.createMesh(...Object.values(buildBox(0.4, 0.5, 0.22)));
    this._headMesh  = r.createMesh(...Object.values(buildSphere(0.16, 6, 5)));
    this._lLegMesh  = r.createMesh(...Object.values(buildCylinder(0.07, 0.48, 5)));
    this._rLegMesh  = r.createMesh(...Object.values(buildCylinder(0.07, 0.48, 5)));
  }

  update(dt) {
    const b = this.body;
    this.animTime += dt;

    if (this.state === 'idle') {
      this.idleTimer -= dt;
      b.vx = 0; b.vz = 0;
      if (this.idleTimer <= 0) {
        this.state = 'walk';
        this.walkTimer = 3 + Math.random()*5;
        // Pick new random target
        this.targetX = b.x + (Math.random()-0.5)*40;
        this.targetZ = b.z + (Math.random()-0.5)*40;
      }
    } else {
      this.walkTimer -= dt;
      const dx = this.targetX - b.x, dz = this.targetZ - b.z;
      const dist = Math.sqrt(dx*dx+dz*dz);

      if (dist < 1.5 || this.walkTimer <= 0) {
        this.state = 'idle';
        this.idleTimer = 1 + Math.random()*3;
        b.vx = 0; b.vz = 0;
      } else {
        const norm = this.speed / dist;
        b.vx = dx * norm;
        b.vz = dz * norm;
        b.ry = Math.atan2(dx, dz);
      }
    }
  }

  draw() {
    const b = this.body;
    const r = this.renderer;
    const t = this.animTime;
    const isWalking = this.state === 'walk';
    const walkCycle = isWalking ? t * 2.8 : 0;

    const bCos = Math.cos(b.ry), bSin = Math.sin(b.ry);
    const m = (dx,dy,dz,ry_,sx=1,sy=1,sz=1) => {
      const out = new Float32Array(16);
      const wx = b.x + bCos*dx + bSin*dz;
      const wz = b.z - bSin*dx + bCos*dz;
      mat4FromTranslationYRotation(out, wx, b.y+dy, wz, b.ry+ry_, sx, sy, sz);
      return out;
    };

    r.addDrawCall(this._torsoMesh, m(0,0.95,0,0), this._clothMat);
    r.addDrawCall(this._headMesh,  m(0,1.6,0,0),  this._skinMat);
    const ls = isWalking ? Math.sin(walkCycle)*0.3  : 0;
    const rs = isWalking ? Math.sin(walkCycle+Math.PI)*0.3 : 0;
    r.addDrawCall(this._lLegMesh, m(-0.12,0.48,0, ls), this._clothMat);
    r.addDrawCall(this._rLegMesh, m( 0.12,0.48,0, rs), this._clothMat);
  }
}

/** NPC Manager - spawns and updates multiple NPCs */
export class NPCManager {
  constructor(renderer, physics) {
    this.renderer = renderer;
    this.physics  = physics;
    this._npcs = [];
  }

  spawn(spawns, count = 40) {
    const used = Math.min(count, spawns.length);
    for (let i = 0; i < used; i++) {
      const sp = spawns[i];
      this._npcs.push(new NPCController(this.renderer, this.physics, sp.x, sp.z));
    }
  }

  update(dt) {
    for (const npc of this._npcs) npc.update(dt);
  }

  draw() {
    const cam = this.renderer.camera;
    for (const npc of this._npcs) {
      const b = npc.body;
      if (!cam.frustumCullSphere(b.x, b.y, b.z, 2.0)) continue;
      npc.draw();
    }
  }
}
