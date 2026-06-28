/** Camera - view/projection matrices, frustum culling */
export class Camera {
  constructor() {
    this.position = [0, 5, 10];
    this.target   = [0, 0, 0];
    this.up       = [0, 1, 0];
    this.fov      = 70 * Math.PI / 180;
    this.aspect   = 16 / 9;
    this.near     = 0.3;
    this.far      = 2000;
    this.viewMatrix = new Float32Array(16);
    this.projMatrix = new Float32Array(16);
    this.viewProjMatrix = new Float32Array(16);
    this.prevViewProjMatrix = new Float32Array(16);
    this._frustumPlanes = new Array(6).fill(null).map(() => new Float32Array(4));
    this._dirty = true;
  }

  lookAt(eye, center, up) {
    this.position = [...eye];
    this.target   = [...center];
    this.up       = [...up];
    this._dirty = true;
  }

  setProjection(fov, aspect, near, far) {
    this.fov = fov; this.aspect = aspect; this.near = near; this.far = far;
    this._dirty = true;
  }

  update() {
    // Save previous VP (for motion vectors). On the very first frame prevVP is
    // still all-zeros, so we defer the copy until after the first build.
    const isFirst = !this._firstFrameDone;
    if (!isFirst) {
      this.prevViewProjMatrix.set(this.viewProjMatrix);
    }
    this._buildView();
    this._buildProj();
    mat4Multiply(this.viewProjMatrix, this.projMatrix, this.viewMatrix);
    if (isFirst) {
      // First frame: initialize prevVP to the same matrix to avoid NaN motion vectors
      this._firstFrameDone = true;
      this.prevViewProjMatrix.set(this.viewProjMatrix);
    }
    this._buildFrustum();
    this._dirty = false;
  }

  _buildView() {
    const [ex,ey,ez] = this.position;
    const [cx,cy,cz] = this.target;
    const [ux,uy,uz] = this.up;

    let fz = [cx-ex, cy-ey, cz-ez]; normalize3(fz);
    let sx = cross3(fz, [ux,uy,uz]); normalize3(sx);
    let sy = cross3(sx, fz);

    const m = this.viewMatrix;
    m[0]=sx[0]; m[4]=sx[1]; m[8]=sx[2];   m[12]=-dot3(sx,[ex,ey,ez]);
    m[1]=sy[0]; m[5]=sy[1]; m[9]=sy[2];   m[13]=-dot3(sy,[ex,ey,ez]);
    m[2]=-fz[0];m[6]=-fz[1];m[10]=-fz[2]; m[14]=dot3(fz,[ex,ey,ez]);
    m[3]=0;m[7]=0;m[11]=0;m[15]=1;
  }

  _buildProj() {
    const f = 1 / Math.tan(this.fov / 2);
    const nf = 1 / (this.near - this.far);
    const m = this.projMatrix;
    m[0]=f/this.aspect; m[1]=0;  m[2]=0;  m[3]=0;
    m[4]=0; m[5]=f;     m[6]=0;  m[7]=0;
    m[8]=0; m[9]=0;     m[10]=(this.far+this.near)*nf; m[11]=-1;
    m[12]=0;m[13]=0;    m[14]=2*this.far*this.near*nf; m[15]=0;
  }

  _buildFrustum() {
    const m = this.viewProjMatrix;
    // Left, Right, Bottom, Top, Near, Far
    const planes = this._frustumPlanes;
    // Left:   m[3]+m[0], m[7]+m[4], m[11]+m[8], m[15]+m[12]
    planes[0][0]=m[3]+m[0]; planes[0][1]=m[7]+m[4]; planes[0][2]=m[11]+m[8];  planes[0][3]=m[15]+m[12];
    // Right:  m[3]-m[0]
    planes[1][0]=m[3]-m[0]; planes[1][1]=m[7]-m[4]; planes[1][2]=m[11]-m[8];  planes[1][3]=m[15]-m[12];
    // Bottom: m[3]+m[1]
    planes[2][0]=m[3]+m[1]; planes[2][1]=m[7]+m[5]; planes[2][2]=m[11]+m[9];  planes[2][3]=m[15]+m[13];
    // Top:    m[3]-m[1]
    planes[3][0]=m[3]-m[1]; planes[3][1]=m[7]-m[5]; planes[3][2]=m[11]-m[9];  planes[3][3]=m[15]-m[13];
    // Near:   m[3]+m[2]
    planes[4][0]=m[3]+m[2]; planes[4][1]=m[7]+m[6]; planes[4][2]=m[11]+m[10]; planes[4][3]=m[15]+m[14];
    // Far:    m[3]-m[2]
    planes[5][0]=m[3]-m[2]; planes[5][1]=m[7]-m[6]; planes[5][2]=m[11]-m[10]; planes[5][3]=m[15]-m[14];
    for (const p of planes) normalizePlane(p);
  }

  /** Returns false if AABB is outside frustum */
  frustumCullAABB(minX,minY,minZ, maxX,maxY,maxZ) {
    for (const p of this._frustumPlanes) {
      const px = p[0]>0?maxX:minX;
      const py = p[1]>0?maxY:minY;
      const pz = p[2]>0?maxZ:minZ;
      if (p[0]*px + p[1]*py + p[2]*pz + p[3] < 0) return false;
    }
    return true;
  }

