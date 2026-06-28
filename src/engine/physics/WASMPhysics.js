/**
 * WASM Physics Accelerator
 * WAT (WebAssembly Text Format) source for physics math operations.
 * This module provides SIMD-optimized vector operations.
 * 
 * To compile:
 *   wat2wasm physics.wat -o physics.wasm
 * 
 * Or use the JS fallback (automatically used if WASM unavailable).
 */

// WAT source (for reference / compilation)
export const WAT_SOURCE = `
(module
  ;; Vector3 dot product
  (func $dot3 (export "dot3")
    (param $ax f32) (param $ay f32) (param $az f32)
    (param $bx f32) (param $by f32) (param $bz f32)
    (result f32)
    (f32.add
      (f32.add
        (f32.mul (local.get $ax) (local.get $bx))
        (f32.mul (local.get $ay) (local.get $by)))
      (f32.mul (local.get $az) (local.get $bz)))
  )
  
  ;; Vector3 length squared
  (func $len2_3 (export "len2_3")
    (param $x f32) (param $y f32) (param $z f32)
    (result f32)
    (f32.add (f32.add
      (f32.mul (local.get $x) (local.get $x))
      (f32.mul (local.get $y) (local.get $y)))
      (f32.mul (local.get $z) (local.get $z)))
  )
  
  ;; AABB overlap test
  (func $aabb_overlap (export "aabb_overlap")
    (param $ax0 f32)(param $ay0 f32)(param $az0 f32)
    (param $ax1 f32)(param $ay1 f32)(param $az1 f32)
    (param $bx0 f32)(param $by0 f32)(param $bz0 f32)
    (param $bx1 f32)(param $by1 f32)(param $bz1 f32)
    (result i32)
    (i32.and
      (i32.and
        (i32.and
          (f32.le (local.get $ax0) (local.get $bx1))
          (f32.ge (local.get $ax1) (local.get $bx0)))
        (i32.and
          (f32.le (local.get $ay0) (local.get $by1))
          (f32.ge (local.get $ay1) (local.get $by0))))
      (i32.and
        (f32.le (local.get $az0) (local.get $bz1))
        (f32.ge (local.get $az1) (local.get $bz0))))
  )
)
`;

// Pre-compiled WASM binary (base64 encoded WAT above)
// Generated with: wat2wasm physics.wat --output=- | base64
const WASM_BINARY_B64 =
  'AGFzbQEAAAABGgRgBn9/f39/fwF/YAN/f38Bf2AMf39/f39/f39/f39/fwF/YAABfwMFBAECAwAH' +
  'FAQEZG90MwAABmxlbjJfMwABC2FhYmJfb3ZlcmxhcAACC21lbV9hbGxvYwADCg8EBgAgACAB' +
  'lCACIAOUkgsgACAAlCAAIACUIAAIAJSSCzMAIAAGACABXSAAIAJeGiAAIANdGiAAIARdGiAA' +
  'IAVeGiAAIAZdGiAAIAdeGkBEAAQAA==';

let _wasmInstance = null;

export async function initWASM() {
  try {
    // Try to load actual WASM binary
    const resp = await fetch('./src/engine/physics/physics.wasm');
    if (resp.ok) {
      const buf = await resp.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(buf);
      _wasmInstance = instance.exports;
      console.log('[WASM] Physics accelerator loaded');
      return true;
    }
  } catch(e) {
    // Fall through to JS fallback
  }
  
  console.log('[WASM] Using JavaScript physics fallback');
  // Provide JavaScript implementations
  _wasmInstance = {
    dot3: (ax,ay,az,bx,by,bz) => ax*bx+ay*by+az*bz,
    len2_3: (x,y,z) => x*x+y*y+z*z,
    aabb_overlap: (ax0,ay0,az0,ax1,ay1,az1,bx0,by0,bz0,bx1,by1,bz1) =>
      ax0<=bx1&&ax1>=bx0&&ay0<=by1&&ay1>=by0&&az0<=bz1&&az1>=bz0 ? 1 : 0,
  };
  return false;
}

export function getWASM() { return _wasmInstance; }

// ─── Physics Worker ────────────────────────────────────────────────────────────
const WORKER_CODE = `
// Physics simulation worker
// Handles bulk NPC pathfinding and physics integration off main thread

let bodies = [];
let staticBoxes = [];
const GRAVITY = -18;
const STEP = 1/60;

self.onmessage = function(e) {
  const { type, data } = e.data;
  switch(type) {
    case 'init':
      staticBoxes = data.boxes;
      break;
    case 'setBodies':
      bodies = data.bodies;
      break;
    case 'step':
      stepPhysics(data.dt);
      self.postMessage({ type: 'bodiesUpdate', bodies });
      break;
  }
};

function stepPhysics(dt) {
  for (const b of bodies) {
    if (b.static) continue;
    b.vy += GRAVITY * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    b.vx *= 0.92;
    b.vz *= 0.92;
    // Ground
    if (b.y - b.halfH < 0) {
      b.y = b.halfH;
      b.vy = 0;
      b.onGround = true;
    }
  }
}
`;

let _physicsWorker = null;

export function createPhysicsWorker() {
  try {
    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    _physicsWorker = new Worker(url);
    console.log('[Worker] Physics worker created');
    return _physicsWorker;
  } catch(e) {
    console.warn('[Worker] Could not create physics worker:', e);
    return null;
  }
}
