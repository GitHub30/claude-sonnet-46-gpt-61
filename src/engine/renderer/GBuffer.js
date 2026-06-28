/** GBuffer - deferred rendering render targets */
export class GBuffer {
  constructor(gl, width, height) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.fbo = null;
    this.albedoTex = null;  // RGBA16F - albedo+roughness
    this.normalTex = null;  // RGBA16F - normal+metallic
    this.emissiveTex = null;// RGBA16F - emissive+ao
    this.motionTex = null;  // RG16F   - motion vectors
    this.depthTex = null;   // DEPTH_COMPONENT32F
    this._build();
  }

  _build() {
    const gl = this.gl;
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);

    const makeColorTex = (internalFmt, fmt, type) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFmt, this.width, this.height, 0, fmt, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    };

    this.albedoTex  = makeColorTex(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    this.normalTex  = makeColorTex(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    this.emissiveTex= makeColorTex(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    this.motionTex  = makeColorTex(gl.RG16F,   gl.RG,   gl.HALF_FLOAT);

    this.depthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT32F, this.width, this.height, 0,
      gl.DEPTH_COMPONENT, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.albedoTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.normalTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, this.emissiveTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT3, gl.TEXTURE_2D, this.motionTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);

    gl.drawBuffers([
      gl.COLOR_ATTACHMENT0,
      gl.COLOR_ATTACHMENT1,
      gl.COLOR_ATTACHMENT2,
      gl.COLOR_ATTACHMENT3,
    ]);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('GBuffer FBO incomplete:', status.toString(16));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
  }

  unbind() { this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null); }

  resize(w, h) {
    this.dispose();
    this.width = w; this.height = h;
    this._build();
  }

  dispose() {
    const gl = this.gl;
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    for (const t of [this.albedoTex,this.normalTex,this.emissiveTex,this.motionTex,this.depthTex]) {
      if (t) gl.deleteTexture(t);
    }
  }
}

/** Single render target framebuffer */
export class RenderTarget {
  constructor(gl, width, height, internalFmt = null, fmt = null, type = null, isDepth = false) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.isDepth = isDepth;
    this.fbo = gl.createFramebuffer();
    this.texture = gl.createTexture();
    this._internalFmt = internalFmt || (isDepth ? gl.DEPTH_COMPONENT32F : gl.RGBA16F);
    this._fmt = fmt || (isDepth ? gl.DEPTH_COMPONENT : gl.RGBA);
    this._type = type || (isDepth ? gl.FLOAT : gl.HALF_FLOAT);
    this._build();
  }

  _build() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, this._internalFmt, this.width, this.height, 0,
      this._fmt, this._type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.isDepth ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.isDepth ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    if (this.isDepth) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.texture, 0);
      // Need a color attachment for completeness, or use DEPTH_COMPONENT only
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
    } else {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
  }

  unbind() { this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null); }

  dispose() {
    this.gl.deleteFramebuffer(this.fbo);
    this.gl.deleteTexture(this.texture);
  }
}

/** Render target for single-channel float (SSAO, etc.) */
export class FloatTarget extends RenderTarget {
  constructor(gl, w, h) {
    super(gl, w, h, gl.R16F, gl.RED, gl.HALF_FLOAT);
  }
}
