/** Physics world - rigid bodies, character controller, vehicle physics */

const GRAVITY = -18;
const FIXED_STEP = 1 / 60;

export class PhysicsWorld {
  constructor() {
    this._bodies = [];
    this._staticBoxes = [];  // AABB obstacles [{minX,minY,minZ,maxX,maxY,maxZ}]
    this._accumulator = 0;
    this._groundHeight = 0; // default ground Y

    // Spatial grid for broad-phase
    this._gridCellSize = 20;
    this._grid = new Map();
  }

  addStaticBox(minX,minY,minZ,maxX,maxY,maxZ) {
    this._staticBoxes.push({minX,minY,minZ,maxX,maxY,maxZ});
    this._insertGrid({minX,minY,minZ,maxX,maxY,maxZ});
  }

  _insertGrid(box) {
    const cs = this._gridCellSize;
    const x0=Math.floor(box.minX/cs), x1=Math.floor(box.maxX/cs);
    const z0=Math.floor(box.minZ/cs), z1=Math.floor(box.maxZ/cs);
    for (let x=x0;x<=x1;x++) for (let z=z0;z<=z1;z++) {
      const key = `${x},${z}`;
      if (!this._grid.has(key)) this._grid.set(key,[]);
      this._grid.get(key).push(box);
    }
  }

  _getCellBoxes(x, z) {
    const cs = this._gridCellSize;
    const key = `${Math.floor(x/cs)},${Math.floor(z/cs)}`;
    return this._grid.get(key) || [];
  }

  createBody(config = {}) {
    const body = {
      x: config.x || 0, y: config.y || 0, z: config.z || 0,
      vx: 0, vy: 0, vz: 0,
      ry: config.ry || 0,  // yaw rotation
      mass: config.mass ?? 1,
      restitution: config.restitution ?? 0.1,
      friction: config.friction ?? 0.85,
      halfW: config.halfW ?? 0.25,  // AABB half sizes
      halfH: config.halfH ?? 0.9,
      halfD: config.halfD ?? 0.25,
      onGround: false,
      type: config.type || 'box',  // 'box', 'capsule', 'vehicle'
      isStatic: config.isStatic || false,
    };
    this._bodies.push(body);
    return body;
  }

  removeBody(body) {
    const i = this._bodies.indexOf(body);
    if (i >= 0) this._bodies.splice(i, 1);
  }

  update(dt) {
    this._accumulator += dt;
    const maxSteps = 3;
    let steps = 0;
    while (this._accumulator >= FIXED_STEP && steps < maxSteps) {
      this._step(FIXED_STEP);
      this._accumulator -= FIXED_STEP;
      steps++;
    }
    if (this._accumulator > FIXED_STEP * maxSteps) this._accumulator = 0;
  }

  _step(dt) {
    for (const b of this._bodies) {
      if (b.isStatic) continue;

      // Gravity
      b.vy += GRAVITY * dt;

      // Integrate
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;

      // Horizontal damping (air resistance)
      const horDamp = b.onGround ? b.friction : 0.98;
      b.vx *= horDamp;
      b.vz *= horDamp;

      // Collision resolution
      this._resolveGround(b);
      this._resolveStatics(b);
    }
  }

  _resolveGround(b) {
    const groundY = this._getGroundY(b.x, b.z);
    const bottom = b.y - b.halfH;
    if (bottom < groundY) {
      b.y = groundY + b.halfH;
      if (b.vy < 0) {
        b.vy = -b.vy * b.restitution;
        if (Math.abs(b.vy) < 0.5) b.vy = 0;
      }
      b.onGround = true;
    } else {
      b.onGround = false;
    }
  }

  _getGroundY(x, z) {
    // Check static boxes below for height
    let maxY = this._groundHeight;
    const boxes = this._getCellBoxes(x, z);
    for (const box of boxes) {
      if (x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ) {
        if (box.maxY > maxY) maxY = box.maxY;
      }
    }
    return maxY;
  }

  _resolveStatics(b) {
    const boxes = this._getCellBoxes(b.x, b.z);
    for (const box of boxes) {
      this._resolveBoxVsAABB(b, box);
    }
  }

  _resolveBoxVsAABB(b, box) {
    // AABB vs AABB overlap test
    const bMinX=b.x-b.halfW, bMaxX=b.x+b.halfW;
    const bMinY=b.y-b.halfH, bMaxY=b.y+b.halfH;
    const bMinZ=b.z-b.halfD, bMaxZ=b.z+b.halfD;

    if (bMaxX < box.minX || bMinX > box.maxX) return;
    if (bMaxY < box.minY || bMinY > box.maxY) return;
    if (bMaxZ < box.minZ || bMinZ > box.maxZ) return;

    // Find minimum penetration axis
    const overX = Math.min(bMaxX-box.minX, box.maxX-bMinX);
    const overY = Math.min(bMaxY-box.minY, box.maxY-bMinY);
    const overZ = Math.min(bMaxZ-box.minZ, box.maxZ-bMinZ);

    if (overY < overX && overY < overZ) {
      // Resolve vertically
      if (b.y < (box.minY + box.maxY) / 2) {
        b.y -= overY;
        if (b.vy > 0) b.vy = 0;
      } else {
        b.y += overY;
        b.onGround = true;
        if (b.vy < 0) b.vy = 0;
      }
    } else if (overX < overZ) {
      if (b.x < (box.minX + box.maxX) / 2) {
        b.x -= overX; b.vx = Math.min(b.vx, 0);
      } else {
        b.x += overX; b.vx = Math.max(b.vx, 0);
      }
    } else {
      if (b.z < (box.minZ + box.maxZ) / 2) {
        b.z -= overZ; b.vz = Math.min(b.vz, 0);
      } else {
        b.z += overZ; b.vz = Math.max(b.vz, 0);
      }
    }
  }