  /** Returns false if sphere is outside frustum */
  frustumCullSphere(cx,cy,cz, r) {
    for (const p of this._frustumPlanes) {
      if (p[0]*cx + p[1]*cy + p[2]*cz + p[3] < -r) return false;
    }
    return true;
  }

  get forward() {
    const m = this.viewMatrix;
    return [-m[2], -m[6], -m[10]];
  }

  get right() {
    const m = this.viewMatrix;
    return [m[0], m[4], m[8]];
  }
}

// --- Math helpers ---
function normalize3(v) {
  const len = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);
  if (len > 1e-7) { v[0]/=len; v[1]/=len; v[2]/=len; }
  return v;
}
function dot3(a,b)   { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function cross3(a,b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function normalizePlane(p) {
  const len = Math.sqrt(p[0]*p[0]+p[1]*p[1]+p[2]*p[2]);
  if (len > 1e-7) { p[0]/=len; p[1]/=len; p[2]/=len; p[3]/=len; }
}

export function mat4Multiply(out, a, b) {
  for (let j = 0; j < 4; j++) {
    const b0=b[j*4], b1=b[j*4+1], b2=b[j*4+2], b3=b[j*4+3];
    out[j*4]   = b0*a[0]+b1*a[4]+b2*a[8]+b3*a[12];
    out[j*4+1] = b0*a[1]+b1*a[5]+b2*a[9]+b3*a[13];
    out[j*4+2] = b0*a[2]+b1*a[6]+b2*a[10]+b3*a[14];
    out[j*4+3] = b0*a[3]+b1*a[7]+b2*a[11]+b3*a[15];
  }
}

export function mat4Identity(out) {
  out.fill(0);
  out[0]=out[5]=out[10]=out[15]=1;
  return out;
}

export function mat4FromTRS(out, tx,ty,tz, rx,ry,rz, sx,sy,sz) {
  const cx=Math.cos(rx),sx_=Math.sin(rx);
  const cy=Math.cos(ry),sy_=Math.sin(ry);
  const cz=Math.cos(rz),sz_=Math.sin(rz);
  out[0]  = (cy*cz)*sx;
  out[1]  = (cy*cz)*sy;
  out[2]  = (cy*cz)*sz;
  out[3]  = 0;

  // Simplified TRS - rotation around Y
  const c=cy, s=sy_;
  out[0]  = c*sx; out[1]=0;  out[2]=-s*sx;  out[3]=0;
  out[4]  = 0;    out[5]=sy; out[6]=0;       out[7]=0;
  out[8]  = s*sz; out[9]=0;  out[10]=c*sz;   out[11]=0;
  out[12] = tx;   out[13]=ty; out[14]=tz;    out[15]=1;
}

export function mat4FromTranslationYRotation(out, tx,ty,tz, ry, sx_=1,sy_=1,sz_=1) {
  const c=Math.cos(ry), s=Math.sin(ry);
  out[0]  = c*sx_;  out[1]=0;    out[2]=-s*sx_;  out[3]=0;
  out[4]  = 0;      out[5]=sy_;  out[6]=0;        out[7]=0;
  out[8]  = s*sz_;  out[9]=0;    out[10]=c*sz_;   out[11]=0;
  out[12] = tx;     out[13]=ty;  out[14]=tz;      out[15]=1;
  return out;
}

export function mat4Invert(out, m) {
  const a00=m[0],a01=m[1],a02=m[2],a03=m[3];
  const a10=m[4],a11=m[5],a12=m[6],a13=m[7];
  const a20=m[8],a21=m[9],a22=m[10],a23=m[11];
  const a30=m[12],a31=m[13],a32=m[14],a33=m[15];
  const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10;
  const b02=a00*a13-a03*a10, b03=a01*a12-a02*a11;
  const b04=a01*a13-a03*a11, b05=a02*a13-a03*a12;
  const b06=a20*a31-a21*a30, b07=a20*a32-a22*a30;
  const b08=a20*a33-a23*a30, b09=a21*a32-a22*a31;
  const b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
  let det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
  if (!det) return null;
  det = 1/det;
  out[0]=(a11*b11-a12*b10+a13*b09)*det; out[1]=(a02*b10-a01*b11-a03*b09)*det;
  out[2]=(a31*b05-a32*b04+a33*b03)*det; out[3]=(a22*b04-a21*b05-a23*b03)*det;
  out[4]=(a12*b08-a10*b11-a13*b07)*det; out[5]=(a00*b11-a02*b08+a03*b07)*det;
  out[6]=(a32*b02-a30*b05-a33*b01)*det; out[7]=(a20*b05-a22*b02+a23*b01)*det;
  out[8]=(a10*b10-a11*b08+a13*b06)*det; out[9]=(a01*b08-a00*b10-a03*b06)*det;
  out[10]=(a30*b04-a31*b02+a33*b00)*det;out[11]=(a21*b02-a20*b04-a23*b00)*det;
  out[12]=(a11*b07-a10*b09-a12*b06)*det;out[13]=(a00*b09-a01*b07+a02*b06)*det;
  out[14]=(a31*b01-a30*b03-a32*b00)*det;out[15]=(a20*b03-a21*b01+a22*b00)*det;
  return out;
}
