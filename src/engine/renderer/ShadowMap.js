/** Cascaded shadow maps */
export class ShadowMap {
  constructor(gl, size = 2048) {
    this.gl = gl;
    this.size = size;
    this.fbo = null;
    this.texture = null;
    this.lightMatrix = new Float32Array(16);
    this._build();
  }

  _build() {
    const gl = this.gl;
    this.fbo = gl.createFramebuffer();
    this.texture = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT32F, this.size, this.size, 0,
      gl.DEPTH_COMPONENT, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.texture, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);

    const s = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (s !== gl.FRAMEBUFFER_COMPLETE) console.error('Shadow FBO incomplete:', s.toString(16));

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Update light-space matrix from sun direction and camera frustum */
  updateLightMatrix(sunDir, camPos, camRadius = 200) {
    const [lx,ly,lz] = [-sunDir[0], -sunDir[1], -sunDir[2]];
    const lightPos = [
      camPos[0] + lx * camRadius * 0.5,
      camPos[1] + ly * camRadius * 0.5,
      camPos[2] + lz * camRadius * 0.5,
    ];
    // Orthographic projection
    const r = camRadius * 1.2;
    const near = 1;
    const far = camRadius * 3;
    const lightView = lookAt(lightPos, camPos, [0,1,0]);
    const lightProj = ortho(-r, r, -r, r, near, far);
    mat4Mul(this.lightMatrix, lightProj, lightView);
  }

  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.size, this.size);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.cullFace(gl.FRONT); // Peter-panning fix
  }

  unbind() {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.cullFace(this.gl.BACK);
  }

  dispose() {
    this.gl.deleteFramebuffer(this.fbo);
    this.gl.deleteTexture(this.texture);
  }
}

// ─── Math helpers ─────────────────────────────────────────────────────────────
function lookAt(eye, center, up) {
  const fz = normalize([center[0]-eye[0], center[1]-eye[1], center[2]-eye[2]]);
  const sx = normalize(cross(fz, up));
  const sy = cross(sx, fz);
  return new Float32Array([
    sx[0], sy[0], -fz[0], 0,
    sx[1], sy[1], -fz[1], 0,
    sx[2], sy[2], -fz[2], 0,
    -dot(sx,eye), -dot(sy,eye), dot(fz,eye), 1
  ]);
}

function ortho(l, r, b, t, n, f) {
  return new Float32Array([
    2/(r-l), 0, 0, 0,
    0, 2/(t-b), 0, 0,
    0, 0, -2/(f-n), 0,
    -(r+l)/(r-l), -(t+b)/(t-b), -(f+n)/(f-n), 1
  ]);
}

function mat4Mul(out, a, b) {
  for (let j = 0; j < 4; j++) {
    const b0=b[j*4], b1=b[j*4+1], b2=b[j*4+2], b3=b[j*4+3];
    out[j*4]   = b0*a[0]+b1*a[4]+b2*a[8]+b3*a[12];
    out[j*4+1] = b0*a[1]+b1*a[5]+b2*a[9]+b3*a[13];
    out[j*4+2] = b0*a[2]+b1*a[6]+b2*a[10]+b3*a[14];
    out[j*4+3] = b0*a[3]+b1*a[7]+b2*a[11]+b3*a[15];
  }
}

function normalize(v) {
  const l=Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);
  return l>1e-8 ? [v[0]/l,v[1]/l,v[2]/l] : [0,0,0];
}
function cross(a,b) {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function dot(a,b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
