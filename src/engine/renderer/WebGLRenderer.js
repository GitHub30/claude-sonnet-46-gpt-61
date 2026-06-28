import { Camera, mat4FromTranslationYRotation, mat4Invert } from './Camera.js';
import { GBuffer } from './GBuffer.js';
import { ShadowMap } from './ShadowMap.js';
import { PostProcessor } from './PostProcessor.js';
import { ProceduralTextures } from './ProceduralTextures.js';
import { Mesh } from './Mesh.js';
import { GBUFFER_VERT, GBUFFER_FRAG, SHADOW_VERT, SHADOW_FRAG,
         INSTANCED_GBUFFER_VERT, INSTANCED_GBUFFER_FRAG,
         RAIN_VERT, RAIN_FRAG, WATER_VERT, WATER_FRAG } from './ShaderLib.js';

export class WebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      antialias: false, // We do our own AA via MSAA/TAA
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (!this.gl) throw new Error('WebGL2 not supported');

    this._checkExtensions();
    this.width  = canvas.width;
    this.height = canvas.height;

    this.camera = new Camera();
    this.textures = new ProceduralTextures(this.gl);
    this.gbuffer = new GBuffer(this.gl, this.width, this.height);
    this.shadowMap = new ShadowMap(this.gl, 2048);
    this.postProcess = new PostProcessor(this.gl, this.width, this.height, this.textures);

    this._programs = {};
    this._compilePrograms();

    this._rainVAO = null;
    this._rainBuf = null;
    this._rainCount = 0;
    this._buildRain();

    // Scene data
    this.drawCalls = [];
    this.lights = [];
    this.sunDir = [0.3, -0.8, 0.4];
    this.sunColor = [1.0, 0.95, 0.85];
    this.sunIntensity = 3.0;
    this.ambientIntensity = 0.4;
    this.skyColor = [0.5, 0.7, 1.0];
    this.weatherFactor = 0.0;
    this.time = 0;

    this.ssaoKernel = this.textures.generateSSAOKernel(64);

    // Instanced draw calls
    this.instancedCalls = [];

    this._setupGL();
  }

  _checkExtensions() {
    const gl = this.gl;
    const needed = ['EXT_color_buffer_float'];
    for (const ext of needed) {
      if (!gl.getExtension(ext)) console.warn('Missing extension:', ext);
    }
    gl.getExtension('OES_texture_float_linear');
    gl.getExtension('EXT_texture_filter_anisotropic');
  }

  _setupGL() {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1.0);
  }

  _compilePrograms() {
    this._programs.gbuffer  = this._compile(GBUFFER_VERT, GBUFFER_FRAG, 'gbuffer');
    this._programs.shadow   = this._compile(SHADOW_VERT,  SHADOW_FRAG,  'shadow');
    this._programs.instanced= this._compile(INSTANCED_GBUFFER_VERT, INSTANCED_GBUFFER_FRAG, 'instanced');
    this._programs.rain     = this._compile(RAIN_VERT,    RAIN_FRAG,    'rain');
    this._programs.water    = this._compile(WATER_VERT,   WATER_FRAG,   'water');
  }

  _compile(vs, fs, name) {
    const gl = this.gl;
    const compile = (src, type) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const err = gl.getShaderInfoLog(s);
        console.error(`[Shader ${name} ${type===gl.VERTEX_SHADER?'VS':'FS'}]`, err);
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(vs, gl.VERTEX_SHADER));
    gl.attachShader(p, compile(fs, gl.FRAGMENT_SHADER));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      console.error(`[Link ${name}]`, gl.getProgramInfoLog(p));
    return p;
  }

  _buildRain() {
    const gl = this.gl;
    const count = 8000;
    this._rainCount = count;
    const verts = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      verts[i*3]   = (Math.random()-0.5) * 80;
      verts[i*3+1] = Math.random() * 40;
      verts[i*3+2] = (Math.random()-0.5) * 80;
    }
    this._rainVAO = gl.createVertexArray();
    gl.bindVertexArray(this._rainVAO);
    this._rainBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._rainBuf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
  }

  /** Add a mesh draw call for this frame */
  addDrawCall(mesh, modelMatrix, material, isWater = false) {
    this.drawCalls.push({ mesh, modelMatrix, material, isWater });
  }

  /** Clear frame draw calls */
  beginFrame() {
    this.drawCalls = [];
    this.instancedCalls = [];
    this.lights = [];
  }

  addLight(x, y, z, r, g, b, radius) {
    this.lights.push({x,y,z,r,g,b,radius});
  }

  addInstancedCall(mesh, instanceMatrices, material) {
    this.instancedCalls.push({ mesh, instanceMatrices, material });
  }

  /** Render a complete frame */
  render() {
    const gl = this.gl;
    this.camera.update();

    // ── Shadow pass ────────────────────────────────────────────────────
    this.shadowMap.updateLightMatrix(this.sunDir, this.camera.position, 250);
    this.shadowMap.bind();
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    const shadowProg = this._programs.shadow;
    gl.useProgram(shadowProg);
    for (const dc of this.drawCalls) {
      if (dc.isWater) continue;
      const mvpLoc = gl.getUniformLocation(shadowProg, 'u_lightMVP');
      const lightMVP = new Float32Array(16);
      mat4MulModel(lightMVP, this.shadowMap.lightMatrix, dc.modelMatrix);
      gl.uniformMatrix4fv(mvpLoc, false, lightMVP);
      dc.mesh.draw();
    }
    this.shadowMap.unbind();

    // ── GBuffer pass ─────────────────────────────────────────────────
    this.gbuffer.bind();
    gl.viewport(0, 0, this.width, this.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);

    const gbufProg = this._programs.gbuffer;
    gl.useProgram(gbufProg);
    // Set constant uniforms
    gl.uniformMatrix4fv(gl.getUniformLocation(gbufProg,'u_V'),false,this.camera.viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(gbufProg,'u_P'),false,this.camera.projMatrix);

    for (const dc of this.drawCalls) {
      if (dc.isWater) continue;
      this._setGBufferUniforms(gbufProg, dc);
      dc.mesh.draw();
    }

    // Instanced draw calls
    const instProg = this._programs.instanced;
    gl.useProgram(instProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(instProg,'u_V'),false,this.camera.viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(instProg,'u_P'),false,this.camera.projMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(instProg,'u_prevVP'),false,this.camera.prevViewProjMatrix);
    for (const ic of this.instancedCalls) {
      this._drawInstanced(instProg, ic);
    }

    // Water surfaces
    const waterProg = this._programs.water;
    gl.useProgram(waterProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(waterProg,'u_V'),false,this.camera.viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(waterProg,'u_P'),false,this.camera.projMatrix);
    gl.uniform1f(gl.getUniformLocation(waterProg,'u_time'), this.time);
    for (const dc of this.drawCalls) {
      if (!dc.isWater) continue;
      gl.uniformMatrix4fv(gl.getUniformLocation(waterProg,'u_M'),false,dc.modelMatrix);
      dc.mesh.draw();
    }

    this.gbuffer.unbind();

    // ── Post-processing ───────────────────────────────────────────────
    this.postProcess.render(
      this.gbuffer, this.shadowMap, this.camera,
      this.lights, this.sunDir, this.sunColor, this.sunIntensity,
      this.time, this.weatherFactor, this.ssaoKernel,
      this.ambientIntensity, this.skyColor
    );

    // ── Rain particles ─────────────────────────────────────────────────
    if (this.weatherFactor > 0.05) {
      this._renderRain();
    }
  }

  _setGBufferUniforms(prog, dc) {
    const gl = this.gl;
    const m = dc.material;

    gl.uniformMatrix4fv(gl.getUniformLocation(prog,'u_M'), false, dc.modelMatrix);

    // Normal matrix
    const nm = new Float32Array(9);
    const inv = new Float32Array(16);
    mat4Invert(inv, dc.modelMatrix);
    // Transpose of 3x3
    nm[0]=inv[0];nm[1]=inv[4];nm[2]=inv[8];
    nm[3]=inv[1];nm[4]=inv[5];nm[5]=inv[9];
    nm[6]=inv[2];nm[7]=inv[6];nm[8]=inv[10];
    gl.uniformMatrix3fv(gl.getUniformLocation(prog,'u_N'), false, nm);

    // Previous MVP for motion vectors
    const prevMVP = new Float32Array(16);
    mat4MulModel(prevMVP, this.camera.prevViewProjMatrix, dc.modelMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog,'u_prevMVP'), false, prevMVP);

    // Textures
    const t = (slot, name, tex) => {
      gl.activeTexture(gl.TEXTURE0 + slot);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(prog, name), slot);
    };
    const white = this.textures.get('white');
    const black = this.textures.get('black');
    const flatN = this.textures.get('flat_normal');

    t(0, 'u_albedoTex',  m.albedoTex  || white);
    t(1, 'u_normalTex',  m.normalTex  || flatN);
    t(2, 'u_roughTex',   m.roughTex   || white);
    t(3, 'u_metalTex',   m.metalTex   || black);
    t(4, 'u_aoTex',      m.aoTex      || white);
    t(5, 'u_emissiveTex',m.emissiveTex|| black);

    gl.uniform3fv(gl.getUniformLocation(prog,'u_albedoFactor'), new Float32Array(m.albedo || [1,1,1]));
    gl.uniform1f(gl.getUniformLocation(prog,'u_roughFactor'),   m.roughness ?? 0.8);
    gl.uniform1f(gl.getUniformLocation(prog,'u_metalFactor'),   m.metallic  ?? 0.0);
    gl.uniform1f(gl.getUniformLocation(prog,'u_emissiveFactor'),m.emissive  ?? 0.0);
    gl.uniform1f(gl.getUniformLocation(prog,'u_uvScale'),        m.uvScale  ?? 1.0);
    gl.uniform1i(gl.getUniformLocation(prog,'u_useNormalMap'), m.normalTex ? 1 : 0);
  }

  _drawInstanced(prog, ic) {
    const gl = this.gl;
    const m = ic.material;
    const white = this.textures.get('white');
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, m.albedoTex || white);
    gl.uniform1i(gl.getUniformLocation(prog,'u_albedoTex'),0);
    gl.uniform3fv(gl.getUniformLocation(prog,'u_albedoFactor'), new Float32Array(m.albedo || [1,1,1]));
    gl.uniform1f(gl.getUniformLocation(prog,'u_roughFactor'), m.roughness ?? 0.7);
    gl.uniform1f(gl.getUniformLocation(prog,'u_metalFactor'), m.metallic  ?? 0.0);

    // Upload instance matrices as VBO (attributes 4-7)
    const instanceBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, ic.instanceMatrices, gl.DYNAMIC_DRAW);

    gl.bindVertexArray(ic.mesh.vao);
    for (let i = 0; i < 4; i++) {
      const loc = 4 + i;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 64, i * 16);
      gl.vertexAttribDivisor(loc, 1);
    }
    const count = ic.instanceMatrices.length / 16;
    if (ic.mesh.hasIndex) {
      gl.drawElementsInstanced(gl.TRIANGLES, ic.mesh.indexCount, gl.UNSIGNED_INT, 0, count);
    } else {
      gl.drawArraysInstanced(gl.TRIANGLES, 0, ic.mesh.vertexCount, count);
    }
    // Cleanup divisors
    for (let i = 0; i < 4; i++) gl.vertexAttribDivisor(4+i, 0);
    gl.bindVertexArray(null);
    gl.deleteBuffer(instanceBuf);
  }

  _renderRain() {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    const prog = this._programs.rain;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog,'u_VP'),false,this.camera.viewProjMatrix);
    gl.uniform1f(gl.getUniformLocation(prog,'u_time'), this.time);
    gl.uniform1f(gl.getUniformLocation(prog,'u_weatherFactor'), this.weatherFactor);
    gl.bindVertexArray(this._rainVAO);
    gl.drawArrays(gl.POINTS, 0, this._rainCount);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  resize(w, h) {
    this.width = w; this.height = h;
    this.canvas.width = w; this.canvas.height = h;
    this.camera.aspect = w/h;
    this.gbuffer.resize(w, h);
    this.postProcess.resize(w, h);
    this.gl.viewport(0, 0, w, h);
  }

  /** Create a GPU mesh from geometry data */
  createMesh(vertices, indices) {
    const m = new Mesh(this.gl);
    m.upload(vertices, indices);
    return m;
  }

  /** Get or create a PBR material using procedural textures */
  getMaterial(preset) {
    const tex = this.textures;
    const presets = {
      concrete:  { albedoTex: tex.get('concrete_albedo'),  normalTex: tex.get('concrete_normal'), roughTex: tex.get('concrete_rough'), metalTex: tex.get('black'), aoTex: tex.get('white'), emissiveTex: tex.get('black'), roughness:1, metallic:0, emissive:0, uvScale:4, albedo:[1,1,1] },
      asphalt:   { albedoTex: tex.get('asphalt_albedo'),   normalTex: tex.get('asphalt_normal'),  roughTex: tex.get('asphalt_rough'),  metalTex: tex.get('black'), aoTex: tex.get('white'), emissiveTex: tex.get('black'), roughness:1, metallic:0, emissive:0, uvScale:8, albedo:[1,1,1] },
      glass:     { albedoTex: tex.get('glass_albedo'),     normalTex: tex.get('flat_normal'),     roughTex: tex.get('glass_rough'),    metalTex: tex.get('black'), aoTex: tex.get('white'), emissiveTex: tex.get('glass_albedo'), roughness:1, metallic:0, emissive:1.5, uvScale:1, albedo:[1,1,1] },
      brick:     { albedoTex: tex.get('brick_albedo'),     normalTex: tex.get('brick_normal'),    roughTex: tex.get('brick_rough'),    metalTex: tex.get('black'), aoTex: tex.get('white'), emissiveTex: tex.get('black'), roughness:1, metallic:0, emissive:0, uvScale:3, albedo:[1,1,1] },
      grass:     { albedoTex: tex.get('grass_albedo'),     normalTex: tex.get('grass_normal'),    roughTex: tex.get('grass_rough'),    metalTex: tex.get('black'), aoTex: tex.get('white'), emissiveTex: tex.get('black'), roughness:1, metallic:0, emissive:0, uvScale:8, albedo:[1,1,1] },
      metal:     { albedoTex: tex.get('metal_albedo'),     normalTex: tex.get('flat_normal'),     roughTex: tex.get('metal_rough'),    metalTex: tex.get('metal_metal'), aoTex: tex.get('white'), emissiveTex: tex.get('black'), roughness:1, metallic:1, emissive:0, uvScale:2, albedo:[1,1,1] },
      building:  { albedoTex: tex.get('building_albedo'),  normalTex: tex.get('building_normal'), roughTex: tex.get('building_rough'), metalTex: tex.get('black'), aoTex: tex.get('white'), emissiveTex: tex.get('building_albedo'), roughness:1, metallic:0, emissive:0.8, uvScale:1, albedo:[1,1,1] },
      road:      { albedoTex: tex.get('road_albedo'),      normalTex: tex.get('road_normal'),     roughTex: tex.get('road_rough'),     metalTex: tex.get('black'), aoTex: tex.get('white'), emissiveTex: tex.get('black'), roughness:1, metallic:0, emissive:0, uvScale:4, albedo:[1,1,1] },
      car:       { albedoTex: tex.get('car_albedo'),       normalTex: tex.get('flat_normal'),     roughTex: tex.get('metal_rough'),    metalTex: tex.get('car_metal'), aoTex: tex.get('white'), emissiveTex: tex.get('black'), roughness:1, metallic:0.9, emissive:0, uvScale:1, albedo:[1,1,1] },
      npc:       { albedoTex: tex.get('npc_albedo'),       normalTex: tex.get('flat_normal'),     roughTex: tex.get('concrete_rough'), metalTex: tex.get('black'), aoTex: tex.get('white'), emissiveTex: tex.get('black'), roughness:0.9, metallic:0, emissive:0, uvScale:1, albedo:[1,1,1] },
    };
    return presets[preset] || presets.concrete;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function mat4MulModel(out, vp, m) {
  // out = vp * m (column-major: iterate over columns of m)
  for (let j = 0; j < 4; j++) {
    const m0=m[j*4], m1=m[j*4+1], m2=m[j*4+2], m3=m[j*4+3];
    out[j*4]   = m0*vp[0]+m1*vp[4]+m2*vp[8]+m3*vp[12];
    out[j*4+1] = m0*vp[1]+m1*vp[5]+m2*vp[9]+m3*vp[13];
    out[j*4+2] = m0*vp[2]+m1*vp[6]+m2*vp[10]+m3*vp[14];
    out[j*4+3] = m0*vp[3]+m1*vp[7]+m2*vp[11]+m3*vp[15];
  }
}
