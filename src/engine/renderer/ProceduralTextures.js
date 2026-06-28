/** Procedurally generated PBR textures using Canvas 2D */
export class ProceduralTextures {
  constructor(gl) {
    this.gl = gl;
    this._cache = new Map();
  }

  _noise2D(x, y, seed = 0) {
    const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.3) * 43758.5453;
    return n - Math.floor(n);
  }

  _fbm(x, y, octaves = 4) {
    let v = 0, a = 0.5, freq = 1;
    for (let i = 0; i < octaves; i++) {
      v += a * this._noise2D(x * freq, y * freq, i);
      a *= 0.5; freq *= 2;
    }
    return v;
  }

  _worley(x, y, cells = 4) {
    const cx = Math.floor(x * cells), cy = Math.floor(y * cells);
    let minD = 1e9;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const nx = cx + i, ny = cy + j;
      const hx = this._noise2D(nx, ny, 0) + nx;
      const hy = this._noise2D(nx, ny, 1) + ny;
      const dx = (x * cells) - hx, dy = (y * cells) - hy;
      minD = Math.min(minD, dx*dx + dy*dy);
    }
    return Math.sqrt(minD) / Math.sqrt(2);
  }

  /**
   * Create a WebGL2 texture from canvas
   * @param {number} size
   * @param {function(ctx, size)} fillFn
   * @param {boolean} mips
   * @returns {WebGLTexture}
   */
  _makeTexture(size, fillFn, mips = true, srgb = false) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    fillFn(ctx, size);

    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const fmt = srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    if (mips) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    // Try anisotropic filtering
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 8);

    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  _makeFloatTexture(size, fillFn) {
    const data = new Float32Array(size * size * 4);
    fillFn(data, size);
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size, size, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  get(name) {
    if (!this._cache.has(name)) {
      this._cache.set(name, this._generate(name));
    }
    return this._cache.get(name);
  }

  _generate(name) {
    const size = 512;
    switch(name) {
      case 'concrete_albedo':     return this._makeTexture(size, this._concreteAlbedo.bind(this));
      case 'concrete_normal':     return this._makeTexture(size, this._concreteNormal.bind(this));
      case 'concrete_rough':      return this._makeTexture(size, this._concreteRough.bind(this));
      case 'asphalt_albedo':      return this._makeTexture(size, this._asphaltAlbedo.bind(this));
      case 'asphalt_normal':      return this._makeTexture(size, this._asphaltNormal.bind(this));
      case 'asphalt_rough':       return this._makeTexture(size, this._asphaltRough.bind(this));
      case 'glass_albedo':        return this._makeTexture(size, this._glassAlbedo.bind(this));
      case 'glass_normal':        return this._makeTexture(size, this._flatNormal.bind(this));
      case 'glass_rough':         return this._makeTexture(size, this._glassRough.bind(this));
      case 'brick_albedo':        return this._makeTexture(size, this._brickAlbedo.bind(this));
      case 'brick_normal':        return this._makeTexture(size, this._brickNormal.bind(this));
      case 'brick_rough':         return this._makeTexture(size, this._brickRough.bind(this));
      case 'grass_albedo':        return this._makeTexture(size, this._grassAlbedo.bind(this));
      case 'grass_normal':        return this._makeTexture(size, this._grassNormal.bind(this));
      case 'grass_rough':         return this._makeTexture(size, this._grassRough.bind(this));
      case 'metal_albedo':        return this._makeTexture(size, this._metalAlbedo.bind(this));
      case 'metal_rough':         return this._makeTexture(size, this._metalRough.bind(this));
      case 'metal_metal':         return this._makeTexture(size, this._metalMetal.bind(this));
      case 'building_albedo':     return this._makeTexture(size, this._buildingAlbedo.bind(this));
      case 'building_normal':     return this._makeTexture(size, this._buildingNormal.bind(this));
      case 'building_rough':      return this._makeTexture(size, this._buildingRough.bind(this));
      case 'road_albedo':         return this._makeTexture(size, this._roadAlbedo.bind(this));
      case 'road_normal':         return this._makeTexture(size, this._roadNormal.bind(this));
      case 'road_rough':          return this._makeTexture(size, this._roadRough.bind(this));
      case 'car_albedo':          return this._makeTexture(size, this._carAlbedo.bind(this));
      case 'car_metal':           return this._makeTexture(size, this._carMetal.bind(this));
      case 'npc_albedo':          return this._makeTexture(256, this._npcAlbedo.bind(this));
      case 'white':               return this._makeTexture(4, (ctx, s) => { ctx.fillStyle='#fff'; ctx.fillRect(0,0,s,s); });
      case 'black':               return this._makeTexture(4, (ctx, s) => { ctx.fillStyle='#000'; ctx.fillRect(0,0,s,s); });
      case 'flat_normal':         return this._makeTexture(4, this._flatNormal.bind(this));
      case 'ssao_noise':          return this._makeSSAONoise();
      default: return this._makeTexture(4, (ctx, s) => { ctx.fillStyle='#888'; ctx.fillRect(0,0,s,s); });
    }
  }

  _flatNormal(ctx, s) {
    // Flat normal map: (0.5, 0.5, 1.0) → rgb(128, 128, 255)
    ctx.fillStyle = 'rgb(128,128,255)'; ctx.fillRect(0,0,s,s);
  }

  _concreteAlbedo(ctx, s) {
    const id = ctx.createImageData(s, s);
    const d = id.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const n = this._fbm(x/s*4, y/s*4, 5);
      const v = Math.floor(130 + n * 60);
      const i = (y*s+x)*4;
      d[i]=v; d[i+1]=v; d[i+2]=v-5; d[i+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _concreteNormal(ctx, s) {
    const id = ctx.createImageData(s, s);
    const d = id.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const h00 = this._fbm(x/s*4, y/s*4);
      const h10 = this._fbm((x+1)/s*4, y/s*4);
      const h01 = this._fbm(x/s*4, (y+1)/s*4);
      const nx_ = (h00 - h10) * 3 * 0.5 + 0.5;
      const ny_ = (h00 - h01) * 3 * 0.5 + 0.5;
      const i = (y*s+x)*4;
      d[i]=Math.floor(nx_*255); d[i+1]=Math.floor(ny_*255); d[i+2]=255; d[i+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _concreteRough(ctx, s) {
    const id = ctx.createImageData(s, s);
    const d = id.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const n = this._fbm(x/s*3, y/s*3);
      const v = Math.floor(180 + n * 50);
      const i = (y*s+x)*4;
      d[i]=v; d[i+1]=v; d[i+2]=v; d[i+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _asphaltAlbedo(ctx, s) {
    const id = ctx.createImageData(s, s);
    const d = id.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const n = this._fbm(x/s*8, y/s*8);
      const v = Math.floor(30 + n * 30);
      const i = (y*s+x)*4;
      d[i]=v; d[i+1]=v; d[i+2]=v; d[i+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _asphaltNormal(ctx, s) { this._concreteNormal(ctx, s); }

  _asphaltRough(ctx, s) {
    const id = ctx.createImageData(s, s);
    const d = id.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const n = this._noise2D(x/s*16, y/s*16);
      const v = Math.floor(190 + n * 40);
      const i = (y*s+x)*4;
      d[i]=v; d[i+1]=v; d[i+2]=v; d[i+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _glassAlbedo(ctx, s) {
    // Window grid pattern
    const id = ctx.createImageData(s, s);
    const d = id.data;
    const grid = 64;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const gx = x % grid, gy = y % grid;
      const frame = gx < 3 || gy < 3 || gx > grid-4 || gy > grid-4;
      const n = this._noise2D(Math.floor(x/grid), Math.floor(y/grid), 5);
      const lit = n > 0.6;  // some windows lit at night
      let r = frame ? 60 : (lit ? 255 : 40);
      let g = frame ? 60 : (lit ? 230 : 70);
      let b = frame ? 65 : (lit ? 100 : 130);
      const i = (y*s+x)*4;
      d[i]=r; d[i+1]=g; d[i+2]=b; d[i+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _glassRough(ctx, s) {
    ctx.fillStyle = 'rgb(25,25,25)'; ctx.fillRect(0,0,s,s);
  }

  _brickAlbedo(ctx, s) {
    const id = ctx.createImageData(s, s);
    const d = id.data;
    const bW = 64, bH = 28, mortar = 4;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const row = Math.floor(y / bH);
      const offset = (row % 2) * (bW / 2);
      const bx = (x + offset) % bW, by = y % bH;
      const isMortar = bx < mortar || by < mortar;
      const n = this._noise2D(Math.floor((x+offset)/bW), Math.floor(y/bH));
      let r,g,b;
      if (isMortar) { r=160; g=155; b=150; }
      else {
        r = Math.floor(180 + n*50); g = Math.floor(80 + n*30); b = Math.floor(60 + n*20);
        // brick noise
        const bn = this._noise2D(x/4, y/4) * 20;
        r = Math.min(255, r + bn - 10); g = Math.min(255, g + bn*0.5 - 5);
      }
      const i = (y*s+x)*4;
      d[i]=r; d[i+1]=g; d[i+2]=b; d[i+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _brickNormal(ctx, s) {
    const id = ctx.createImageData(s, s);
    const d = id.data;
    const bW=64, bH=28, mortar=4;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const row = Math.floor(y/bH);
      const offset = (row%2)*(bW/2);
      const bx=(x+offset)%bW, by=y%bH;
      const isMortar = bx<mortar||by<mortar;
      const edge = Math.min(bx-mortar, bW-bx-mortar, by-mortar, bH-by-mortar);
      const bump = isMortar ? -0.3 : Math.min(1, edge/8)*0.3;
      const nx_ = isMortar ? 0.5 : ((bx<bW/2?1:-1)*Math.min(1,(mortar+2)/bx)*0.15+0.5);
      const ny_ = isMortar ? 0.5 : ((by<bH/2?1:-1)*Math.min(1,(mortar+2)/by)*0.15+0.5);
      const i = (y*s+x)*4;
      d[i]=Math.floor(nx_*255); d[i+1]=Math.floor(ny_*255); d[i+2]=255; d[i+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _brickRough(ctx, s) {
    const id = ctx.createImageData(s, s);
    const d = id.data;
    const bW=64, bH=28, mortar=4;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const row=Math.floor(y/bH), offset=(row%2)*(bW/2);
      const bx=(x+offset)%bW, by=y%bH;
      const isMortar=bx<mortar||by<mortar;
      const n=this._noise2D(x/4,y/4);
      const v = isMortar ? Math.floor(190+n*30) : Math.floor(160+n*60);
      const i = (y*s+x)*4;
      d[i]=v; d[i+1]=v; d[i+2]=v; d[i+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _grassAlbedo(ctx, s) {
    const id = ctx.createImageData(s, s);
    const d = id.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const n = this._fbm(x/s*6, y/s*6);
      const n2 = this._noise2D(x/s*20, y/s*20);
      const r = Math.floor(30 + n*25 + n2*10);
      const g = Math.floor(100 + n*60 + n2*15);
      const b = Math.floor(20 + n*20);
      const i = (y*s+x)*4;
      d[i]=r; d[i+1]=g; d[i+2]=b; d[i+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _grassNormal(ctx, s) { this._concreteNormal(ctx, s); }

  _grassRough(ctx, s) {
    const id = ctx.createImageData(s, s);
    const d = id.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const n = this._fbm(x/s*8, y/s*8);
      const v = Math.floor(200 + n*40);
      const i = (y*s+x)*4;
      d[i]=v; d[i+1]=v; d[i+2]=v; d[i+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _metalAlbedo(ctx, s) {
    const id = ctx.createImageData(s, s);
    const d = id.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const n = this._fbm(x/s*4, y/s*4);
      const v = Math.floor(180 + n*40);
      const i = (y*s+x)*4;
      d[i]=v; d[i+1]=v; d[i+2]=v+5; d[i+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _metalRough(ctx, s) {
    const id = ctx.createImageData(s, s);
    const d = id.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const n = this._noise2D(x/s*8, y/s*8);
      const v = Math.floor(50 + n*60);
      const i = (y*s+x)*4;
      d[i]=v; d[i+1]=v; d[i+2]=v; d[i+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _metalMetal(ctx, s) {
    ctx.fillStyle = 'rgb(230,230,230)'; ctx.fillRect(0,0,s,s);
  }

  _buildingAlbedo(ctx, s) {
    const id = ctx.createImageData(s, s);
    const d = id.data;
    const winW=40, winH=50, padX=8, padY=8;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const bx=x%winW, by=y%winH;
      const isWin=bx>padX&&bx<winW-padX&&by>padY&&by<winH-padY;
      const col = Math.floor(x/winW) + Math.floor(y/winH);
      const lit = this._noise2D(Math.floor(x/winW), Math.floor(y/winH)) > 0.4;
      let r,g,b;
      if (!isWin) { // Frame / wall
        const n=this._fbm(x/s*3,y/s*3)*0.5;
        r=Math.floor(150+n*40); g=Math.floor(150+n*40); b=Math.floor(155+n*40);
      } else { // Window
        if (lit) { r=255; g=240; b=160; }
        else { r=30; g=50; b=80; }
      }
      const i=(y*s+x)*4;
      d[i]=r; d[i+1]=g; d[i+2]=b; d[i+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _buildingNormal(ctx, s) { this._flatNormal(ctx, s); }

  _buildingRough(ctx, s) {
    const id = ctx.createImageData(s, s);
    const d = id.data;
    const winW=40, winH=50, padX=8, padY=8;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const bx=x%winW, by=y%winH;
      const isWin=bx>padX&&bx<winW-padX&&by>padY&&by<winH-padY;
      const v = isWin ? 15 : 180;
      const i=(y*s+x)*4;
      d[i]=v; d[i+1]=v; d[i+2]=v; d[i+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _roadAlbedo(ctx, s) {
    const id = ctx.createImageData(s, s);
    const d = id.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const n = this._fbm(x/s*8, y/s*8);
      let v = Math.floor(40 + n*25);
      // Lane markings
      const lanePos = (x / s) % 0.5;
      if (lanePos > 0.23 && lanePos < 0.27 && (y/s*4)%1 < 0.5) v = 220;
      const i=(y*s+x)*4;
      d[i]=v; d[i+1]=v; d[i+2]=v; d[i+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _roadNormal(ctx, s) { this._asphaltNormal(ctx, s); }

  _roadRough(ctx, s) {
    const id = ctx.createImageData(s, s);
    const d = id.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const n = this._noise2D(x/s*12, y/s*12);
      const v = Math.floor(185 + n*40);
      const i=(y*s+x)*4;
      d[i]=v; d[i+1]=v; d[i+2]=v; d[i+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _carAlbedo(ctx, s) {
    const colors = ['#cc2020','#2060cc','#20cc60','#cccc20','#cccccc','#101010'];
    const hash = Math.floor(Math.random() * colors.length);
    const id = ctx.createImageData(s, s);
    const c = parseInt(colors[hash].slice(1), 16);
    const r=(c>>16)&255, g=(c>>8)&255, b=c&255;
    const d = id.data;
    for (let i = 0; i < s*s; i++) {
      const n = this._noise2D(i%s/4, Math.floor(i/s)/4) * 20;
      d[i*4]=Math.min(255,r+n); d[i*4+1]=Math.min(255,g+n);
      d[i*4+2]=Math.min(255,b+n); d[i*4+3]=255;
    }
    ctx.putImageData(id, 0, 0);
  }

  _carMetal(ctx, s) { ctx.fillStyle='rgb(240,240,240)'; ctx.fillRect(0,0,s,s); }

  _npcAlbedo(ctx, s) {
    const colors = ['#e8b89a','#c49070','#a06040','#f0d0c0'];
    const skinColor = colors[Math.floor(Math.random()*colors.length)];
    const clothColors = ['#2244aa','#aa2244','#224422','#444444','#aa8833'];
    const clothColor = clothColors[Math.floor(Math.random()*clothColors.length)];
    ctx.fillStyle = clothColor; ctx.fillRect(0,0,s,s);
    // Head area (top quarter)
    ctx.fillStyle = skinColor; ctx.fillRect(0,0,s,s/4);
  }

  _makeSSAONoise() {
    const size = 4;
    const data = new Float32Array(size * size * 3);
    for (let i = 0; i < size * size; i++) {
      data[i*3]   = Math.random() * 2 - 1;
      data[i*3+1] = Math.random() * 2 - 1;
      data[i*3+2] = 0;
    }
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, size, size, 0, gl.RGB, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  generateSSAOKernel(size = 64) {
    const kernel = [];
    for (let i = 0; i < size; i++) {
      let s = [Math.random()*2-1, Math.random()*2-1, Math.random()];
      const len = Math.sqrt(s[0]*s[0]+s[1]*s[1]+s[2]*s[2]);
      s = s.map(v => v/len);
      let scale = i/size;
      scale = 0.1 + scale*scale * 0.9;
      kernel.push(s[0]*scale, s[1]*scale, s[2]*scale);
    }
    return new Float32Array(kernel);
  }

  /** Create a solid color texture */
  makeColorTex(r,g,b,a=255) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([r,g,b,a]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }
}
