import { buildBox, buildPlane, buildCylinder, buildSphere } from '../engine/renderer/Mesh.js';
import { mat4FromTranslationYRotation } from '../engine/renderer/Camera.js';

const BLOCK_SIZE  = 72;   // city block size (m)
const ROAD_WIDTH  = 14;   // road width (m)
const GRID_SIZE   = 20;   // number of blocks per side
const CITY_OFFSET = -(BLOCK_SIZE + ROAD_WIDTH) * GRID_SIZE / 2;

/** Seeded pseudo-random */
function rand(seed) {
  const x = Math.sin(seed) * 43758.5453;
  return x - Math.floor(x);
}

export class CityGenerator {
  constructor(renderer, physics) {
    this.renderer = renderer;
    this.physics  = physics;

    this._meshCache = new Map();
    this._streetLights = [];  // [{x,y,z}] for rendering lights
    this._vehicleSpawns = []; // spawn positions for vehicles
    this._npcSpawns = [];     // spawn positions for NPCs

    this._buildingData = []; // [{mesh, mat, modelMatrix, aabb}]
    this._roadData     = [];
    this._groundData   = [];
    this._propData     = [];
    this._waterData    = [];
    this._parkData     = [];

    this._materials    = {};
  }

  async generate(progressCb) {
    const rnd = renderer => renderer; // local alias
    const report = (pct, msg) => progressCb && progressCb(pct, msg);

    report(0.1, 'Building materials…');
    this._initMaterials();

    report(0.2, 'Generating terrain…');
    this._buildGround();

    report(0.35, 'Laying roads…');
    this._buildRoads();

    report(0.5, 'Constructing buildings…');
    this._buildCity();

    report(0.7, 'Adding vegetation & props…');
    this._buildVegetation();
    this._buildProps();

    report(0.8, 'Placing water bodies…');
    this._buildWater();

    report(0.9, 'Calculating physics colliders…');
    this._buildPhysicsColliders();

    report(1.0, 'City complete.');
    return this;
  }

  _initMaterials() {
    const r = this.renderer;
    this._materials = {
      concrete:  r.getMaterial('concrete'),
      asphalt:   r.getMaterial('asphalt'),
      glass:     r.getMaterial('glass'),
      brick:     r.getMaterial('brick'),
      grass:     r.getMaterial('grass'),
      metal:     r.getMaterial('metal'),
      building:  r.getMaterial('building'),
      road:      r.getMaterial('road'),
    };
  }

  _getMesh(key, buildFn) {
    if (!this._meshCache.has(key)) {
      const { vertices, indices } = buildFn();
      const mesh = this.renderer.createMesh(vertices, indices);
      this._meshCache.set(key, mesh);
    }
    return this._meshCache.get(key);
  }

  _mat4(tx,ty,tz,ry,sx=1,sy=1,sz=1) {
    const m = new Float32Array(16);
    mat4FromTranslationYRotation(m,tx,ty,tz,ry,sx,sy,sz);
    return m;
  }

  // ─── Ground ─────────────────────────────────────────────────────────────
  _buildGround() {
    const totalSize = (BLOCK_SIZE + ROAD_WIDTH) * GRID_SIZE + ROAD_WIDTH;
    const mesh = this._getMesh('ground', () => buildPlane(totalSize+400, totalSize+400, 1, 1, 16));
    this._groundData.push({ mesh, mat: this._materials.grass, modelMatrix: this._mat4(0,0,0,0) });
  }

