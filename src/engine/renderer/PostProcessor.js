import { RenderTarget, FloatTarget } from './GBuffer.js';
import {
  QUAD_VERT, SSAO_FRAG, SSAO_BLUR_FRAG,
  BLOOM_EXTRACT_FRAG, BLOOM_BLUR_FRAG,
  MOTION_BLUR_FRAG, TONEMAP_FRAG,
  LIGHTING_FRAG, SKY_FRAG
} from './ShaderLib.js';

/** Full post-processing pipeline:
 *  GBuffer → Lighting → SSAO → Bloom → MotionBlur → Tonemap
 */
export class PostProcessor {
  constructor(gl, width, height, textures) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.textures = textures;

    // HDR scene color target
    this.hdrTarget    = new RenderTarget(gl, width, height);
    // SSAO
    this.ssaoTarget   = new FloatTarget(gl, Math.floor(width/2), Math.floor(height/2));
    this.ssaoBlur     = new FloatTarget(gl, Math.floor(width/2), Math.floor(height/2));
    // Bloom mip chain (4 levels)
    this.bloomTargets = [];
    let bw = width, bh = height;
    for (let i = 0; i < 5; i++) {
      bw = Math.max(1, Math.floor(bw/2));
      bh = Math.max(1, Math.floor(bh/2));
      this.bloomTargets.push(
        new RenderTarget(gl, bw, bh),
        new RenderTarget(gl, bw, bh)
      );
    }
    // Motion blur
    this.motionTarget = new RenderTarget(gl, width, height);

