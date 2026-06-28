/** GPU mesh with VAO/VBO management */
export class Mesh {
  constructor(gl) {
    this.gl = gl;
    this.vao = null;
    this.vbo = null;
    this.ibo = null;
    this.indexCount = 0;
    this.vertexCount = 0;
    this.hasIndex = false;
    // AABB for frustum culling
    this.aabbMin = [0,0,0];
    this.aabbMax = [0,0,0];
  }

  /**
   * Upload geometry to GPU
   * @param {Float32Array} vertices - interleaved pos(3)+normal(3)+uv(2)+tangent(4) = 12 floats
   * @param {Uint32Array|Uint16Array} [indices]
   */
  upload(vertices, indices) {
    const gl = this.gl;
    if (!this.vao) this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    if (!this.vbo) this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const stride = 12 * 4; // 12 floats * 4 bytes
    // position (location 0)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    // normal (location 1)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    // uv (location 2)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
    // tangent (location 3)
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 32);

    if (indices) {
      if (!this.ibo) this.ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      this.indexCount = indices.length;
      this.hasIndex = true;
    } else {
      this.vertexCount = vertices.length / 12;
    }

    gl.bindVertexArray(null);
    this._computeAABB(vertices);
  }

  _computeAABB(verts) {
    let minX=Infinity, minY=Infinity, minZ=Infinity;
    let maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;
    for (let i = 0; i < verts.length; i += 12) {
      const x=verts[i], y=verts[i+1], z=verts[i+2];
      if (x<minX) minX=x; if (x>maxX) maxX=x;
      if (y<minY) minY=y; if (y>maxY) maxY=y;
      if (z<minZ) minZ=z; if (z>maxZ) maxZ=z;
    }
    this.aabbMin = [minX,minY,minZ];
    this.aabbMax = [maxX,maxY,maxZ];
  }

  bind()   { this.gl.bindVertexArray(this.vao); }
  unbind() { this.gl.bindVertexArray(null); }

  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    if (this.hasIndex) {
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    } else {
      gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    }
  }

  dispose() {
    const gl = this.gl;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.vbo) gl.deleteBuffer(this.vbo);
    if (this.ibo) gl.deleteBuffer(this.ibo);
  }
}

// ─── Geometry builders ────────────────────────────────────────────────────────

/** Build interleaved vertex data: [pos(3) normal(3) uv(2) tangent(4)] */
export function buildBox(w = 1, h = 1, d = 1, uvScale = 1) {
  const hW = w/2, hH = h/2, hD = d/2;
  // 6 faces, each 4 verts, total 24 verts
  // Face: positions, normal, tangent
  const faces = [
    // +X, -X, +Y, -Y, +Z, -Z
    { n:[1,0,0], t:[0,0,-1,1], verts: [[hW,-hH,-hD],[hW,hH,-hD],[hW,hH,hD],[hW,-hH,hD]] },
    { n:[-1,0,0],t:[0,0,1,1],  verts: [[-hW,-hH,hD],[-hW,hH,hD],[-hW,hH,-hD],[-hW,-hH,-hD]] },
    { n:[0,1,0], t:[1,0,0,1],  verts: [[-hW,hH,-hD],[-hW,hH,hD],[hW,hH,hD],[hW,hH,-hD]] },
    { n:[0,-1,0],t:[1,0,0,1],  verts: [[-hW,-hH,hD],[-hW,-hH,-hD],[hW,-hH,-hD],[hW,-hH,hD]] },
    { n:[0,0,1], t:[1,0,0,1],  verts: [[-hW,-hH,hD],[-hW,hH,hD],[hW,hH,hD],[hW,-hH,hD]] },
    { n:[0,0,-1],t:[-1,0,0,1], verts: [[hW,-hH,-hD],[hW,hH,-hD],[-hW,hH,-hD],[-hW,-hH,-hD]] },
  ];

  const uvs = [[0,0],[0,1],[1,1],[1,0]];
  const verts = []; const inds = [];
  let base = 0;

  for (const face of faces) {
    for (let i = 0; i < 4; i++) {
      const [px,py,pz] = face.verts[i];
      verts.push(px,py,pz, ...face.n, uvs[i][0]*uvScale, uvs[i][1]*uvScale, ...face.t);
    }
    inds.push(base,base+1,base+2, base,base+2,base+3);
    base += 4;
  }

  return { vertices: new Float32Array(verts), indices: new Uint32Array(inds) };
}