  // ─── Roads ──────────────────────────────────────────────────────────────
  _buildRoads() {
    const roadMesh = (w, l) => {
      const key = `road_${w}_${l}`;
      return this._getMesh(key, () => buildPlane(w, l, 1, Math.ceil(l/20), 4));
    };

    const step = BLOCK_SIZE + ROAD_WIDTH;
    const total = GRID_SIZE * step + ROAD_WIDTH;
    const halfTotal = total / 2;

    // Horizontal roads
    for (let row = 0; row <= GRID_SIZE; row++) {
      const z = CITY_OFFSET + row * step;
      const m = this._mat4(0, 0.01, z, 0, 1, 1, 1);
      // Scale to total width
      const w = total, l = ROAD_WIDTH;
      const mesh = roadMesh(w, l);
      this._roadData.push({ mesh, mat: this._materials.road, modelMatrix: m });
      // Sidewalks
      this._addSidewalk(0, 0.03, z - ROAD_WIDTH/2 - 1, w, 2);
      this._addSidewalk(0, 0.03, z + ROAD_WIDTH/2 + 1, w, 2);
    }
    // Vertical roads
    for (let col = 0; col <= GRID_SIZE; col++) {
      const x = CITY_OFFSET + col * step;
      const m = this._mat4(x, 0.01, 0, 0, 1, 1, 1);
      const mesh = roadMesh(ROAD_WIDTH, total);
      this._roadData.push({ mesh, mat: this._materials.road, modelMatrix: m });
      this._addSidewalk(x - ROAD_WIDTH/2 - 1, 0.03, 0, 2, total);
      this._addSidewalk(x + ROAD_WIDTH/2 + 1, 0.03, 0, 2, total);
    }

    // Streetlights along roads
    for (let row = 0; row <= GRID_SIZE; row++) {
      const z = CITY_OFFSET + row * step;
      for (let i = 0; i < GRID_SIZE; i++) {
        const x = CITY_OFFSET + i * step + step/2;
        this._streetLights.push({ x, y: 6, z: z + ROAD_WIDTH/2 + 1 });
        this._streetLights.push({ x, y: 6, z: z - ROAD_WIDTH/2 - 1 });
      }
    }
  }

  _addSidewalk(cx, y, cz, w, d) {
    const key = `sw_${Math.round(w)}_${Math.round(d)}`;
    const mesh = this._getMesh(key, () => buildPlane(w, d, 1, 1, 2));
    this._roadData.push({ mesh, mat: this._materials.concrete, modelMatrix: this._mat4(cx,y,cz,0) });
  }

