/* ============================================================================
 *  마몽어스 · 효과음 (WebAudio 절차 생성 · 외부 파일 0)
 * ==========================================================================*/
const Sfx = {
  ctx: null, master: null, muted: false,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    } catch {}
  },
  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); },
  _env(node, t0, a, d, peak = 1) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    node.connect(g); g.connect(this.master);
    return g;
  },
  tone(freq, dur = 0.12, type = 'sine', when = 0, slideTo = null, vol = 1) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    this._env(o, t0, 0.008, dur, vol);
    o.start(t0); o.stop(t0 + dur + 0.06);
  },
  noise(dur = 0.25, filterFreq = 900, vol = 0.7, sweepTo = null) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(filterFreq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    src.connect(f);
    this._env(f, t0, 0.01, dur, vol);
    src.start(t0);
  },

  click()      { this.tone(880, 0.05, 'square', 0, 660, 0.35); },
  /** 인사 — 밝게 두 번 통통 */
  wave() { this.tone(620, 0.07, 'triangle', 0, 780, 0.4); this.tone(780, 0.09, 'triangle', 0.09, 990, 0.4); },
  /** 방귀 — 낮은 톱니파가 떨리며 내려간다. 대기실 장난용 */
  fart() {
    this.tone(140, 0.09, 'sawtooth', 0,    95, 0.5);
    this.tone(110, 0.13, 'sawtooth', 0.07, 70, 0.55);
    this.tone(85,  0.22, 'sawtooth', 0.16, 45, 0.5);
    this.noise?.(0.28, 300, 0.25, 120);
  },
  step()       { this.tone(180, 0.04, 'sine', 0, 120, 0.12); },
  taskStep()   { this.tone(660, 0.08, 'triangle', 0, 880, 0.5); },
  taskDone()   { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.13, 'triangle', i * 0.07, null, 0.5)); },
  kill()       { this.noise(0.5, 2200, 1, 120); this.tone(140, 0.5, 'sawtooth', 0, 40, 0.6); },
  bodyFound()  { [880, 0, 880, 0, 660].forEach((f, i) => f && this.tone(f, 0.18, 'square', i * 0.13, null, 0.55)); },
  meeting()    { [392, 523, 659].forEach((f, i) => this.tone(f, 0.32, 'sawtooth', i * 0.14, null, 0.4)); },
  vote()       { this.tone(1046, 0.09, 'square', 0, 1318, 0.4); },
  eject()      { this.tone(300, 1.0, 'sine', 0, 60, 0.5); this.noise(0.9, 500, 0.4, 80); },
  vent()       { this.noise(0.3, 700, 0.6, 200); this.tone(240, 0.22, 'sine', 0, 90, 0.35); },
  sabotage()   { for (let i = 0; i < 3; i++) { this.tone(700, 0.22, 'sawtooth', i * 0.3, 420, 0.5); } },
  alarm()      { this.tone(880, 0.3, 'square', 0, 500, 0.45); this.tone(880, 0.3, 'square', 0.45, 500, 0.45); },
  fixed()      { [784, 1046].forEach((f, i) => this.tone(f, 0.16, 'triangle', i * 0.1, null, 0.5)); },
  win()        { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.3, 'triangle', i * 0.12, null, 0.5)); },
  lose()       { [440, 392, 330, 262].forEach((f, i) => this.tone(f, 0.35, 'sine', i * 0.16, null, 0.45)); },
  chat()       { this.tone(1200, 0.05, 'sine', 0, 1600, 0.22); },
  alert()      { this.tone(1400, 0.07, 'square', 0, 1000, 0.3); this.tone(1000, 0.07, 'square', 0.09, 1400, 0.3); },
  quack()      { this.tone(420, 0.1, 'sawtooth', 0, 260, 0.4); this.tone(300, 0.09, 'square', 0.09, 190, 0.3); },
};