  /** Raycast downward from point, return hit Y or null */
  raycastDown(x, startY, z) {
    let hitY = null;
    const boxes = this._getCellBoxes(x, z);
    for (const box of boxes) {
      if (x < box.minX || x > box.maxX) continue;
      if (z < box.minZ || z > box.maxZ) continue;
      if (box.maxY <= startY && (hitY === null || box.maxY > hitY)) {
        hitY = box.maxY;
      }
    }
    return hitY;
  }

  /** Find nearest body of given type within radius */
  findNearest(x, z, radius, tag) {
    let nearest = null, minDist2 = radius * radius;
    for (const b of this._bodies) {
      if (b.tag !== tag) continue;
      const dx = b.x-x, dz = b.z-z;
      const d2 = dx*dx+dz*dz;
      if (d2 < minDist2) { minDist2=d2; nearest=b; }
    }
    return nearest;
  }
}

// ─── Vehicle physics ──────────────────────────────────────────────────────────
export class VehicleBody {
  constructor(physics) {
    this._physics = physics;
    // Chassis
    this.x=0; this.y=0.6; this.z=0;
    this.vx=0; this.vy=0; this.vz=0;
    this.ry=0; this.angVel=0;

    // Wheels [FL,FR,BL,BR]
    this.wheels = [
      { localX:-1, localZ:1.6,  compression:0, vel:0, angle:0, spin:0 },
      { localX: 1, localZ:1.6,  compression:0, vel:0, angle:0, spin:0 },
      { localX:-1, localZ:-1.6, compression:0, vel:0, angle:0, spin:0 },
      { localX: 1, localZ:-1.6, compression:0, vel:0, angle:0, spin:0 },
    ];

    this.steer = 0;      // -1 to 1
    this.throttle = 0;   // -1 to 1
    this.brake = 0;      // 0 to 1

    this.maxSpeed = 55;  // m/s ≈ 200 km/h
    this.engineForce = 18000;
    this.brakeForce = 30000;
    this.mass = 1200;
    this.wheelBase = 3.2;
    this.springK = 35000;
    this.damperK = 3500;
    this.restLength = 0.5;
    this.maxCompression = 0.25;
    this.onGround = false;
    this.tag = 'vehicle';
    this.occupied = false;
    this._physics = physics;
    // NOTE: VehicleBody manages its own physics - not added to physics._bodies
  }

  update(dt) {
    const c = Math.cos(this.ry), s = Math.sin(this.ry);
    const speed = Math.sqrt(this.vx*this.vx + this.vz*this.vz);

    // Suspension + ground contact
    let wheelsGrounded = 0;
    let totalSuspY = 0;

    for (const w of this.wheels) {
      const wx = this.x + c*w.localX - s*w.localZ;
      const wz = this.z + s*w.localX + c*w.localZ;
      const groundY = this._physics._getGroundY(wx, wz);
      const wheelWorldY = this.y + w.localZ * 0.0; // simplified
      const suspY = this.y - 0.5; // bottom of chassis
      const compression = Math.max(0, Math.min(this.maxCompression, groundY + this.restLength - suspY));
      w.compression = compression;

      if (compression > 0.01) {
        wheelsGrounded++;
        const springF = (compression * this.springK - w.vel * this.damperK) / this.mass;
        this.vy += springF * dt;
        totalSuspY += groundY + this.restLength;
        w.vel = (compression - w.compression) / dt;
      }
      // Wheel spin
      w.spin += speed * dt * 6;
    }

    this.onGround = wheelsGrounded > 1;

    // Gravity
    this.vy += GRAVITY * dt;
    if (this.onGround && this.vy < 0) {
      const targetY = totalSuspY / Math.max(1, wheelsGrounded);
      this.y += (targetY - this.y) * 0.3;
      if (this.vy < -5) this.vy = -5;
      this.vy *= 0.5;
    }

    if (this.onGround) {
      // Engine force
      const fwd = this.throttle * this.engineForce / this.mass;
      this.vx += s * fwd * dt;
      this.vz += c * fwd * dt;

      // Brake
      if (this.brake > 0) {
        const brakeMag = Math.min(speed, this.brake * this.brakeForce / this.mass * dt);
        if (speed > 0.01) {
          this.vx -= (this.vx/speed) * brakeMag;
          this.vz -= (this.vz/speed) * brakeMag;
        }
      }

      // Steering
      const steerAngle = this.steer * Math.PI * 0.12;
      const turnRate = speed * Math.sin(steerAngle) / this.wheelBase;
      this.ry += this.throttle > 0 ? turnRate * dt : -turnRate * dt;
      this.angVel = turnRate;

      // Friction / lateral damping
      const forward = [s, 0, c];
      const vDotF = this.vx*forward[0] + this.vz*forward[2];
      const vLat = [this.vx - vDotF*forward[0], 0, this.vz - vDotF*forward[2]];
      this.vx -= vLat[0] * 0.15;
      this.vz -= vLat[2] * 0.15;

      // Speed limit
      const sp = Math.sqrt(this.vx*this.vx+this.vz*this.vz);
      if (sp > this.maxSpeed) { this.vx *= this.maxSpeed/sp; this.vz *= this.maxSpeed/sp; }

      // Rolling friction
      this.vx *= 0.97;
      this.vz *= 0.97;
    }

    // Integrate position
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;

    // Ground clamp
    const groundY = this._physics._getGroundY(this.x, this.z);
    if (this.y < groundY + 0.45) {
      this.y = groundY + 0.45;
      if (this.vy < 0) this.vy = 0;
    }
  }

  getSpeedKmh() {
    return Math.sqrt(this.vx*this.vx+this.vz*this.vz) * 3.6;
  }
}
