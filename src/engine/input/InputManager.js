/** Keyboard, mouse, gamepad input manager */
export class InputManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = {};
    this.keysDown = {};  // pressed this frame
    this.keysUp = {};    // released this frame
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0, buttons: 0 };
    this.mouseScrollDelta = 0;
    this.pointerLocked = false;
    this._bindEvents();
  }

  _bindEvents() {
    window.addEventListener('keydown', e => {
      if (!this.keys[e.code]) this.keysDown[e.code] = true;
      this.keys[e.code] = true;
      if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))
        e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
      this.keysUp[e.code] = true;
    });
    this.canvas.addEventListener('mousedown', e => {
      this.mouse.buttons |= (1 << e.button);
      if (e.button === 0 && !this.pointerLocked) {
        this.canvas.requestPointerLock();
      }
    });
    window.addEventListener('mouseup', e => {
      this.mouse.buttons &= ~(1 << e.button);
    });
    window.addEventListener('mousemove', e => {
      if (this.pointerLocked) {
        this.mouse.dx += e.movementX;
        this.mouse.dy += e.movementY;
      } else {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
      }
    });
    window.addEventListener('wheel', e => {
      this.mouseScrollDelta += e.deltaY;
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.keys = {};
    });
  }

  isPressed(code)    { return !!this.keys[code]; }
  isDown(code)       { return !!this.keysDown[code]; }
  isUp(code)         { return !!this.keysUp[code]; }
  isMouseDown(btn)   { return !!(this.mouse.buttons & (1 << btn)); }

  // Call at end of each frame
  flush() {
    this.keysDown = {};
    this.keysUp = {};
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouseScrollDelta = 0;
  }

  getAxis() {
    return {
      x: (this.isPressed('KeyD') || this.isPressed('ArrowRight') ? 1 : 0)
       - (this.isPressed('KeyA') || this.isPressed('ArrowLeft')  ? 1 : 0),
      y: (this.isPressed('KeyW') || this.isPressed('ArrowUp')    ? 1 : 0)
       - (this.isPressed('KeyS') || this.isPressed('ArrowDown')  ? 1 : 0),
    };
  }

  lockPointer() { this.canvas.requestPointerLock(); }
  unlockPointer() { document.exitPointerLock(); }
}
