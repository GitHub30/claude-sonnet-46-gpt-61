/** Web Audio API manager - BGM, ambient, SFX */
export class AudioManager {
  constructor() {
    this._ctx = null;
    this._master = null;
    this._sfxGain = null;
    this._bgmGain = null;
    this._ambGain = null;
    this._bgmSource = null;
    this._ambSource = null;
    this._buffers = new Map();
    this._activated = false;
  }

  async init() {
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._master = this._ctx.createGain(); this._master.gain.value = 1.0;
    this._bgmGain = this._ctx.createGain(); this._bgmGain.gain.value = 0.35;
    this._ambGain = this._ctx.createGain(); this._ambGain.gain.value = 0.5;
    this._sfxGain = this._ctx.createGain(); this._sfxGain.gain.value = 0.8;
    this._bgmGain.connect(this._master);
    this._ambGain.connect(this._master);
    this._sfxGain.connect(this._master);
    this._master.connect(this._ctx.destination);
    this._generateSounds();
  }

  _generateSounds() {
    // Procedurally generate all sound buffers
    this._buffers.set('footstep', this._makeFootstep());
    this._buffers.set('engine_idle', this._makeEngineIdle());
    this._buffers.set('engine_rev', this._makeEngineRev());
    this._buffers.set('wind', this._makeWind());
    this._buffers.set('rain', this._makeRain());
    this._buffers.set('city_amb', this._makeCityAmb());
    this._buffers.set('bgm', this._makeBGM());
    this._buffers.set('car_enter', this._makeCarEnter());
    this._buffers.set('jump', this._makeJump());
  }

  _makeBuffer(sampleRate, duration, fillFn) {
    const len = Math.floor(sampleRate * duration);
    const buf = this._ctx.createBuffer(1, len, sampleRate);
    const data = buf.getChannelData(0);
    fillFn(data, len, sampleRate);
    return buf;
  }

  _makeFootstep() {
    return this._makeBuffer(44100, 0.12, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / n;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 25) * 0.6;
      }
    });
  }

  _makeEngineIdle() {
    return this._makeBuffer(44100, 2.0, (d, n, sr) => {
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = (Math.sin(t * 2 * Math.PI * 42) * 0.3
              + Math.sin(t * 2 * Math.PI * 84) * 0.15
              + Math.sin(t * 2 * Math.PI * 168) * 0.08
              + (Math.random() * 2 - 1) * 0.04)
              * 0.7;
      }
    });
  }

  _makeEngineRev() {
    return this._makeBuffer(44100, 0.8, (d, n, sr) => {
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const f = 80 + (i / n) * 240;
        d[i] = (Math.sin(t * 2 * Math.PI * f) * 0.4
              + Math.sin(t * 2 * Math.PI * f * 2) * 0.2
              + (Math.random() * 2 - 1) * 0.06) * Math.min(1, (n - i) / (n * 0.1));
      }
    });
  }

  _makeWind() {
    return this._makeBuffer(22050, 3.0, (d, n) => {
      let lp = 0;
      for (let i = 0; i < n; i++) {
        lp += ((Math.random() * 2 - 1) - lp) * 0.005;
        d[i] = lp * 0.4;
      }
    });
  }

  _makeRain() {
    return this._makeBuffer(22050, 2.0, (d, n) => {
      for (let i = 0; i < n; i++) {
        d[i] = (Math.random() * 2 - 1) * 0.3;
      }
    });
  }

  _makeCityAmb() {
    return this._makeBuffer(22050, 4.0, (d, n, sr) => {
      let lp = 0;
      for (let i = 0; i < n; i++) {
        lp += ((Math.random() * 2 - 1) - lp) * 0.002;
        const t = i / sr;
        d[i] = lp * 0.25 + Math.sin(t * 2 * Math.PI * 0.5) * 0.05;
      }
    });
  }

  _makeBGM() {
    const sr = 22050, dur = 8.0;
    return this._makeBuffer(sr, dur, (d, n, sampleRate) => {
      const notes = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25];
      const bpm = 90, beat = sampleRate * 60 / bpm;
      for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        const bIdx = Math.floor(i / beat) % notes.length;
        const noteFreq = notes[bIdx];
        const phase = (i % beat) / beat;
        const env = Math.min(1, phase * 8) * Math.max(0, 1 - (phase - 0.7) * 3);
        d[i] = (Math.sin(t * 2 * Math.PI * noteFreq) * 0.25
              + Math.sin(t * 2 * Math.PI * noteFreq * 2) * 0.1
              + Math.sin(t * 2 * Math.PI * noteFreq * 0.5) * 0.08) * env * 0.4;
      }
    });
  }

  _makeCarEnter() {
    return this._makeBuffer(44100, 0.3, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / n;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 10) * 0.5;
      }
    });
  }

  _makeJump() {
    return this._makeBuffer(44100, 0.2, (d, n, sr) => {
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const f = 200 - t * 100;
        d[i] = Math.sin(t * 2 * Math.PI * f) * Math.exp(-t * 20) * 0.4;
      }
    });
  }

  activate() {
    if (this._activated) return;
    if (this._ctx.state === 'suspended') this._ctx.resume();
    this._activated = true;
    this.playAmbient('city_amb');
    this.playBGM('bgm');
  }

  playBGM(name) {
    if (!this._ctx || !this._buffers.has(name)) return;
    if (this._bgmSource) { this._bgmSource.stop(); this._bgmSource = null; }
    const src = this._ctx.createBufferSource();
    src.buffer = this._buffers.get(name);
    src.loop = true;
    src.connect(this._bgmGain);
    src.start();
    this._bgmSource = src;
  }

  playAmbient(name) {
    if (!this._ctx || !this._buffers.has(name)) return;
    if (this._ambSource) { this._ambSource.stop(); this._ambSource = null; }
    const src = this._ctx.createBufferSource();
    src.buffer = this._buffers.get(name);
    src.loop = true;
    src.connect(this._ambGain);
    src.start();
    this._ambSource = src;
  }

  playSFX(name, volume = 1.0, detune = 0) {
    if (!this._ctx || !this._buffers.has(name) || !this._activated) return;
    if (this._ctx.state === 'suspended') return;
    const src = this._ctx.createBufferSource();
    src.buffer = this._buffers.get(name);
    src.detune.value = detune;
    const gain = this._ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(this._sfxGain);
    src.start();
  }

  setEngineSound(rpm) {
    // Dynamic engine pitch via detune
  }

  setMasterVolume(v) { this._master && (this._master.gain.value = v); }
  setBGMVolume(v)    { this._bgmGain && (this._bgmGain.gain.value = v); }
  setAmbVolume(v)    { this._ambGain && (this._ambGain.gain.value = v); }
  setSFXVolume(v)    { this._sfxGain && (this._sfxGain.gain.value = v); }
}