    this._ssaoKernel = null;
    this._programs = {};
    this._quadVAO = this._buildQuad();
    this._compileAll();
  }

  _buildQuad() {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindVertexArray(null);
    return vao;
  }

  _compileAll() {
    const gl = this.gl;
    const compile = (vs, fs, name) => {
      const p = gl.createProgram();
      const v = gl.createShader(gl.VERTEX_SHADER);
      const f = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(v, vs); gl.compileShader(v);
      if (!gl.getShaderParameter(v,gl.COMPILE_STATUS))
        console.error(`[VS ${name}]`, gl.getShaderInfoLog(v));
      gl.shaderSource(f, fs); gl.compileShader(f);
      if (!gl.getShaderParameter(f,gl.COMPILE_STATUS))
        console.error(`[FS ${name}]`, gl.getShaderInfoLog(f));
      gl.attachShader(p,v); gl.attachShader(p,f); gl.linkProgram(p);
      if (!gl.getProgramParameter(p,gl.LINK_STATUS))
        console.error(`[LINK ${name}]`, gl.getProgramInfoLog(p));
      gl.deleteShader(v); gl.deleteShader(f);
      return p;
    };
    this._programs.lighting  = compile(QUAD_VERT, LIGHTING_FRAG, 'lighting');
    this._programs.sky       = compile(QUAD_VERT, SKY_FRAG, 'sky');
    this._programs.ssao      = compile(QUAD_VERT, SSAO_FRAG, 'ssao');
    this._programs.ssaoBlur  = compile(QUAD_VERT, SSAO_BLUR_FRAG, 'ssaoBlur');
    this._programs.bloomX    = compile(QUAD_VERT, BLOOM_EXTRACT_FRAG, 'bloomX');
    this._programs.bloomBlur = compile(QUAD_VERT, BLOOM_BLUR_FRAG, 'bloomBlur');
    this._programs.motionBlur= compile(QUAD_VERT, MOTION_BLUR_FRAG, 'motionBlur');
    this._programs.tonemap   = compile(QUAD_VERT, TONEMAP_FRAG, 'tonemap');
  }

  _drawQuad() {
    const gl = this.gl;
    gl.bindVertexArray(this._quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  _use(name) {
    this.gl.useProgram(this._programs[name]);
    return this._programs[name];
  }

  _uni(prog, name, ...args) {
    const gl = this.gl;
    const loc = gl.getUniformLocation(prog, name);
    if (loc === null) return;
    if (args.length === 1) {
      if (typeof args[0] === 'number') {
        // Always use uniform1f for scalar numbers; caller uses _uniI for ints
        gl.uniform1f(loc, args[0]);
      } else if (args[0] instanceof Float32Array) {
        if (args[0].length === 16) gl.uniformMatrix4fv(loc, false, args[0]);
        else if (args[0].length === 9) gl.uniformMatrix3fv(loc, false, args[0]);
        else if (args[0].length === 3) gl.uniform3fv(loc, args[0]);
        else if (args[0].length === 2) gl.uniform2fv(loc, args[0]);
      }
    } else if (args.length === 2) gl.uniform2f(loc, args[0], args[1]);
    else if (args.length === 3) gl.uniform3f(loc, args[0], args[1], args[2]);
  }

  _uniI(prog, name, val) {
    const gl = this.gl;
    const loc = gl.getUniformLocation(prog, name);
    if (loc !== null) gl.uniform1i(loc, val);
  }

  _bindTex(prog, name, unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    this._uniI(prog, name, unit);
  }

  /** Run full post-processing pass */
  render(gbuffer, shadowMap, camera, lights, sunDir, sunColor, sunIntensity, time,
         weatherFactor, ssaoKernel, ambientIntensity, skyColor) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    // ── 1. SSAO ──────────────────────────────────────────────────────────
    this.ssaoTarget.bind();
    gl.viewport(0,0, this.ssaoTarget.width, this.ssaoTarget.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const ssaoProg = this._use('ssao');
    this._bindTex(ssaoProg,'u_depth',0,gbuffer.depthTex);
    this._bindTex(ssaoProg,'u_gNormal',1,gbuffer.normalTex);
    this._bindTex(ssaoProg,'u_noise',2,this.textures.get('ssao_noise'));
    gl.uniformMatrix4fv(gl.getUniformLocation(ssaoProg,'u_P'),false,camera.projMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(ssaoProg,'u_V'),false,camera.viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(ssaoProg,'u_invVP'),false,this._invVP(camera));
    if (ssaoKernel) gl.uniform3fv(gl.getUniformLocation(ssaoProg,'u_samples'), ssaoKernel);
    this._uni(ssaoProg,'u_radius', 1.5);
    this._uni(ssaoProg,'u_bias', 0.03);
    gl.uniform2f(gl.getUniformLocation(ssaoProg,'u_resolution'),
      this.ssaoTarget.width, this.ssaoTarget.height);
    this._drawQuad();

    // SSAO blur
    this.ssaoBlur.bind();
    gl.viewport(0,0, this.ssaoBlur.width, this.ssaoBlur.height);
    const blurProg = this._use('ssaoBlur');
    this._bindTex(blurProg,'u_ssao',0,this.ssaoTarget.texture);
    gl.uniform2f(gl.getUniformLocation(blurProg,'u_texelSize'),
      1/this.ssaoBlur.width, 1/this.ssaoBlur.height);
    this._drawQuad();

    // ── 2. Lighting pass ─────────────────────────────────────────────────
    this.hdrTarget.bind();
    gl.viewport(0,0,this.width,this.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const litProg = this._use('lighting');
    this._bindTex(litProg,'u_gAlbedo',0,gbuffer.albedoTex);
    this._bindTex(litProg,'u_gNormal',1,gbuffer.normalTex);
    this._bindTex(litProg,'u_gEmissive',2,gbuffer.emissiveTex);
    this._bindTex(litProg,'u_depth',3,gbuffer.depthTex);
    this._bindTex(litProg,'u_ssao',4,this.ssaoBlur.texture);
    this._bindTex(litProg,'u_shadowMap',5,shadowMap.texture);
    gl.uniformMatrix4fv(gl.getUniformLocation(litProg,'u_invVP'),false,this._invVP(camera));
    gl.uniformMatrix4fv(gl.getUniformLocation(litProg,'u_lightMVP'),false,shadowMap.lightMatrix);
    gl.uniform3fv(gl.getUniformLocation(litProg,'u_camPos'), new Float32Array(camera.position));
    gl.uniform3fv(gl.getUniformLocation(litProg,'u_sunDir'), new Float32Array(sunDir));
    gl.uniform3fv(gl.getUniformLocation(litProg,'u_sunColor'), new Float32Array(sunColor));
    this._uni(litProg,'u_sunIntensity', sunIntensity);
    this._uni(litProg,'u_ambientIntensity', ambientIntensity);
    gl.uniform3fv(gl.getUniformLocation(litProg,'u_skyColor'), new Float32Array(skyColor));
    this._uni(litProg,'u_time', time);
    // Point lights
    const maxLights = Math.min(lights.length, 32);
    this._uniI(litProg,'u_numLights', maxLights);
    if (maxLights > 0) {
      const pos=[],col=[],rad=[];
      for (let i=0;i<maxLights;i++){
        pos.push(lights[i].x,lights[i].y,lights[i].z);
        col.push(lights[i].r,lights[i].g,lights[i].b);
        rad.push(lights[i].radius);
      }
      gl.uniform3fv(gl.getUniformLocation(litProg,'u_lightPos'),new Float32Array(pos));
      gl.uniform3fv(gl.getUniformLocation(litProg,'u_lightColor'),new Float32Array(col));
      gl.uniform1fv(gl.getUniformLocation(litProg,'u_lightRadius'),new Float32Array(rad));
    }
    this._drawQuad();

    // ── 3. Sky composite ─────────────────────────────────────────────────
    const skyProg = this._use('sky');
    this._bindTex(skyProg,'u_depth',0,gbuffer.depthTex);
    gl.uniformMatrix4fv(gl.getUniformLocation(skyProg,'u_invVP'),false,this._invVP(camera));
    gl.uniform3fv(gl.getUniformLocation(skyProg,'u_camPos'), new Float32Array(camera.position));
    gl.uniform3fv(gl.getUniformLocation(skyProg,'u_sunDir'), new Float32Array(sunDir));
    gl.uniform3fv(gl.getUniformLocation(skyProg,'u_sunColor'), new Float32Array(sunColor));
    this._uni(skyProg,'u_sunIntensity', sunIntensity);
    this._uni(skyProg,'u_time', time);
    this._uni(skyProg,'u_weatherFactor', weatherFactor);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this._drawQuad();
    gl.disable(gl.BLEND);
    this.hdrTarget.unbind();

    // ── 4. Bloom ─────────────────────────────────────────────────────────
    // Extract bright pixels
    this.bloomTargets[0].bind();
    gl.viewport(0,0,this.bloomTargets[0].width,this.bloomTargets[0].height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const bxProg = this._use('bloomX');
    this._bindTex(bxProg,'u_hdr',0,this.hdrTarget.texture);
    this._uni(bxProg,'u_threshold', 1.2);
    this._drawQuad();

    // Blur mip chain
    for (let i = 0; i < 5; i++) {
      const src = this.bloomTargets[i*2];
      const dstH= this.bloomTargets[i*2+1]; // horizontal blur target
      const w = src.width, h = src.height;

      dstH.bind();
      gl.viewport(0,0,w,h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const bbProg = this._use('bloomBlur');
      this._bindTex(bbProg,'u_src',0,src.texture);
      gl.uniform2f(gl.getUniformLocation(bbProg,'u_dir'),1,0);
      gl.uniform2f(gl.getUniformLocation(bbProg,'u_texelSize'),1/w,1/h);
      this._drawQuad();

      // For last iteration, keep in place; otherwise feed to next level
      if (i < 4) {
        const dst = this.bloomTargets[(i+1)*2];
        dst.bind();
        gl.viewport(0,0,dst.width,dst.height);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this._bindTex(bbProg,'u_src',0,dstH.texture);
        gl.uniform2f(gl.getUniformLocation(bbProg,'u_dir'),0,1);
        gl.uniform2f(gl.getUniformLocation(bbProg,'u_texelSize'),1/dst.width,1/dst.height);
        this._drawQuad();
      }
    }

    // ── 5. Motion blur ───────────────────────────────────────────────────
    this.motionTarget.bind();
    gl.viewport(0,0,this.width,this.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const mbProg = this._use('motionBlur');
    this._bindTex(mbProg,'u_hdr',0,this.hdrTarget.texture);
    this._bindTex(mbProg,'u_motion',1,gbuffer.motionTex);
    this._uni(mbProg,'u_strength', 6.0);
    this._drawQuad();
    this.motionTarget.unbind();

    // ── 6. Tonemap + composite to screen ─────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0,0,this.width,this.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const tmProg = this._use('tonemap');
    this._bindTex(tmProg,'u_hdr',0,this.motionTarget.texture);
    this._bindTex(tmProg,'u_bloom',1,this.bloomTargets[1].texture); // upsampled bloom
    this._uni(tmProg,'u_exposure', 1.0);
    this._uni(tmProg,'u_bloomStrength', 0.08);
    this._uni(tmProg,'u_time', time);
    gl.uniform2f(gl.getUniformLocation(tmProg,'u_resolution'),this.width,this.height);
    this._drawQuad();
  }

  _invVP(camera) {
    // Return inverse view-projection matrix
    if (!this._invVPBuf) this._invVPBuf = new Float32Array(16);
    mat4Invert(this._invVPBuf, camera.viewProjMatrix);
    return this._invVPBuf;
  }

  resize(w, h) {
    this.width = w; this.height = h;
    this.hdrTarget.dispose(); this.hdrTarget = new RenderTarget(this.gl, w, h);
    this.ssaoTarget.dispose(); this.ssaoTarget = new FloatTarget(this.gl, Math.floor(w/2), Math.floor(h/2));
    this.ssaoBlur.dispose();   this.ssaoBlur   = new FloatTarget(this.gl, Math.floor(w/2), Math.floor(h/2));
    this.motionTarget.dispose(); this.motionTarget = new RenderTarget(this.gl, w, h);
    for (const t of this.bloomTargets) t.dispose();
    this.bloomTargets = [];
    let bw=w, bh=h;
    for (let i=0;i<5;i++){
      bw=Math.max(1,Math.floor(bw/2)); bh=Math.max(1,Math.floor(bh/2));
      this.bloomTargets.push(new RenderTarget(this.gl,bw,bh), new RenderTarget(this.gl,bw,bh));
    }
  }
}

function mat4Invert(out, m) {
  const a=m[0],b=m[1],c=m[2],d=m[3],
        e=m[4],f=m[5],g=m[6],h=m[7],
        i=m[8],j=m[9],k=m[10],l=m[11],
        mn=m[12],n=m[13],o=m[14],p=m[15];
  const b00=a*f-b*e,b01=a*g-c*e,b02=a*h-d*e,b03=b*g-c*f,
        b04=b*h-d*f,b05=c*h-d*g,b06=i*n-j*mn,b07=i*o-k*mn,
        b08=i*p-l*mn,b09=j*o-k*n,b10=j*p-l*n,b11=k*p-l*o;
  let det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
  if(!det){out.fill(0);out[0]=out[5]=out[10]=out[15]=1;return;}
  det=1/det;
  out[0]=(f*b11-g*b10+h*b09)*det; out[1]=(c*b10-b*b11-d*b09)*det;
  out[2]=(n*b05-o*b04+p*b03)*det; out[3]=(k*b04-j*b05-l*b03)*det;
  out[4]=(g*b08-e*b11-h*b07)*det; out[5]=(a*b11-c*b08+d*b07)*det;
  out[6]=(o*b02-mn*b05-p*b01)*det;out[7]=(i*b05-k*b02+l*b01)*det;
  out[8]=(e*b10-f*b08+h*b06)*det; out[9]=(b*b08-a*b10-d*b06)*det;
  out[10]=(mn*b04-n*b02+p*b00)*det;out[11]=(j*b02-i*b04-l*b00)*det;
  out[12]=(f*b07-e*b09-g*b06)*det;out[13]=(a*b09-b*b07+c*b06)*det;
  out[14]=(n*b01-mn*b03-o*b00)*det;out[15]=(i*b03-j*b01+k*b00)*det;
}