  // ─── Buildings ──────────────────────────────────────────────────────────
  _buildCity() {
    const step = BLOCK_SIZE + ROAD_WIDTH;
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const blockX = CITY_OFFSET + col * step + ROAD_WIDTH/2 + BLOCK_SIZE/2;
        const blockZ = CITY_OFFSET + row * step + ROAD_WIDTH/2 + BLOCK_SIZE/2;
        const seed = row * GRID_SIZE + col;

        // Determine block type
        const distFromCenter = Math.sqrt(blockX*blockX + blockZ*blockZ);
        const type = distFromCenter < 150 ? 'skyscraper' :
                     distFromCenter < 350 ? 'office' :
                     rand(seed*7) > 0.7  ? 'park' : 'residential';

        if (type === 'park') {
          this._buildPark(blockX, blockZ, seed);
        } else {
          this._buildBlock(blockX, blockZ, seed, type);
        }

        // Vehicle spawn points
        if (seed % 5 === 0) {
          const sx = blockX + (rand(seed*3)-0.5)*BLOCK_SIZE*0.5;
          const sz = blockZ + (rand(seed*4)-0.5)*BLOCK_SIZE*0.5;
          this._vehicleSpawns.push({x:sx, y:1, z:sz, ry: rand(seed)*Math.PI*2});
        }
        // NPC spawns on sidewalks
        const nsz = CITY_OFFSET + row * step + 1;
        this._npcSpawns.push({ x: blockX + (rand(seed+17)-0.5)*20, y:0.9, z: nsz });
      }
    }
  }

  _buildBlock(cx, cz, seed, type) {
    const numBuildings = type === 'skyscraper' ? 1 : Math.floor(rand(seed)*2) + 2;
    const subGrid = Math.ceil(Math.sqrt(numBuildings));

    for (let i = 0; i < numBuildings; i++) {
      const si = Math.floor(i / subGrid), sj = i % subGrid;
      const subSize = BLOCK_SIZE / subGrid;
      const bx = cx - BLOCK_SIZE/2 + sj*subSize + subSize/2 + (rand(seed+i)-0.5)*4;
      const bz = cz - BLOCK_SIZE/2 + si*subSize + subSize/2 + (rand(seed+i+11)-0.5)*4;

      let h, w, d, matKey;
      if (type === 'skyscraper') {
        h = 80 + rand(seed*13)*160;
        w = 20 + rand(seed*7)*25;
        d = 20 + rand(seed*9)*25;
        matKey = rand(seed+2) > 0.5 ? 'glass' : 'building';
      } else if (type === 'office') {
        h = 20 + rand(seed*i+3)*60;
        w = 15 + rand(seed+i)*20;
        d = 15 + rand(seed+i+1)*20;
        matKey = rand(seed+i) > 0.4 ? 'building' : 'glass';
      } else {
        h = 6 + rand(seed*i+5)*10;
        w = 10 + rand(seed+i)*14;
        d = 8 + rand(seed+i+2)*12;
        matKey = rand(seed+i) > 0.5 ? 'brick' : 'concrete';
      }

      w = Math.min(w, subSize - 4); d = Math.min(d, subSize - 4);
      const mat = this._materials[matKey] || this._materials.building;
      this._placeBuilding(bx, bz, w, h, d, mat, seed+i);
    }
  }

  _placeBuilding(cx, cz, w, h, d, mat, seed) {
    const ry = rand(seed * 17) * Math.PI * 2;
    const key = `bld_${Math.round(w)}_${Math.round(h)}_${Math.round(d)}`;
    const mesh = this._getMesh(key, () => buildBox(w, h, d, 1));

    const m = this._mat4(cx, h/2, cz, ry);
    this._buildingData.push({ mesh, mat, modelMatrix: m,
      aabb: { cx, cy: h/2, cz, rx: w/2, ry_: h/2, rz: d/2 }
    });

    // Roof detail for tall buildings
    if (h > 30) {
      const roofW = w * 0.4, roofH = 8, roofD = d * 0.4;
      const key2 = `roof_${Math.round(roofW)}_${Math.round(roofH)}_${Math.round(roofD)}`;
      const roofMesh = this._getMesh(key2, () => buildBox(roofW, roofH, roofD, 1));
      this._buildingData.push({
        mesh: roofMesh, mat: this._materials.metal,
        modelMatrix: this._mat4(cx, h + roofH/2, cz, ry),
      });
    }

    // Window lights for tall buildings (emissive boxes)
    if (h > 20 && seed % 3 === 0) {
      this._streetLights.push({ x: cx, y: h*0.6, z: cz, r:1.0, g:0.95, b:0.7, radius: 25 });
    }
  }

  _buildPark(cx, cz, seed) {
    // Grass area
    const parkMesh = this._getMesh('park_base', () => buildPlane(BLOCK_SIZE-2, BLOCK_SIZE-2, 2, 2, 4));
    this._parkData.push({ mesh: parkMesh, mat: this._materials.grass, modelMatrix: this._mat4(cx,0.02,cz,0) });

    // Path through park
    const pathW = 3, pathL = BLOCK_SIZE - 4;
    const pathMesh = this._getMesh('park_path', () => buildPlane(pathW, pathL, 1, 4, 2));
    this._parkData.push({ mesh: pathMesh, mat: this._materials.concrete, modelMatrix: this._mat4(cx, 0.04, cz, 0) });

    // Trees
    const numTrees = 8 + Math.floor(rand(seed)*8);
    for (let i = 0; i < numTrees; i++) {
      const tx = cx + (rand(seed+i*3)-0.5)*(BLOCK_SIZE-10);
      const tz = cz + (rand(seed+i*3+1)-0.5)*(BLOCK_SIZE-10);
      this._placeTree(tx, tz, seed+i);
    }

    // Benches
    for (let i = 0; i < 4; i++) {
      const bx = cx + (i%2===0?-8:8), bz = cz + (i<2?-8:8);
      const bMesh = this._getMesh('bench', () => buildBox(1.8, 0.4, 0.5, 1));
      this._propData.push({ mesh: bMesh, mat: this._materials.metal,
        modelMatrix: this._mat4(bx, 0.2, bz, rand(seed+i)*Math.PI*2) });
    }
  }

  _buildVegetation() {
    // Trees along roads
    const step = BLOCK_SIZE + ROAD_WIDTH;
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const seed = (row * GRID_SIZE + col) * 31;
        if (rand(seed) > 0.4) continue;
        const x = CITY_OFFSET + col * step + ROAD_WIDTH/2 + rand(seed+1)*(BLOCK_SIZE-4);
        const z = CITY_OFFSET + row * step + (rand(seed+2) > 0.5 ? 1 : step-1);
        this._placeTree(x, z, seed);
      }
    }
  }

  _placeTree(x, z, seed) {
    const h = 4 + rand(seed) * 3;
    const hRounded = Math.round(h * 2) / 2; // 0.5m increments
    const trunkKey   = `tree_trunk_${hRounded}`;
    const foliageKey = `tree_foliage`;
    const trunkMesh   = this._getMesh(trunkKey,   () => buildCylinder(0.2, hRounded, 8, 1));
    const foliageMesh = this._getMesh(foliageKey, () => buildSphere(1.8, 8, 6));

    if (!this._trunkMat) {
      this._trunkMat   = { albedoTex: this.renderer.textures.makeColorTex(90,55,30),  roughness:0.9, metallic:0, emissive:0, uvScale:1, albedo:[1,1,1] };
      this._foliageMat = { albedoTex: this.renderer.textures.makeColorTex(30,100,30), roughness:1,   metallic:0, emissive:0, uvScale:1, albedo:[1,1,1] };
    }
    this._propData.push({ mesh: trunkMesh,   mat: this._trunkMat,   modelMatrix: this._mat4(x, hRounded/2, z, 0) });
    this._propData.push({ mesh: foliageMesh, mat: this._foliageMat, modelMatrix: this._mat4(x, hRounded+1.5, z, 0) });
  }

  _buildProps() {
    // Traffic lights at intersections
    const step = BLOCK_SIZE + ROAD_WIDTH;
    const poleMesh = this._getMesh('tl_pole', () => buildCylinder(0.06, 4.5, 6, 1));
    const lightMesh = this._getMesh('tl_box', () => buildBox(0.3, 0.8, 0.3, 1));

    for (let row = 0; row <= GRID_SIZE; row++) {
      for (let col = 0; col <= GRID_SIZE; col++) {
        const x = CITY_OFFSET + col * step;
        const z = CITY_OFFSET + row * step;
        const poleMat = { albedoTex: this.renderer.textures.makeColorTex(50,50,55), roughness:0.5, metallic:0.8, emissive:0, uvScale:1, albedo:[1,1,1] };

        this._propData.push({ mesh: poleMesh, mat: poleMat, modelMatrix: this._mat4(x, 2.25, z, 0) });
        // Light box (red/green)
        const redMat   = { albedoTex: this.renderer.textures.makeColorTex(20,20,20), emissiveTex: this.renderer.textures.makeColorTex(255,40,40), roughness:0.3, metallic:0, emissive:2.0, uvScale:1, albedo:[1,1,1] };
        this._propData.push({ mesh: lightMesh, mat: redMat, modelMatrix: this._mat4(x+0.3, 4.2, z, 0) });

        // Add light source
        this._streetLights.push({ x, y: 5, z, r:1.0, g:0.4, b:0.4, radius:18 });
      }
    }

    // Street lamp posts along roads
    const lampMesh = this._getMesh('lamp', () => buildCylinder(0.05, 5, 6, 1));
    const lampMat = { albedoTex: this.renderer.textures.makeColorTex(200,200,210), roughness:0.4, metallic:0.9, emissive:0, uvScale:1, albedo:[1,1,1] };
    for (const sl of this._streetLights.filter(l => l.r === undefined)) {
      this._propData.push({ mesh: lampMesh, mat: lampMat, modelMatrix: this._mat4(sl.x, 2.5, sl.z, 0) });
    }
  }

  _buildWater() {
    // River / water feature through the city
    const step = BLOCK_SIZE + ROAD_WIDTH;
    const waterW = ROAD_WIDTH * 2.5;
    const totalLen = GRID_SIZE * step;
    const waterMesh = this._getMesh('water', () => buildPlane(waterW, totalLen, 4, 32, 1));
    this._waterData.push({ mesh: waterMesh, mat: this._materials.concrete,
      modelMatrix: this._mat4(CITY_OFFSET + step * 5, -0.1, 0, 0), isWater: true });

    // Bridge over water where roads cross it
    for (let row = 0; row <= GRID_SIZE; row++) {
      const z = CITY_OFFSET + row * step;
      const bridgeMesh = this._getMesh('bridge', () => buildBox(waterW + 2, 0.3, ROAD_WIDTH + 2, 1));
      const bMat = { albedoTex: this.renderer.textures.get('concrete_albedo'), roughness:0.9, metallic:0, emissive:0, uvScale:2, albedo:[1,1,1] };
      this._groundData.push({ mesh: bridgeMesh, mat: bMat,
        modelMatrix: this._mat4(CITY_OFFSET + step * 5, 0.15, z, 0) });
    }
  }

  _buildPhysicsColliders() {
    // Add building colliders
    for (const bd of this._buildingData) {
      if (!bd.aabb) continue;
      const a = bd.aabb;
      this.physics.addStaticBox(
        a.cx - a.rx, 0, a.cz - a.rz,
        a.cx + a.rx, a.cy * 2, a.cz + a.rz
      );
    }

    // Road surface colliders (flat, just a large ground plane)
    // Ground physics is handled by getGroundY returning 0 by default
  }

  /** Register all draw calls for this frame */
  draw(camera) {
    const r = this.renderer;
    const cam = r.camera;

    for (const d of this._groundData)   r.addDrawCall(d.mesh, d.modelMatrix, d.mat);
    for (const d of this._roadData)     r.addDrawCall(d.mesh, d.modelMatrix, d.mat);

    // Frustum culled buildings
    for (const d of this._buildingData) {
      if (d.aabb) {
        const a = d.aabb;
        if (!cam.frustumCullAABB(a.cx-a.rx, 0, a.cz-a.rz, a.cx+a.rx, a.cy*2, a.cz+a.rz))
          continue;
      }
      r.addDrawCall(d.mesh, d.modelMatrix, d.mat);
    }

    for (const d of this._parkData)     r.addDrawCall(d.mesh, d.modelMatrix, d.mat);

    // Frustum cull props (use bounding sphere approximation from modelMatrix translation)
    for (const d of this._propData) {
      const m = d.modelMatrix;
      if (!cam.frustumCullSphere(m[12], m[13], m[14], 5)) continue;
      r.addDrawCall(d.mesh, d.modelMatrix, d.mat);
    }

    for (const d of this._waterData)    r.addDrawCall(d.mesh, d.modelMatrix, d.mat, true);

    // Register point lights (street lights) - only nearby
    const px = cam.position[0], pz = cam.position[2];
    for (const sl of this._streetLights) {
      const dx = sl.x-px, dz = sl.z-pz;
      if (dx*dx+dz*dz > 120*120) continue;
      r.addLight(sl.x, sl.y || 6, sl.z, sl.r ?? 1.0, sl.g ?? 0.9, sl.b ?? 0.6, sl.radius ?? 22);
    }
  }

  get vehicleSpawns() { return this._vehicleSpawns; }
  get npcSpawns()     { return this._npcSpawns; }
}