export function buildPlane(w = 1, d = 1, segX = 1, segZ = 1, uvScale = 1, yUp = true) {
  const verts = [], inds = [];
  const hW = w/2, hD = d/2;
  const stepX = w / segX, stepZ = d / segZ;
  for (let z = 0; z <= segZ; z++) {
    for (let x = 0; x <= segX; x++) {
      const px = -hW + x * stepX, pz = -hD + z * stepZ;
      const u = (x/segX)*uvScale, v = (z/segZ)*uvScale;
      if (yUp)
        verts.push(px,0,pz, 0,1,0, u,v, 1,0,0,1);
      else
        verts.push(px,pz,0, 0,0,1, u,v, 1,0,0,1);
    }
  }
  for (let z = 0; z < segZ; z++) for (let x = 0; x < segX; x++) {
    const a = z*(segX+1)+x, b = a+segX+1;
    inds.push(a,b,a+1, a+1,b,b+1);
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(inds) };
}

export function buildCylinder(r = 1, h = 2, segs = 16, uvScale = 1) {
  const verts = [], inds = [];
  // Side vertices
  for (let i = 0; i <= segs; i++) {
    const angle = (i/segs) * Math.PI * 2;
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
    const nx = Math.cos(angle), nz = Math.sin(angle);
    const u = i/segs * uvScale;
    verts.push(x, -h/2, z,  nx,0,nz,  u,0*uvScale, nx,0,nz, 1);  // bottom
    verts.push(x,  h/2, z,  nx,0,nz,  u,1*uvScale, nx,0,nz, 1);  // top
  }
  for (let i = 0; i < segs; i++) {
    const b = i*2;
    inds.push(b,b+1,b+2, b+2,b+1,b+3);
  }
  // Top/bottom caps
  const topCenter = verts.length/12, botCenter = topCenter+1;
  verts.push(0, h/2, 0,  0,1,0,  0.5,0.5, 1,0,0, 1);
  verts.push(0,-h/2, 0,  0,-1,0, 0.5,0.5, 1,0,0, 1);
  for (let i = 0; i < segs; i++) {
    inds.push(topCenter, i*2+1, (i*2+3)%(segs*2+2));
    inds.push(botCenter, i*2,   (i*2+2)%(segs*2+2));
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(inds) };
}

export function buildSphere(r = 1, segsH = 16, segsV = 12) {
  const verts = [], inds = [];
  for (let v = 0; v <= segsV; v++) {
    const phi = (v/segsV) * Math.PI;
    for (let h = 0; h <= segsH; h++) {
      const theta = (h/segsH) * Math.PI * 2;
      const x=Math.sin(phi)*Math.cos(theta), y=Math.cos(phi), z=Math.sin(phi)*Math.sin(theta);
      verts.push(x*r,y*r,z*r, x,y,z, h/segsH, v/segsV, Math.cos(theta),0,-Math.sin(theta),1);
    }
  }
  for (let v = 0; v < segsV; v++) for (let h = 0; h < segsH; h++) {
    const a=v*(segsH+1)+h, b=a+segsH+1;
    inds.push(a,b,a+1, a+1,b,b+1);
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(inds) };
}

/** Simple humanoid mesh (for player / NPC) */
export function buildHumanoid(scale = 1) {
  const parts = [];
  // Torso
  const torso = buildBox(0.45*scale, 0.6*scale, 0.25*scale, 2);
  // Head
  const head = buildBox(0.3*scale, 0.3*scale, 0.3*scale, 2);
  // Combine (simplified - just a single box for now)
  return buildBox(0.45*scale, 1.8*scale, 0.25*scale, 2);
}
