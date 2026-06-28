import { WebGLRenderer } from '../engine/renderer/WebGLRenderer.js';
import { PhysicsWorld } from '../engine/physics/PhysicsWorld.js';
import { InputManager } from '../engine/input/InputManager.js';
import { AudioManager } from '../engine/audio/AudioManager.js';
import { CityGenerator } from './CityGenerator.js';
import { CharacterController } from './CharacterController.js';
import { VehicleController } from './VehicleController.js';
import { NPCManager } from './NPCController.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.physics  = null;
    this.input    = null;
    this.audio    = null;
    this.city     = null;
    this.player   = null;
    this.vehicles = [];
    this.npcMgr   = null;

    this._lastTime = 0;
    this._fpsTimer = 0;
    this._fpsFrames = 0;
    this._fps = 0;
    this._running = false;

    // Day/night cycle
    this._timeOfDay = 0.5;      // 0=midnight, 0.5=noon, 1=midnight
    this._daySpeed  = 0.0005;   // full cycle in ~33 min
    this._weatherFactor = 0.0;
    this._weatherTarget  = 0.0;
    this._weatherTimer   = 120;

    // Minimap canvas
    this._mmCtx = null;
    this._mmCanvas = null;
  }

  async init(progressCb) {
    const report = (p, msg) => {
      progressCb(p, msg);
    };

    report(0.02, 'Initializing renderer…');
    this.renderer = new WebGLRenderer(this.canvas);
    this.renderer.camera.setProjection(
      70 * Math.PI / 180, this.canvas.width / this.canvas.height, 0.3, 2000
    );

    report(0.05, 'Initializing physics…');
    this.physics = new PhysicsWorld();

    report(0.07, 'Initializing input…');
    this.input = new InputManager(this.canvas);

    report(0.08, 'Initializing audio…');
    this.audio = new AudioManager();
    await this.audio.init();

    report(0.10, 'Generating city…');
    this.city = new CityGenerator(this.renderer, this.physics);
    await this.city.generate((p, msg) => report(0.1 + p * 0.6, msg));

    report(0.72, 'Spawning player…');
    this.player = new CharacterController(
      this.renderer, this.physics, this.input, this.audio
    );
    this.player.body.x = 20;
    this.player.body.z = 20;
    this.player.body.y = 1.5;

    report(0.80, 'Spawning vehicles…');
    const vSpawns = this.city.vehicleSpawns;
    const vCount = Math.min(12, vSpawns.length);
    for (let i = 0; i < vCount; i++) {
      const sp = vSpawns[i];
      this.vehicles.push(new VehicleController(
        this.renderer, this.physics, this.audio,
        sp.x, sp.y || 0.8, sp.z, sp.ry || 0
      ));
    }

    report(0.87, 'Spawning NPCs…');
    this.npcMgr = new NPCManager(this.renderer, this.physics);
    this.npcMgr.spawn(this.city.npcSpawns, 40);

    report(0.92, 'Building minimap…');
    this._mmCanvas = document.getElementById('mmcanvas');
    this._mmCtx = this._mmCanvas.getContext('2d');
    this._drawMinimap();

    report(0.95, 'Setting up window events…');
    this._setupResize();
    this._setupInteraction();

    report(1.0, 'Ready!');
    this._running = true;
  }

  _setupResize() {
    const onResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.canvas.width = w; this.canvas.height = h;
      this.renderer.resize(w, h);
      this.renderer.camera.setProjection(70*Math.PI/180, w/h, 0.3, 2000);
    };
    window.addEventListener('resize', onResize);
    onResize();
  }

  _setupInteraction() {
    // 'F' - enter/exit vehicle
    // Handled in update loop via isDown check
  }

  start() {
    this._lastTime = performance.now();
    requestAnimationFrame(t => this._loop(t));
  }

  _loop(now) {
    if (!this._running) return;
    const dt = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    this.update(dt);
    this.draw();

    this._fpsTimer += dt;
    this._fpsFrames++;
    if (this._fpsTimer >= 0.5) {
      this._fps = this._fpsFrames / this._fpsTimer;
      document.getElementById('fps').textContent =
        `FPS: ${Math.round(this._fps)} | Draw: ${this.renderer.drawCalls.length}`;
      this._fpsTimer = 0; this._fpsFrames = 0;
    }

    requestAnimationFrame(t => this._loop(t));
  }

  update(dt) {
    this.renderer.time += dt;

    // ── Day/night cycle ────────────────────────────────────────────────
    this._timeOfDay = (this._timeOfDay + this._daySpeed * dt) % 1.0;
    this._updateSun();

    // ── Weather ────────────────────────────────────────────────────────
    this._weatherTimer -= dt;
    if (this._weatherTimer <= 0) {
      this._weatherTarget = Math.random() > 0.7 ? Math.random() : 0;
      this._weatherTimer = 60 + Math.random()*120;
    }
    this._weatherFactor += (this._weatherTarget - this._weatherFactor) * dt * 0.05;
    this.renderer.weatherFactor = this._weatherFactor;
    this._updateWeatherUI();

    // ── Physics ────────────────────────────────────────────────────────
    this.physics.update(dt);

    // ── Player ────────────────────────────────────────────────────────
    this.player.update(dt);

    // ── Vehicle enter/exit ────────────────────────────────────────────
    if (this.input.isDown('KeyF')) {
      if (this.player.inVehicle) {
        this.player.exitVehicle();
      } else {
        const nearest = this._findNearestVehicle(3.5);
        if (nearest) this.player.enterVehicle(nearest.body);
      }
    }

    // ── Vehicles ──────────────────────────────────────────────────────
    for (const v of this.vehicles) {
      if (v.body.occupied) {
        v.update(dt, this.input);
      } else {
        v.body.update(dt);
      }
    }

    // ── NPCs ──────────────────────────────────────────────────────────
    this.npcMgr.update(dt);

    // ── Interaction prompt ─────────────────────────────────────────────
    const near = this._findNearestVehicle(3.5);
    const prompt = document.getElementById('prompt');
    if (!this.player.inVehicle && near) {
      prompt.textContent = 'Press [F] to enter vehicle';
      prompt.style.display = 'block';
    } else {
      prompt.style.display = 'none';
    }

    // ── Minimap (update every 0.5s) ────────────────────────────────────
    this._fpsTimer;
    if (Math.floor(this.renderer.time * 2) !== this._lastMMUpdate) {
      this._lastMMUpdate = Math.floor(this.renderer.time * 2);
      this._drawMinimap();
    }

    this.input.flush();
  }

  draw() {
    const r = this.renderer;
    r.beginFrame();

    // City
    this.city.draw(r.camera);

    // Vehicles
    for (const v of this.vehicles) {
      const b = v.body;
      if (r.camera.frustumCullSphere(b.x, b.y, b.z, 8)) v.draw();
    }

    // NPCs
    this.npcMgr.draw();

    // Player character
    this.player.draw();

    r.render();
  }

  _updateSun() {
    // Sun elevation angle (0=horizon, 1=zenith)
    const t = this._timeOfDay;
    const sunAngle = t * Math.PI * 2; // full rotation
    const elevation = Math.sin(sunAngle - Math.PI / 2); // -1=midnight, 1=noon
    const azimuth   = t * Math.PI * 2 * 0.25;

    // Correct sun direction from elevation (negative Y = pointing downward from sky)
    const elevRad  = elevation * Math.PI / 2;
    const hDist    = Math.cos(elevRad);
    this.renderer.sunDir = [
      Math.sin(azimuth) * hDist,
      -Math.sin(elevRad),          // negative = sun rays point downward
      Math.cos(azimuth) * hDist,
    ];

    // Sun intensity based on elevation
    const elev = elevation;
    this.renderer.sunIntensity  = Math.max(0, elev) * 4.5 + 0.1;
    this.renderer.ambientIntensity = Math.max(0.03, elev * 0.5 + 0.05);

    // Sky color transition
    if (elev > 0.1) {
      // Day
      this.renderer.sunColor = [1.0, 0.97, 0.88];
      this.renderer.skyColor  = [0.52, 0.72, 1.0];
    } else if (elev > -0.1) {
      // Sunrise/sunset
      const t2 = (elev + 0.1) / 0.2;
      this.renderer.sunColor  = [1.0, 0.5 + t2*0.47, 0.2 + t2*0.68];
      this.renderer.skyColor   = [0.8-t2*0.28, 0.5+t2*0.22, 0.6+t2*0.4];
    } else {
      // Night
      this.renderer.sunColor  = [0.15, 0.18, 0.35];
      this.renderer.skyColor   = [0.05, 0.05, 0.15];
    }

    // Update time display
    const hour = Math.floor(t * 24);
    const min  = Math.floor((t * 24 - hour) * 60);
    document.getElementById('time-display').textContent =
      `${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }

  _updateWeatherUI() {
    const wf = this._weatherFactor;
    const el = document.getElementById('weather');
    if (wf > 0.5) el.textContent = '🌧 Rain';
    else if (wf > 0.1) el.textContent = '⛅ Cloudy';
    else el.textContent = '☀ Clear';
  }

  _findNearestVehicle(maxDist) {
    const p = this.player.body;
    let nearest = null, minD = maxDist * maxDist;
    for (const v of this.vehicles) {
      const dx = v.body.x-p.x, dz = v.body.z-p.z;
      const d2 = dx*dx+dz*dz;
      if (d2 < minD) { minD=d2; nearest=v; }
    }
    return nearest;
  }

  _drawMinimap() {
    if (!this._mmCtx) return;
    const ctx = this._mmCtx, s = 170;
    ctx.clearRect(0,0,s,s);

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.beginPath(); ctx.arc(s/2,s/2,s/2,0,Math.PI*2); ctx.fill();

    const p = this.player.body;
    const scale = s / 600; // world units to minimap pixels
    const cx = s/2, cy = s/2;

    // Save/rotate around player
    ctx.save();
    ctx.translate(cx, cy);
    // North-up minimap

    // Roads (light grey lines)
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
    const BLOCK = 72, ROAD = 14, GRID = 20, OFF = -(BLOCK+ROAD)*GRID/2;
    const step = BLOCK+ROAD;
    for (let i=0;i<=GRID;i++){
      const wx = OFF+i*step; const wz = OFF+i*step;
      // vertical road at wx
      ctx.beginPath();
      ctx.moveTo((wx-p.x)*scale, (OFF-p.z)*scale);
      ctx.lineTo((wx-p.x)*scale, (OFF+GRID*step-p.z)*scale);
      ctx.stroke();
      // horizontal road at wz
      ctx.beginPath();
      ctx.moveTo((OFF-p.x)*scale, (wz-p.z)*scale);
      ctx.lineTo((OFF+GRID*step-p.x)*scale, (wz-p.z)*scale);
      ctx.stroke();
    }

    // Vehicles
    for (const v of this.vehicles) {
      const vx = (v.body.x-p.x)*scale, vz = (v.body.z-p.z)*scale;
      if (Math.abs(vx)>cx || Math.abs(vz)>cy) continue;
      ctx.fillStyle = '#4af';
      ctx.fillRect(vx-2,vz-2,4,4);
    }

    // NPCs
    ctx.fillStyle = '#8f8';

    // Player marker
    ctx.fillStyle = '#ff0';
    ctx.beginPath();
    ctx.arc(0,0,4,0,Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#fa0';
    ctx.beginPath();
    ctx.moveTo(0,-6); ctx.lineTo(-3,0); ctx.lineTo(3,0); ctx.closePath(); ctx.fill();

    ctx.restore();

    // Clip to circle
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath(); ctx.arc(s/2,s/2,s/2,0,Math.PI*2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // Compass
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px sans-serif'; ctx.textAlign='center';
    ctx.fillText('N', s/2, 10);
  }
}
